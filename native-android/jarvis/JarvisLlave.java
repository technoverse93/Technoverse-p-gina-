package com.technoverse.admin;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * La llave del mini-widget, guardada CIFRADA en el teléfono.
 *
 * La llave (ver supabase/functions/asistente-ia/llaves.ts) deja preguntarle
 * a Jarvis sin huella. Se cifra con AES-GCM usando una clave del Keystore
 * de Android, que nunca sale del chip de seguridad del teléfono: aunque
 * alguien copiara los archivos de la app, sin ese chip no la puede leer.
 * Si se restaura una copia en otro teléfono, simplemente deja de servir y
 * hay que activar el widget de nuevo.
 */
final class JarvisLlave {
    private static final String PREFS = "jarvis_widget_llave";
    private static final String ALIAS = "jarvis_widget";

    private JarvisLlave() {}

    static void guardar(Context ctx, String url, String llave) throws Exception {
        Cipher cifrador = Cipher.getInstance("AES/GCM/NoPadding");
        cifrador.init(Cipher.ENCRYPT_MODE, clave());
        byte[] dato = cifrador.doFinal(llave.getBytes(StandardCharsets.UTF_8));
        prefs(ctx).edit()
            .putString("url", url)
            .putString("iv", Base64.encodeToString(cifrador.getIV(), Base64.NO_WRAP))
            .putString("dato", Base64.encodeToString(dato, Base64.NO_WRAP))
            .apply();
    }

    /** {url, llave} o null si no está activado (o no se puede descifrar). */
    static String[] leer(Context ctx) {
        SharedPreferences p = prefs(ctx);
        String url = p.getString("url", null), iv = p.getString("iv", null), dato = p.getString("dato", null);
        if (url == null || iv == null || dato == null) return null;
        try {
            Cipher cifrador = Cipher.getInstance("AES/GCM/NoPadding");
            cifrador.init(Cipher.DECRYPT_MODE, clave(), new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
            String llave = new String(cifrador.doFinal(Base64.decode(dato, Base64.NO_WRAP)), StandardCharsets.UTF_8);
            return new String[] { url, llave };
        } catch (Exception e) {
            return null;
        }
    }

    static void borrar(Context ctx) {
        prefs(ctx).edit().clear().apply();
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static SecretKey clave() throws Exception {
        KeyStore almacen = KeyStore.getInstance("AndroidKeyStore");
        almacen.load(null);
        if (almacen.containsAlias(ALIAS)) return (SecretKey) almacen.getKey(ALIAS, null);
        KeyGenerator generador = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generador.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build());
        return generador.generateKey();
    }
}
