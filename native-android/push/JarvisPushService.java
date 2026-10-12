package com.technoverse.admin;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * Recibe los avisos push (Firebase) aunque la app esté cerrada y arma la
 * notificación. Son mensajes de DATOS (el servidor no manda una notificación
 * hecha): así el teléfono puede ponerle el botón «Responder» y juntar los
 * mensajes de cada conversación. Ver supabase/functions/asistente-ia/push.ts.
 *
 *   tipo=chat   conv, cliente, texto, ts, llave   → notificación del chat
 *   tipo=aviso  titulo, texto, destino, nivel     → aviso de Jarvis
 */
public class JarvisPushService extends FirebaseMessagingService {
    @Override
    public void onNewToken(String token) {
        // La web lo vuelve a registrar al abrir la app; aquí solo se guarda.
        NotifPush.prefs(this).edit().putString("token", token).putBoolean("token_nuevo", true).apply();
    }

    @Override
    public void onMessageReceived(RemoteMessage mensaje) {
        Map<String, String> d = mensaje.getData();
        if (d == null) return;
        String tipo = d.get("tipo");
        if ("chat".equals(tipo)) {
            String chat = d.get("conv");
            if (chat == null || chat.isEmpty()) return;
            String cliente = d.get("cliente") != null ? d.get("cliente") : "Un cliente";
            String texto = d.get("texto") != null ? d.get("texto") : "Mensaje nuevo";
            long ts = System.currentTimeMillis();
            try { if (d.get("ts") != null) ts = Long.parseLong(d.get("ts")); } catch (NumberFormatException e) { /* la hora de ahora */ }
            if (d.get("llave") != null) NotifPush.prefs(this).edit().putString("llave_" + chat, d.get("llave")).apply();
            NotifPush.agregar(this, chat, "c", texto, ts);
            // Mirando el chat en este momento: ya lo ves en pantalla, no se repite.
            if (NotifPush.enPrimerPlano(this) && NotifPush.prefs(this).getBoolean("chat_abierto", false)) return;
            NotifPush.publicarChat(this, chat, cliente, false);
        } else if ("aviso".equals(tipo)) {
            String titulo = d.get("titulo") != null ? d.get("titulo") : "Aviso";
            String texto = d.get("texto") != null ? d.get("texto") : "";
            NotifPush.publicarAviso(this, titulo, texto, d.get("destino"), d.get("nivel"));
        }
    }
}
