package com.technoverse.admin

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.projection.MediaProjection
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.DataChannel
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.ScreenCapturerAndroid
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoCapturer

/**
 * Servicio en primer plano que sostiene la captura de pantalla nativa
 * (MediaProjection) y la conexión WebRTC mientras dure.
 *
 * LA NOTIFICACIÓN PERMANENTE NO ES OPCIONAL: Android exige un servicio en
 * primer plano con `foregroundServiceType="mediaProjection"` para que
 * MediaProjection funcione, y ese tipo de servicio obliga a mostrar una
 * notificación fija, no descartable, mientras esté activo. Es política del
 * sistema operativo — no una decisión de esta aplicación, y no hay forma
 * de ocultarla sin dejar de usar MediaProjection.
 *
 * La señalización (Supabase Realtime, intercambio de SDP/hielo) vive
 * enteramente en TypeScript (`capturaPantallaNativa.ts`), igual que la
 * pantalla completa de escritorio (`capturaPantalla.ts`). Este servicio
 * solo expone primitivas WebRTC a `PantallaNativaPlugin`: crear oferta,
 * fijar respuesta, agregar hielo, detener.
 *
 * FLAG_SECURE: ya no se aplica, y por eso esto se ve. Esa bandera ciega
 * TODA captura por igual —la de un tercero y la nuestra—, así que
 * mientras estuvo puesta este servicio transmitía un rectángulo negro.
 * Android no ofrece un "cegá a los demás pero a mí no", así que
 * `escudoDlp.ts` dejó de encenderla. El costo queda anotado allá: en la
 * APK, otras apps pueden grabar la pantalla.
 */
class CapturaPantallaService : Service() {

    companion object {
        private const val ID_CANAL = "captura_pantalla"
        private const val ID_NOTIFICACION = 4177
        private const val EXTRA_RESULT_CODE = "resultCode"
        private const val EXTRA_RESULT_DATA = "resultData"

        private var instancia: CapturaPantallaService? = null

        /** El plugin se suscribe aquí para reenviar hielo/estado al WebView. */
        var onHielo: ((candidato: String, sdpMid: String?, indice: Int) -> Unit)? = null
        var onEstado: ((estado: String) -> Unit)? = null

        fun iniciar(context: Context, resultCode: Int, data: Intent) {
            val intent = Intent(context, CapturaPantallaService::class.java)
            intent.putExtra(EXTRA_RESULT_CODE, resultCode)
            intent.putExtra(EXTRA_RESULT_DATA, data)
            ContextCompat.startForegroundService(context, intent)
        }

        fun crearOferta(alTerminar: (String?) -> Unit) {
            val actual = instancia
            if (actual == null) alTerminar(null) else actual.crearOfertaInterna(alTerminar)
        }

        fun fijarRespuesta(sdp: String) {
            instancia?.fijarRespuestaInterna(sdp)
        }

        fun agregarHielo(candidato: String, sdpMid: String?, indice: Int) {
            instancia?.agregarHieloInterno(candidato, sdpMid, indice)
        }

        fun detener(context: Context) {
            context.stopService(Intent(context, CapturaPantallaService::class.java))
        }
    }

    private var eglBase: EglBase? = null
    private var factory: PeerConnectionFactory? = null
    private var capturer: VideoCapturer? = null
    private var surfaceHelper: SurfaceTextureHelper? = null
    private var pc: PeerConnection? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instancia = this
        crearCanalNotificacion()
    }

    @Suppress("DEPRECATION")
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notificacion = construirNotificacion()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ServiceCompat.startForeground(
                this,
                ID_NOTIFICACION,
                notificacion,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
            )
        } else {
            startForeground(ID_NOTIFICACION, notificacion)
        }

        if (pc == null) {
            val resultCode = intent?.getIntExtra(EXTRA_RESULT_CODE, 0) ?: 0
            val resultData: Intent? = intent?.getParcelableExtra(EXTRA_RESULT_DATA)
            if (resultData != null) {
                armarWebRtc(resultCode, resultData)
            }
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        detenerTodo()
        if (instancia === this) instancia = null
        super.onDestroy()
    }

    /**
     * Canal en IMPORTANCE_MIN: lo más discreto que Android deja para un
     * servicio en primer plano. Sin sonido, sin vibración, sin asomarse
     * arriba de la pantalla; queda plegada abajo, en el grupo de avisos
     * silenciosos de la persiana.
     *
     * HASTA DÓNDE LLEGA "DISCRETO", SIN ADORNOS: la notificación NO se
     * puede quitar, ni achicar más, ni mover al pie de la app. La pinta el
     * sistema operativo en su propia persiana —no es un elemento de esta
     * aplicación, así que no hay CSS ni layout que la gobierne—. Y aparte
     * de la nuestra, Android 10+ dibuja su PROPIO indicador de "se está
     * grabando la pantalla" en la barra de estado, que ninguna app puede
     * tocar. Esto es lo mínimo alcanzable, no lo mínimo deseable.
     */
    private fun crearCanalNotificacion() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val canal = NotificationChannel(
                ID_CANAL,
                "Soporte remoto",
                NotificationManager.IMPORTANCE_MIN
            )
            canal.description = "Aviso silencioso mientras hay una sesión de soporte en curso."
            canal.setShowBadge(false)
            canal.setSound(null, null)
            canal.enableVibration(false)
            canal.enableLights(false)
            val gestor = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            gestor.createNotificationChannel(canal)
        }
    }

    private fun construirNotificacion(): Notification {
        return NotificationCompat.Builder(this, ID_CANAL)
            .setContentTitle("Soporte remoto activo")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(true)
            .setSilent(true)
            .setShowWhen(false)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            // Android 12+: permite al sistema retrasar hasta 10 s el momento
            // de mostrarla. No la oculta —eso no existe—, solo evita que
            // salte en el instante justo en que la persona inicia sesión.
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_DEFERRED)
            .build()
    }

    private fun armarWebRtc(resultCode: Int, data: Intent) {
        val opciones = PeerConnectionFactory.InitializationOptions
            .builder(applicationContext)
            .createInitializationOptions()
        PeerConnectionFactory.initialize(opciones)

        val base = EglBase.create()
        eglBase = base

        val fabrica = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(base.eglBaseContext, true, true))
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(base.eglBaseContext))
            .createPeerConnectionFactory()
        factory = fabrica

        val ayudanteSuperficie = SurfaceTextureHelper.create("captura-pantalla", base.eglBaseContext)
        surfaceHelper = ayudanteSuperficie

        val fuente = fabrica.createVideoSource(true)

        val capturador = ScreenCapturerAndroid(
            data,
            object : MediaProjection.Callback() {
                override fun onStop() {
                    onEstado?.invoke("desconectado")
                    detenerTodo()
                }
            }
        )
        capturer = capturador
        capturador.initialize(ayudanteSuperficie, applicationContext, fuente.capturerObserver)

        val metrica = resources.displayMetrics
        val anchoReal = metrica.widthPixels
        val altoReal = metrica.heightPixels
        // Techo de 1280px de ancho: suficiente para leer el celular en el
        // panel del Superadmin sin gastar de más el ancho de banda móvil.
        val ancho = if (anchoReal > 1280) 1280 else anchoReal
        val alto = if (anchoReal > 0) (ancho.toFloat() / anchoReal * altoReal).toInt() else altoReal
        capturador.startCapture(ancho, alto, 12)

        val pista = fabrica.createVideoTrack("pantalla_v0", fuente)

        val servidoresHielo = listOf(
            PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),
            PeerConnection.IceServer.builder("stun:stun1.l.google.com:19302").createIceServer()
        )
        val configuracion = PeerConnection.RTCConfiguration(servidoresHielo)

        val conexion = fabrica.createPeerConnection(
            configuracion,
            object : PeerConnection.Observer {
                override fun onIceCandidate(candidato: IceCandidate) {
                    onHielo?.invoke(candidato.sdp, candidato.sdpMid, candidato.sdpMLineIndex)
                }
                override fun onIceCandidatesRemoved(candidatos: Array<out IceCandidate>) {}
                override fun onConnectionChange(estado: PeerConnection.PeerConnectionState) {
                    when (estado) {
                        PeerConnection.PeerConnectionState.CONNECTED -> onEstado?.invoke("conectado")
                        PeerConnection.PeerConnectionState.DISCONNECTED,
                        PeerConnection.PeerConnectionState.FAILED,
                        PeerConnection.PeerConnectionState.CLOSED -> onEstado?.invoke("desconectado")
                        else -> {}
                    }
                }
                override fun onIceConnectionChange(estado: PeerConnection.IceConnectionState) {}
                override fun onIceConnectionReceivingChange(recibiendo: Boolean) {}
                override fun onIceGatheringChange(estado: PeerConnection.IceGatheringState) {}
                override fun onSignalingChange(estado: PeerConnection.SignalingState) {}
                override fun onAddStream(stream: MediaStream) {}
                override fun onRemoveStream(stream: MediaStream) {}
                override fun onDataChannel(canal: DataChannel) {}
                override fun onRenegotiationNeeded() {}
                override fun onAddTrack(receptor: RtpReceiver, streams: Array<out MediaStream>) {}
            }
        )
        if (conexion == null) {
            detenerTodo()
            return
        }
        pc = conexion
        conexion.addTrack(pista, listOf("pantalla_s0"))
        onEstado?.invoke("lista")
    }

    private fun crearOfertaInterna(alTerminar: (String?) -> Unit) {
        val conexion = pc
        if (conexion == null) {
            alTerminar(null)
            return
        }
        conexion.createOffer(
            object : SdpObserver {
                override fun onCreateSuccess(oferta: SessionDescription) {
                    conexion.setLocalDescription(
                        object : SdpObserver {
                            override fun onSetSuccess() { alTerminar(oferta.description) }
                            override fun onSetFailure(motivo: String?) { alTerminar(null) }
                            override fun onCreateSuccess(sdp: SessionDescription?) {}
                            override fun onCreateFailure(motivo: String?) {}
                        },
                        oferta
                    )
                }
                override fun onCreateFailure(motivo: String?) { alTerminar(null) }
                override fun onSetSuccess() {}
                override fun onSetFailure(motivo: String?) {}
            },
            MediaConstraints()
        )
    }

    private fun fijarRespuestaInterna(sdp: String) {
        val conexion = pc ?: return
        val descripcion = SessionDescription(SessionDescription.Type.ANSWER, sdp)
        conexion.setRemoteDescription(
            object : SdpObserver {
                override fun onSetSuccess() {}
                override fun onSetFailure(motivo: String?) {}
                override fun onCreateSuccess(sdp: SessionDescription?) {}
                override fun onCreateFailure(motivo: String?) {}
            },
            descripcion
        )
    }

    private fun agregarHieloInterno(candidato: String, sdpMid: String?, indice: Int) {
        pc?.addIceCandidate(IceCandidate(sdpMid ?: "", indice, candidato))
    }

    private fun detenerTodo() {
        try { capturer?.stopCapture() } catch (e: InterruptedException) { /* no importa, se está cerrando */ }
        capturer?.dispose()
        capturer = null
        pc?.close()
        pc?.dispose()
        pc = null
        surfaceHelper?.dispose()
        surfaceHelper = null
        factory?.dispose()
        factory = null
        eglBase?.release()
        eglBase = null
        stopSelf()
    }
}
