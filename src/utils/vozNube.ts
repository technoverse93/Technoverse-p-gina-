// =====================================================================
// VOZ NATURAL DE JAVIER — la voz neuronal de Google (Gemini), por internet
// =====================================================================
// El dueño pidió una voz «más natural» (2026-10-12). La voz del teléfono y la
// propia (Piper, en el aparato) suenan robóticas; esta es una voz neuronal que
// genera el servidor (acción «hablar» de asistente-ia, con la misma clave de
// Gemini) y llega como audio. Se genera oración por oración, y la siguiente
// mientras suena la actual, para que no haya silencios.
//
// Si no hay internet, se acabó el cupo o falla, el lector sigue con la voz de
// antes (propia o del teléfono) sin cortar la lectura.
// =====================================================================

import { supabase } from '../supabaseClient';
import { reproducir } from './vozPropia';

const CLAVE = 'tv_voz_natural';

/** ¿Se usa la voz natural? (por defecto sí; se apaga en Ajustes → Voz) */
export function usarVozNatural(): boolean {
  try { return localStorage.getItem(CLAVE) !== 'no' && typeof navigator !== 'undefined' && navigator.onLine !== false; } catch { return true; }
}
export function fijarVozNatural(si: boolean): void {
  try { localStorage.setItem(CLAVE, si ? 'si' : 'no'); } catch { /* sin almacenamiento */ }
}

/** Audio PCM de 16 bits (lo que manda Gemini) → WAV que el navegador sabe tocar. */
export function pcmAWav(base64: string, tasa = 24000): Blob {
  const crudo = atob(base64);
  const datos = new Uint8Array(crudo.length);
  for (let i = 0; i < crudo.length; i++) datos[i] = crudo.charCodeAt(i);
  const cab = new DataView(new ArrayBuffer(44));
  const txt = (o: number, t: string) => { for (let i = 0; i < t.length; i++) cab.setUint8(o + i, t.charCodeAt(i)); };
  txt(0, 'RIFF'); cab.setUint32(4, 36 + datos.length, true); txt(8, 'WAVE');
  txt(12, 'fmt '); cab.setUint32(16, 16, true); cab.setUint16(20, 1, true); cab.setUint16(22, 1, true);
  cab.setUint32(24, tasa, true); cab.setUint32(28, tasa * 2, true); cab.setUint16(32, 2, true); cab.setUint16(34, 16, true);
  txt(36, 'data'); cab.setUint32(40, datos.length, true);
  return new Blob([cab.buffer, datos], { type: 'audio/wav' });
}

const cache = new Map<string, Promise<Blob>>();
/** Genera (o reusa) el audio de una oración. */
export function preparar(texto: string): Promise<Blob> {
  let p = cache.get(texto);
  if (!p) {
    p = (async () => {
      const { data, error } = await supabase.functions.invoke('asistente-ia', { body: { accion: 'hablar', texto } });
      if (error || !data?.ok || !data.audio) throw new Error(data?.error || 'Sin voz natural ahora.');
      return pcmAWav(String(data.audio), Number(data.tasa) || 24000);
    })();
    p.catch(() => cache.delete(texto));
    cache.set(texto, p);
    if (cache.size > 16) cache.delete(cache.keys().next().value as string);
  }
  return p;
}

export async function decir(texto: string, alEmpezar?: () => void): Promise<void> {
  await reproducir(await preparar(texto), alEmpezar);
}
