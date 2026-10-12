package com.technoverse.admin;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;

import androidx.core.app.RemoteInput;

import org.json.JSONObject;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Lo que se escribe en el botón «Responder» de la notificación del chat. Se
 * manda a la función (accion «responder_push») con la llave firmada que
 * trajo el aviso; no hace falta abrir la app ni tener sesión a mano.
 * Al terminar, la notificación se actualiza con tu respuesta (o con el
 * motivo si no se pudo), que es lo que hace que deje de «cargar».
 */
public class ResponderReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(final Context contexto, Intent intento) {
        if (!NotifPush.ACCION_RESPONDER.equals(intento.getAction())) return;
        Bundle entrada = RemoteInput.getResultsFromIntent(intento);
        CharSequence escrito = entrada == null ? null : entrada.getCharSequence(NotifPush.CLAVE_TEXTO);
        final String chat = intento.getStringExtra("chat");
        final String cliente = intento.getStringExtra("cliente") != null ? intento.getStringExtra("cliente") : "Cliente";
        if (escrito == null || chat == null) return;
        final String texto = escrito.toString().trim();
        if (texto.isEmpty()) return;

        final PendingResult pendiente = goAsync();
        final Context app = contexto.getApplicationContext();
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    String error = enviar(app, chat, texto);
                    if (error == null) {
                        NotifPush.agregar(app, chat, "yo", texto, System.currentTimeMillis());
                    } else {
                        NotifPush.agregar(app, chat, "s", "No se pudo enviar tu respuesta: " + error, System.currentTimeMillis());
                    }
                    // Se vuelve a mostrar sin sonido: así la notificación deja de «cargar».
                    NotifPush.publicarChat(app, chat, cliente, true);
                } catch (Exception e) {
                    try {
                        NotifPush.agregar(app, chat, "s", "No se pudo enviar tu respuesta. Tocá para abrir el chat.", System.currentTimeMillis());
                        NotifPush.publicarChat(app, chat, cliente, true);
                    } catch (Exception ignorada) { /* nada más que hacer */ }
                } finally {
                    pendiente.finish();
                }
            }
        }).start();
    }

    /** null si salió bien; si no, el motivo para mostrarlo en la notificación. */
    private static String enviar(Context c, String chat, String texto) throws Exception {
        SharedPreferences p = NotifPush.prefs(c);
        String url = p.getString("url", null);
        String clave = p.getString("clave", null);
        String llave = p.getString("llave_" + chat, null);
        if (url == null || clave == null) return "abrí la app una vez para activar las respuestas.";
        if (llave == null) return "esta respuesta venció. Abrí la app para contestar.";

        HttpURLConnection con = (HttpURLConnection) new URL(url + "/functions/v1/asistente-ia").openConnection();
        try {
            con.setRequestMethod("POST");
            con.setConnectTimeout(6000);
            con.setReadTimeout(8000);
            con.setDoOutput(true);
            con.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            con.setRequestProperty("Authorization", "Bearer " + clave);
            con.setRequestProperty("apikey", clave);
            byte[] cuerpo = new JSONObject().put("accion", "responder_push").put("llave", llave).put("texto", texto).toString().getBytes(StandardCharsets.UTF_8);
            OutputStream out = con.getOutputStream();
            out.write(cuerpo);
            out.close();
            int codigo = con.getResponseCode();
            if (codigo == 200) return null;
            InputStream in = codigo >= 400 ? con.getErrorStream() : con.getInputStream();
            String motivo = "error " + codigo;
            if (in != null) {
                java.io.ByteArrayOutputStream buf = new java.io.ByteArrayOutputStream();
                byte[] trozo = new byte[1024];
                int n;
                while ((n = in.read(trozo)) > 0 && buf.size() < 4096) buf.write(trozo, 0, n);
                try { motivo = new JSONObject(buf.toString("UTF-8")).optString("error", motivo); } catch (Exception e) { /* se queda el código */ }
            }
            return motivo;
        } finally {
            con.disconnect();
        }
    }
}
