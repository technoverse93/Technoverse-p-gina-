package com.technoverse.admin;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Lo que «Oye Phill» recuerda en este teléfono (si está prendido, sus frases y qué tan
 * exigente es). Vive aparte del motor de voz a propósito: las pantallas de la app (y el
 * widget) lo consultan, y una falla del motor (Vosk) nunca debe llegar hasta ellas.
 */
final class OyePrefs {
    private OyePrefs() {}

    static final String PREFS = "oye_phill";
    static final String K_ACTIVO = "activo";
    static final String K_FRASES = "frases";
    static final String K_SENS = "sens";

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean activo(Context c) {
        return prefs(c).getBoolean(K_ACTIVO, false);
    }

    static void fijarActivo(Context c, boolean si) {
        prefs(c).edit().putBoolean(K_ACTIVO, si).apply();
    }

    static int sensibilidad(Context c) {
        return Math.max(0, Math.min(2, prefs(c).getInt(K_SENS, OyeLogica.SENS_NORMAL)));
    }

    static void fijarSensibilidad(Context c, int s) {
        prefs(c).edit().putInt(K_SENS, Math.max(0, Math.min(2, s))).apply();
    }

    static List<String> frases(Context c) {
        String guardadas = prefs(c).getString(K_FRASES, null);
        List<String> crudas = new ArrayList<>();
        if (guardadas != null) {
            for (String f : guardadas.split("\n")) crudas.add(f);
        } else {
            crudas.addAll(Arrays.asList(OyeLogica.FRASES_INICIALES));
        }
        return OyeLogica.frasesValidas(crudas);
    }

    static void guardarFrases(Context c, List<String> frases) {
        StringBuilder b = new StringBuilder();
        for (String f : OyeLogica.frasesValidas(frases)) b.append(b.length() > 0 ? "\n" : "").append(f);
        prefs(c).edit().putString(K_FRASES, b.toString()).apply();
    }
}
