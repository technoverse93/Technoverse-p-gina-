package com.technoverse.admin;

import android.app.KeyguardManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.Icon;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.media.ToneGenerator;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.TextView;

import org.vosk.LogLevel;
import org.vosk.LibVosk;
import org.vosk.Model;
import org.vosk.Recognizer;

import java.io.File;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * «Oye Phill»: Phill te escucha con el teléfono desbloqueado, aunque la app
 * esté cerrada, y se abre cuando lo llamás.
 *
 * Es un servicio en primer plano (Android lo pide para usar el micrófono con la
 * app cerrada: por eso muestra siempre una notificación y el puntito verde del
 * micrófono). Mientras espera el llamado reconoce la voz EN EL TELÉFONO, sin
 * internet (Vosk, el «oído» que se baja desde Ajustes): nada de lo que se
 * escucha sale del aparato ni se guarda. Solo cuando oye «Oye Phill» abre
 * Phill (la ventanita de siempre, JarvisRapido, en modo manos libres).
 *
 * Reglas para gastar poca batería y no estorbar:
 *  · Solo escucha con la pantalla encendida y el teléfono DESBLOQUEADO: con el
 *    teléfono bloqueado no se abre nada (cualquiera podría llamarlo).
 *  · Se calla mientras la app o la ventanita están a la vista (usan el
 *    micrófono ellas), durante una llamada y cuando lo pausás.
 *  · Una «puerta de voz» mide el ruido y solo despierta al reconocedor cuando
 *    alguien habla (OyeLogica.PuertaVoz).
 *
 * No arranca solo al prender el teléfono (Android 14 no deja prender un
 * micrófono desde el arranque): al abrir la app se reanuda si estaba activado.
 */
public class OyePhillService extends Service {
    static final String PREFS = "oye_phill";
    static final String K_ACTIVO = "activo";
    static final String K_FRASES = "frases";
    static final String K_SENS = "sens";

    static final String ACC_INICIAR = "com.technoverse.admin.oye.INICIAR";
    static final String ACC_DETENER = "com.technoverse.admin.oye.DETENER";
    static final String ACC_PAUSAR = "com.technoverse.admin.oye.PAUSAR";
    static final String ACC_REANUDAR = "com.technoverse.admin.oye.REANUDAR";
    static final String ACC_CONFIG = "com.technoverse.admin.oye.CONFIG";
    static final String ACC_PROBAR = "com.technoverse.admin.oye.PROBAR";

    private static final String CANAL = "oye_phill";
    private static final String CANAL_AVISO = "oye_phill_aviso";
    private static final int ID_NOTIF = 4101;
    private static final int ID_AVISO = 4102;
    private static final int RATE = 16000;
    private static final int TROZO = 1600;
    private static final long MAX_SEGMENTO_MS = 6000;
    private static final long ENFRIAR_MS = 2500;
    private static final long ESPERA_APERTURA_MS = 9000;
    /** ~20 s de silencio digital absoluto: Android dejó mudo el micrófono de la app (un ambiente quieto igual deja un poco de ruido). */
    private static final int CEROS_PARA_AVISAR = 200;

    /** Quién habla con el plugin (la app, si está abierta). */
    interface Oyente {
        void alEstado();

        void alOir(String texto, boolean fin, boolean despierta, String motivo);

        void alNivel(double nivel);

        void alDespertar();
    }

    static volatile OyePhillService instancia;
    static volatile Oyente oyente;
    /** apagado · cargando · escuchando · pausa · error */
    static volatile String estado = "apagado";
    /** El motivo de la pausa (app, pantalla, bloqueado, llamada, pausa, despertando) o el texto del error. */
    static volatile String detalle = "";
    static volatile boolean probando = false;
    static volatile String ultimoOido = "";
    static volatile String ultimaDecision = "";

    private static final Set<Object> visibles = Collections.newSetFromMap(new ConcurrentHashMap<Object, Boolean>());
    private static final Object cerrojo = new Object();

    private final Handler principal = new Handler(Looper.getMainLooper());
    private Thread hilo;
    private volatile boolean parar = false;
    private volatile int versionConfig = 0;
    private volatile long pausaHasta = 0;
    /** Descanso por ruido continuo (música, un video): el oído se calla unos segundos. */
    private volatile long descansoHasta = 0;
    private int largasSeguidas = 0;
    private volatile long esperaApertura = 0;
    private volatile boolean aperturaPendiente = false;
    private long ultimoDespertar = 0;
    private String textoNotif = "";
    private View orbe;
    private BroadcastReceiver pantalla;

    // ----------------------------- preferencias y atajos -----------------------------

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean activo(Context c) {
        return prefs(c).getBoolean(K_ACTIVO, false);
    }

    static int sensibilidad(Context c) {
        return Math.max(0, Math.min(2, prefs(c).getInt(K_SENS, OyeLogica.SENS_NORMAL)));
    }

    static List<String> frases(Context c) {
        String guardadas = prefs(c).getString(K_FRASES, null);
        List<String> crudas = new ArrayList<>();
        if (guardadas != null) {
            for (String f : guardadas.split("\n")) crudas.add(f);
        } else {
            crudas.addAll(Arrays.asList(OyeLogica.FRASES_INICIALES));
        }
        return OyeLogica.frasesValidas(crudas);
    }

    static void guardarFrases(Context c, List<String> frases) {
        StringBuilder b = new StringBuilder();
        for (String f : OyeLogica.frasesValidas(frases)) b.append(b.length() > 0 ? "\n" : "").append(f);
        prefs(c).edit().putString(K_FRASES, b.toString()).apply();
    }

    static boolean enEjecucion() {
        return instancia != null;
    }

    /** La app o la ventanita se ven (o dejaron de verse): mientras se ven usan ellas el micrófono. */
    static void visible(Object quien, boolean si) {
        if (si) visibles.add(quien);
        else visibles.remove(quien);
        despertarBucle();
    }

    /** La ventanita ya abrió: se quita el aviso de «tocá para hablar» y la burbuja. */
    static void aperturaConfirmada() {
        OyePhillService s = instancia;
        if (s == null) return;
        s.aperturaPendiente = false;
        s.esperaApertura = 0;
        s.principal.post(new Runnable() {
            @Override
            public void run() {
                OyePhillService t = instancia;
                if (t == null) return;
                t.quitarOrbe();
                NotificationManager nm = (NotificationManager) t.getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null) nm.cancel(ID_AVISO);
            }
        });
    }

    private static void despertarBucle() {
        synchronized (cerrojo) {
            cerrojo.notifyAll();
        }
    }

    /** Prende el servicio (hay que llamarlo con la app a la vista: Android no deja prender el micrófono desde el fondo). */
    static void iniciar(Context c) {
        prefs(c).edit().putBoolean(K_ACTIVO, true).apply();
        probando = false;
        enviar(c, ACC_INICIAR, true, null);
    }

    static void detener(Context c) {
        prefs(c).edit().putBoolean(K_ACTIVO, false).apply();
        probando = false;
        if (instancia != null) enviar(c, ACC_DETENER, false, null);
        else {
            estado = "apagado";
            detalle = "";
        }
    }

    static void pausar(Context c) {
        if (instancia != null) enviar(c, ACC_PAUSAR, false, null);
    }

    static void reanudar(Context c) {
        if (instancia != null) enviar(c, ACC_REANUDAR, false, null);
    }

    static void reconfigurar(Context c) {
        if (instancia != null) enviar(c, ACC_CONFIG, false, null);
    }

    /** La prueba usa el micrófono con la app abierta: sirve para enseñarle cómo te oye. */
    static void probar(Context c, boolean si) {
        if (instancia != null) {
            enviar(c, ACC_PROBAR, false, si);
        } else if (si) {
            probando = true;
            enviar(c, ACC_PROBAR, true, true);
        }
    }

    private static void enviar(Context c, String accion, boolean primerPlano, Boolean extra) {
        Intent i = new Intent(c, OyePhillService.class).setAction(accion);
        if (extra != null) i.putExtra("activo", extra.booleanValue());
        if (primerPlano && Build.VERSION.SDK_INT >= 26) c.startForegroundService(i);
        else c.startService(i);
    }

    // ----------------------------- ciclo de vida -----------------------------

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instancia = this;
        crearCanales();
        pantalla = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                despertarBucle();
            }
        };
        IntentFilter f = new IntentFilter();
        f.addAction(Intent.ACTION_SCREEN_ON);
        f.addAction(Intent.ACTION_SCREEN_OFF);
        f.addAction(Intent.ACTION_USER_PRESENT);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(pantalla, f, Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(pantalla, f);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String accion = intent != null ? intent.getAction() : ACC_INICIAR;
        // Si Android lo reinicia solo (intent nulo), sigue únicamente si estaba activado.
        if (intent == null && !activo(this)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (accion == null) accion = ACC_INICIAR;
        switch (accion) {
            case ACC_DETENER:
                apagar();
                return START_NOT_STICKY;
            case ACC_PAUSAR:
                pausaHasta = SystemClock.elapsedRealtime() + 60L * 60_000L;
                refrescarNotificacion();
                despertarBucle();
                return START_STICKY;
            case ACC_REANUDAR:
                pausaHasta = 0;
                refrescarNotificacion();
                despertarBucle();
                return START_STICKY;
            case ACC_CONFIG:
                versionConfig++;
                despertarBucle();
                return START_STICKY;
            case ACC_PROBAR:
                // Si Android pidió prenderlo en primer plano, hay que cumplirlo antes de cualquier otra cosa.
                if (!ponerEnPrimerPlano()) return START_NOT_STICKY;
                probando = intent != null && intent.getBooleanExtra("activo", false);
                versionConfig++;
                // Si el servicio nació solo para la prueba y se terminó la prueba, se apaga.
                if (!probando && !activo(this)) {
                    apagar();
                    return START_NOT_STICKY;
                }
                arrancarMotor();
                despertarBucle();
                return START_STICKY;
            default:
                if (!ponerEnPrimerPlano()) return START_NOT_STICKY;
                arrancarMotor();
                return START_STICKY;
        }
    }

    @Override
    public void onDestroy() {
        parar = true;
        despertarBucle();
        try {
            if (pantalla != null) unregisterReceiver(pantalla);
        } catch (Exception e) {
            /* ya estaba suelto */
        }
        pantalla = null;
        quitarOrbe();
        if (instancia == this) instancia = null;
        publicar("apagado", "");
        super.onDestroy();
    }

    private void apagar() {
        parar = true;
        probando = false;
        despertarBucle();
        try {
            stopForeground(true);
        } catch (Exception e) {
            /* nada que soltar */
        }
        stopSelf();
    }

    /** false si Android no dejó (sin permiso de micrófono o desde el fondo): queda el motivo a la vista. */
    private boolean ponerEnPrimerPlano() {
        try {
            if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                publicar("error", "Falta el permiso del micrófono.");
                stopSelf();
                return false;
            }
            Notification n = construirNotificacion(textoParaEstado());
            if (Build.VERSION.SDK_INT >= 30) startForeground(ID_NOTIF, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
            else startForeground(ID_NOTIF, n);
            return true;
        } catch (Throwable t) {
            publicar("error", "Android no dejó prender el micrófono en segundo plano. Abrí la app y volvé a activar «Oye Phill».");
            stopSelf();
            return false;
        }
    }

    private synchronized void arrancarMotor() {
        if (hilo != null && hilo.isAlive()) return;
        parar = false;
        hilo = new Thread(new Runnable() {
            @Override
            public void run() {
                bucle();
            }
        }, "oye-phill");
        hilo.start();
    }

    // ----------------------------- estado a la vista -----------------------------

    private synchronized void publicar(String nuevo, String det) {
        if (nuevo.equals(estado) && det.equals(detalle)) return;
        estado = nuevo;
        detalle = det;
        refrescarNotificacion();
        final Oyente o = oyente;
        if (o != null) principal.post(new Runnable() {
            @Override
            public void run() {
                o.alEstado();
            }
        });
    }

    private String textoParaEstado() {
        switch (estado) {
            case "escuchando":
                return probando ? "Probando: decí «Oye Phill» y mirá lo que oye." : "Te escucho: decí «Oye Phill».";
            case "pausa":
                switch (detalle) {
                    case "app": return "En pausa: tenés Phill abierto.";
                    case "pantalla": return "En pausa: la pantalla está apagada.";
                    case "bloqueado": return "En pausa: el teléfono está bloqueado.";
                    case "llamada": return "En pausa: hay una llamada.";
                    case "pausa": return "En pausa porque lo pediste.";
                    case "ruido": return "Descansando: hay mucho ruido o música seguidos.";
                    case "despertando": return "Abriendo Phill…";
                    default: return "En pausa.";
                }
            case "error":
                return "No pude escuchar: " + detalle;
            default:
                return "Preparando el oído de Phill…";
        }
    }

    private void refrescarNotificacion() {
        String t = textoParaEstado();
        if (t.equals(textoNotif)) return;
        textoNotif = t;
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null && instancia == this) nm.notify(ID_NOTIF, construirNotificacion(t));
        } catch (Throwable e) {
            /* sin notificación no se corta el oído */
        }
    }

    private void crearCanales() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        NotificationChannel c = new NotificationChannel(CANAL, "Oye Phill", NotificationManager.IMPORTANCE_LOW);
        c.setDescription("Muestra que Phill te está escuchando.");
        c.setShowBadge(false);
        nm.createNotificationChannel(c);
        NotificationChannel a = new NotificationChannel(CANAL_AVISO, "Oye Phill: llamado", NotificationManager.IMPORTANCE_HIGH);
        a.setDescription("Cuando Phill te oyó pero Android no lo dejó abrirse solo.");
        nm.createNotificationChannel(a);
    }

    private PendingIntent abrirApp() {
        Intent i = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (i == null) i = new Intent();
        return PendingIntent.getActivity(this, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private PendingIntent accion(String accion, int codigo) {
        Intent i = new Intent(this, OyePhillService.class).setAction(accion);
        return PendingIntent.getService(this, codigo, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private Notification construirNotificacion(String texto) {
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CANAL) : new Notification.Builder(this);
        b.setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("Oye Phill")
            .setContentText(texto)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setCategory(Notification.CATEGORY_SERVICE)
            .setContentIntent(abrirApp());
        if (Build.VERSION.SDK_INT < 26) b.setPriority(Notification.PRIORITY_LOW);
        if (Build.VERSION.SDK_INT >= 31) b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        boolean enPausa = pausaHasta > SystemClock.elapsedRealtime();
        if (Build.VERSION.SDK_INT >= 23) {
            if (enPausa) {
                b.addAction(new Notification.Action.Builder(Icon.createWithResource(this, android.R.drawable.ic_media_play), "Seguir", accion(ACC_REANUDAR, 2)).build());
            } else {
                b.addAction(new Notification.Action.Builder(Icon.createWithResource(this, android.R.drawable.ic_media_pause), "Pausar 1 h", accion(ACC_PAUSAR, 1)).build());
            }
            b.addAction(new Notification.Action.Builder(Icon.createWithResource(this, android.R.drawable.ic_menu_close_clear_cancel), "Apagar", accion(ACC_DETENER, 3)).build());
        }
        return b.build();
    }

    // ----------------------------- cuándo escuchar -----------------------------

    /** null = hay que escuchar; si no, el motivo de la pausa (la regla está en OyeLogica.motivoPausa). */
    private String motivoPausa() {
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        boolean encendida = pm == null || pm.isInteractive();
        KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
        boolean bloqueado = km != null && km.isKeyguardLocked();
        AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        boolean enLlamada = false;
        if (am != null) {
            int modo = am.getMode();
            enLlamada = modo == AudioManager.MODE_IN_CALL || modo == AudioManager.MODE_IN_COMMUNICATION || modo == AudioManager.MODE_RINGTONE;
        }
        return OyeLogica.motivoPausa(SystemClock.elapsedRealtime(), pausaHasta, descansoHasta, encendida, probando, !visibles.isEmpty(), esperaApertura, bloqueado, enLlamada);
    }

    private static void dormir(long ms) {
        synchronized (cerrojo) {
            try {
                cerrojo.wait(ms);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }

    // ----------------------------- el oído -----------------------------

    private AudioRecord abrirMicrofono() {
        int minimo = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        int bytes = Math.max(minimo, RATE * 2);
        int[] fuentes = { MediaRecorder.AudioSource.VOICE_RECOGNITION, MediaRecorder.AudioSource.MIC };
        for (int fuente : fuentes) {
            AudioRecord ar = null;
            try {
                ar = new AudioRecord(fuente, RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, bytes);
                if (ar.getState() == AudioRecord.STATE_INITIALIZED) {
                    ar.startRecording();
                    if (ar.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) return ar;
                }
            } catch (Throwable t) {
                /* se prueba con la otra fuente */
            }
            soltar(ar);
        }
        return null;
    }

    private static void soltar(AudioRecord ar) {
        if (ar == null) return;
        try {
            ar.stop();
        } catch (Throwable t) {
            /* ya estaba parado */
        }
        try {
            ar.release();
        } catch (Throwable t) {
            /* ya estaba suelto */
        }
    }

    private static void cerrar(Recognizer r) {
        if (r == null) return;
        try {
            r.close();
        } catch (Throwable t) {
            /* ya estaba cerrado */
        }
    }

    /** Las frases del llamado que el oído conoce (descarta las que traen palabras que no existen en su vocabulario). */
    private List<String> frasesQueEntiende(File raiz) {
        List<String> todas = frases(this);
        Set<String> conocidas = OyeModelo.conocidas(raiz, OyeLogica.palabrasDe(todas));
        if (conocidas == null) return todas;
        List<String> buenas = new ArrayList<>();
        for (String f : todas) {
            boolean entra = true;
            for (String w : OyeLogica.palabrasDe(Collections.singletonList(f))) if (!conocidas.contains(w)) entra = false;
            if (entra) buenas.add(f);
        }
        return buenas;
    }

    private Recognizer nuevoReconocedor(Model modelo, File raiz) throws java.io.IOException {
        if (probando) return new Recognizer(modelo, (float) RATE);
        List<String> f = frasesQueEntiende(raiz);
        if (f.isEmpty()) {
            publicar("error", "El oído no conoce las palabras de tu llamado. Usá «Probar» para enseñarle cómo te oye.");
            return null;
        }
        return new Recognizer(modelo, (float) RATE, OyeLogica.gramatica(f));
    }

    /** Vosk visto como lo que necesita la tubería. */
    private static OyeLogica.Reconocedor adaptador(final Recognizer r) {
        return new OyeLogica.Reconocedor() {
            @Override
            public boolean aceptar(short[] b, int n) {
                return r.acceptWaveForm(b, n);
            }

            @Override
            public String resultado() {
                return r.getResult();
            }

            @Override
            public String resultadoFinal() {
                return r.getFinalResult();
            }

            @Override
            public String parcial() {
                return r.getPartialResult();
            }
        };
    }

    private void bucle() {
        Model modelo = null;
        Recognizer rec = null;
        OyeLogica.Tuberia tuberia = null;
        AudioRecord ar = null;
        short[] buf = new short[TROZO];
        int versionVista = -1;
        int ceros = 0;
        boolean reabrioPorCeros = false;
        int trozos = 0;
        boolean sinFrases = false;
        final OyeLogica.Salida salida = new OyeLogica.Salida() {
            @Override
            public void alResultado(String texto, long duracionMs) {
                resolver(texto, duracionMs);
            }

            @Override
            public void alParcial(String texto) {
                avisarOido(texto, false, false, "");
            }
        };
        try {
            publicar("cargando", "");
            File raiz = OyeModelo.raiz(this);
            if (!OyeModelo.listo(raiz)) {
                publicar("error", "Falta bajar el oído de Phill (Ajustes → Oye Phill).");
                return;
            }
            LibVosk.setLogLevel(LogLevel.WARNINGS);
            modelo = new Model(OyeModelo.carpeta(raiz).getAbsolutePath());
            while (!parar) {
                // La prueba solo vale con la app a la vista: si salís, se termina (no se queda decodificando a escondidas).
                if (probando && visibles.isEmpty()) {
                    probando = false;
                    versionConfig++;
                    if (!activo(this)) {
                        principal.post(new Runnable() {
                            @Override
                            public void run() {
                                apagar();
                            }
                        });
                        break;
                    }
                }
                String pausa = motivoPausa();
                if (pausa != null) {
                    if (ar != null) {
                        soltar(ar);
                        ar = null;
                    }
                    if (tuberia != null) tuberia.reiniciar();
                    publicar("pausa", pausa);
                    dormir("pantalla".equals(pausa) ? 1500 : 400);
                    continue;
                }
                if (sinFrases && versionVista == versionConfig) {
                    // Sin frases que el oído entienda: se espera a que las cambien (o a que se pruebe).
                    dormir(1500);
                    continue;
                }
                if (rec == null || versionVista != versionConfig) {
                    cerrar(rec);
                    rec = null;
                    tuberia = null;
                    versionVista = versionConfig;
                    rec = nuevoReconocedor(modelo, raiz);
                    sinFrases = rec == null;
                    if (rec == null) {
                        dormir(1500);
                        continue;
                    }
                    tuberia = new OyeLogica.Tuberia(adaptador(rec), salida, probando, MAX_SEGMENTO_MS);
                }
                if (ar == null) {
                    ar = abrirMicrofono();
                    if (ar == null) {
                        publicar("error", "No pude abrir el micrófono (¿lo está usando otra app?).");
                        dormir(3000);
                        continue;
                    }
                    rec.reset();
                    tuberia.reiniciar();
                    ceros = 0;
                }
                publicar("escuchando", "");
                int n = ar.read(buf, 0, TROZO);
                if (n < 0) {
                    // El micrófono se cayó: se vuelve a abrir en un rato.
                    soltar(ar);
                    ar = null;
                    dormir(1000);
                    continue;
                }
                if (n == 0) continue;

                // Android puede dejar mudo el micrófono de una app en segundo plano: se avisa en vez de «escuchar» el silencio.
                boolean mudo = true;
                for (int i = 0; i < n; i++) if (buf[i] != 0) { mudo = false; break; }
                ceros = mudo ? ceros + 1 : 0;
                if (ceros >= CEROS_PARA_AVISAR) {
                    soltar(ar);
                    ar = null;
                    ceros = 0;
                    if (reabrioPorCeros) {
                        publicar("error", "Android está dejando mudo el micrófono de esta app. Abrí la app y tocá «Reiniciar».");
                        pausaHasta = SystemClock.elapsedRealtime() + 60_000L;
                        reabrioPorCeros = false;
                    } else {
                        reabrioPorCeros = true;
                    }
                    continue;
                }
                if (!mudo) reabrioPorCeros = false;

                tuberia.alimentar(buf, n, SystemClock.elapsedRealtime());
                trozos++;
                if (probando && trozos % 2 == 0) {
                    final double nivel = Math.min(1.0, tuberia.puerta().ultimoRms() / 6000.0);
                    final Oyente o = oyente;
                    if (o != null) principal.post(new Runnable() {
                        @Override
                        public void run() {
                            o.alNivel(nivel);
                        }
                    });
                }
            }
        } catch (Throwable t) {
            String m = t.getMessage() != null ? t.getMessage() : "";
            publicar("error", "No pude cargar el motor de voz (" + t.getClass().getSimpleName() + (m.isEmpty() ? "" : ": " + m) + ").");
        } finally {
            soltar(ar);
            cerrar(rec);
            try {
                if (modelo != null) modelo.close();
            } catch (Throwable t) {
                /* ya estaba cerrado */
            }
            if (!"error".equals(estado)) publicar("apagado", "");
            synchronized (this) {
                hilo = null;
            }
        }
    }

    private void avisarOido(final String texto, final boolean fin, final boolean despierta, final String motivo) {
        final Oyente o = oyente;
        if (o == null) return;
        principal.post(new Runnable() {
            @Override
            public void run() {
                o.alOir(texto, fin, despierta, motivo);
            }
        });
    }

    /** Lo que se oyó al terminar de hablar: en la prueba se muestra; si no, se decide si es el llamado. */
    private void resolver(String texto, long duracionMs) {
        // Frases larguísimas una tras otra no son un llamado: es música, un video o una charla. Se descansa un rato.
        largasSeguidas = OyeLogica.largasSeguidas(largasSeguidas, duracionMs);
        if (!probando && largasSeguidas >= OyeLogica.LARGAS_PARA_DESCANSAR) {
            largasSeguidas = 0;
            descansoHasta = SystemClock.elapsedRealtime() + OyeLogica.DESCANSO_MS;
        }
        if (texto.isEmpty()) return;
        if (probando) {
            ultimoOido = texto;
            avisarOido(texto, true, false, "");
            return;
        }
        OyeLogica.Decision d = OyeLogica.evaluar(texto, frases(this), sensibilidad(this), duracionMs);
        ultimoOido = texto;
        ultimaDecision = d.despierta ? "despertó" : d.motivo;
        avisarOido(texto, true, d.despierta, d.motivo);
        long ahora = SystemClock.elapsedRealtime();
        if (d.despierta && ahora - ultimoDespertar > ENFRIAR_MS) {
            ultimoDespertar = ahora;
            despertar();
        }
    }

    // ----------------------------- abrir Phill -----------------------------

    private void despertar() {
        aperturaPendiente = true;
        // Mientras abre, el oído suelta el micrófono (la ventanita lo va a usar).
        esperaApertura = SystemClock.elapsedRealtime() + ESPERA_APERTURA_MS;
        despertarBucle();
        sonar();
        vibrar();
        final Oyente o = oyente;
        principal.post(new Runnable() {
            @Override
            public void run() {
                mostrarOrbe();
                abrirPhill();
                if (o != null) o.alDespertar();
            }
        });
        principal.postDelayed(new Runnable() {
            @Override
            public void run() {
                avisarSiNoAbrio();
            }
        }, 3000);
    }

    private Intent intentoAbrir() {
        return new Intent(this, JarvisRapido.class)
            .putExtra(JarvisRapido.EXTRA_MODO, "oye")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    }

    private void abrirPhill() {
        try {
            startActivity(intentoAbrir());
        } catch (Throwable t) {
            /* si Android no la deja abrir, el aviso con toque lo resuelve */
        }
    }

    /** Si pasaron unos segundos y la ventanita no abrió (Android bloquea abrir apps desde el fondo), un aviso para tocar. */
    private void avisarSiNoAbrio() {
        if (!aperturaPendiente) return;
        aperturaPendiente = false;
        quitarOrbe();
        try {
            PendingIntent toque = PendingIntent.getActivity(this, 7, intentoAbrir(), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CANAL_AVISO) : new Notification.Builder(this);
            b.setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle("Phill te escuchó")
                .setContentText("Tocá para hablar. (Para que se abra solo, activá «Mostrar sobre otras apps» en Ajustes → Oye Phill.)")
                .setAutoCancel(true)
                .setContentIntent(toque)
                .setCategory(Notification.CATEGORY_CALL);
            if (Build.VERSION.SDK_INT < 26) b.setPriority(Notification.PRIORITY_HIGH);
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(ID_AVISO, b.build());
        } catch (Throwable t) {
            /* sin aviso */
        }
        // Que el oído vuelva a escuchar.
        esperaApertura = 0;
        despertarBucle();
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    /** Una burbujita arriba («Phill te escucha…») mientras abre: también es la ventana visible que Android pide para abrir desde el fondo. */
    private void mostrarOrbe() {
        try {
            if (orbe != null) return;
            if (Build.VERSION.SDK_INT >= 23 && !Settings.canDrawOverlays(this)) return;
            WindowManager wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
            if (wm == null) return;
            TextView v = new TextView(this);
            v.setText("●  Phill te escucha…");
            v.setTextColor(Color.WHITE);
            v.setTextSize(15);
            v.setPadding(dp(18), dp(10), dp(18), dp(10));
            GradientDrawable fondo = new GradientDrawable();
            fondo.setColor(Color.argb(235, 7, 31, 43));
            fondo.setCornerRadius(dp(26));
            v.setBackground(fondo);
            int tipo = Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE;
            WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT, tipo,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE, PixelFormat.TRANSLUCENT);
            lp.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
            lp.y = dp(64);
            wm.addView(v, lp);
            orbe = v;
            principal.postDelayed(new Runnable() {
                @Override
                public void run() {
                    quitarOrbe();
                }
            }, 6000);
        } catch (Throwable t) {
            orbe = null;
        }
    }

    private void quitarOrbe() {
        View v = orbe;
        orbe = null;
        if (v == null) return;
        try {
            WindowManager wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
            if (wm != null) wm.removeView(v);
        } catch (Throwable t) {
            /* ya no estaba */
        }
    }

    private void sonar() {
        try {
            final ToneGenerator tono = new ToneGenerator(AudioManager.STREAM_MUSIC, 70);
            tono.startTone(ToneGenerator.TONE_PROP_ACK, 160);
            principal.postDelayed(new Runnable() {
                @Override
                public void run() {
                    tono.release();
                }
            }, 500);
        } catch (Throwable t) {
            /* sin sonido */
        }
    }

    private void vibrar() {
        try {
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (v == null || !v.hasVibrator()) return;
            if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createOneShot(60, VibrationEffect.DEFAULT_AMPLITUDE));
            else v.vibrate(60);
        } catch (Throwable t) {
            /* sin vibración */
        }
    }
}
