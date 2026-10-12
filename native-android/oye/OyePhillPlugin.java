package com.technoverse.admin;

import android.Manifest;
import android.app.NotificationManager;
import android.app.role.RoleManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.IOException;
import java.io.InterruptedIOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * «Oye Javier»: el puente entre la web (src/mobile/oyePhill.ts) y el servicio que
 * escucha (OyePhillService). Desde Ajustes → Oye Javier se baja el «oído» (el
 * modelo de voz que corre en el teléfono), se dan los permisos, se enseña cómo
 * te oye y se prende o apaga. No es un paquete npm: MainActivity lo registra a mano.
 *
 * Todas las llamadas responden { ok: true, ... } o { ok: false, error } (nunca
 * rechazan), para que la web decida qué mostrar. Los avisos en vivo (estado,
 * lo que se oye en la prueba, el nivel del micrófono y el avance de la bajada)
 * llegan como eventos.
 */
@CapacitorPlugin(
    name = "OyePhill",
    permissions = { @Permission(alias = "mic", strings = { Manifest.permission.RECORD_AUDIO }) }
)
public class OyePhillPlugin extends Plugin {
    /** La web la compara con la que entiende. */
    static final int VERSION = 3;

    private OyePhillService.Oyente mio;
    private Thread bajada;
    private final AtomicBoolean cancelarBajada = new AtomicBoolean(false);

    // ------------------------------ ayudas ------------------------------
    private static JSObject ok() {
        JSObject r = new JSObject();
        r.put("ok", true);
        return r;
    }

    private static JSObject error(String mensaje) {
        JSObject r = new JSObject();
        r.put("ok", false);
        r.put("error", mensaje);
        return r;
    }

    private static boolean hayVosk() {
        try {
            // Sin inicializar la clase: solo mirar si está, sin cargar la librería nativa.
            Class.forName("org.vosk.Model", false, OyePhillPlugin.class.getClassLoader());
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    private boolean tieneMicrofono() {
        return getContext().checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    private static boolean notificacionesActivas(Context c) {
        try {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            return nm == null || nm.areNotificationsEnabled();
        } catch (Throwable t) {
            return true;
        }
    }

    private static boolean bateriaLibre(Context c) {
        if (Build.VERSION.SDK_INT < 23) return true;
        try {
            PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
            return pm != null && pm.isIgnoringBatteryOptimizations(c.getPackageName());
        } catch (Throwable t) {
            return false;
        }
    }

    private static JSArray lista(List<String> l) {
        JSArray a = new JSArray();
        for (String s : l) a.put(s);
        return a;
    }

    /** ¿Javier es la app de asistente del teléfono (botón de inicio / encendido)? */
    private static boolean esAsistente(Context c) {
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                RoleManager roles = c.getSystemService(RoleManager.class);
                return roles != null && roles.isRoleAvailable(RoleManager.ROLE_ASSISTANT) && roles.isRoleHeld(RoleManager.ROLE_ASSISTANT);
            }
            String actual = Settings.Secure.getString(c.getContentResolver(), "assistant");
            return actual != null && actual.startsWith(c.getPackageName() + "/");
        } catch (Throwable t) {
            return false;
        }
    }

    private JSObject estadoJs() {
        Context c = getContext();
        File raiz = OyeModelo.raiz(c);
        JSObject r = ok();
        r.put("version", VERSION);
        r.put("vosk", hayVosk());
        r.put("modeloListo", OyeModelo.listo(raiz));
        r.put("modeloMB", OyeModelo.megas(raiz));
        r.put("bajando", bajada != null && bajada.isAlive());
        r.put("permisoMic", tieneMicrofono());
        r.put("notificaciones", notificacionesActivas(c));
        r.put("overlay", Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(c));
        r.put("bateriaLibre", bateriaLibre(c));
        r.put("activo", OyePrefs.activo(c));
        r.put("servicio", OyePhillService.enEjecucion());
        r.put("motor", OyePhillService.estado);
        r.put("detalle", OyePhillService.detalle);
        r.put("probando", OyePhillService.probando);
        r.put("sensibilidad", OyePrefs.sensibilidad(c));
        r.put("frases", lista(OyePrefs.frases(c)));
        r.put("ultimoOido", OyePhillService.ultimoOido);
        r.put("ultimaDecision", OyePhillService.ultimaDecision);
        r.put("sdk", Build.VERSION.SDK_INT);
        r.put("asistente", esAsistente(c));
        r.put("burbuja", OyePrefs.burbuja(c));
        return r;
    }

    // ------------------------------ ciclo de vida ------------------------------
    @Override
    public void load() {
        mio = new OyePhillService.Oyente() {
            @Override
            public void alEstado() {
                notifyListeners("estado", estadoJs());
            }

            @Override
            public void alOir(String texto, boolean fin, boolean despierta, String motivo) {
                JSObject o = new JSObject();
                o.put("texto", texto);
                o.put("fin", fin);
                o.put("despierta", despierta);
                o.put("motivo", motivo == null ? "" : motivo);
                notifyListeners("oyo", o);
            }

            @Override
            public void alNivel(double nivel) {
                JSObject o = new JSObject();
                o.put("n", nivel);
                notifyListeners("nivel", o);
            }

            @Override
            public void alDespertar() {
                notifyListeners("despertado", new JSObject());
            }
        };
        OyePhillService.oyente = mio;
    }

    @Override
    protected void handleOnDestroy() {
        if (OyePhillService.oyente == mio) OyePhillService.oyente = null;
        cancelarBajada.set(true);
        super.handleOnDestroy();
    }

    // ------------------------------ estado ------------------------------
    @PluginMethod
    public void estado(PluginCall call) {
        call.resolve(estadoJs());
    }

    // ------------------------------ el oído (el modelo) ------------------------------
    @PluginMethod
    public void bajarModelo(final PluginCall call) {
        if (bajada != null && bajada.isAlive()) {
            call.resolve(error("Ya se está bajando."));
            return;
        }
        final Context c = getContext();
        final File raiz = OyeModelo.raiz(c);
        if (OyeModelo.listo(raiz)) {
            call.resolve(estadoJs());
            return;
        }
        cancelarBajada.set(false);
        bajada = new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    OyeModelo.bajar(raiz, OyeModelo.URL_MODELO, OyeModelo.TAMANO_MIN, new OyeModelo.Progreso() {
                        @Override
                        public void alAvanzar(String fase, double fraccion) {
                            JSObject o = new JSObject();
                            o.put("fase", fase);
                            o.put("progreso", fraccion);
                            notifyListeners("modelo", o);
                        }
                    }, cancelarBajada);
                    call.resolve(estadoJs());
                } catch (InterruptedIOException e) {
                    OyeModelo.borrar(raiz);
                    call.resolve(error("Bajada cancelada."));
                } catch (IOException e) {
                    call.resolve(error(e.getMessage() != null ? e.getMessage() : "No se pudo bajar el oído."));
                } catch (Throwable t) {
                    call.resolve(error("No se pudo bajar el oído."));
                }
            }
        }, "oye-bajada");
        bajada.start();
    }

    @PluginMethod
    public void cancelarBajada(PluginCall call) {
        cancelarBajada.set(true);
        call.resolve(ok());
    }

    @PluginMethod
    public void borrarModelo(PluginCall call) {
        OyePhillService.detener(getContext());
        OyeModelo.borrar(OyeModelo.raiz(getContext()));
        call.resolve(estadoJs());
    }

    /** De las palabras de las frases, las que el oído conoce y las que no. */
    @PluginMethod
    public void vocabulario(PluginCall call) {
        JSArray crudas = call.getArray("frases");
        List<String> frases = new ArrayList<>();
        if (crudas != null) for (int i = 0; i < crudas.length(); i++) frases.add(crudas.optString(i));
        List<String> palabras = OyeLogica.palabrasDe(OyeLogica.frasesValidas(frases));
        Set<String> conocidas = OyeModelo.conocidas(OyeModelo.raiz(getContext()), palabras);
        JSObject r = ok();
        r.put("sabe", conocidas != null);
        List<String> si = new ArrayList<>();
        List<String> no = new ArrayList<>();
        for (String p : palabras) {
            if (conocidas == null || conocidas.contains(p)) si.add(p);
            else no.add(p);
        }
        r.put("conocidas", lista(si));
        r.put("desconocidas", lista(no));
        call.resolve(r);
    }

    // ------------------------------ configurar ------------------------------
    @PluginMethod
    public void configurar(PluginCall call) {
        Context c = getContext();
        JSArray crudas = call.getArray("frases");
        if (crudas != null) {
            List<String> frases = new ArrayList<>();
            for (int i = 0; i < crudas.length(); i++) frases.add(crudas.optString(i));
            OyePrefs.guardarFrases(c, frases);
        }
        Integer sens = call.getInt("sensibilidad");
        if (sens != null) OyePrefs.fijarSensibilidad(c, sens.intValue());
        Boolean burbuja = call.getBoolean("burbuja");
        if (burbuja != null) OyePrefs.fijarBurbuja(c, burbuja.booleanValue());
        // Lo guardado ya quedó guardado: si avisarle al servicio falla (Android no deja
        // despertarlo en ese momento), lo toma la próxima vez que arranque.
        try {
            OyePhillService.reconfigurar(c);
        } catch (Throwable t) {
            /* el servicio relee las frases al arrancar */
        }
        call.resolve(estadoJs());
    }

    // ------------------------------ prender y apagar ------------------------------
    @PluginMethod
    public void iniciar(PluginCall call) {
        if (!hayVosk()) {
            call.resolve(error("Esta APK no trae el motor de voz. Instalá la APK más nueva."));
            return;
        }
        if (!OyeModelo.listo(OyeModelo.raiz(getContext()))) {
            call.resolve(error("Primero bajá el oído de Javier."));
            return;
        }
        if (!tieneMicrofono()) {
            requestPermissionForAlias("mic", call, "alMicIniciar");
            return;
        }
        arrancar(call);
    }

    @PermissionCallback
    private void alMicIniciar(PluginCall call) {
        if (getPermissionState("mic") == PermissionState.GRANTED) arrancar(call);
        else call.resolve(error("Sin el permiso del micrófono no puedo escucharte."));
    }

    private void arrancar(PluginCall call) {
        try {
            OyePhillService.iniciar(getContext());
        } catch (Throwable t) {
            // No arrancó: que no quede «activado» sin estar corriendo.
            OyePrefs.fijarActivo(getContext(), false);
            call.resolve(error("Android no dejó prender el micrófono: abrí la app y probá de nuevo."));
            return;
        }
        call.resolve(estadoJs());
    }

    @PluginMethod
    public void detener(PluginCall call) {
        OyePhillService.detener(getContext());
        call.resolve(estadoJs());
    }

    /** Pausa de una hora (o la quita con {activo:false}). */
    @PluginMethod
    public void pausar(PluginCall call) {
        if (Boolean.FALSE.equals(call.getBoolean("activo", true))) OyePhillService.reanudar(getContext());
        else OyePhillService.pausar(getContext());
        call.resolve(ok());
    }

    /** La prueba: el oído escucha libre y muestra lo que entiende, para enseñarle cómo decís «Oye Javier». */
    @PluginMethod
    public void probar(PluginCall call) {
        boolean si = Boolean.TRUE.equals(call.getBoolean("activo", true));
        if (si) {
            if (!hayVosk() || !OyeModelo.listo(OyeModelo.raiz(getContext()))) {
                call.resolve(error("Primero bajá el oído de Javier."));
                return;
            }
            if (!tieneMicrofono()) {
                requestPermissionForAlias("mic", call, "alMicProbar");
                return;
            }
        }
        empezarPrueba(call, si);
    }

    @PermissionCallback
    private void alMicProbar(PluginCall call) {
        if (getPermissionState("mic") == PermissionState.GRANTED) empezarPrueba(call, true);
        else call.resolve(error("Sin el permiso del micrófono no puedo escucharte."));
    }

    private void empezarPrueba(PluginCall call, boolean si) {
        try {
            OyePhillService.probar(getContext(), si);
        } catch (Throwable t) {
            call.resolve(error("No pude prender el micrófono para la prueba."));
            return;
        }
        call.resolve(estadoJs());
    }

    @PluginMethod
    public void pedirMicrofono(PluginCall call) {
        if (tieneMicrofono()) {
            call.resolve(estadoJs());
            return;
        }
        requestPermissionForAlias("mic", call, "alMicPedido");
    }

    @PermissionCallback
    private void alMicPedido(PluginCall call) {
        call.resolve(estadoJs());
    }

    // ------------------------------ ajustes del sistema ------------------------------
    /** Abre la pantalla de Android donde se da un permiso: overlay, bateria, notificaciones o app. */
    @PluginMethod
    public void abrirAjuste(PluginCall call) {
        String cual = call.getString("cual");
        Context c = getContext();
        String paquete = c.getPackageName();
        Intent i;
        if ("overlay".equals(cual)) {
            i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + paquete));
        } else if ("bateria".equals(cual)) {
            i = Build.VERSION.SDK_INT >= 23
                ? new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + paquete))
                : new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + paquete));
        } else if ("asistente".equals(cual)) {
            // «App de asistente digital» (en algunos teléfonos, dentro de «Apps predeterminadas»).
            i = new Intent(Settings.ACTION_VOICE_INPUT_SETTINGS);
            if (i.resolveActivity(c.getPackageManager()) == null && Build.VERSION.SDK_INT >= 24) i = new Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS);
        } else if ("notificaciones".equals(cual) && Build.VERSION.SDK_INT >= 26) {
            i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, paquete);
        } else {
            i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + paquete));
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            c.startActivity(i);
            call.resolve(ok());
        } catch (ActivityNotFoundException e) {
            // Algunos teléfonos no tienen esa pantalla: se abre la ficha de la app.
            try {
                c.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + paquete)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                call.resolve(ok());
            } catch (Exception e2) {
                call.resolve(error("No se pudo abrir esa pantalla de Android."));
            }
        } catch (Exception e) {
            call.resolve(error("No se pudo abrir esa pantalla de Android."));
        }
    }
}
