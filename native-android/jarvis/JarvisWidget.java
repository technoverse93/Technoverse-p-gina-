package com.technoverse.admin;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;

/**
 * Widget «Jarvis» de la pantalla de inicio.
 *
 * Dos botones: «Hablar» abre la app con technoverse://jarvis?voz=1 (Jarvis
 * abierto y escuchando) y «Escribir» con technoverse://jarvis. No guarda ni
 * muestra datos: solo abre la app, que usa su propia sesión con huella.
 * La parte web que recibe el enlace está en src/mobile/jarvisAtajo.ts.
 */
public class JarvisWidget extends AppWidgetProvider {
    private static PendingIntent abrir(Context ctx, String url, int codigo) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url), ctx, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(ctx, codigo, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager manager, int[] ids) {
        for (int id : ids) {
            RemoteViews vista = new RemoteViews(ctx.getPackageName(), R.layout.widget_jarvis);
            vista.setOnClickPendingIntent(R.id.jarvis_hablar, abrir(ctx, "technoverse://jarvis?voz=1", 1));
            vista.setOnClickPendingIntent(R.id.jarvis_escribir, abrir(ctx, "technoverse://jarvis", 2));
            vista.setOnClickPendingIntent(R.id.jarvis_marca, abrir(ctx, "technoverse://jarvis", 3));
            manager.updateAppWidget(id, vista);
        }
    }
}
