// =====================================================================
// AUDIO CRUDO — remuestreo a 16 kHz y WAV
// =====================================================================
// El «oído» de manos libres (oidoVoz.ts) trabaja con el audio crudo del
// micrófono. Para mandarlo al servidor se baja a 16 kHz (de sobra para la
// voz) y se envuelve en un WAV, que entienden tanto Gemini como Whisper.
// Lógica pura: se prueba sin navegador.
// =====================================================================

export const FS_VOZ = 16000;

/** Baja el audio a 16 kHz promediando (sirve para 48 000, 44 100, etc.), de a bloques. */
export function crearRemuestreador(frecuenciaEntrada: number) {
  const razon = Math.max(1, frecuenciaEntrada / FS_VOZ);
  let acum = 0, cuenta = 0, fase = 0;
  return {
    /** Devuelve las muestras (enteros de 16 bits) que este bloque completa. */
    procesar(x: Float32Array): Int16Array {
      const salida = new Int16Array(Math.ceil(x.length / razon) + 2);
      let n = 0;
      for (let i = 0; i < x.length; i++) {
        acum += x[i]; cuenta++; fase += 1;
        if (fase >= razon) {
          fase -= razon;
          const v = Math.max(-1, Math.min(1, acum / cuenta));
          salida[n++] = v < 0 ? v * 0x8000 : v * 0x7fff;
          acum = 0; cuenta = 0;
        }
      }
      return salida.subarray(0, n);
    },
  };
}

/** Las muestras de varios trozos en un solo arreglo (hasta `hasta` muestras). */
export function unirTrozos(trozos: Int16Array[], hasta = Infinity): Int16Array {
  let total = 0;
  for (const t of trozos) total += t.length;
  total = Math.min(total, hasta);
  const out = new Int16Array(total);
  let pos = 0;
  for (const t of trozos) {
    if (pos >= total) break;
    const n = Math.min(t.length, total - pos);
    out.set(n === t.length ? t : t.subarray(0, n), pos);
    pos += n;
  }
  return out;
}

/** Un WAV (PCM de 16 bits, mono) con esas muestras. */
export function aWav(muestras: Int16Array, frecuencia = FS_VOZ): Uint8Array {
  const datos = muestras.length * 2;
  const buf = new ArrayBuffer(44 + datos);
  const v = new DataView(buf);
  const txt = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  txt(0, 'RIFF'); v.setUint32(4, 36 + datos, true); txt(8, 'WAVE');
  txt(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, frecuencia, true); v.setUint32(28, frecuencia * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  txt(36, 'data'); v.setUint32(40, datos, true);
  new Int16Array(buf, 44, muestras.length).set(muestras);
  return new Uint8Array(buf);
}
