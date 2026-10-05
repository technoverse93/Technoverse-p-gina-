package com.technoverse.admin;

import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.CapConfig;

import java.lang.reflect.Field;

/**
 * Ventanita del mini-widget de Jarvis, ENCIMA de la pantalla de inicio.
 *
 * Es el MISMO Jarvis de la app con la MISMA sesión (lo pidió el dueño:
 * «hacer todo como lo haría con mi sesión», sin huella; el teléfono es solo
 * suyo): un segundo puente de Capacitor que abre la página liviana
 * jarvis-rapido.html (src/rapido.tsx) en vez de la app entera. Comparte con
 * la app el almacenamiento (la sesión) y la versión OTA instalada, así que
 * cobra, responde chats, mueve el taller y ajusta inventario por los mismos
 * caminos que la app.
 *
 * La página decide si puede abrir: el widget activado en este teléfono (la
 * marca que pone JarvisWidgetPlugin.activar desde la app), la sesión del
 * superadmin y sin bloqueo de aparato. El candado de huella de la app no se
 * toca: la app sigue pidiéndola como siempre.
 *
 * Fondo transparente con la pantalla de inicio oscurecida detrás. Atrás, la
 * X o tocar fuera de la hoja la cierran. Sin capturas de pantalla
 * (FLAG_SECURE), como la app.
 */
public class JarvisRapido extends BridgeActivity {
    static final String EXTRA_VOZ = "voz";
    static final String PAGINA = "/jarvis-rapido.html";

    private boolean conPagina = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Antes de super.onCreate(): ahí el puente arma su lista de plugins y
        // lee la configuración (con la página de inicio de la ventanita).
        registerPlugin(JarvisWidgetPlugin.class);
        config = configConPagina();
        super.onCreate(savedInstanceState);

        Window ventana = getWindow();
        ventana.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
        ventana.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
        ventana.setDimAmount(0.5f);
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
