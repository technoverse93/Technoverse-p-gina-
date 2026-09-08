package com.technoverse.admin

import android.app.Activity
import android.content.Context
import android.media.projection.MediaProjectionManager
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Puente entre el WebView y CapturaPantallaService (pantalla completa
 * nativa en Android, vía MediaProjection). Pide el permiso nativo —el
 * selector "Iniciar transmisión o grabación" que pinta el propio Android—
 * desde el mismo gesto que ya dispara `capturaPantallaNativa.ts` en el
 * login del personal, y delega todo lo demás al servicio en primer plano.
 *
 * Este plugin NO toca la señal en sí: la negociación WebRTC (ofertas,
 * respuestas, hielo) viaja por el mismo canal privado de Supabase Realtime
 * que ya usa la pantalla completa de escritorio (`capturaPantalla.ts`).
 * Aquí solo se puentean las primitivas nativas — crear oferta, fijar
 * respuesta, agregar hielo, detener — hacia/desde `CapturaPantallaService`.
 */
@CapacitorPlugin(name = "PantallaNativa")
class PantallaNativaPlugin : Plugin() {

    override fun load() {
        super.load()
        CapturaPantallaService.onHielo = { candidato, sdpMid, indice ->
            val datos = JSObject()
            datos.put("candidato", candidato)
            datos.put("sdpMid", sdpMid ?: "")
            datos.put("sdpMLineIndex", indice)
            notifyListeners("hielo", datos)
        }
        CapturaPantallaService.onEstado = { estado ->
            val datos = JSObject()
            datos.put("estado", estado)
            notifyListeners("estado", datos)
        }
    }

    @PluginMethod
    fun disponible(call: PluginCall) {
        val r = JSObject()
        r.put("disponible", true)
        call.resolve(r)
    }

    @PluginMethod
    fun iniciar(call: PluginCall) {
        val gestor =
            getActivity().getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        startActivityForResult(call, gestor.createScreenCaptureIntent(), "alRecibirPermiso")
    }

    @ActivityCallback
    private fun alRecibirPermiso(call: PluginCall?, resultado: ActivityResult) {
        val llamada = call ?: return
        val datos = resultado.data
        val r = JSObject()
        if (resultado.resultCode != Activity.RESULT_OK || datos == null) {
            r.put("ok", false)
            llamada.resolve(r)
            return
        }
        CapturaPantallaService.iniciar(getContext(), resultado.resultCode, datos)
        r.put("ok", true)
        llamada.resolve(r)
    }

    @PluginMethod
    fun crearOferta(call: PluginCall) {
        CapturaPantallaService.crearOferta { sdp ->
            if (sdp == null) {
                call.reject("sin sesión activa")
            } else {
                val r = JSObject()
                r.put("sdp", sdp)
                call.resolve(r)
            }
        }
    }

    @PluginMethod
    fun fijarRespuesta(call: PluginCall) {
        val sdp = call.getString("sdp")
        if (sdp == null) {
            call.reject("sdp requerido")
            return
        }
        CapturaPantallaService.fijarRespuesta(sdp)
        call.resolve()
    }

    @PluginMethod
    fun agregarHielo(call: PluginCall) {
        val candidato = call.getString("candidato")
        if (candidato == null) {
            call.reject("candidato requerido")
            return
        }
        val sdpMid = call.getString("sdpMid")
        val indice = call.getInt("sdpMLineIndex") ?: 0
        CapturaPantallaService.agregarHielo(candidato, sdpMid, indice)
        call.resolve()
    }

    @PluginMethod
    fun detener(call: PluginCall) {
        CapturaPantallaService.detener(getContext())
        call.resolve()
    }
}
