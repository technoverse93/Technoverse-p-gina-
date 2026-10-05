package com.technoverse.admin;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.widget.RemoteViews;

/**
 * Mini-widget «Jarvis» de la pantalla de inicio.
 *
 * La barra «Preguntale a Jarvis…» y el micrófono abren la ventanita
 * (JarvisRapido) ENCIMA de la pantalla de inicio: el mismo Jarvis de la app
 * con tu sesión, sin huella y sin abrir la app (lo pidió el dueño; el
 * teléfono es solo suyo). Abajo queda la última respuesta. La marca
 * «Jarvis» abre Jarvis en la app (con su huella de siempre).
 *
 * Sin activar (Jarvis → Ajustes → Mini-widget), la ventanita explica cómo.
 */
public class JarvisWidget extends AppWidgetProvider {
    static final String PREFS = "jarvis_widget";
    static final String ACTIVO = "activo";

    static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean activo(Context ctx) {
        return prefs(ctx).getBoolean(ACTIVO, false);
    }

    private static PendingIntent ventanita(Context ctx, boolean voz, int codigo) {
        Intent intent = new Intent(ctx, JarvisRapido.class);
        intent.setAction(voz ? "com.technoverse.jarvis.HABLAR" : "com.technoverse.jarvis.ESCRIBIR");
        intent.putExtra(JarvisRapido.EXTRA_VOZ, voz);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(ctx, codigo, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent app(Context ctx, int codigo) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("technoverse://jarvis"), ctx, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(ctx, codigo, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager manager, int[] ids) {
        pintar(ctx, manager, ids);
    }

    /** Vuelve a pintar todos los widgets (después de cada respuesta o al activar). */
    static void actualizar(Context ctx) {
        AppWidgetManager manager = AppWidgetManager.getInstance(ctx);
        int[] ids = manager.getAppWidgetIds(new ComponentName(ctx, JarvisWidget.class));
        if (ids != null && ids.length > 0) pintar(ctx, manager, ids);
    }

    private static void pintar(Context ctx, AppWidgetManager manager, int[] ids) {
        String ultima = prefs(ctx).getString("ultima_respuesta", null);
        String abajo = !activo(ctx)
            ? "Tocá para activarlo: Jarvis → Ajustes → Mini-widget."
            : ultima != null ? ultima : "Preguntale o pedile lo que quieras del negocio.";
        for (int id : ids) {
            RemoteViews vista = new RemoteViews(ctx.getPackageName(), R.layout.widget_jarvis);
            vista.setTextViewText(R.id.jarvis_ultima, abajo);
            vista.setOnClickPendingIntent(R.id.jarvis_hablar, ventanita(ctx, true, 11));
            vista.setOnClickPendingIntent(R.id.jarvis_escribir, ventanita(ctx, false, 12));
            vista.setOnClickPendingIntent(R.id.jarvis_ultima, ventanita(ctx, false, 13));
            vista.setOnClickPendingIntent(R.id.jarvis_marca, app(ctx, 14));
            manager.updateAppWidget(id, vista);
        }
    }

    /** La respuesta sin el formato del chat (negritas, títulos, tablas), para el widget. */
    static String textoPlano(String md) {
        if (md == null) return "";
        String t = md.replaceAll("(?s)```.*?```", "(Hay un bloque de código: miralo en Jarvis.)");
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
