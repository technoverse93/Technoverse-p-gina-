package com.technoverse.admin;

import android.content.Context;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.InterruptedIOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Collection;
import java.util.Enumeration;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/**
 * El «oído» de Javier: el modelo de voz en español de Vosk (~40 MB) que corre en
 * el teléfono, sin internet, para reconocer «Oye Javier». No viene dentro de la
 * APK (la haría el doble de pesada): se baja una sola vez desde Ajustes, con
 * porcentaje, y queda guardado en el teléfono. Si se corta la conexión, sigue
 * donde iba.
 *
 * No depende de Android más que para saber dónde guardar (raiz): lo demás se
 * prueba solo.
 */
final class OyeModelo {
    private OyeModelo() {}

    /** Modelo liviano de Vosk para español (Apache 2.0). */
    static final String URL_MODELO = "https://alphacephei.com/vosk/models/vosk-model-small-es-0.42.zip";
    static final long TAMANO_APROX = 39_000_000L;
    /** Un zip más chico que esto quedó incompleto o no es el modelo. */
    static final long TAMANO_MIN = 25_000_000L;
    static final long ESPACIO_LIBRE_MIN = 160_000_000L;
    private static final long TOPE_DESCOMPRIMIDO = 600_000_000L;

    interface Progreso {
        /** fase: «bajando», «descomprimiendo»; fraccion: 0..1. */
        void alAvanzar(String fase, double fraccion);
    }

    static File raiz(Context ctx) {
        // Sin copia de seguridad en la nube: son ~50 MB que se pueden volver a bajar.
        return new File(ctx.getNoBackupFilesDir(), "oye");
    }

    static File carpeta(File raiz) {
        return new File(raiz, "modelo");
    }

    static boolean listo(File raiz) {
        File m = carpeta(raiz);
        return new File(m, "am/final.mdl").isFile() && new File(m, "conf/model.conf").isFile();
    }

    /** Cuántos MB ocupa el oído guardado (0 si no está). */
    static long megas(File raiz) {
        return listo(raiz) ? Math.max(1, pesoDe(carpeta(raiz)) / 1_000_000L) : 0;
    }

    private static long pesoDe(File f) {
        if (f.isFile()) return f.length();
        File[] hijos = f.listFiles();
        long t = 0;
        if (hijos != null) for (File h : hijos) t += pesoDe(h);
        return t;
    }

    static void borrar(File raiz) {
        borrarArbol(carpeta(raiz));
        borrarArbol(new File(raiz, "modelo-tmp"));
        new File(raiz, "modelo.zip.part").delete();
    }

    static void borrarArbol(File f) {
        if (f == null || !f.exists()) return;
        File[] hijos = f.listFiles();
        if (hijos != null) for (File h : hijos) borrarArbol(h);
        f.delete();
    }

    // ------------------------------ bajar ------------------------------

    /**
     * Baja y deja listo el oído. Lanza IOException con un texto para la persona
     * si no se pudo (sin espacio, sin conexión, archivo dañado); InterruptedIOException
     * si la persona canceló.
     */
    static void bajar(File raiz, String url, long minimo, Progreso p, AtomicBoolean cancelar) throws IOException {
        if (!raiz.isDirectory() && !raiz.mkdirs()) throw new IOException("No pude preparar la carpeta del oído.");
        if (raiz.getUsableSpace() < ESPACIO_LIBRE_MIN) throw new IOException("Falta espacio en el teléfono: hacen falta unos 160 MB libres.");
        File zip = new File(raiz, "modelo.zip.part");
        IOException ultimo = null;
        for (int intento = 1; intento <= 3; intento++) {
            try {
                descargar(zip, url, p, cancelar);
                ultimo = null;
                break;
            } catch (InterruptedIOException e) {
                throw e;
            } catch (IOException e) {
                ultimo = e;
                if (intento < 3) {
                    try { Thread.sleep(1500L * intento); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); throw new InterruptedIOException("cancelado"); }
                }
            }
        }
        if (ultimo != null) throw new IOException("No se pudo bajar (" + (ultimo.getMessage() != null ? ultimo.getMessage() : "sin conexión") + "). Revisá la conexión y probá de nuevo.");
        if (zip.length() < minimo) {
            zip.delete();
            throw new IOException("La descarga quedó incompleta. Probá de nuevo.");
        }
        descomprimir(zip, raiz, p, cancelar);
        zip.delete();
    }

    private static void descargar(File destino, String urlTexto, Progreso p, AtomicBoolean cancelar) throws IOException {
        long ya = destino.isFile() ? destino.length() : 0;
        HttpURLConnection c = (HttpURLConnection) new URL(urlTexto).openConnection();
        try {
            c.setConnectTimeout(20_000);
            c.setReadTimeout(30_000);
            c.setInstanceFollowRedirects(true);
            c.setRequestProperty("User-Agent", "Technoverse-Javier");
            if (ya > 0) c.setRequestProperty("Range", "bytes=" + ya + "-");
            int codigo = c.getResponseCode();
            if (codigo == 416) {
                // Lo que había no sirve para seguir: se vuelve a empezar de cero.
                destino.delete();
                throw new IOException("reiniciando la descarga");
            }
            if (codigo != 200 && codigo != 206) throw new IOException("el servidor respondió " + codigo);
            boolean sigue = codigo == 206 && ya > 0;
            long largo = 0;
            try { largo = Long.parseLong(String.valueOf(c.getHeaderField("Content-Length"))); } catch (NumberFormatException e) { /* sin largo: se estima */ }
            long total = largo > 0 ? (sigue ? ya : 0) + largo : TAMANO_APROX;
            long hecho = sigue ? ya : 0;
            byte[] buf = new byte[64 * 1024];
            long ultimoAviso = 0;
            try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(destino, sigue)) {
                int n;
                while ((n = in.read(buf)) > 0) {
                    if (cancelar != null && cancelar.get()) throw new InterruptedIOException("cancelado");
                    out.write(buf, 0, n);
                    hecho += n;
                    if (p != null && hecho - ultimoAviso > 256 * 1024) {
                        ultimoAviso = hecho;
                        p.alAvanzar("bajando", Math.min(1.0, hecho / (double) Math.max(1, total)));
                    }
                }
            }
            if (largo > 0 && hecho < total) throw new IOException("se cortó la conexión");
            if (p != null) p.alAvanzar("bajando", 1.0);
        } finally {
            c.disconnect();
        }
    }

    // ------------------------------ descomprimir ------------------------------

    private static String prefijoComun(ZipFile z) {
        String prefijo = null;
        Enumeration<? extends ZipEntry> es = z.entries();
        while (es.hasMoreElements()) {
            String n = es.nextElement().getName();
            int i = n.indexOf('/');
            if (i <= 0) return "";
            String primero = n.substring(0, i + 1);
            if (prefijo == null) prefijo = primero;
            else if (!prefijo.equals(primero)) return "";
        }
        return prefijo == null ? "" : prefijo;
    }

    private static void descomprimir(File zip, File raiz, Progreso p, AtomicBoolean cancelar) throws IOException {
        File tmp = new File(raiz, "modelo-tmp");
        borrarArbol(tmp);
        if (!tmp.mkdirs()) throw new IOException("No pude preparar la carpeta del oído.");
        String base = tmp.getCanonicalPath() + File.separator;
        try (ZipFile z = new ZipFile(zip)) {
            String prefijo = prefijoComun(z);
            long total = 0;
            Enumeration<? extends ZipEntry> es = z.entries();
            while (es.hasMoreElements()) total += Math.max(0, es.nextElement().getSize());
            if (total > TOPE_DESCOMPRIMIDO) throw new IOException("El archivo del oído es más grande de lo esperado.");
            long hecho = 0;
            byte[] buf = new byte[64 * 1024];
            es = z.entries();
            while (es.hasMoreElements()) {
                if (cancelar != null && cancelar.get()) throw new InterruptedIOException("cancelado");
                ZipEntry e = es.nextElement();
                String nombre = e.getName();
                if (!prefijo.isEmpty() && nombre.startsWith(prefijo)) nombre = nombre.substring(prefijo.length());
                if (nombre.isEmpty()) continue;
                File dest = new File(tmp, nombre);
                if (!dest.getCanonicalPath().startsWith(base)) throw new IOException("El archivo del oído trae una ruta insegura.");
                if (e.isDirectory()) {
                    dest.mkdirs();
                    continue;
                }
                File padre = dest.getParentFile();
                if (padre != null && !padre.isDirectory() && !padre.mkdirs()) throw new IOException("No pude guardar el oído.");
                try (InputStream in = z.getInputStream(e); OutputStream out = new FileOutputStream(dest)) {
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        hecho += n;
                        if (hecho > TOPE_DESCOMPRIMIDO) throw new IOException("El archivo del oído es más grande de lo esperado.");
                    }
                }
                if (p != null) p.alAvanzar("descomprimiendo", Math.min(1.0, hecho / (double) Math.max(1, total)));
            }
        }
        if (!new File(tmp, "am/final.mdl").isFile() || !new File(tmp, "conf/model.conf").isFile()) {
            borrarArbol(tmp);
            throw new IOException("El oído bajado no es el modelo de voz esperado.");
        }
        File fin = carpeta(raiz);
        borrarArbol(fin);
        if (!tmp.renameTo(fin)) throw new IOException("No pude guardar el oído.");
        if (p != null) p.alAvanzar("descomprimiendo", 1.0);
    }

    // ------------------------------ vocabulario ------------------------------

    /**
     * De las palabras pedidas, las que el oído conoce (están en graph/words.txt).
     * Devuelve null si el modelo no trae esa lista (no se puede saber).
     */
    static Set<String> conocidas(File raiz, Collection<String> candidatas) {
        File lista = new File(carpeta(raiz), "graph/words.txt");
        if (!lista.isFile()) return null;
        Set<String> quiero = new HashSet<>();
        for (String c : candidatas) if (c != null) quiero.add(c.toLowerCase(java.util.Locale.ROOT));
        Set<String> halladas = new HashSet<>();
        try (BufferedReader r = new BufferedReader(new InputStreamReader(new java.io.FileInputStream(lista), "UTF-8"))) {
            String linea;
            while ((linea = r.readLine()) != null && halladas.size() < quiero.size()) {
                int esp = linea.indexOf(' ');
                String palabra = esp > 0 ? linea.substring(0, esp) : linea;
                if (quiero.contains(palabra)) halladas.add(palabra);
            }
        } catch (IOException e) {
            return null;
        }
        return halladas;
    }
}
