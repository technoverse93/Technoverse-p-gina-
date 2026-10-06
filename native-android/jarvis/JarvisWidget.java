package com.technoverse.admin;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Mini-widget «Jarvis» de la pantalla de inicio, que se usa EN EL PROPIO
 * RECUADRO (lo pidió el dueño: sin ventanas emergentes y sin huella; el
 * teléfono es solo suyo):
 *
 *  · Micrófono: el dictado del teléfono; la pregunta va a Jarvis con la
 *    sesión de la app y la respuesta sale aquí (y se lee en voz alta).
 *  · «Escribile…»: el chat se dibuja EXACTAMENTE encima del recuadro (mismo
 *    lugar, tamaño y diseño, sin oscurecer la pantalla) con el teclado
 *    abajo: a la vista es el mismo widget que se activa. La respuesta queda
 *    aquí. (Android no deja escribir dentro de un widget.)
 *  · Botón de tamaño: chico (la última respuesta) o grande (la
 *    conversación, que se desliza).
 *  · Tocar la respuesta o «Abrir conversación»: lo mismo que «Escribile…»,
 *    en el propio recuadro. Lo que haya que confirmar se confirma ahí
 *    mismo. NINGÚN toque abre otra ventana encima.
 *  · La marca «Jarvis»: la app (con su huella de siempre), a propósito.
 *
 * Todo eso lo hace JarvisRapido (un puente de Capacitor con la página
 * jarvis-rapido.html). Sin activar (Jarvis → Ajustes → Mini-widget), la
 * hoja explica cómo.
 */
public class JarvisWidget extends AppWidgetProvider {
    static final String PREFS = "jarvis_widget";
    static final String ACTIVO = "activo";
    static final String GRANDE = "grande";
    static final String ESTADO = "estado";
    static final String HISTORIAL = "historial";
    static final String CONVERSACION = "conversacion";
    static final String ACCION = "accion_pendiente";
    static final String CAMBIAR_TAMANO = "com.technoverse.jarvis.TAMANO";
    private static final int MAX_HISTORIAL = 12;

    static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean activo(Context ctx) {
        return prefs(ctx).getBoolean(ACTIVO, false);
    }

    private static PendingIntent ventanita(Context ctx, String modo, int codigo) {
        return ventanita(ctx, modo, codigo, -1);
    }

    /** `widgetId` ≥ 0 = se tocó la caja de ESE widget: la ventanita dibuja el
     *  chat exactamente encima del recuadro (con el tamaño del widget). */
    private static PendingIntent ventanita(Context ctx, String modo, int codigo, int widgetId) {
        Intent intent = new Intent(ctx, JarvisRapido.class);
        intent.setAction("com.technoverse.jarvis." + modo.toUpperCase() + (widgetId >= 0 ? "." + widgetId : ""));
        intent.putExtra(JarvisRapido.EXTRA_MODO, modo);
        if (widgetId >= 0) intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(ctx, widgetId >= 0 ? codigo * 1000 + (widgetId % 1000) : codigo, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent app(Context ctx, int codigo) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("technoverse://jarvis"), ctx, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(ctx, codigo, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent tamano(Context ctx, int codigo) {
        Intent intent = new Intent(ctx, JarvisWidget.class);
        intent.setAction(CAMBIAR_TAMANO);
        return PendingIntent.getBroadcast(ctx, codigo, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager manager, int[] ids) {
        pintar(ctx, manager, ids);
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (intent != null && CAMBIAR_TAMANO.equals(intent.getAction())) {
            prefs(ctx).edit().putBoolean(GRANDE, !prefs(ctx).getBoolean(GRANDE, false)).apply();
            actualizar(ctx);
            return;
        }
        super.onReceive(ctx, intent);
    }

    /** Vuelve a pintar todos los widgets (después de cada respuesta, al activar o al cambiar de tamaño). */
    static void actualizar(Context ctx) {
        AppWidgetManager manager = AppWidgetManager.getInstance(ctx);
        int[] ids = manager.getAppWidgetIds(new ComponentName(ctx, JarvisWidget.class));
        if (ids == null || ids.length == 0) return;
        pintar(ctx, manager, ids);
        manager.notifyAppWidgetViewDataChanged(ids, R.id.jarvis_lista);
    }

    /** La línea de estado («Escuchando…», «Pensando…»); vacía la quita. */
    static void avisar(Context ctx, String texto) {
        prefs(ctx).edit().putString(ESTADO, texto == null ? "" : texto).apply();
        actualizar(ctx);
    }

    /** Suma una vuelta (pregunta y respuesta) a la conversación del widget. */
    static void anotar(Context ctx, String pregunta, String respuesta, String conversacion, boolean accion) {
        SharedPreferences p = prefs(ctx);
        JSONArray lista = historial(ctx), nueva = new JSONArray();
        // Conversación nueva en el servidor = se empieza de cero aquí también.
        String anterior = p.getString(CONVERSACION, null);
        boolean otra = conversacion != null && !conversacion.isEmpty() && anterior != null && !conversacion.equals(anterior);
        int desde = otra ? lista.length() : Math.max(0, lista.length() - (MAX_HISTORIAL - 1));
        for (int i = desde; i < lista.length(); i++) nueva.put(lista.optJSONObject(i));
        try {
            JSONObject vuelta = new JSONObject();
            vuelta.put("p", pregunta);
            vuelta.put("r", respuesta);
            vuelta.put("t", System.currentTimeMillis());
            nueva.put(vuelta);
        } catch (Exception ignorado) { /* sin esa vuelta */ }
        SharedPreferences.Editor e = p.edit()
            .putString(HISTORIAL, nueva.toString())
            .putString("ultima_respuesta", respuesta)
            .putString(ESTADO, "")
            .putBoolean(ACCION, accion);
        if (conversacion != null && !conversacion.isEmpty()) e.putString(CONVERSACION, conversacion);
        e.apply();
        actualizar(ctx);
    }

    static JSONArray historial(Context ctx) {
        try { return new JSONArray(prefs(ctx).getString(HISTORIAL, "[]")); } catch (Exception e) { return new JSONArray(); }
    }

    private static void pintar(Context ctx, AppWidgetManager manager, int[] ids) {
        SharedPreferences p = prefs(ctx);
        boolean activo = activo(ctx), grande = p.getBoolean(GRANDE, false), accion = p.getBoolean(ACCION, false);
        String estado = !activo ? "Sin activar" : accion ? "Acción por confirmar · tocá aquí" : p.getString(ESTADO, "");
        String ultima = p.getString("ultima_respuesta", null);
        String abajo = !activo
            ? "Sin activar: tocá para abrir la app y activalo en Jarvis → Ajustes → Mini-widget."
            : ultima != null ? ultima : "Hablale o escribile: la respuesta sale aquí.";
        for (int id : ids) {
            RemoteViews vista = new RemoteViews(ctx.getPackageName(), grande ? R.layout.widget_jarvis_grande : R.layout.widget_jarvis);
            vista.setTextViewText(R.id.jarvis_estado, estado == null ? "" : estado);
            vista.setViewVisibility(R.id.jarvis_estado, estado == null || estado.isEmpty() ? View.INVISIBLE : View.VISIBLE);
            vista.setOnClickPendingIntent(R.id.jarvis_marca, app(ctx, 14));
            vista.setOnClickPendingIntent(R.id.jarvis_tamano, tamano(ctx, 15));
            // Sin activar, el widget no abre nada propio: todo lleva a la app
            // (Jarvis), donde se activa. Así nunca tapa la pantalla.
            vista.setOnClickPendingIntent(R.id.jarvis_hablar, activo ? ventanita(ctx, "voz", 11) : app(ctx, 21));
            vista.setOnClickPendingIntent(R.id.jarvis_escribir, activo ? ventanita(ctx, "escribir", 12, id) : app(ctx, 22));
            if (grande) {
                Intent servicio = new Intent(ctx, JarvisWidgetLista.class);
                servicio.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
                servicio.setData(Uri.parse(servicio.toUri(Intent.URI_INTENT_SCHEME)));
                vista.setRemoteAdapter(R.id.jarvis_lista, servicio);
                vista.setEmptyView(R.id.jarvis_lista, R.id.jarvis_vacio);
                // Todo toque al recuadro se queda EN el recuadro (nunca una
                // hoja ni la app): el chat se dibuja encima del propio widget.
                vista.setOnClickPendingIntent(R.id.jarvis_abrir, activo ? ventanita(ctx, "escribir", 13, id) : app(ctx, 23));
                vista.setOnClickPendingIntent(R.id.jarvis_vacio, activo ? ventanita(ctx, "escribir", 16, id) : app(ctx, 24));
            } else {
                vista.setTextViewText(R.id.jarvis_ultima, abajo);
                vista.setOnClickPendingIntent(R.id.jarvis_ultima, activo ? ventanita(ctx, "escribir", 13, id) : app(ctx, 23));
            }
            manager.updateAppWidget(id, vista);
        }
    }

    /** La respuesta sin el formato del chat (negritas, títulos, tablas), para el widget. */
    static String textoPlano(String md) {
        if (md == null) return "";
        String t = md.replaceAll("(?s)```.*?```", "(Hay un bloque de código: miralo en la conversación.)");
        StringBuilder sb = new StringBuilder();
        for (String linea : t.split("\n")) {
            String l = linea.trim();
            if (l.matches("^\\|.*\\|$")) continue;
            l = l.replaceAll("^#{1,6}\\s*", "").replaceAll("^[-*]\\s+", "• ");
            if (!l.isEmpty()) sb.append(l).append('\n');
        }
        return sb.toString().replace("**", "").replace("__", "").replace("`", "").trim();
    }
}
