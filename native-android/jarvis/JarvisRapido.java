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
import android.view.Gravity;
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
 * Lo que hay detrás del mini-widget de Javier: el MISMO Javier de la app con
 * la MISMA sesión (lo pidió el dueño: «hacer todo como lo haría con mi
 * sesión», sin huella y sin ventanas emergentes; el teléfono es solo suyo).
 * Es un segundo puente de Capacitor con la página liviana jarvis-rapido.html
 * (src/rapido.tsx), que comparte con la app el almacenamiento (la sesión) y
 * la versión OTA instalada.
 *
 * Tres modos (EXTRA_MODO):
 *  · «voz»: solo el dictado del teléfono. No se ve nada propio: la pregunta
 *    va a Javier y la respuesta sale en el widget (y se lee). Mientras
 *    contesta, esta ventana no tapa nada: los toques pasan a la pantalla
 *    de inicio.
 *  · «escribir»: el chat se dibuja exactamente encima del recuadro del
 *    widget (sin oscurecer), con el teclado abajo; la respuesta queda en el
 *    widget. Si no se sabe dónde está el widget, una barrita sobre el teclado.
 *  · «hoja»: Javier completo, para confirmar acciones o ver tablas.
 *  · «oye»: lo llamaste («Oye Javier» o el botón del asistente, ver
 *    PhillAsistente): un panel chico abajo, escuchando de una, SIN oscurecer
 *    la pantalla (como el asistente de Google). Si abre otra app, se quita.
 *
 * La página decide si puede abrir: widget activado en este teléfono, sesión
 * del superadmin y sin bloqueo de aparato. El candado de huella de la app no
 * se toca. Sin capturas de pantalla (FLAG_SECURE), como la app.
 */
public class JarvisRapido extends BridgeActivity {
    static final String EXTRA_MODO = "modo";
    /** Widgets puestos antes del modo «voz»: se leían con este dato. */
    static final String EXTRA_VOZ = "voz";
    /** La abrió el botón del asistente del teléfono (PhillAsistente). */
    static final String EXTRA_ASISTENTE = "asistente";
    /** La abrió la burbuja de Javier: y (px, en pantalla) del centro de la burbuja, para abrirse a su lado. */
    static final String EXTRA_ANCLA_Y = "anclaY";
    /** Lo mismo en horizontal: x (px) del centro de la burbuja, para abrirse del lado donde está. */
    static final String EXTRA_ANCLA_X = "anclaX";
    static final String EXTRA_BURBUJA = "burbuja";
    /**
     * Medidas del panel que sale de la burbuja (dp). Es una tarjeta CHICA, no una hoja a lo ancho:
     * lo que queda fuera de ella (YouTube, WhatsApp, el escritorio) se sigue viendo y usando.
     */
    static final int ANCHO_PANEL_BURBUJA_DP = 330;
    static final int ALTO_CHAT_BURBUJA_DP = 320;
    static final int ALTO_OYE_BURBUJA_DP = 190;
    static final int ANCHO_HOJA_BURBUJA_DP = 360;
    static final int ALTO_HOJA_BURBUJA_DP = 480;
    static final String PAGINA = "/jarvis-rapido.html";

    private boolean conPagina = false;
    private boolean creada = false;
    private String modo = "hoja";
    private boolean comoAsistente = false;
    private boolean desdeBurbuja = false;
    private int anclaY = -1;
    private int anclaX = -1;
    private ActivityResultLauncher<Intent> dictado;
    /** Dónde está el widget en la pantalla (px), si se abrió desde su caja. */
    private Rect marco = null;

    static String modoDe(Intent intent) {
        if (intent == null) return "hoja";
        String m = intent.getStringExtra(EXTRA_MODO);
        if ("voz".equals(m) || "escribir".equals(m) || "hoja".equals(m) || "oye".equals(m)) return m;
        return intent.getBooleanExtra(EXTRA_VOZ, false) ? "voz" : "hoja";
    }

    String modo() {
        return modo;
    }

    /** ¿La abrió el botón del asistente? (elegir a Javier como asistente ya es el permiso). */
    boolean comoAsistente() {
        return comoAsistente;
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Antes de super.onCreate(): ahí el puente arma su lista de plugins y
        // lee la configuración (con la página de inicio de la ventanita).
        registerPlugin(JarvisWidgetPlugin.class);
        // El teléfono de Javier (abrir apps, llamar, WhatsApp, alarmas…): sin esto, fuera de la app
        // Javier decía que lo hacía pero no pasaba nada (este puente no lo tenía registrado).
        registerPlugin(TelefonoNativoPlugin.class);
        config = configConPagina();
        modo = modoDe(getIntent());
        comoAsistente = getIntent() != null && getIntent().getBooleanExtra(EXTRA_ASISTENTE, false);
        leerBurbuja(getIntent());
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
        // Si la abrió «Oye Javier», ya abrió: se quita el aviso de «tocá para hablar».
        OyeVisibilidad.aperturaConfirmada();
        if ("voz".equals(modo)) dictar();
    }

    // Mientras la ventanita se ve, el micrófono lo usa ella: «Oye Javier» se calla y vuelve al cerrarla.
    @Override
    public void onStart() {
        super.onStart();
        OyeVisibilidad.visible(this, true);
    }

    @Override
    public void onStop() {
        OyeVisibilidad.visible(this, false);
        super.onStop();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // La primera vez la llama el propio puente al arrancar: eso ya lo
        // resuelve onCreate.
        if (!creada || intent == null) return;
        setIntent(intent);
        modo = modoDe(intent);
        comoAsistente = intent.getBooleanExtra(EXTRA_ASISTENTE, false);
        leerBurbuja(intent);
        marco = marcoDe(intent);
        aplicarModo();
        OyeVisibilidad.aperturaConfirmada();
        if ("voz".equals(modo)) dictar();
    }

    /**
     * El recuadro del widget en la pantalla, a partir de la caja que se tocó
     * (el lanzador da su posición) y del tamaño del widget (sus opciones).
     * La caja va abajo del widget, con 10 dp a los lados y abajo.
     */
    private Rect marcoDe(Intent intent) {
        if (intent == null || !"escribir".equals(modoDe(intent))) return null;
        if (desdeBurbuja) return marcoJuntoALaBurbuja();
        int id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1);
        Rect caja = intent.getSourceBounds();
        if (caja == null) return null;
        if (id < 0) return cajaSola(caja);
        try {
            Bundle o = AppWidgetManager.getInstance(this).getAppWidgetOptions(id);
            float d = getResources().getDisplayMetrics().density;
            boolean vertical = getResources().getConfiguration().orientation != Configuration.ORIENTATION_LANDSCAPE;
            int anchoDp = o.getInt(vertical ? AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH : AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH);
            int altoDp = o.getInt(vertical ? AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT : AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT);
            int izq = Math.round(caja.left - 10 * d);
            int abajo = Math.round(caja.bottom + 12 * d);
            int ancho = Math.max(caja.width() + Math.round(62 * d), Math.round(Math.max(0, anchoDp) * d));
            int alto = altoDp > 0 ? Math.round(altoDp * d) : Math.round(300 * d);
            // Arriba no puede quedar debajo de la barra de estado; si el widget
            // es más alto que lo que cabe, el recuadro se ajusta (sigue encima).
            int tope = Math.round(28 * d);
            return new Rect(izq, Math.max(tope, abajo - alto), izq + ancho, abajo);
        } catch (Exception e) {
            return cajaSola(caja);
        }
    }

    private void leerBurbuja(Intent intent) {
        desdeBurbuja = intent != null && intent.getBooleanExtra(EXTRA_BURBUJA, false);
        anclaY = desdeBurbuja ? intent.getIntExtra(EXTRA_ANCLA_Y, -1) : -1;
        anclaX = desdeBurbuja ? intent.getIntExtra(EXTRA_ANCLA_X, -1) : -1;
    }

    boolean desdeBurbuja() {
        return desdeBurbuja;
    }

    /** El chat de la burbuja (ver recuadroBurbuja). */
    private Rect marcoJuntoALaBurbuja() {
        return recuadroBurbuja("escribir");
    }

    /**
     * El recuadro (px, en pantalla) del panel que sale de la burbuja: una tarjeta chica del lado donde
     * está la burbuja, debajo de ella si está arriba o encima si está abajo. La ventana mide EXACTO
     * esto, así que todo lo demás de la pantalla queda libre.
     */
    private Rect recuadroBurbuja(String m) {
        float d = getResources().getDisplayMetrics().density;
        int anchoPantalla = getResources().getDisplayMetrics().widthPixels;
        int altoPantalla = getResources().getDisplayMetrics().heightPixels;
        int margen = Math.round(8 * d);
        int disponible = anchoPantalla - 2 * margen;
        int ancho, alto;
        if ("hoja".equals(m)) {
            ancho = Math.min(disponible, Math.round(ANCHO_HOJA_BURBUJA_DP * d));
            alto = Math.min(Math.round(ALTO_HOJA_BURBUJA_DP * d), Math.round(altoPantalla * 0.62f));
        } else if ("oye".equals(m)) {
            ancho = Math.min(disponible, Math.round(ANCHO_PANEL_BURBUJA_DP * d));
            alto = Math.min(Math.round(ALTO_OYE_BURBUJA_DP * d), Math.round(altoPantalla * 0.4f));
        } else {
            ancho = Math.min(disponible, Math.round(ANCHO_PANEL_BURBUJA_DP * d));
            alto = Math.min(Math.round(ALTO_CHAT_BURBUJA_DP * d), Math.round(altoPantalla * 0.55f));
        }
        int x = anclaX >= 0 && anclaX < anchoPantalla / 2 ? margen : anchoPantalla - ancho - margen;
        int y = posicionJuntoALaBurbuja(alto);
        // El chat se escribe con el teclado abierto (ocupa abajo ~40 %): se queda en la parte de arriba
        // para que el teclado no lo empuje ni lo tape.
        if ("escribir".equals(m)) y = Math.max(Math.round(28 * d), Math.min(y, Math.round(altoPantalla * 0.6f) - alto));
        return new Rect(x, y, x + ancho, y + alto);
    }

    /** Dónde va (y en px) una ventana de `alto` junto a la burbuja, sin salirse de la pantalla. */
    private int posicionJuntoALaBurbuja(int alto) {
        float d = getResources().getDisplayMetrics().density;
        int altoPantalla = getResources().getDisplayMetrics().heightPixels;
        int radio = Math.round(36 * d);
        int y = anclaY < altoPantalla / 2 ? anclaY + radio : anclaY - radio - alto;
        return Math.max(Math.round(28 * d), Math.min(y, altoPantalla - alto - Math.round(16 * d)));
    }

    /** Sin el tamaño del widget: un recuadro que crece hacia arriba desde la caja tocada. */
    private Rect cajaSola(Rect caja) {
        float d = getResources().getDisplayMetrics().density;
        int abajo = Math.round(caja.bottom + 12 * d);
        return new Rect(Math.round(caja.left - 10 * d), Math.max(Math.round(28 * d), abajo - Math.round(300 * d)), Math.round(caja.right + 62 * d), abajo);
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

    /** Alto de la ventana al llamarlo («oye»): el panel de abajo y su margen (dp). */
    static final int ALTO_LLAMADO_DP = 260;
    /** Alto de la barrita para escribir (sin el recuadro del widget), en dp. */
    static final int ALTO_BARRA_DP = 140;
    /** La conversación completa del widget («hoja»): como mucho esta parte de la pantalla, abajo. */
    static final float PARTE_HOJA = 0.58f;

    /**
     * REGLA DEL DUEÑO (2026-10-12): fuera de la app, Javier y el widget NUNCA tapan el
     * teléfono con una página ni con algo oscuro. Se tiene que seguir viendo y usando lo
     * que había (WhatsApp, YouTube, el escritorio). Por eso la ventana nunca oscurece y
     * mide SOLO lo que Javier dibuja; los toques de afuera pasan a la app de atrás
     * (FLAG_NOT_TOUCH_MODAL):
     *  · «voz»: no se dibuja nada; la ventana no recibe toques (solo el cartel del dictado).
     *  · «oye»: el panel de abajo (ALTO_LLAMADO_DP).
     *  · «escribir» sobre el widget: exactamente el recuadro del widget.
     *  · «escribir» sin recuadro: la barrita de abajo (ALTO_BARRA_DP).
     *  · «hoja»: la mitad de abajo, como mucho (PARTE_HOJA).
     * Con el teclado, la ventana sube sola (ADJUST_PAN) en vez de achicarse.
     */
    private void aplicarModo() {
        Window ventana = getWindow();
        ventana.clearFlags(WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE | WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
            | WindowManager.LayoutParams.FLAG_DIM_BEHIND);
        ventana.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_PAN | WindowManager.LayoutParams.SOFT_INPUT_STATE_HIDDEN);
        float d = getResources().getDisplayMetrics().density;
        int anchoPantalla = getResources().getDisplayMetrics().widthPixels;
        int altoPantalla = getResources().getDisplayMetrics().heightPixels;
        WindowManager.LayoutParams lp = ventana.getAttributes();
        lp.x = 0;
        lp.y = 0;
        if ("voz".equals(modo)) {
            ventana.setAttributes(lp);
            ventana.setGravity(Gravity.FILL);
            ventana.setLayout(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT);
            ventana.addFlags(WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE | WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE);
            return;
        }
        ventana.addFlags(WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL);
        if (desdeBurbuja && anclaY >= 0) {
            // Desde la burbuja, en cualquier modo: una tarjeta chica a su lado (nunca a lo ancho).
            Rect r = recuadroBurbuja(modo);
            if ("escribir".equals(modo)) marco = r;
            ventana.addFlags(WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS);
            lp.x = r.left;
            lp.y = r.top;
            ventana.setAttributes(lp);
            ventana.setGravity(Gravity.TOP | Gravity.START);
            ventana.setLayout(r.width(), r.height());
            return;
        }
        if ("escribir".equals(modo) && marco != null) {
            int izq = Math.max(0, marco.left);
            int ancho = Math.min(marco.width(), anchoPantalla - izq);
            ventana.addFlags(WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS);
            lp.x = izq;
            lp.y = Math.max(0, marco.top);
            ventana.setAttributes(lp);
            ventana.setGravity(Gravity.TOP | Gravity.START);
            ventana.setLayout(ancho, marco.height());
            return;
        }
        ventana.clearFlags(WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS);
        int alto;
        if ("oye".equals(modo)) alto = Math.round(ALTO_LLAMADO_DP * d);
        else if ("escribir".equals(modo)) alto = Math.round(ALTO_BARRA_DP * d);
        else alto = Math.round(altoPantalla * PARTE_HOJA);
        ventana.setAttributes(lp);
        ventana.setGravity(Gravity.BOTTOM);
        ventana.setLayout(WindowManager.LayoutParams.MATCH_PARENT, alto);
    }

    /** La página cambió de modo (la barrita pasó a la conversación completa): la ventana se ajusta. */
    void cambiarModo(String nuevo) {
        if (!"voz".equals(nuevo) && !"escribir".equals(nuevo) && !"hoja".equals(nuevo) && !"oye".equals(nuevo)) return;
        modo = nuevo;
        aplicarModo();
    }

    /** Deja de tapar: los toques pasan a la pantalla de inicio mientras Javier contesta. */
    void soltar() {
        Window ventana = getWindow();
        ventana.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
        if ("oye".equals(modo)) return; // al llamarlo, el panel sigue tocable (Terminar, tocar el orbe)
        ventana.addFlags(WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE | WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE);
    }

    /** El dictado del propio teléfono (el de Google): solo su cartelito. */
    private void dictar() {
        JarvisWidget.avisar(this, "Escuchando…");
        Intent pedir = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        pedir.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        pedir.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "es-CR");
        pedir.putExtra(RecognizerIntent.EXTRA_PROMPT, "Hablale a Javier");
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
