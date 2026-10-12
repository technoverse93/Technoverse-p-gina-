package com.technoverse.admin;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;

/**
 * El dictado del propio teléfono (el reconocedor de voz de Android) con el texto
 * APARECIENDO MIENTRAS HABLÁS. Es opcional (Ajustes → Voz → «Dictado del
 * teléfono»): sin esto, el micrófono de Javier graba el audio y el servidor lo
 * pasa a texto cuando terminás de hablar. Ninguno de los dos corre en manos
 * libres (ahí sigue la grabación de siempre, que permite interrumpir a Javier).
 *
 * No es un paquete npm: MainActivity lo registra a mano. Todas las llamadas
 * responden { ok: true } o { ok: false, error, codigo }; lo que se va
 * entendiendo llega como eventos: listo, habla, parcial, final, nivel, error, fin.
 */
@CapacitorPlugin(
    name = "DictadoNativo",
    permissions = { @Permission(alias = "mic", strings = { Manifest.permission.RECORD_AUDIO }) }
)
public class DictadoNativoPlugin extends Plugin {
    private SpeechRecognizer reconocedor;
    private boolean enCurso = false;
    private String ultimoParcial = "";
    private String mejorTexto = "";

    // ------------------------------ ayudas ------------------------------
    private static JSObject ok() {
        JSObject r = new JSObject();
        r.put("ok", true);
        return r;
    }

    private static JSObject error(String codigo, String mensaje) {
        JSObject r = new JSObject();
        r.put("ok", false);
        r.put("codigo", codigo);
        r.put("error", mensaje);
        return r;
    }

    /** El código de Android → uno corto para la web y un texto para la persona. */
    static String[] describirError(int codigo) {
        switch (codigo) {
            case SpeechRecognizer.ERROR_NO_MATCH:
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                return new String[] { "sin_voz", "No te escuché." };
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                return new String[] { "sin_permiso", "Falta el permiso del micrófono." };
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                return new String[] { "red", "El dictado necesita internet (o el idioma descargado en el teléfono)." };
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
                return new String[] { "ocupado", "El dictado del teléfono está ocupado. Probá de nuevo." };
            case SpeechRecognizer.ERROR_AUDIO:
                return new String[] { "audio", "No pude usar el micrófono." };
            case SpeechRecognizer.ERROR_CLIENT:
                return new String[] { "cliente", "Se cortó el dictado." };
            case SpeechRecognizer.ERROR_SERVER:
            case 11: // ERROR_SERVER_DISCONNECTED
            case 10: // ERROR_TOO_MANY_REQUESTS
                return new String[] { "servicio", "El servicio de dictado del teléfono no respondió." };
            case 12: // ERROR_LANGUAGE_NOT_SUPPORTED
            case 13: // ERROR_LANGUAGE_UNAVAILABLE
                return new String[] { "idioma", "El dictado del teléfono no tiene el español descargado." };
            default:
                return new String[] { "otro", "No se pudo dictar (código " + codigo + ")." };
        }
    }

    private void enPrincipal(Runnable r) {
        if (getActivity() != null) getActivity().runOnUiThread(r);
        else r.run();
    }

    private static String primero(Bundle b) {
        if (b == null) return "";
        ArrayList<String> l = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        return l != null && !l.isEmpty() && l.get(0) != null ? l.get(0).trim() : "";
    }

    private void destruir() {
        enCurso = false;
        if (reconocedor == null) return;
        try {
            reconocedor.cancel();
        } catch (Throwable t) {
            /* ya estaba parado */
        }
        try {
            reconocedor.destroy();
        } catch (Throwable t) {
            /* ya estaba suelto */
        }
        reconocedor = null;
    }

    // ------------------------------ estado ------------------------------
    @PluginMethod
    public void disponible(PluginCall call) {
        Context c = getContext();
        JSObject r = ok();
        boolean hay = false;
        boolean enDispositivo = false;
        try {
            hay = SpeechRecognizer.isRecognitionAvailable(c);
            if (Build.VERSION.SDK_INT >= 33) enDispositivo = SpeechRecognizer.isOnDeviceRecognitionAvailable(c);
        } catch (Throwable t) {
            /* sin dictado */
        }
        r.put("disponible", hay);
        r.put("enDispositivo", enDispositivo);
        r.put("sdk", Build.VERSION.SDK_INT);
        call.resolve(r);
    }

    // ------------------------------ dictar ------------------------------
    @PluginMethod
    public void empezar(PluginCall call) {
        if (getPermissionState("mic") != PermissionState.GRANTED) {
            requestPermissionForAlias("mic", call, "alMicDictado");
            return;
        }
        arrancar(call);
    }

    @PermissionCallback
    private void alMicDictado(PluginCall call) {
        if (getPermissionState("mic") == PermissionState.GRANTED) arrancar(call);
        else call.resolve(error("sin_permiso", "Sin el permiso del micrófono no puedo dictar."));
    }

    private void arrancar(final PluginCall call) {
        final String idioma = call.getString("idioma", "es-CR");
        final boolean soloLocal = Boolean.TRUE.equals(call.getBoolean("soloLocal", false));
        enPrincipal(new Runnable() {
            @Override
            public void run() {
                try {
                    Context c = getContext();
                    if (!SpeechRecognizer.isRecognitionAvailable(c)) {
                        call.resolve(error("sin_servicio", "Este teléfono no tiene dictado por voz."));
                        return;
                    }
                    destruir();
                    ultimoParcial = "";
                    mejorTexto = "";
                    boolean local = soloLocal && Build.VERSION.SDK_INT >= 33 && SpeechRecognizer.isOnDeviceRecognitionAvailable(c);
                    reconocedor = local ? SpeechRecognizer.createOnDeviceSpeechRecognizer(c) : SpeechRecognizer.createSpeechRecognizer(c);
                    reconocedor.setRecognitionListener(escucha);
                    Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                    i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                    i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, idioma);
                    i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, idioma);
                    i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
                    i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
                    i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, c.getPackageName());
                    i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1600L);
                    i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 1300L);
                    if (soloLocal) i.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
                    enCurso = true;
                    reconocedor.startListening(i);
                    call.resolve(ok());
                } catch (Throwable t) {
                    destruir();
                    call.resolve(error("otro", "No se pudo empezar a dictar."));
                }
            }
        });
    }

    /** Termina de escuchar y entrega lo que entendió (evento «final»). */
    @PluginMethod
    public void detener(final PluginCall call) {
        enPrincipal(new Runnable() {
            @Override
            public void run() {
                try {
                    if (reconocedor != null && enCurso) reconocedor.stopListening();
                } catch (Throwable t) {
                    /* ya estaba parado */
                }
                call.resolve(ok());
            }
        });
    }

    /** Corta sin entregar nada. */
    @PluginMethod
    public void cancelar(final PluginCall call) {
        enPrincipal(new Runnable() {
            @Override
            public void run() {
                destruir();
                call.resolve(ok());
            }
        });
    }

    @Override
    protected void handleOnPause() {
        // Si la app pasa a segundo plano, el dictado se corta (no se escucha a escondidas).
        enPrincipal(new Runnable() {
            @Override
            public void run() {
                if (enCurso) {
                    destruir();
                    notifyListeners("fin", ok());
                }
            }
        });
        super.handleOnPause();
    }

    @Override
    protected void handleOnDestroy() {
        destruir();
        super.handleOnDestroy();
    }

    private final RecognitionListener escucha = new RecognitionListener() {
        @Override
        public void onReadyForSpeech(Bundle params) {
            notifyListeners("listo", new JSObject());
        }

        @Override
        public void onBeginningOfSpeech() {
            notifyListeners("habla", new JSObject());
        }

        @Override
        public void onRmsChanged(float rmsdB) {
            // De -2 a 10 dB aproximadamente → 0..1.
            JSObject o = new JSObject();
            o.put("n", Math.max(0.0, Math.min(1.0, (rmsdB + 2.0) / 12.0)));
            notifyListeners("nivel", o);
        }

        @Override
        public void onBufferReceived(byte[] buffer) {
            /* no se usa */
        }

        @Override
        public void onEndOfSpeech() {
            /* el resultado llega enseguida */
        }

        @Override
        public void onPartialResults(Bundle parcial) {
            String t = primero(parcial);
            if (t.isEmpty() || t.equals(ultimoParcial)) return;
            ultimoParcial = t;
            mejorTexto = t;
            JSObject o = new JSObject();
            o.put("texto", t);
            notifyListeners("parcial", o);
        }

        @Override
        public void onResults(Bundle resultados) {
            String t = primero(resultados);
            if (t.isEmpty()) t = mejorTexto;
            enCurso = false;
            JSObject o = new JSObject();
            o.put("texto", t);
            notifyListeners("final", o);
            destruir();
        }

        @Override
        public void onError(int codigo) {
            String[] d = describirError(codigo);
            // Cuando se corta justo al terminar, lo último que se entendió igual sirve.
            if (("sin_voz".equals(d[0]) || "cliente".equals(d[0])) && !mejorTexto.isEmpty()) {
                enCurso = false;
                JSObject o = new JSObject();
                o.put("texto", mejorTexto);
                notifyListeners("final", o);
                destruir();
                return;
            }
            enCurso = false;
            JSObject o = new JSObject();
            o.put("codigo", d[0]);
            o.put("error", d[1]);
            notifyListeners("error", o);
            destruir();
        }

        @Override
        public void onEvent(int eventType, Bundle params) {
            /* no se usa */
        }
    };
}
