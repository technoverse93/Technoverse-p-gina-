package com.technoverse.admin;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

/**
 * PantallaNativaPlugin y JarvisWidgetPlugin no son paquetes npm de Capacitor
 * instalados, así
 * que no se auto-registra vía capacitor.plugins.json como los demás
 * (privacy-screen, device, etc.) — hay que registrarlo a mano, y ANTES de
 * super.onCreate(), que es cuando el puente arma la lista definitiva de
 * plugins.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PantallaNativaPlugin.class);
        // Puente del mini-widget de Jarvis (native-android/jarvis/).
        registerPlugin(JarvisWidgetPlugin.class);
        super.onCreate(savedInstanceState);

        // Tamaño de letra FIJO dentro de la app. Android aplica el «Tamaño de
        // fuente» del sistema encima del diseño (textZoom), y con la letra
        // agrandada en el teléfono los textos se salían de botones y
        // tarjetas. El diseño ya tiene un piso de 12 px para que todo se lea.
        WebView vista = getBridge() != null ? getBridge().getWebView() : null;
        if (vista != null) vista.getSettings().setTextZoom(100);
    }
}
