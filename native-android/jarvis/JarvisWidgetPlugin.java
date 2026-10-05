package com.technoverse.admin;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Puente entre la app (src/mobile/jarvisWidget.ts) y el mini-widget.
 *
 * La app pide la llave al servidor (con la sesión y la huella de siempre) y
 * la entrega aquí UNA vez: se guarda cifrada (JarvisLlave) y el JavaScript
 * no la conserva. No es un paquete npm, así que se registra a mano en
 * MainActivity, antes de super.onCreate().
 */
@CapacitorPlugin(name = "JarvisWidget")
public class JarvisWidgetPlugin extends Plugin {

    @PluginMethod
    public void activar(PluginCall call) {
        String url = call.getString("url");
        String llave = call.getString("llave");
        if (url == null || llave == null || !url.startsWith("https://") || !llave.startsWith("jvw_")) {
            call.reject("Faltan los datos del widget.");
            return;
        }
        try {
            JarvisLlave.guardar(getContext(), url, llave);
            JarvisWidget.actualizar(getContext());
            JSObject r = new JSObject();
            r.put("ok", true);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("No se pudo guardar la llave: " + e.getMessage());
        }
    }

    @PluginMethod
    public void desactivar(PluginCall call) {
        JarvisLlave.borrar(getContext());
        getContext().getSharedPreferences(JarvisWidget.PREFS, android.content.Context.MODE_PRIVATE).edit().clear().apply();
        JarvisWidget.actualizar(getContext());
        JSObject r = new JSObject();
        r.put("ok", true);
        call.resolve(r);
    }

    @PluginMethod
    public void estado(PluginCall call) {
        JSObject r = new JSObject();
        r.put("activo", JarvisLlave.leer(getContext()) != null);
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
}
