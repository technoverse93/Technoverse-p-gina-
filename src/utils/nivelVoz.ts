// =====================================================================
// NIVEL DE VOZ — cuánto suena el micrófono o la voz de Jarvis (0 a 1)
// =====================================================================
// Un bus mínimo: quien graba o reproduce publica el volumen del momento
// y el orbe del modo «manos libres» lo dibuja. No hay estado de React de
// por medio: se lee a ~60 cuadros por segundo sin volver a pintar nada.
// =====================================================================

type Fuente = 'mic' | 'voz';
let nivel = 0;
let desde = 0;            // cuándo se publicó el último nivel real
let fuente: Fuente = 'mic';

export const nivelVoz = {
  /** Publica el volumen actual (0 a 1). */
  fijar(n: number, de: Fuente = 'mic'): void {
    nivel = Math.max(0, Math.min(1, n));
    fuente = de;
    desde = Date.now();
  },
  /** El último volumen, o 0 si hace rato que nadie publica. */
  leer(): number { return Date.now() - desde < 250 ? nivel : 0; },
  /** ¿Hay una fuente real publicando ahora? (si no, el orbe simula). */
  hayReal(de?: Fuente): boolean { return Date.now() - desde < 250 && (!de || fuente === de); },
  apagar(): void { nivel = 0; desde = 0; },
};

/** Volumen eficaz (RMS) de un trozo de audio de 8 bits (centrado en 128). */
export function rms8(datos: Uint8Array): number {
  let s = 0;
  for (let i = 0; i < datos.length; i++) { const v = (datos[i] - 128) / 128; s += v * v; }
  return Math.sqrt(s / Math.max(1, datos.length));
}

/** De RMS (≈ 0.01 en voz baja, ≈ 0.2 en voz fuerte) a un 0–1 que se vea bien. */
export const aVisual = (r: number): number => Math.max(0, Math.min(1, Math.sqrt(Math.max(0, r - 0.006)) * 2.6));
