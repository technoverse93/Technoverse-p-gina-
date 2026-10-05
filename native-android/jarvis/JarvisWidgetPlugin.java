package com.technoverse.admin;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.security.KeyStore;

/**
 * Puente entre la web (src/mobile/jarvisWidget.ts) y el mini-widget.
 *
 * Vive en los DOS puentes: el de la app (MainActivity, para activarlo desde
 * Jarvis → Ajustes) y el de la ventanita (JarvisRapido, para cerrarla, abrir
 * la app y dejar la última respuesta en el widget). No es un paquete npm,
 * así que cada actividad lo registra a mano antes de super.onCreate().
 *
 * Activar es solo una marca en este teléfono: la ventanita usa la sesión de
 * la app, sin llaves aparte.
 */
@CapacitorPlugin(name = "JarvisWidget")
public class JarvisWidgetPlugin extends Plugin {
    /** La web la compara: 3 = Jarvis con sesión, usable en el propio recuadro. */
    static final int VERSION = 3;

    private int pedidos = 0;

    @Override
    public void load() {
        limpiarLlaveVieja(getContext());
    }

    @PluginMethod
    public void activar(PluginCall call) {
        JarvisWidget.prefs(getContext()).edit().putBoolean(JarvisWidget.ACTIVO, true).apply();
        JarvisWidget.actualizar(getContext());
        listo(call);
    }

    @PluginMethod
    public void desactivar(PluginCall call) {
        // La marca y la última respuesta: el widget queda como recién puesto.
        JarvisWidget.prefs(getContext()).edit().clear().putBoolean("llave_vieja_limpia", true).apply();
        JarvisWidget.actualizar(getContext());
        listo(call);
    }

    @PluginMethod
    public void estado(PluginCall call) {
        JSObject r = new JSObject();
        r.put("activo", JarvisWidget.activo(getContext()));
        r.put("enVentanita", getActivity() instanceof JarvisRapido);
        r.put("version", VERSION);
        if (getActivity() instanceof JarvisRapido) r.put("modo", ((JarvisRapido) getActivity()).modo());
        String conv = JarvisWidget.prefs(getContext()).getString(JarvisWidget.CONVERSACION, null);
        if (conv != null) r.put("conversacion", conv);
        call.resolve(r);
    }

    /** El aviso de Android «¿Agregar el widget a la pantalla de inicio?» (Android 8+). */
    @PluginMethod
    public void ponerEnInicio(PluginCall call) {
        boolean pedido = false;
        if (Build.VERSION.SDK_INT >= 26) {
            AppWidgetManager manager = getContext().getSystemService(AppWidgetManager.class);
            if (manager != null && manager.isRequestPinAppWidgetSupported()) {
                pedido = manager.requestPinAppWidget(new ComponentName(getContext(), JarvisWidget.class), null, null);
            }
        }
        JSObject r = new JSObject();
        r.put("pedido", pedido);
        call.resolve(r);
    }

    /** Solo en la ventanita. */
    @PluginMethod
    public void cerrar(PluginCall call) {
        call.resolve();
        cerrarVentanita();
    }

    /**
     * Abre la app (con su huella de siempre) en Jarvis o, si se indica, en un
     * módulo («Ir a Taller» desde la ventanita), y cierra la ventanita.
     */
    @PluginMethod
    public void abrirApp(PluginCall call) {
        String modulo = call.getString("modulo", "");
        String url = "technoverse://jarvis";
        if (modulo != null && modulo.matches("[a-z_]{2,40}")) url += "?modulo=" + modulo;
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url), getContext(), MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        try {
            getContext().startActivity(intent);
        } catch (Exception e) {
            call.reject("No se pudo abrir la app.");
            return;
        }
        call.resolve();
        cerrarVentanita();
    }

    /** La pregunta y la respuesta quedan en la conversación del widget. */
    @PluginMethod
    public void ultimaRespuesta(PluginCall call) {
        String respuesta = JarvisWidget.textoPlano(call.getString("respuesta", ""));
        if (respuesta.isEmpty()) {
            JarvisWidget.avisar(getContext(), "");
            call.resolve();
            return;
        }
        JarvisWidget.anotar(getContext(), recortar(call.getString("pregunta", ""), 300), recortar(respuesta, 1500),
            call.getString("conversacion", null), Boolean.TRUE.equals(call.getBoolean("accion", false)));
        call.resolve();
    }

    /** La línea de estado del widget («Pensando…»); vacía la quita. */
    @PluginMethod
    public void avisar(PluginCall call) {
        JarvisWidget.avisar(getContext(), recortar(call.getString("texto", ""), 60));
        call.resolve();
    }

    /** Mientras contesta en el widget, la ventanita deja pasar los toques. */
    @PluginMethod
    public void soltar(PluginCall call) {
        call.resolve();
        if (getActivity() instanceof JarvisRapido) {
            final JarvisRapido ventanita = (JarvisRapido) getActivity();
            ventanita.runOnUiThread(ventanita::soltar);
        }
    }

    /**
     * Cada toque al widget con la ventanita abierta (y el que la abrió)
     * llega aquí y se avisa a la página. Lo dictado lo manda la ventanita
     * cuando el teléfono termina de entenderlo (emitirPedido). Se retiene
     * hasta que la página escuche, para no perder el primero.
     */
    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (intent == null || !(getActivity() instanceof JarvisRapido)) return;
        String modo = JarvisRapido.modoDe(intent);
        if ("voz".equals(modo)) return;
        if ("hoja".equals(modo)) JarvisWidget.prefs(getContext()).edit().putBoolean(JarvisWidget.ACCION, false).apply();
        emitirPedido(modo, null);
    }

    void emitirPedido(String modo, String texto) {
        pedidos++;
        JSObject p = new JSObject();
        p.put("modo", modo);
        p.put("voz", "voz".equals(modo));
        p.put("n", pedidos);
        if (texto != null) p.put("texto", texto);
        notifyListeners("pedido", p, true);
    }

    private void cerrarVentanita() {
        if (getActivity() instanceof JarvisRapido) {
            final JarvisRapido ventanita = (JarvisRapido) getActivity();
            ventanita.runOnUiThread(ventanita::cerrar);
        }
    }

    private static void listo(PluginCall call) {
        JSObject r = new JSObject();
        r.put("ok", true);
        call.resolve(r);
    }

    private static String recortar(String t, int max) {
        if (t == null) return "";
        t = t.trim();
        return t.length() > max ? t.substring(0, max - 1) + "…" : t;
    }

    /**
     * El widget de antes guardaba una llave cifrada propia; con la sesión de
     * la app ya no sirve. Se borra una sola vez (archivo y clave del
     * Keystore) al actualizar la APK.
     */
    private static void limpiarLlaveVieja(Context ctx) {
        SharedPreferences propias = JarvisWidget.prefs(ctx);
        if (propias.getBoolean("llave_vieja_limpia", false)) return;
        ctx.getSharedPreferences("jarvis_widget_llave", Context.MODE_PRIVATE).edit().clear().apply();
        try {
            KeyStore almacen = KeyStore.getInstance("AndroidKeyStore");
            almacen.load(null);
            if (almacen.containsAlias("jarvis_widget")) almacen.deleteEntry("jarvis_widget");
        } catch (Exception ignorado) {
            /* sin Keystore no hay nada que borrar */
        }
        propias.edit().putBoolean("llave_vieja_limpia", true).apply();
    }
}
