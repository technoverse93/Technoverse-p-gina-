package com.technoverse.admin;

import android.appwidget.AppWidgetManager;
import android.content.ActivityNotFoundException;
import android.content.res.Configuration;
import android.graphics.Rect;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Bundle;
import android.speech.RecognizerIntent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebView;

import com.getcapacitor.JSObject;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.CapConfig;
import com.getcapacitor.PluginHandle;

import java.lang.reflect.Field;
import java.util.ArrayList;

/**
 * Lo que hay detrás del mini-widget de Jarvis: el MISMO Jarvis de la app con
 * la MISMA sesión (lo pidió el dueño: «hacer todo como lo haría con mi
 * sesión», sin huella y sin ventanas emergentes; el teléfono es solo suyo).
 * Es un segundo puente de Capacitor con la página liviana jarvis-rapido.html
 * (src/rapido.tsx), que comparte con la app el almacenamiento (la sesión) y
 * la versión OTA instalada.
 *
 * Tres modos (EXTRA_MODO):
 *  · «voz»: solo el dictado del teléfono. No se ve nada propio: la pregunta
 *    va a Jarvis y la respuesta sale en el widget (y se lee). Mientras
 *    contesta, esta ventana no tapa nada: los toques pasan a la pantalla
 *    de inicio.
 *  · «escribir»: el chat se dibuja exactamente encima del recuadro del
 *    widget (sin oscurecer), con el teclado abajo; la respuesta queda en el
 *    widget. Si no se sabe dónde está el widget, una barrita sobre el teclado.
 *  · «hoja»: Jarvis completo, para confirmar acciones o ver tablas.
 *
 * La página decide si puede abrir: widget activado en este teléfono, sesión
 * del superadmin y sin bloqueo de aparato. El candado de huella de la app no
 * se toca. Sin capturas de pantalla (FLAG_SECURE), como la app.
 */
public class JarvisRapido extends BridgeActivity {
    static final String EXTRA_MODO = "modo";
    /** Widgets puestos antes del modo «voz»: se leían con este dato. */
    static final String EXTRA_VOZ = "voz";
    static final String PAGINA = "/jarvis-rapido.html";

    private boolean conPagina = false;
    private boolean creada = false;
    private String modo = "hoja";
    private ActivityResultLauncher<Intent> dictado;
    /** Dónde está el widget en la pantalla (px), si se abrió desde su caja. */
    private Rect marco = null;

    static String modoDe(Intent intent) {
        if (intent == null) return "hoja";
        String m = intent.getStringExtra(EXTRA_MODO);
        if ("voz".equals(m) || "escribir".equals(m) || "hoja".equals(m)) return m;
        return intent.getBooleanExtra(EXTRA_VOZ, false) ? "voz" : "hoja";
    }

    String modo() {
        return modo;
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Antes de super.onCreate(): ahí el puente arma su lista de plugins y
        // lee la configuración (con la página de inicio de la ventanita).
        registerPlugin(JarvisWidgetPlugin.class);
        config = configConPagina();
        modo = modoDe(getIntent());
        marco = marcoDe(getIntent());
        super.onCreate(savedInstanceState);
        dictado = registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), this::alDictar);

        Window ventana = getWindow();
        ventana.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
        ventana.addFlags(WindowManager.LayoutParams.FLAG_SECURE);

        final WebView vista = getBridge() != null ? getBridge().getWebView() : null;
        if (vista != null) {
            vista.setBackgroundColor(Color.TRANSPARENT);
            vista.getSettings().setTextZoom(100);
            if (vista.getParent() instanceof View) ((View) vista.getParent()).setBackgroundColor(Color.TRANSPARENT);
            // Si una versión de Capacitor no dejara fijar la página de inicio,
            // se carga a mano, DESPUÉS de lo que el puente ya dejó encolado.
            if (!conPagina) {
                final String url = getBridge().getLocalUrl() + PAGINA;
                vista.post(() -> vista.loadUrl(url));
            }
        }

        // Atrás = cerrar, aunque la página no haya terminado de cargar.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                cerrar();
            }
        });

        creada = true;
        aplicarModo();
        if ("voz".equals(modo)) dictar();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // La primera vez la llama el propio puente al arrancar: eso ya lo
        // resuelve onCreate.
        if (!creada || intent == null) return;
        setIntent(intent);
        modo = modoDe(intent);
        marco = marcoDe(intent);
        aplicarModo();
        if ("voz".equals(modo)) dictar();
    }

    /**
     * El recuadro del widget en la pantalla, a partir de la caja que se tocó
     * (el lanzador da su posición) y del tamaño del widget (sus opciones).
     * La caja va abajo del widget, con 10 dp a los lados y abajo.
     */
    private Rect marcoDe(Intent intent) {
        if (intent == null || !"escribir".equals(modoDe(intent))) return null;
        int id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1);
        Rect caja = intent.getSourceBounds();
        if (id < 0 || caja == null) return null;
        try {
            Bundle o = AppWidgetManager.getInstance(this).getAppWidgetOptions(id);
            float d = getResources().getDisplayMetrics().density;
            boolean vertical = getResources().getConfiguration().orientation != Configuration.ORIENTATION_LANDSCAPE;
            int anchoDp = o.getInt(vertical ? AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH : AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH);
            int altoDp = o.getInt(vertical ? AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT : AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT);
            if (anchoDp <= 0 || altoDp <= 0) return null;
            int izq = Math.round(caja.left - 10 * d);
            int abajo = Math.round(caja.bottom + 12 * d);
            int ancho = Math.max(caja.width() + Math.round(62 * d), Math.round(anchoDp * d));
            Rect r = new Rect(izq, abajo - Math.round(altoDp * d), izq + ancho, abajo);
            return r.top >= 0 && r.height() > 80 * d ? r : null;
        } catch (Exception e) {
            return null;
        }
    }

    /** El marco en px CSS relativos a la página (null si no hay). */
    JSObject marcoCss() {
        if (marco == null) return null;
        WebView vista = getBridge() != null ? getBridge().getWebView() : null;
        if (vista == null) return null;
        int[] en = new int[2];
        vista.getLocationOnScreen(en);
        float d = getResources().getDisplayMetrics().density;
        JSObject m = new JSObject();
        m.put("x", (marco.left - en[0]) / d);
        m.put("y", (marco.top - en[1]) / d);
        m.put("ancho", marco.width() / d);
        m.put("alto", marco.height() / d);
        return m;
    }

    boolean noche() {
        return (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    /** Cuánto se oscurece y si la ventana recibe toques, según el modo. */
    private void aplicarModo() {
        Window ventana = getWindow();
        ventana.clearFlags(WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE | WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE);
        if ("voz".equals(modo) || ("escribir".equals(modo) && marco != null)) {
            // Por voz no se ve nada; al escribir sobre el widget, el chat ocupa
            // su recuadro y la pantalla de inicio queda tal cual (sin oscurecer).
            ventana.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
        } else {
            ventana.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
            ventana.setDimAmount("escribir".equals(modo) ? 0.3f : 0.5f);
        }
    }

    /** Deja de tapar: los toques pasan a la pantalla de inicio mientras Jarvis contesta. */
    void soltar() {
        Window ventana = getWindow();
        ventana.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
        ventana.addFlags(WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE | WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE);
    }

    /** El dictado del propio teléfono (el de Google): solo su cartelito. */
    private void dictar() {
        JarvisWidget.avisar(this, "Escuchando…");
        Intent pedir = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        pedir.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        pedir.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "es-CR");
        pedir.putExtra(RecognizerIntent.EXTRA_PROMPT, "Hablale a Jarvis");
        try {
            dictado.launch(pedir);
        } catch (ActivityNotFoundException e) {
            // Sin dictado en este teléfono: se ofrece escribir.
            JarvisWidget.avisar(this, "");
            modo = "escribir";
            aplicarModo();
            JarvisWidgetPlugin p = plugin();
            if (p != null) p.emitirPedido("escribir", null);
        }
    }

    private void alDictar(ActivityResult resultado) {
        String texto = null;
        Intent datos = resultado != null ? resultado.getData() : null;
        if (datos != null) {
            ArrayList<String> dichos = datos.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
            if (dichos != null && !dichos.isEmpty()) texto = dichos.get(0);
        }
        if (texto == null || texto.trim().isEmpty()) {
            JarvisWidget.avisar(this, "");
            cerrar();
            return;
        }
        JarvisWidget.avisar(this, "Pensando…");
        soltar();
        JarvisWidgetPlugin p = plugin();
        if (p != null) p.emitirPedido("voz", texto.trim());
        else cerrar();
    }

    private JarvisWidgetPlugin plugin() {
        if (getBridge() == null) return null;
        PluginHandle h = getBridge().getPlugin("JarvisWidget");
        return h != null && h.getInstance() instanceof JarvisWidgetPlugin ? (JarvisWidgetPlugin) h.getInstance() : null;
    }

    /** Cierra la ventanita y su tarea (no queda en «Recientes»). */
    void cerrar() {
        finishAndRemoveTask();
    }

    /**
     * La configuración de siempre (capacitor.config.json) con otra página de
     * inicio. Capacitor no la deja cambiar por fuera del archivo, así que se
     * fija el campo directamente; si no se pudiera, ver arriba.
     */
    private CapConfig configConPagina() {
        CapConfig c = CapConfig.loadDefault(this);
        try {
            Field campo = CapConfig.class.getDeclaredField("startPath");
            campo.setAccessible(true);
            campo.set(c, PAGINA);
            conPagina = true;
        } catch (Exception e) {
            conPagina = false;
        }
        return c;
    }
}
