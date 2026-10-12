package com.technoverse.admin;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

/**
 * Phill como ASISTENTE DEL TELÉFONO: lo que se abre al mantener el botón de
 * inicio (o el de encendido, en los teléfonos que lo usan para el asistente),
 * como Google o Siri. Hay que elegirlo una vez en Android: Ajustes → Apps →
 * Apps predeterminadas → App de asistente digital → Technoverse.
 *
 * Es solo un trampolín sin pantalla: abre la ventanita de Phill en modo
 * «oye» (el panel chico de abajo, escuchando de una) y se va. No lee nada
 * del pedido que la abrió: solo la abre el sistema (acción ASSIST), y lo que
 * Phill puede hacer lo decide la ventanita (sesión del dueño, sin bloqueo).
 */
public class PhillAsistente extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            startActivity(new Intent(this, JarvisRapido.class)
                .putExtra(JarvisRapido.EXTRA_MODO, "oye")
                .putExtra(JarvisRapido.EXTRA_ASISTENTE, true)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP));
        } catch (Throwable t) {
            /* sin ventanita: no se abre nada */
        }
        finish();
        overridePendingTransition(0, 0);
    }
}
