package com.technoverse.admin;

import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * La conversación del widget grande (la lista que se desliza). Lee las
 * vueltas que guardó JarvisWidget.anotar: pregunta a la derecha, respuesta
 * de Jarvis a la izquierda, la más nueva abajo.
 */
public class JarvisWidgetLista extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new Filas(getApplicationContext());
    }

    private static final class Filas implements RemoteViewsFactory {
        private final Context ctx;
        private JSONArray vueltas = new JSONArray();

        Filas(Context ctx) {
            this.ctx = ctx;
        }

        @Override public void onCreate() { onDataSetChanged(); }
        @Override public void onDataSetChanged() { vueltas = JarvisWidget.historial(ctx); }
        @Override public void onDestroy() { vueltas = new JSONArray(); }
        @Override public int getCount() { return vueltas.length(); }
        @Override public RemoteViews getLoadingView() { return null; }
        @Override public int getViewTypeCount() { return 1; }
        @Override public long getItemId(int posicion) { return posicion; }
        @Override public boolean hasStableIds() { return false; }

        @Override
        public RemoteViews getViewAt(int posicion) {
            RemoteViews fila = new RemoteViews(ctx.getPackageName(), R.layout.widget_jarvis_fila);
            JSONObject v = vueltas.optJSONObject(posicion);
            String p = v != null ? v.optString("p", "") : "";
            String r = v != null ? v.optString("r", "") : "";
            fila.setTextViewText(R.id.jarvis_fila_p, p);
            fila.setViewVisibility(R.id.jarvis_fila_p, p.isEmpty() ? android.view.View.GONE : android.view.View.VISIBLE);
            fila.setTextViewText(R.id.jarvis_fila_r, r);
            return fila;
        }
    }
}
