package com.technoverse.admin;

import android.app.ActivityManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.Person;
import androidx.core.app.RemoteInput;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.List;

/**
 * Las notificaciones de la app que llegan por push (Firebase): el chat de los
 * clientes (con «Responder» en la propia notificación, como WhatsApp) y los
 * avisos de Javier. Las usan JarvisPushService (llega un aviso) y
 * ResponderReceiver (se contestó desde la notificación).
 *
 * Lo que se guarda en este teléfono (SharedPreferences «tv_push»):
 *   url, clave ......... la dirección de Supabase y su clave pública (la web
 *                        las deja aquí: el receptor no tiene sesión).
 *   llave_<chat> ....... la llave firmada para contestar ESE chat (24 h), la
 *                        última que mandó el servidor.
 *   hist_<chat> ........ lo último de la conversación, para mostrarla en la
 *                        notificación.
 *   chat_abierto ....... la web avisa si estás mirando el chat ahora.
 */
final class NotifPush {
    static final String PREFS = "tv_push";
    static final String CANAL_CHAT = "chat_clientes";
    static final String CANAL_AVISOS = "jarvis_avisos";
    static final String ACCION_RESPONDER = "com.technoverse.admin.RESPONDER";
    static final String CLAVE_TEXTO = "texto";
    private static final int MAX_HIST = 8;

    private NotifPush() {}

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** ¿La app está a la vista ahora mismo? */
    static boolean enPrimerPlano(Context c) {
        try {
            ActivityManager am = (ActivityManager) c.getSystemService(Context.ACTIVITY_SERVICE);
            List<ActivityManager.RunningAppProcessInfo> ps = am == null ? null : am.getRunningAppProcesses();
            if (ps == null) return false;
            for (ActivityManager.RunningAppProcessInfo p : ps) {
                if (p.processName.equals(c.getPackageName())) {
                    return p.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND;
                }
            }
        } catch (Exception e) { /* se asume que no */ }
        return false;
    }

    static int idDe(String clave, int base) {
        return base + ((clave.hashCode() & 0x7fffffff) % 900000);
    }

    static void canales(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        NotificationChannel chat = new NotificationChannel(CANAL_CHAT, "Chat con clientes", NotificationManager.IMPORTANCE_HIGH);
        chat.setDescription("Cuando un cliente te escribe en el chat");
        chat.enableVibration(true);
        chat.setLockscreenVisibility(android.app.Notification.VISIBILITY_PRIVATE);
        nm.createNotificationChannel(chat);
        NotificationChannel avisos = new NotificationChannel(CANAL_AVISOS, "Avisos de Javier", NotificationManager.IMPORTANCE_DEFAULT);
        avisos.setDescription("Lo que Javier vigila: chats esperando, existencias, seguridad y el resumen de la mañana");
        nm.createNotificationChannel(avisos);
    }

    // ----------------------------- historial -----------------------------
    private static JSONArray historial(Context c, String chat) {
        try { return new JSONArray(prefs(c).getString("hist_" + chat, "[]")); }
        catch (Exception e) { return new JSONArray(); }
    }

    /** quien: «c» el cliente · «yo» vos · «s» el sistema. */
    static void agregar(Context c, String chat, String quien, String texto, long ts) {
        try {
            JSONArray h = historial(c, chat);
            JSONArray nuevo = new JSONArray();
            int desde = Math.max(0, h.length() - (MAX_HIST - 1));
            for (int i = desde; i < h.length(); i++) nuevo.put(h.get(i));
            nuevo.put(new JSONObject().put("q", quien).put("t", texto).put("ts", ts));
            prefs(c).edit().putString("hist_" + chat, nuevo.toString()).apply();
        } catch (Exception e) { /* sin historial: se muestra lo último */ }
    }

    static void limpiar(Context c, String chat) {
        prefs(c).edit().remove("hist_" + chat).remove("llave_" + chat).apply();
        try { NotificationManagerCompat.from(c).cancel(idDe(chat, 1_000_000)); } catch (Exception e) { /* nada */ }
    }

    static void limpiarTodo(Context c) {
        SharedPreferences.Editor ed = prefs(c).edit();
        for (String k : prefs(c).getAll().keySet()) if (k.startsWith("hist_") || k.startsWith("llave_")) ed.remove(k);
        ed.apply();
        try { NotificationManagerCompat.from(c).cancelAll(); } catch (Exception e) { /* nada */ }
    }

    // ------------------------------- chat -------------------------------
    /** Muestra (o actualiza) la notificación de una conversación. */
    static void publicarChat(Context c, String chat, String cliente, boolean silenciosa) {
        canales(c);
        Person yo = new Person.Builder().setName("Vos").build();
        Person ellos = new Person.Builder().setName(cliente).build();
        Person sistema = new Person.Builder().setName("Technoverse").build();
        NotificationCompat.MessagingStyle estilo = new NotificationCompat.MessagingStyle(yo);
        String ultimo = "";
        JSONArray h = historial(c, chat);
        for (int i = 0; i < h.length(); i++) {
            JSONObject m = h.optJSONObject(i);
            if (m == null) continue;
            String q = m.optString("q");
            String t = m.optString("t");
            long ts = m.optLong("ts", System.currentTimeMillis());
            estilo.addMessage(t, ts, "yo".equals(q) ? yo : "s".equals(q) ? sistema : ellos);
            if ("c".equals(q)) ultimo = t;
        }

        int id = idDe(chat, 1_000_000);
        int flagsMut = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
        int flagsInm = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);

        // Tocar la notificación: abre el chat de esa conversación.
        Intent abrir = new Intent(Intent.ACTION_VIEW, Uri.parse("technoverse://jarvis?modulo=chat&conv=" + Uri.encode(chat)));
        abrir.setPackage(c.getPackageName());
        abrir.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent alAbrir = PendingIntent.getActivity(c, id, abrir, flagsInm);

        // «Responder»: el texto escrito llega a ResponderReceiver.
        Intent responder = new Intent(c, ResponderReceiver.class);
        responder.setAction(ACCION_RESPONDER);
        responder.putExtra("chat", chat);
        responder.putExtra("cliente", cliente);
        PendingIntent alResponder = PendingIntent.getBroadcast(c, id, responder, flagsMut);
        RemoteInput entrada = new RemoteInput.Builder(CLAVE_TEXTO).setLabel("Escribí tu respuesta…").build();
        NotificationCompat.Action responderAccion = new NotificationCompat.Action.Builder(R.drawable.ic_stat_aviso, "Responder", alResponder)
                .addRemoteInput(entrada)
                .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
                .setShowsUserInterface(false)
                .setAllowGeneratedReplies(true)
                .build();

        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CANAL_CHAT)
                .setSmallIcon(R.drawable.ic_stat_aviso)
                .setColor(0xFF031837)
                .setContentTitle(cliente)
                .setContentText(ultimo)
                .setStyle(estilo)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setAutoCancel(true)
                .setOnlyAlertOnce(silenciosa)
                .setContentIntent(alAbrir)
                .addAction(responderAccion);
        publicar(c, id, b);
    }

    // ------------------------------- avisos -------------------------------
    /** Un aviso de Javier. Tocarlo abre Javier (o el módulo al que lleva). */
    static void publicarAviso(Context c, String titulo, String texto, String destino, String nivel) {
        canales(c);
        String url = "technoverse://jarvis" + (destino != null && !destino.isEmpty() ? "?modulo=" + Uri.encode(destino) : "");
        Intent abrir = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        abrir.setPackage(c.getPackageName());
        abrir.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int id = idDe(titulo + texto, 3_000_000);
        PendingIntent alAbrir = PendingIntent.getActivity(c, id, abrir, PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0));
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CANAL_AVISOS)
                .setSmallIcon(R.drawable.ic_stat_aviso)
                .setColor(0xFF031837)
                .setContentTitle("Javier · " + titulo)
                .setContentText(texto)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(texto))
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setPriority("urgente".equals(nivel) ? NotificationCompat.PRIORITY_HIGH : NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true)
                .setContentIntent(alAbrir);
        publicar(c, id, b);
    }

    private static void publicar(Context c, int id, NotificationCompat.Builder b) {
        try { NotificationManagerCompat.from(c).notify(id, b.build()); }
        catch (SecurityException e) { /* sin permiso de notificaciones: no hay nada que hacer */ }
    }
}
