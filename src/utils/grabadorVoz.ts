// =====================================================================
// GRABADOR DE NOTAS DE VOZ — MediaRecorder, sin librerías
// =====================================================================
// Graba desde el micrófono y devuelve un Blob listo para subir. Nada de
// dependencias nuevas: `MediaRecorder` está en todos los navegadores que
// esta plataforma soporta (Chrome/Edge de escritorio, Chrome de Android y
// el WebView de la APK).
//
// EL PERMISO DEL MICRÓFONO SE PIDE AL GRABAR, NO AL ENTRAR
// ---------------------------------------------------------------------
// Es deliberado y es lo que corresponde: pedir el micrófono al iniciar
// sesión, a todo el mundo, para una función que quizá esa persona no use
// nunca, es exactamente el tipo de fricción que el aviso de inicio evita.
// El toque en el botón de grabar YA ES un gesto real, que es lo único que
// el navegador exige. Se pide una vez por aparato y el sistema lo
// recuerda.
//
// EL FORMATO LO ELIGE EL NAVEGADOR
// ---------------------------------------------------------------------
// No todos aceptan el mismo contenedor: Chrome graba `audio/webm` (opus)
// y otros motores prefieren `audio/mp4`. En vez de imponer uno y fallar
// donde no exista, se prueba la lista en orden y se usa el primero que el
// navegador declare soportado; si ninguno lo es, se deja que MediaRecorder
// elija por su cuenta. La migración del bucket admite los dos.
//
// SIEMPRE SE SUELTA EL MICRÓFONO
// ---------------------------------------------------------------------
// Al terminar —o al cancelar, o si algo falla— se llama `track.stop()`.
// Sin eso el indicador de "micrófono en uso" del sistema se queda
// encendido después de mandar la nota, que es alarmante y con razón.
// =====================================================================

import { aVisual, rms8 } from './nivelVoz';
import { crearDetector, type OpcionesSilencio } from './silencioVoz';

/** Preferencias de contenedor, de mejor a peor soportado. */
const FORMATOS = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];

/** Tope de duración: una nota de voz no es un podcast. */
export const TOPE_GRABACION_MS = 3 * 60 * 1000;

export interface GrabacionEnCurso {
  /** Corta, suelta el micrófono y entrega el audio grabado. */
  detener: () => Promise<Blob>;
  /** Corta y descarta: no devuelve nada y suelta el micrófono igual. */
  cancelar: () => void;
  /** ¿Se oyó voz de verdad? (solo con el detector de «manos libres»; si no, siempre sí). */
  hablo: () => boolean;
}

/** Para «manos libres»: avisa el volumen y cuándo hubo silencio. */
export interface OpcionesGrabacion extends OpcionesSilencio {
  /** Volumen de 0 a 1, unas 20 veces por segundo. */
  alNivel?: (n: number) => void;
  /** `fin`: terminó de hablar. `nadie`: pasó la espera sin voz. Se avisa una sola vez. */
  alPausa?: (por: 'fin' | 'nadie') => void;
}

/** ¿Este aparato puede grabar audio? Falso en navegadores muy viejos. */
export function puedeGrabarVoz(): boolean {
  try {
    return typeof MediaRecorder !== 'undefined'
      && typeof navigator !== 'undefined'
      && !!navigator.mediaDevices
      && typeof navigator.mediaDevices.getUserMedia === 'function';
  } catch {
    return false;
  }
}

function mejorFormato(): string | undefined {
  for (const f of FORMATOS) {
    try {
      if (MediaRecorder.isTypeSupported(f)) return f;
    } catch { /* motor sin isTypeSupported: que elija él */ }
  }
  return undefined;
}

/**
 * Arranca la grabación. DEBE llamarse desde un gesto real (el toque en el
 * botón de grabar), porque ahí es donde el navegador pide el micrófono.
 *
 * Lanza con un mensaje legible si la persona deniega el permiso o si el
 * aparato no tiene micrófono — quien llama solo tiene que mostrarlo.
 */
export async function grabarNotaDeVoz(opciones: OpcionesGrabacion = {}): Promise<GrabacionEnCurso> {
  if (!puedeGrabarVoz()) {
    throw new Error('Este navegador no puede grabar notas de voz.');
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    throw new Error('No se pudo usar el micrófono. Revisá el permiso del navegador e intentá de nuevo.');
  }

  const formato = mejorFormato();
  const grabador = formato
    ? new MediaRecorder(stream, { mimeType: formato })
    : new MediaRecorder(stream);

  const trozos: Blob[] = [];
  grabador.ondataavailable = (e) => { if (e.data && e.data.size > 0) trozos.push(e.data); };
  grabador.start();

  // Volumen y silencio (solo si se pidió): un analizador de audio sobre el
  // mismo micrófono. Si el aparato no lo permite, se graba igual, sin esto.
  const medir = !!(opciones.alNivel || opciones.alPausa);
  const detector = opciones.alPausa ? crearDetector(opciones) : null;
  let contexto: AudioContext | null = null;
  let medidor: ReturnType<typeof setInterval> | null = null;
  let avisado = false;
  if (medir) {
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      contexto = new Ctx();
      const fuente = contexto.createMediaStreamSource(stream);
      const analizador = contexto.createAnalyser();
      analizador.fftSize = 1024;
      fuente.connect(analizador);
      const datos = new Uint8Array(analizador.fftSize);
      void contexto.resume().catch(() => {});
      medidor = setInterval(() => {
        analizador.getByteTimeDomainData(datos);
        const r = rms8(datos);
        opciones.alNivel?.(aVisual(r));
        const v = detector?.procesar(r, Date.now());
        if (!avisado && (v === 'fin' || v === 'nadie')) { avisado = true; opciones.alPausa?.(v); }
      }, 50);
    } catch { contexto = null; }
  }
  const pararMedidor = () => {
    if (medidor) { clearInterval(medidor); medidor = null; }
    if (contexto) { void contexto.close().catch(() => {}); contexto = null; }
    if (opciones.alNivel) opciones.alNivel(0);
  };

  const soltarMicrofono = () => {
    pararMedidor();
    try { stream.getTracks().forEach(t => t.stop()); } catch { /* ya soltado */ }
  };

  // Freno de mano: si alguien deja el botón grabando, se corta solo.
  const reloj = setTimeout(() => {
    try { if (grabador.state !== 'inactive') grabador.stop(); } catch { /* nada */ }
  }, TOPE_GRABACION_MS);

  return {
    detener: () =>
      new Promise<Blob>((resolve, reject) => {
        clearTimeout(reloj);
        grabador.onstop = () => {
          soltarMicrofono();
          const tipo = grabador.mimeType || formato || 'audio/webm';
          const blob = new Blob(trozos, { type: tipo });
          if (blob.size === 0) reject(new Error('No se grabó nada. Mantené presionado un momento más.'));
          else resolve(blob);
        };
        try {
          if (grabador.state === 'inactive') grabador.onstop?.(new Event('stop'));
          else grabador.stop();
        } catch {
          soltarMicrofono();
          reject(new Error('No se pudo cerrar la grabación.'));
        }
      }),
    hablo: () => (detector ? detector.hablo() : true),
    cancelar: () => {
      clearTimeout(reloj);
      grabador.onstop = () => soltarMicrofono();
      try {
        if (grabador.state !== 'inactive') grabador.stop();
        else soltarMicrofono();
      } catch {
        soltarMicrofono();
      }
    },
  };
}
