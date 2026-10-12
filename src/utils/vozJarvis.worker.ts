// =====================================================================
// VOZ PROPIA DE JARVIS — el motor neuronal, en un hilo aparte
// =====================================================================
// Piper (modelo de voz abierto, ONNX) corre aquí para no trabar la
// pantalla mientras genera el audio. Recibe { id, texto, voz } y devuelve
// { id, wav } (un Blob WAV) o { id, error }. La primera vez baja el modelo
// (~60 MB) y queda guardado en el aparato (OPFS): después funciona sin
// gastar datos.
// =====================================================================

/// <reference lib="webworker" />
import * as piper from '@mintplex-labs/piper-tts-web';

type Pedido = { id: number; tipo: 'decir'; texto: string; voz: string } | { id: number; tipo: 'bajar'; voz: string } | { id: number; tipo: 'estado'; voz: string };

let sesion: { voz: string; s: piper.TtsSession } | null = null;

/**
 * Baja el modelo y su configuración y los deja guardados donde la librería los busca (OPFS,
 * carpeta «piper», con el nombre del archivo). Lo hacemos acá y no con `piper.download()` porque
 * esa función no espera a que termine de grabarse el archivo ni revisa la respuesta: con la voz HD
 * (110 MB) se abría el modelo a medio grabar y fallaba con «No graph was found in the protobuf».
 */
async function bajarModelo(voz: string, avisar: (pct: number) => void): Promise<void> {
  const ruta = (piper.PATH_MAP as Record<string, string>)[voz];
  if (!ruta) throw new Error('Esa voz no existe.');
  const raiz = await navigator.storage.getDirectory();
  const dir = await raiz.getDirectoryHandle('piper', { create: true });
  for (const url of [`${piper.HF_BASE}/${ruta}.json`, `${piper.HF_BASE}/${ruta}`]) {
    const r = await fetch(url);
    if (!r.ok || !r.body) throw new Error(`el servidor de voces respondió ${r.status}`);
    const total = Number(r.headers.get('Content-Length') || 0);
    const nombre = url.split('/').at(-1)!;
    const archivo = await dir.getFileHandle(nombre, { create: true });
    const destino = await archivo.createWritable();
    let llegado = 0;
    try {
      const lector = r.body.getReader();
      for (;;) {
        const { done, value } = await lector.read();
        if (done) break;
        await destino.write(value);
        llegado += value.length;
        if (total && url.endsWith('.onnx')) avisar(Math.min(99, Math.round((llegado / total) * 100)));
      }
      // Cortado a mitad de camino (se cayó el wifi): no se guarda un modelo incompleto.
      if (total && llegado < total) throw new Error('la descarga se cortó a mitad de camino');
      await destino.close();
    } catch (e) {
      await destino.abort().catch(() => {});
      await dir.removeEntry(nombre).catch(() => {});
      throw e;
    }
  }
}

/** Un modelo guardado que no abre (a medio bajar, de una versión vieja): se borra para bajarlo de nuevo. */
async function descartar(voz: string): Promise<void> {
  sesion = null;
  await piper.remove(voz as piper.VoiceId).catch(() => {});
}

async function preparar(voz: string, avisar?: (pct: number) => void) {
  if (sesion?.voz === voz) return sesion.s;
  const s = await piper.TtsSession.create({
    voiceId: voz as piper.VoiceId,
    progress: p => { if (avisar && p.total) avisar(Math.round((p.loaded / p.total) * 100)); },
  });
  sesion = { voz, s };
  return s;
}

self.onmessage = async (ev: MessageEvent<Pedido>) => {
  const m = ev.data;
  try {
    if (m.tipo === 'estado') {
      const guardadas = await piper.stored().catch(() => [] as string[]);
      (self as unknown as Worker).postMessage({ id: m.id, ok: true, guardada: guardadas.includes(m.voz as piper.VoiceId) });
      return;
    }
    if (m.tipo === 'bajar') {
      await descartar(m.voz);
      try {
        await bajarModelo(m.voz, pct => (self as unknown as Worker).postMessage({ id: m.id, progreso: pct }));
        await preparar(m.voz);
      } catch (e) {
        await descartar(m.voz);
        throw e;
      }
      (self as unknown as Worker).postMessage({ id: m.id, ok: true });
      return;
    }
    let s: piper.TtsSession;
    try { s = await preparar(m.voz); }
    catch (e) {
      // El guardado no abre: se borra, y la próxima vez que se baje queda bien.
      if (/protobuf|graph|session|onnx/i.test(e instanceof Error ? e.message : String(e))) await descartar(m.voz);
      throw e;
    }
    const wav = await s.predict(m.texto);
    (self as unknown as Worker).postMessage({ id: m.id, ok: true, wav });
  } catch (e) {
    (self as unknown as Worker).postMessage({ id: m.id, error: e instanceof Error ? e.message : String(e) });
  }
};
