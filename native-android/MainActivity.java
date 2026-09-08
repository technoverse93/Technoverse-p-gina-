package com.technoverse.admin;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/**
 * PantallaNativaPlugin no es un paquete npm de Capacitor instalado, así
 * que no se auto-registra vía capacitor.plugins.json como los demás
 * (privacy-screen, device, etc.) — hay que registrarlo a mano, y ANTES de
 * super.onCreate(), que es cuando el puente arma la lista definitiva de
 * plugins.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PantallaNativaPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
