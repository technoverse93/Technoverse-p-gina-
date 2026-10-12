package com.technoverse.admin;

import java.util.Collections;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Qué pantallas de Phill se ven ahora (la app, la ventanita). Mientras alguna se ve, usa ella
 * el micrófono y «Oye Phill» se calla; al irse, vuelve a escuchar. Vive aparte del motor de voz a
 * propósito: las pantallas lo llaman en cada abrir y cerrar, y una falla del motor (Vosk) nunca
 * debe poder tocarlas. Todo está envuelto: aquí nada lanza.
 */
final class OyeVisibilidad {
    private OyeVisibilidad() {}

    private static final Set<Object> visibles = Collections.newSetFromMap(new ConcurrentHashMap<Object, Boolean>());
    /** Lo que el servicio pide que se avise cuando algo se ve o deja de verse (despierta su bucle). */
    static volatile Runnable alCambiar;
    /** Lo que el servicio pide que se avise cuando la ventanita abrió de verdad. */
    static volatile Runnable alConfirmarApertura;

    /** La pantalla `quien` se ve (o dejó de verse). */
    static void visible(Object quien, boolean si) {
        try {
            if (si) visibles.add(quien);
            else visibles.remove(quien);
            Runnable r = alCambiar;
            if (r != null) r.run();
        } catch (Throwable t) {
            /* esto nunca debe romper una pantalla */
        }
    }

    static boolean hayAlgoVisible() {
        return !visibles.isEmpty();
    }

    /** La ventanita ya abrió (la abrió «Oye Phill» o no): se quita el aviso de «tocá para hablar». */
    static void aperturaConfirmada() {
        try {
            Runnable r = alConfirmarApertura;
            if (r != null) r.run();
        } catch (Throwable t) {
            /* esto nunca debe romper una pantalla */
        }
    }
}
