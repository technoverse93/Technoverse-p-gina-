package com.technoverse.admin;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;

/**
 * Puente entre la web (src/mobile/pushNativo.ts) y los avisos push.
 * No es un paquete npm: MainActivity lo registra a mano.
 *
 *   estado() ............ ¿esta APK trae Firebase? (sin google-services.json no)
 *   obtenerToken() ...... la dirección de ESTE teléfono para los avisos.
 *   configurar() ........ deja la dirección de Supabase y su clave pública para
 *                         que «Responder» pueda mandar sin abrir la app.
 *   chatAbierto() ....... la web avisa si estás mirando el chat (no repetir).
 *   limpiar() ........... quita la notificación de un chat (ya lo abriste).
 */
@CapacitorPlugin(name = "PushNativo")
public class PushNativoPlugin extends Plugin {
    private boolean hayFirebase() {
        try { return !FirebaseApp.getApps(getContext()).isEmpty(); }
        catch (Throwable e) { return false; }
    }

    @PluginMethod
    public void estado(PluginCall call) {
        JSObject r = new JSObject();
        r.put("firebase", hayFirebase());
        call.resolve(r);
    }

    @PluginMethod
    public void obtenerToken(final PluginCall call) {
        if (!hayFirebase()) { call.reject("sin_firebase"); return; }
        try {
            FirebaseMessaging.getInstance().getToken().addOnCompleteListener(tarea -> {
                if (!tarea.isSuccessful() || tarea.getResult() == null) {
                    Exception e = tarea.getException();
                    call.reject(e != null && e.getMessage() != null ? e.getMessage() : "sin_token");
                    return;
                }
                NotifPush.prefs(getContext()).edit().putBoolean("token_nuevo", false).apply();
                JSObject r = new JSObject();
                r.put("token", tarea.getResult());
                call.resolve(r);
            });
        } catch (Throwable e) {
            call.reject("sin_firebase");
        }
    }

    @PluginMethod
    public void configurar(PluginCall call) {
        String url = call.getString("url");
        String clave = call.getString("clave");
        if (url == null || clave == null) { call.reject("faltan datos"); return; }
        NotifPush.prefs(getContext()).edit().putString("url", url.replaceAll("/+$", "")).putString("clave", clave).apply();
        NotifPush.canales(getContext());
        call.resolve();
    }

    @PluginMethod
    public void chatAbierto(PluginCall call) {
        NotifPush.prefs(getContext()).edit().putBoolean("chat_abierto", Boolean.TRUE.equals(call.getBoolean("abierto", false))).apply();
        call.resolve();
    }

    @PluginMethod
    public void limpiar(PluginCall call) {
        String chat = call.getString("conv");
        if (chat == null || chat.isEmpty()) NotifPush.limpiarTodo(getContext());
        else NotifPush.limpiar(getContext(), chat);
        call.resolve();
    }
}
