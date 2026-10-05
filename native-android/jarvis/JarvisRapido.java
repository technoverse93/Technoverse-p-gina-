package com.technoverse.admin;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognizerIntent;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Ventanita del mini-widget de Jarvis, ENCIMA de la pantalla de inicio.
 *
 * Se escribe o se habla y la respuesta sale aquí mismo: no abre la app, no
 * pide huella ni contraseña (lo pidió el dueño; el teléfono es solo suyo).
 * Pregunta a la función «jarvis-widget» con la llave que guardó la app al
 * activar el widget (JarvisLlave, cifrada con el Keystore). Por esta puerta
 * solo se pregunta: las órdenes (cobrar, chats, bloquear) se hacen en la
 * app, con el botón «Abrir en la app».
 *
 * Voz:
 *  · Dictado: el reconocimiento de voz del propio teléfono (Google).
 *  · Respuesta hablada: el motor de voz de Android, por oraciones, con
 *    Pausar / Seguir / Callar y el botón del parlante para silenciarla.
 *
 * Como la app: sin capturas de pantalla (FLAG_SECURE), porque aquí se ven
 * datos del negocio.
 */
public class JarvisRapido extends Activity {
    static final String EXTRA_VOZ = "voz";
    private static final int PEDIR_VOZ = 7;
    private static final long CONVERSACION_MS = 30 * 60_000L;

    private final ExecutorService red = Executors.newSingleThreadExecutor();
    private final Handler ui = new Handler(Looper.getMainLooper());
    private SharedPreferences prefs;
    private String url, llave;

    private FrameLayout raiz;
    private LinearLayout tarjeta, lista, controles;
    private ScrollView scroll;
    private TextView estado, pausa;
    private EditText campo;
    private ImageButton enviar, microfono, vozAlta;
    private boolean ocupado = false, esperandoVoz = false;
    private int insetArriba = 0, insetAbajo = 0;

    // Respuesta hablada
    private TextToSpeech tts;
    private boolean ttsListo = false;
    private String pendienteDeLeer = null;
    private final ArrayList<String> frases = new ArrayList<>();
    private int indice = 0, generacion = 0;
    private boolean pausado = false;

    @Override
    protected void onCreate(Bundle guardado) {
        super.onCreate(guardado);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        setContentView(R.layout.jarvis_rapido);
        prefs = getSharedPreferences(JarvisWidget.PREFS, MODE_PRIVATE);

        raiz = findViewById(R.id.rapido_raiz);
        tarjeta = findViewById(R.id.rapido_tarjeta);
        lista = findViewById(R.id.rapido_lista);
        scroll = findViewById(R.id.rapido_scroll);
        estado = findViewById(R.id.rapido_estado);
        controles = findViewById(R.id.rapido_controles);
        pausa = findViewById(R.id.rapido_pausa);
        campo = findViewById(R.id.rapido_texto);
        enviar = findViewById(R.id.rapido_enviar);
        microfono = findViewById(R.id.rapido_microfono);
        vozAlta = findViewById(R.id.rapido_voz_alta);

        prepararVentana();

        // Una línea que crece hasta 4 y con la tecla «Enviar» en el teclado.
        campo.setRawInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES | InputType.TYPE_TEXT_FLAG_AUTO_CORRECT);
        campo.setImeOptions(EditorInfo.IME_ACTION_SEND);
        campo.setHorizontallyScrolling(false);
        campo.setMaxLines(4);
        campo.setOnEditorActionListener((v, accion, ev) -> {
            boolean enter = ev != null && ev.getKeyCode() == KeyEvent.KEYCODE_ENTER && ev.getAction() == KeyEvent.ACTION_DOWN;
            if (accion == EditorInfo.IME_ACTION_SEND || enter) { enviarTexto(); return true; }
            return false;
        });
        enviar.setOnClickListener(v -> enviarTexto());
        microfono.setOnClickListener(v -> escuchar());
        findViewById(R.id.rapido_cerrar).setOnClickListener(v -> finish());
        findViewById(R.id.rapido_abrir).setOnClickListener(v -> abrirApp());
        raiz.setOnClickListener(v -> finish());
        vozAlta.setOnClickListener(v -> alternarVozAlta());
        pausa.setOnClickListener(v -> { if (pausado) seguir(); else pausar(); });
        findViewById(R.id.rapido_callar).setOnClickListener(v -> callar());
        pintarVozAlta();

        String[] datos = JarvisLlave.leer(this);
        if (datos == null) { sinActivar(); return; }
        url = datos[0];
        llave = datos[1];

        tts = new TextToSpeech(this, s -> ui.post(() -> iniciarVoz(s)));

        // Lo último, si fue hace poco: se ve el hilo de la conversación.
        long hora = prefs.getLong("ultima_hora", 0);
        String p = prefs.getString("ultima_pregunta", null), r = prefs.getString("ultima_respuesta", null);
        if (p != null && r != null && System.currentTimeMillis() - hora < CONVERSACION_MS) {
            burbuja(true, p);
            burbuja(false, r);
        } else {
            burbuja(false, "Preguntame lo que quieras: ventas, inventario, taller, chats, finanzas…");
        }

        if (getIntent().getBooleanExtra(EXTRA_VOZ, false)) escuchar();
        else mostrarTeclado();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (url != null && intent.getBooleanExtra(EXTRA_VOZ, false)) escuchar();
    }

    @Override
    protected void onStop() {
        super.onStop();
        // Si la ventanita deja de verse, se calla (salvo mientras dictan).
        if (!esperandoVoz) callar();
    }

    @Override
    protected void onDestroy() {
        if (tts != null) { tts.stop(); tts.shutdown(); }
        red.shutdownNow();
        super.onDestroy();
    }

    // ------------------------------------------------------------------
    // Ventana: a pantalla completa, la tarjeta abajo y el teclado nunca
    // tapa la caja de escribir (también en Android 15, de borde a borde).
    // ------------------------------------------------------------------
    private void prepararVentana() {
        Window w = getWindow();
        w.setStatusBarColor(Color.TRANSPARENT);
        w.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 30) {
            w.setDecorFitsSystemWindows(false);
        } else {
            w.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
        w.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        raiz.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets ime = insets.getInsets(WindowInsets.Type.ime());
                android.graphics.Insets barras = insets.getInsets(WindowInsets.Type.systemBars());
                insetArriba = barras.top;
                insetAbajo = Math.max(ime.bottom, barras.bottom);
            } else {
                insetArriba = insets.getSystemWindowInsetTop();
                insetAbajo = insets.getSystemWindowInsetBottom();
            }
            acomodar();
            return insets;
        });
        raiz.addOnLayoutChangeListener((v, l, t, r, b, ol, ot, or, ob) -> { if (b - t != ob - ot) acomodar(); });
    }

    /** Alto de la tarjeta: hasta el 64 % de la pantalla, sin pasar por debajo del teclado. */
    private void acomodar() {
        int alto = raiz.getHeight();
        if (alto <= 0) { raiz.post(this::acomodar); return; }
        int pantalla = getResources().getDisplayMetrics().heightPixels;
        int disponible = alto - insetArriba - insetAbajo - dp(16);
        int deseado = Math.min((int) (pantalla * 0.64f), disponible);
        FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) tarjeta.getLayoutParams();
        int abajo = insetAbajo + dp(8);
        int nuevoAlto = Math.max(dp(220), deseado);
        if (lp.height != nuevoAlto || lp.bottomMargin != abajo) {
            lp.height = nuevoAlto;
            lp.bottomMargin = abajo;
            tarjeta.setLayoutParams(lp);
            bajarAlFinal();
        }
    }

    private int dp(int v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics());
    }

    // ------------------------------------------------------------------
    // Conversación
    // ------------------------------------------------------------------
    private void burbuja(boolean mia, String texto) {
        TextView t = new TextView(this);
        t.setText(texto);
        t.setTextColor(mia ? Color.parseColor("#031837") : Color.WHITE);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        t.setLineSpacing(0, 1.15f);
        t.setPadding(dp(13), dp(9), dp(13), dp(10));
        t.setBackgroundResource(mia ? R.drawable.jarvis_burbuja_yo : R.drawable.jarvis_burbuja_ia);
        t.setMaxWidth((int) (getResources().getDisplayMetrics().widthPixels * 0.78f));
        if (!mia) t.setTextIsSelectable(true);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(8);
        lp.gravity = mia ? Gravity.END : Gravity.START;
        lista.addView(t, lp);
        bajarAlFinal();
    }

    private void bajarAlFinal() {
        scroll.post(() -> scroll.fullScroll(View.FOCUS_DOWN));
    }

    private void ponerEstado(String texto) {
        if (texto == null) { estado.setVisibility(View.GONE); return; }
        estado.setText(texto);
        estado.setVisibility(View.VISIBLE);
    }

    private void sinActivar() {
        burbuja(false, "El mini-widget no está activado en este teléfono.\n\nAbrí Jarvis en la app → Ajustes → Mini-widget → «Activar en este teléfono». Con el botón de arriba (↗) abrís la app.");
        campo.setEnabled(false);
        enviar.setEnabled(false);
        microfono.setEnabled(false);
        enviar.setAlpha(0.4f);
        microfono.setAlpha(0.4f);
    }

    private void mostrarTeclado() {
        campo.requestFocus();
        ui.postDelayed(() -> {
            InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
            if (imm != null) imm.showSoftInput(campo, InputMethodManager.SHOW_IMPLICIT);
        }, 180);
    }

    private void abrirApp() {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("technoverse://jarvis"), this, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        startActivity(intent);
        finish();
    }

    private void enviarTexto() {
        String t = campo.getText().toString().trim();
        if (t.isEmpty() || ocupado || url == null) return;
        campo.setText("");
        preguntar(t, false);
    }

    private void preguntar(String texto, boolean porVoz) {
        callar();
        ocupado = true;
        burbuja(true, texto);
        ponerEstado("Pensando…");
        enviar.setEnabled(false);
        enviar.setAlpha(0.5f);
        final String conv = conversacionVigente();
        red.execute(() -> {
            final JSONObject r = llamar(texto, porVoz, conv);
            ui.post(() -> respuesta(texto, r));
        });
    }

    private String conversacionVigente() {
        long hora = prefs.getLong("conv_hora", 0);
        return System.currentTimeMillis() - hora < CONVERSACION_MS ? prefs.getString("conv_id", null) : null;
    }

    /** POST a jarvis-widget. Devuelve el JSON de la función, o uno de error. */
    private JSONObject llamar(String texto, boolean porVoz, String conv) {
        HttpURLConnection c = null;
        try {
            JSONObject cuerpo = new JSONObject();
            cuerpo.put("accion", "enviar");
            cuerpo.put("texto", texto);
            cuerpo.put("perfil", "rapido");
            if (conv != null) cuerpo.put("conversacionId", conv);
            if (porVoz) cuerpo.put("porVoz", 1);
            JSONObject yo = new JSONObject();
            yo.put("device", "widget");
            yo.put("modelo", (Build.MANUFACTURER + " " + Build.MODEL).trim());
            cuerpo.put("yo", yo);

            c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(15000);
            c.setReadTimeout(120000);
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            c.setRequestProperty("Accept", "application/json");
            c.setRequestProperty("x-jarvis-widget", llave);
            try (OutputStream os = c.getOutputStream()) { os.write(cuerpo.toString().getBytes(StandardCharsets.UTF_8)); }
            int codigo = c.getResponseCode();
            InputStream is = codigo >= 400 ? c.getErrorStream() : c.getInputStream();
            String cuerpoRespuesta = leerTodo(is);
            try { return new JSONObject(cuerpoRespuesta); }
            catch (Exception e) { return error("El servidor respondió algo inesperado (" + codigo + "). Probá de nuevo."); }
        } catch (Exception e) {
            return error("Sin conexión. Revisá internet y probá de nuevo.");
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static JSONObject error(String mensaje) {
        JSONObject j = new JSONObject();
        try { j.put("ok", false); j.put("error", mensaje); } catch (Exception ignorado) { /* nada */ }
        return j;
    }

    private static String leerTodo(InputStream is) throws Exception {
        if (is == null) return "";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] b = new byte[8192];
        int n;
        while ((n = is.read(b)) > 0) out.write(b, 0, n);
        is.close();
        return new String(out.toByteArray(), StandardCharsets.UTF_8);
    }

    private void respuesta(String pregunta, JSONObject r) {
        ocupado = false;
        ponerEstado(null);
        enviar.setEnabled(true);
        enviar.setAlpha(1f);
        if (isFinishing() || isDestroyed()) return;
        if (r.optBoolean("ok", false)) {
            JSONObject m = r.optJSONObject("mensaje");
            String texto = limpiar(m != null ? m.optString("texto", "") : "");
            if (texto.isEmpty()) texto = "No me llegó la respuesta. Probá de nuevo.";
            burbuja(false, texto);
            long ahora = System.currentTimeMillis();
            String conv = r.optString("conversacionId", null);
            SharedPreferences.Editor e = prefs.edit()
                .putString("ultima_pregunta", pregunta)
                .putString("ultima_respuesta", texto)
                .putLong("ultima_hora", ahora)
                .putLong("conv_hora", ahora);
            if (conv != null && !conv.isEmpty() && !"null".equals(conv)) e.putString("conv_id", conv);
            e.apply();
            JarvisWidget.actualizar(this);
            if (vozAltaActiva()) hablar(texto);
        } else {
            String error = r.optString("error", "No se pudo responder. Probá de nuevo.");
            burbuja(false, "⚠ " + error);
            if ("llave".equals(r.optString("codigo", ""))) {
                JarvisLlave.borrar(this);
                JarvisWidget.actualizar(this);
                sinActivar();
            }
        }
    }

    /** Quita el formato del chat (negritas, títulos, tablas) para leerlo limpio. */
    static String limpiar(String md) {
        String t = md.replaceAll("(?s)```.*?```", "(Hay un bloque de código: miralo en la app.)");
        StringBuilder sb = new StringBuilder();
        boolean tabla = false;
        for (String linea : t.split("\n")) {
            if (linea.trim().matches("^\\|.*\\|$")) { tabla = true; continue; }
            sb.append(linea.replaceAll("^\\s*#{1,6}\\s*", "").replaceAll("^\\s*[-*]\\s+", "• ")).append('\n');
        }
        t = sb.toString().replace("**", "").replace("__", "").replace("`", "").replaceAll("\n{3,}", "\n\n").trim();
        if (tabla) t += "\n\n(Hay una tabla: abrila en la app con ↗.)";
        return t;
    }

    // ------------------------------------------------------------------
    // Dictado por voz (reconocimiento del teléfono)
    // ------------------------------------------------------------------
    private void escuchar() {
        if (ocupado || url == null) return;
        callar();
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "es-CR");
        i.putExtra(RecognizerIntent.EXTRA_PROMPT, "Hablale a Jarvis");
        try {
            esperandoVoz = true;
            startActivityForResult(i, PEDIR_VOZ);
        } catch (ActivityNotFoundException e) {
            esperandoVoz = false;
            ponerEstado("Este teléfono no tiene dictado por voz. Escribilo.");
            mostrarTeclado();
        }
    }

    @Override
    protected void onActivityResult(int pedido, int resultado, Intent datos) {
        super.onActivityResult(pedido, resultado, datos);
        if (pedido != PEDIR_VOZ) return;
        esperandoVoz = false;
        ArrayList<String> r = datos != null ? datos.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS) : null;
        if (resultado == RESULT_OK && r != null && !r.isEmpty() && !r.get(0).trim().isEmpty()) {
            preguntar(r.get(0).trim(), true);
        } else {
            mostrarTeclado();
        }
    }

    // ------------------------------------------------------------------
    // Respuesta hablada (motor de voz de Android), por oraciones
    // ------------------------------------------------------------------
    private void iniciarVoz(int status) {
        if (tts == null || status != TextToSpeech.SUCCESS) return;
        Locale[] opciones = { new Locale("es", "CR"), new Locale("es", "MX"), new Locale("es", "US"), new Locale("es", "ES"), new Locale("es") };
        for (Locale l : opciones) {
            if (tts.isLanguageAvailable(l) >= TextToSpeech.LANG_AVAILABLE) { tts.setLanguage(l); break; }
        }
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override public void onStart(String id) { ui.post(() -> { int i = numero(id); if (i >= 0) indice = i; }); }
            @Override public void onDone(String id) { ui.post(() -> terminoFrase(id)); }
            @Override public void onError(String id) { ui.post(() -> terminoFrase(id)); }
        });
        ttsListo = true;
        if (pendienteDeLeer != null) { String t = pendienteDeLeer; pendienteDeLeer = null; hablar(t); }
    }

    /** «g3_5» → 5 si es de la lectura actual (generación 3); si no, -1. */
    private int numero(String id) {
        if (id == null || !id.startsWith("g" + generacion + "_")) return -1;
        try { return Integer.parseInt(id.substring(id.indexOf('_') + 1)); } catch (Exception e) { return -1; }
    }

    private void terminoFrase(String id) {
        int i = numero(id);
        if (i >= 0 && i >= frases.size() - 1 && !pausado) ocultarControles();
    }

    private void hablar(String texto) {
        if (!vozAltaActiva()) return;
        if (!ttsListo) { pendienteDeLeer = texto; return; }
        frases.clear();
        for (String f : paraHablar(texto).split("(?<=[.!?…:;])\\s+|\\n+")) {
            String x = f.trim();
            if (!x.isEmpty()) frases.add(x);
        }
        if (frases.isEmpty()) return;
        hablarDesde(0);
    }

    private void hablarDesde(int desde) {
        generacion++;
        pausado = false;
        indice = desde;
        for (int i = desde; i < frases.size(); i++) {
            tts.speak(frases.get(i), i == desde ? TextToSpeech.QUEUE_FLUSH : TextToSpeech.QUEUE_ADD, null, "g" + generacion + "_" + i);
        }
        pausa.setText("Pausar");
        controles.setVisibility(View.VISIBLE);
    }

    private void pausar() {
        if (tts == null || frases.isEmpty()) return;
        pausado = true;
        tts.stop();
        pausa.setText("Seguir");
    }

    private void seguir() {
        if (tts == null || frases.isEmpty()) return;
        hablarDesde(Math.min(indice, frases.size() - 1));
    }

    private void callar() {
        if (tts != null) tts.stop();
        frases.clear();
        pausado = false;
        ocultarControles();
    }

    private void ocultarControles() {
        if (controles != null) controles.setVisibility(View.GONE);
    }

    /** El texto como se dice: «₡25 000» → «25 000 colones», sin viñetas ni avisos entre paréntesis. */
    private static String paraHablar(String t) {
        return t.replaceAll("\\(Hay (una tabla|un bloque de código)[^)]*\\)", "")
            .replaceAll("₡\\s?([\\d.,\\s]*\\d)", "$1 colones")
            .replaceAll("https?://\\S+", "")
            .replace("•", "")
            .replace("⚠", "")
            .trim();
    }

    private boolean vozAltaActiva() {
        return prefs.getBoolean("voz_alta", true);
    }

    private void alternarVozAlta() {
        boolean nueva = !vozAltaActiva();
        prefs.edit().putBoolean("voz_alta", nueva).apply();
        if (!nueva) callar();
        pintarVozAlta();
        ponerEstado(nueva ? "Respuestas habladas: activadas." : "Respuestas habladas: silenciadas.");
        ui.postDelayed(() -> { if (!ocupado) ponerEstado(null); }, 1800);
    }

    private void pintarVozAlta() {
        boolean si = vozAltaActiva();
        vozAlta.setImageResource(si ? R.drawable.jarvis_ic_voz_si : R.drawable.jarvis_ic_voz_no);
        vozAlta.setContentDescription(si ? "Silenciar las respuestas habladas" : "Activar las respuestas habladas");
    }
}
