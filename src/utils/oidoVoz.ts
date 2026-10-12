// =====================================================================
// OÍDO — el micrófono de «manos libres», abierto todo el rato
// =====================================================================
// Se abre UNA vez al empezar el modo y queda escuchando hasta terminarlo.
// Eso permite lo que una grabadora que se prende y se apaga no puede:
//   · No se pierden las primeras palabras: siempre se guardan los últimos
//     ~0.9 s, así que si empezás a hablar justo cuando Javier termina (o un
//     instante antes de que el micrófono «arranque»), igual quedan.
//   · Se puede interrumpir a Javier hablándole encima: mientras él habla el
//     oído vigila (ver interrupcionVoz.ts) y, si de verdad hablás, te toma
//     lo que decís desde un poco antes de que se callara.
//   · El cancelador de eco ya está acomodado desde el principio (no cada
//     vez que se prende el micrófono) y Android no cambia de modo de audio
//     en pleno habla.
// Trabaja con el audio crudo (Web Audio) y entrega un WAV de 16 kHz, que
// entienden Gemini y Whisper. En manos libres solo; el botón del micrófono
// de siempre sigue usando la grabadora de notas (grabadorVoz.ts).
// =====================================================================

import { aVisual } from './nivelVoz';
import { crearDetector } from './silencioVoz';
import { crearInterruptor } from './interrupcionVoz';
import { aWav, crearRemuestreador, FS_VOZ, unirTrozos } from './pcmVoz';
import type { GrabacionEnCurso } from './grabadorVoz';

const PREVIO_MS = 900;     // lo último que se guarda para no perder el comienzo
const ENTRADA_MS = 900;    // cuánto antes de la primera voz arranca el WAV (todo lo previo)
const COLA_MS = 350;       // y cuánto después de la última voz termina
const TOPE_MS = 90_000;    // una nota hablada no pasa de aquí
const BLOQUE = 2048;       // ~43 ms a 48 kHz

export interface OpcionesEscucha {
  /** Silencio, después de hablar, que cuenta como «terminé». */
  silencioMs: number;
  /** Si en este tiempo no se oyó voz, se da por «no habló nadie». */
  esperaMs: number;
  /** Volumen de 0 a 1 (para el orbe). */
  alNivel?: (n: number) => void;
  /** `fin`: terminó de hablar. `nadie`: pasó la espera sin voz. Se avisa una sola vez. */
  alPausa?: (por: 'fin' | 'nadie') => void;
}

export interface OpcionesVigilancia {
  /** Cuándo empezó a sonar la última oración de Javier (el eco da un golpe ahí). */
  inicioOracion: () => number;
  silencioMs: number;
  /** Se oyó algo fuerte y sostenido: que Javier se calle YA (puede ser falsa alarma). */
  alPausar: () => void;
  /** No era nadie (una tos, el eco): que Javier siga. */
  alFalsaAlarma: () => void;
  /** Hablás de verdad: entrega lo que dijiste (con lo de un instante antes) para seguir grabando. */
  alConfirmar: (g: GrabacionEnCurso) => void;
  alNivel?: (n: number) => void;
  alPausa?: (por: 'fin' | 'nadie') => void;
}

export interface Oido {
  /** Un turno de escucha (con lo previo): termina solo cuando hacés una pausa. */
  escuchar(op: OpcionesEscucha): GrabacionEnCurso;
  /** Mientras Javier habla: avisa si le hablás encima. Devuelve cómo dejar de vigilar. */
  vigilar(op: OpcionesVigilancia): () => void;
  abierto(): boolean;
  /** Suelta el micrófono. */
  cerrar(): void;
}

/** ¿Este aparato puede tener el oído abierto? */
export function puedeOir(): boolean {
  try {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function'
      && typeof window !== 'undefined' && !!(window.AudioContext || (window as any).webkitAudioContext);
  } catch { return false; }
}

type Bloque = (rms: number, pcm: Int16Array, ahora: number) => void;

/** Lo que se va juntando de un turno: el audio, el volumen y el final del habla. */
function crearCaptura(previo: Int16Array[], det: ReturnType<typeof crearDetector>, op: { alNivel?: (n: number) => void; alPausa?: (por: 'fin' | 'nadie') => void }, desdeElComienzo: boolean) {
  const trozos = [...previo];
  let n = trozos.reduce((a, t) => a + t.length, 0);
  let primeraVoz = desdeElComienzo ? 0 : -1;   // índice de muestra donde empezó la voz
  let ultimaVoz = n;                            // y donde sonó por última vez
  let avisado = false;
  return {
    alBloque(rms: number, pcm: Int16Array, ahora: number) {
      const antes = n;
      trozos.push(pcm); n += pcm.length;
      op.alNivel?.(aVisual(rms));
      if (rms > det.umbral()) { if (primeraVoz < 0) primeraVoz = antes; ultimaVoz = n; }
      const v = det.procesar(rms, ahora);
      if (!avisado && (v === 'fin' || v === 'nadie' || n >= FS_VOZ * TOPE_MS / 1000)) { avisado = true; op.alPausa?.(v === 'nadie' ? 'nadie' : 'fin'); }
    },
    /** El WAV, sin el silencio de antes ni el de después. */
    blob(): Blob {
      const todo = unirTrozos(trozos);
      const a = Math.max(0, (primeraVoz < 0 ? 0 : primeraVoz) - FS_VOZ * ENTRADA_MS / 1000);
      const b = Math.min(todo.length, ultimaVoz + FS_VOZ * COLA_MS / 1000);
      return new Blob([aWav(todo.subarray(a, Math.max(a, b)))], { type: 'audio/wav' });
    },
    hablo: () => det.hablo(),
  };
}

export async function abrirOido(): Promise<Oido> {
  if (!puedeOir()) throw new Error('Este aparato no puede escuchar así.');
  let flujo: MediaStream;
  try {
    // Con cancelación de eco: así Javier puede hablar mientras el micrófono sigue abierto.
    flujo = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch {
    throw new Error('No se pudo usar el micrófono. Revisá el permiso del navegador e intentá de nuevo.');
  }
  const Ctx = window.AudioContext || (window as any).webkitAudioContext;
  let ctx: AudioContext | null = null;
  let fuente: MediaStreamAudioSourceNode, proc: ScriptProcessorNode, mudo: GainNode;
  try {
    ctx = new Ctx() as AudioContext;
    void ctx.resume().catch(() => {});
    fuente = ctx.createMediaStreamSource(flujo);
    proc = ctx.createScriptProcessor(BLOQUE, 1, 1);
    mudo = ctx.createGain();
    mudo.gain.value = 0;
    fuente.connect(proc); proc.connect(mudo); mudo.connect(ctx.destination);
  } catch {
    // Que el micrófono no quede abierto si no se pudo armar el audio.
    try { flujo.getTracks().forEach(t => t.stop()); } catch { /* ya soltado */ }
    try { void ctx?.close(); } catch { /* nada */ }
    throw new Error('Este aparato no puede escuchar así.');
  }
  const contexto: AudioContext = ctx;
  const remuestrear = crearRemuestreador(contexto.sampleRate);

  let abierto = true;
  const anillo: Int16Array[] = [];
  let anilloN = 0;
  const recientes: number[] = [];            // últimos volúmenes (≈ 2.5 s): de ahí sale el ruido de fondo
  let consumidor: Bloque | null = null;
  let escuchando = false;                     // hay un turno de escucha en curso: no se lo pisa con la vigilancia
  const piso = () => (recientes.length < 8 ? 0.008 : Math.max(0.003, Math.min(0.02, Math.min(...recientes))));

  proc.onaudioprocess = (e: AudioProcessingEvent) => {
    if (!abierto) return;
    const x = e.inputBuffer.getChannelData(0);
    let s = 0;
    for (let i = 0; i < x.length; i++) s += x[i] * x[i];
    const rms = Math.sqrt(s / x.length);
    const pcm = remuestrear.procesar(x);
    anillo.push(pcm); anilloN += pcm.length;
    while (anillo.length > 1 && anilloN - anillo[0].length >= FS_VOZ * PREVIO_MS / 1000) anilloN -= anillo.shift()!.length;
    recientes.push(rms);
    if (recientes.length > 58) recientes.shift();
    consumidor?.(rms, pcm, Date.now());
  };

  const cerrar = () => {
    if (!abierto) return;
    abierto = false; consumidor = null;
    try { proc.onaudioprocess = null; proc.disconnect(); fuente.disconnect(); mudo.disconnect(); } catch { /* ya suelto */ }
    try { flujo.getTracks().forEach(t => t.stop()); } catch { /* ya soltado */ }
    void contexto.close().catch(() => {});
  };

  /** El manejador de una captura: se la suelta con `detener` o `cancelar` y deja de recibir audio. */
  const manejador = (cap: ReturnType<typeof crearCaptura>, mio: Bloque, alNivel?: (n: number) => void): GrabacionEnCurso => {
    const soltar = () => { if (consumidor === mio) { consumidor = null; escuchando = false; } alNivel?.(0); };
    return {
      detener: async () => {
        soltar();
        const b = cap.blob();
        if (b.size <= 44) throw new Error('No se grabó nada.');
        return b;
      },
      cancelar: soltar,
      hablo: () => cap.hablo(),
    };
  };

  return {
    escuchar(op) {
      if (!abierto) throw new Error('El micrófono ya está cerrado.');
      const det = crearDetector({ silencioMs: op.silencioMs, esperaMs: op.esperaMs, pisoInicial: piso() });
      // Lo último que se oyó ya está en el anillo: no se pierde el comienzo.
      const cap = crearCaptura([...anillo], det, op, false);
      const mio: Bloque = (rms, pcm, ahora) => cap.alBloque(rms, pcm, ahora);
      consumidor = mio; escuchando = true;
      return manejador(cap, mio, op.alNivel);
    },

    vigilar(op) {
      if (!abierto || escuchando) return () => {};
      const inter = crearInterruptor();
      let previo: Int16Array[] = [];          // lo que había justo antes de pausar
      let desdePausa: Int16Array[] = [];      // y lo que llegó mientras se confirmaba
      let cap: ReturnType<typeof crearCaptura> | null = null;
      const mio: Bloque = (rms, pcm, ahora) => {
        if (cap) { cap.alBloque(rms, pcm, ahora); return; }
        const antesDePausa = inter.estado();
        const a = inter.procesar(rms, ahora, op.inicioOracion());
        if (antesDePausa === 'pausado') desdePausa.push(pcm);
        if (a === 'pausar') { previo = [...anillo]; desdePausa = []; op.alPausar(); }
        else if (a === 'falsa') { previo = []; desdePausa = []; op.alFalsaAlarma(); }
        else if (a === 'confirmar') {
          const det = crearDetector({ silencioMs: op.silencioMs, esperaMs: 6000, pisoInicial: piso(), yaHablo: true });
          cap = crearCaptura([...previo, ...desdePausa], det, op, true);
          previo = []; desdePausa = []; escuchando = true;
          op.alConfirmar(manejador(cap, mio, op.alNivel));
        }
      };
      consumidor = mio;
      // Dejar de vigilar; si ya se entregó una grabación, esa sigue su curso.
      return () => { if (!cap && consumidor === mio) consumidor = null; };
    },

    abierto: () => abierto,
    cerrar,
  };
}
