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
      await piper.download(m.voz as piper.VoiceId, p => {
        if (p.total) (self as unknown as Worker).postMessage({ id: m.id, progreso: Math.round((p.loaded / p.total) * 100) });
      });
      await preparar(m.voz);
      (self as unknown as Worker).postMessage({ id: m.id, ok: true });
      return;
    }
    const s = await preparar(m.voz);
    const wav = await s.predict(m.texto);
    (self as unknown as Worker).postMessage({ id: m.id, ok: true, wav });
  } catch (e) {
    (self as unknown as Worker).postMessage({ id: m.id, error: e instanceof Error ? e.message : String(e) });
  }
};
