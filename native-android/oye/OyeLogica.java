package com.technoverse.admin;

import java.text.Normalizer;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Lo de «Oye Phill» que NO depende de Android (por eso se prueba solo):
 * limpiar las frases de activación, armar la gramática del reconocedor,
 * leer lo que contesta, decidir si lo que se oyó es el llamado y la
 * «puerta de voz» que solo deja pasar al reconocedor los trozos donde alguien
 * habla (así no gasta batería escuchando el silencio).
 *
 * El reconocedor (Vosk) corre en el teléfono, sin internet: lo que se oye
 * mientras esperás el llamado nunca sale del aparato.
 */
final class OyeLogica {
    private OyeLogica() {}

    /** Qué tan exigente es el llamado. */
    static final int SENS_ESTRICTA = 0;
    static final int SENS_NORMAL = 1;
    static final int SENS_SENSIBLE = 2;

    /**
     * Cómo suele «oír» el reconocedor en español a «Oye Phill» (suena «fil»). La
     * persona puede enseñarle otras con «Probar». Las palabras que el oído no
     * conoce se descartan al arrancar (ver OyeModelo.vocabulario).
     */
    static final String[] FRASES_INICIALES = { "oye fil", "oye fin" };
    static final int MAX_FRASES = 8;

    // ------------------------------ texto ------------------------------

    /** Minúsculas, sin tildes ni símbolos: «Oye, Phill» → «oye phill». */
    static String norm(String s) {
        if (s == null) return "";
        String t = Normalizer.normalize(s, Normalizer.Form.NFD).replaceAll("\\p{M}+", "");
        return t.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9 ]", " ").replaceAll("\\s+", " ").trim();
    }

    /** Una frase lista para la gramática: minúsculas (con sus tildes), solo letras, números y espacios. */
    static String limpiar(String s) {
        if (s == null) return "";
        return s.toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N} ]", " ").replaceAll("\\s+", " ").trim();
    }

    /** De 2 a 4 palabras (una sola palabra se dispararía con cualquier charla), sin repetir y hasta MAX_FRASES. */
    static List<String> frasesValidas(List<String> crudas) {
        LinkedHashSet<String> vistas = new LinkedHashSet<>();
        List<String> salida = new ArrayList<>();
        if (crudas == null) return salida;
        for (String cruda : crudas) {
            String f = limpiar(cruda);
            String[] p = f.isEmpty() ? new String[0] : f.split(" ");
            if (p.length < 2 || p.length > 4) continue;
            boolean corta = false;
            for (String w : p) if (w.length() < 2 || w.equals("unk")) corta = true;
            if (corta) continue;
            if (vistas.add(norm(f)) && salida.size() < MAX_FRASES) salida.add(f);
        }
        return salida;
    }

    /** Las palabras de todas las frases (para revisar cuáles conoce el oído). */
    static List<String> palabrasDe(List<String> frases) {
        LinkedHashSet<String> w = new LinkedHashSet<>();
        for (String f : frases) for (String p : limpiar(f).split(" ")) if (!p.isEmpty()) w.add(p);
        return new ArrayList<>(w);
    }

    /** La lista de frases que entiende Vosk: las del llamado y «[unk]» para todo lo demás que se hable. */
    static String gramatica(List<String> frases) {
        StringBuilder b = new StringBuilder("[");
        for (String f : frases) b.append('"').append(f.replace("\\", " ").replace("\"", " ")).append("\",");
        return b.append("\"[unk]\"]").toString();
    }

    // ---------------------------- lo que contesta Vosk ----------------------------

    /** El texto de un campo de la respuesta de Vosk («text», «partial»), o «». */
    static String campo(String json, String clave) {
        if (json == null) return "";
        Matcher m = Pattern.compile("\"" + Pattern.quote(clave) + "\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"").matcher(json);
        if (!m.find()) return "";
        return desescapar(m.group(1)).trim();
    }

    private static String desescapar(String s) {
        if (s.indexOf('\\') < 0) return s;
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c != '\\' || i + 1 >= s.length()) { b.append(c); continue; }
            char n = s.charAt(++i);
            if (n == 'u' && i + 4 < s.length()) {
                try { b.append((char) Integer.parseInt(s.substring(i + 1, i + 5), 16)); i += 4; continue; } catch (NumberFormatException e) { /* sigue como texto */ }
            }
            if (n == 'n' || n == 't' || n == 'r') b.append(' ');
            else b.append(n);
        }
        return b.toString();
    }

    // ------------------------------ ¿es el llamado? ------------------------------

    static final class Decision {
        final boolean despierta;
        final String frase;
        final String motivo;

        Decision(boolean despierta, String frase, String motivo) {
            this.despierta = despierta;
            this.frase = frase;
            this.motivo = motivo;
        }
    }

    /** Más palabras de las que caben en un llamado se toman como charla normal. */
    static int maxExtras(int sens) {
        return sens <= SENS_ESTRICTA ? 0 : sens == SENS_NORMAL ? 1 : 5;
    }

    static long maxDuracionMs(int sens) {
        return sens <= SENS_ESTRICTA ? 1800 : sens == SENS_NORMAL ? 2400 : 5000;
    }

    static final long MIN_DURACION_MS = 250;

    /**
     * ¿Lo que se oyó es el llamado? La frase tiene que estar AL PRINCIPIO (se
     * tolera una palabra desconocida antes), con pocas palabras de más y en un
     * trozo corto: una charla larga que apenas la contiene no cuenta.
     */
    static Decision evaluar(String texto, List<String> frases, int sens, long duracionMs) {
        List<String> t = tokens(texto);
        if (t.isEmpty()) return new Decision(false, null, "vacío");
        if (duracionMs < MIN_DURACION_MS) return new Decision(false, null, "muy corto");
        int antes = (t.get(0).equals("unk") && sens >= SENS_NORMAL) ? 1 : 0;
        for (String f : frases) {
            List<String> p = tokens(f);
            if (p.isEmpty() || antes + p.size() > t.size()) continue;
            boolean igual = true;
            for (int i = 0; i < p.size(); i++) if (!t.get(antes + i).equals(p.get(i))) { igual = false; break; }
            if (!igual) continue;
            int extras = t.size() - antes - p.size();
            if (extras > maxExtras(sens)) return new Decision(false, f, "con palabras de más");
            if (duracionMs > maxDuracionMs(sens)) return new Decision(false, f, "demasiado largo");
            return new Decision(true, f, "ok");
        }
        return new Decision(false, null, "no es el llamado");
    }

    private static List<String> tokens(String s) {
        String n = norm(s);
        List<String> l = new ArrayList<>();
        if (n.isEmpty()) return l;
        for (String p : n.split(" ")) if (!p.isEmpty()) l.add(p);
        return l;
    }

    // ------------------------------ cuándo escuchar ------------------------------

    /** Tres frases seguidas casi de tope (música, un video, una charla larga) y el oído descansa un rato en vez de gastar batería. */
    static final long FRASE_LARGA_MS = 4500;
    static final int LARGAS_PARA_DESCANSAR = 3;
    static final long DESCANSO_MS = 20_000;

    /** Cuántas frases largas van seguidas después de esta (0 si fue corta). */
    static int largasSeguidas(int antes, long duracionMs) {
        return duracionMs >= FRASE_LARGA_MS ? antes + 1 : 0;
    }

    /**
     * null = hay que escuchar; si no, el motivo de la pausa. El orden importa: lo que
     * pediste (pausa) manda; con la pantalla apagada no se escucha nada; en la prueba
     * (con la app abierta) no cuenta que la app se vea ni el bloqueo, pero sí una llamada.
     */
    static String motivoPausa(long ahora, long pausaHasta, long descansoHasta, boolean pantallaEncendida, boolean probando, boolean appVisible,
                              long esperaApertura, boolean bloqueado, boolean enLlamada) {
        if (pausaHasta > ahora) return "pausa";
        if (!pantallaEncendida) return "pantalla";
        if (descansoHasta > ahora && !probando) return "ruido";
        if (!probando) {
            if (appVisible) return "app";
            if (ahora < esperaApertura) return "despertando";
            if (bloqueado) return "bloqueado";
        }
        if (enLlamada) return "llamada";
        return null;
    }

    // ------------------------------ la puerta de voz ------------------------------

    /**
     * Decide trozo a trozo (100 ms) si alguien está hablando, midiendo la
     * energía contra el ruido de fondo, que se va aprendiendo solo. Empieza
     * a hablar tras 2 trozos fuertes seguidos y termina tras ~0,6 s de silencio.
     */
    static final class PuertaVoz {
        static final int EMPIEZA_TRAS = 2;
        static final int TERMINA_TRAS = 6;
        static final double UMBRAL_MIN = 320;
        static final double FACTOR = 2.8;

        enum Evento { NADA, EMPIEZA, SIGUE, TERMINA }

        private double piso = 140;
        private int fuertes = 0;
        private int flojos = 0;
        private boolean hablando = false;
        private double ultimo = 0;

        double umbral() {
            return Math.max(UMBRAL_MIN, piso * FACTOR);
        }

        double ultimoRms() {
            return ultimo;
        }

        boolean hablando() {
            return hablando;
        }

        void reiniciar() {
            hablando = false;
            fuertes = 0;
            flojos = 0;
        }

        static double rms(short[] b, int n) {
            if (n <= 0) return 0;
            double s = 0;
            for (int i = 0; i < n; i++) s += (double) b[i] * b[i];
            return Math.sqrt(s / n);
        }

        Evento alimentar(short[] b, int n) {
            double r = rms(b, n);
            ultimo = r;
            boolean fuerte = r > umbral();
            if (!hablando) {
                // Mientras no se habla, el ruido de fondo se aprende despacio (nunca sube por una voz).
                if (!fuerte) piso = Math.min(2000, Math.max(60, piso + (r - piso) * 0.03));
                fuertes = fuerte ? fuertes + 1 : 0;
                if (fuertes >= EMPIEZA_TRAS) {
                    hablando = true;
                    flojos = 0;
                    return Evento.EMPIEZA;
                }
                return Evento.NADA;
            }
            flojos = r < umbral() * 0.75 ? flojos + 1 : 0;
            if (flojos >= TERMINA_TRAS) {
                hablando = false;
                fuertes = 0;
                flojos = 0;
                return Evento.TERMINA;
            }
            return Evento.SIGUE;
        }
    }

    // ------------------------------ la tubería: de la puerta al reconocedor ------------------------------

    /** Lo que necesita de Vosk (así se prueba con uno de mentira). */
    interface Reconocedor {
        /** Le da audio; true si el reconocedor cree que ya terminó una frase. */
        boolean aceptar(short[] b, int n);

        /** El resultado de la frase que terminó (cuando aceptar() dio true). */
        String resultado();

        /** Fuerza el final de lo que lleva y lo devuelve. */
        String resultadoFinal();

        String parcial();
    }

    interface Salida {
        /** Una frase terminada: lo que se entendió y cuánto duró (ms). */
        void alResultado(String texto, long duracionMs);

        /** Lo que va entendiendo mientras hablás (solo en la prueba). */
        void alParcial(String texto);
    }

    /**
     * Junta todo: mide cada trozo con la puerta de voz y solo mientras alguien habla se lo
     * pasa al reconocedor (con 0,3 s de audio de antes, para no perder el comienzo). Al
     * terminar la frase, entrega el texto. Una frase no pasa de `maxSegmentoMs`.
     */
    static final class Tuberia {
        private static final int PREVIO = 3;
        private final Reconocedor rec;
        private final Salida salida;
        private final boolean conParciales;
        private final long maxSegmentoMs;
        private final PuertaVoz puerta = new PuertaVoz();
        private final ArrayDeque<short[]> previo = new ArrayDeque<>();
        private boolean enSegmento = false;
        private long inicioSegmentoMs = 0;
        private String ultimoParcial = "";

        Tuberia(Reconocedor rec, Salida salida, boolean conParciales, long maxSegmentoMs) {
            this.rec = rec;
            this.salida = salida;
            this.conParciales = conParciales;
            this.maxSegmentoMs = maxSegmentoMs;
        }

        PuertaVoz puerta() {
            return puerta;
        }

        boolean enSegmento() {
            return enSegmento;
        }

        /** Descarta lo que lleve (se pausó la escucha o se cambió de reconocedor). */
        void reiniciar() {
            enSegmento = false;
            previo.clear();
            puerta.reiniciar();
            ultimoParcial = "";
        }

        /** Un trozo de audio (`ahoraMs`: un reloj que no vuelve atrás). */
        void alimentar(short[] buf, int n, long ahoraMs) {
            PuertaVoz.Evento ev = puerta.alimentar(buf, n);
            short[] copia = Arrays.copyOf(buf, n);
            if (!enSegmento) {
                previo.addLast(copia);
                while (previo.size() > PREVIO) previo.removeFirst();
                if (ev == PuertaVoz.Evento.EMPIEZA) {
                    enSegmento = true;
                    inicioSegmentoMs = ahoraMs;
                    ultimoParcial = "";
                    for (short[] p : previo) rec.aceptar(p, p.length);
                    previo.clear();
                }
                return;
            }
            boolean terminoSolo = rec.aceptar(copia, n);
            long duracion = ahoraMs - inicioSegmentoMs;
            String json;
            if (terminoSolo) {
                json = rec.resultado();
            } else if (ev == PuertaVoz.Evento.TERMINA || duracion >= maxSegmentoMs) {
                json = rec.resultadoFinal();
            } else {
                if (conParciales) {
                    String parcial = campo(rec.parcial(), "partial");
                    if (!parcial.isEmpty() && !parcial.equals(ultimoParcial)) {
                        ultimoParcial = parcial;
                        salida.alParcial(parcial);
                    }
                }
                return;
            }
            reiniciar();
            salida.alResultado(campo(json, "text"), duracion);
        }
    }
}
