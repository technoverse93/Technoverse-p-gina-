// =====================================================================
// DETECTOR DE SILENCIO — para saber cuándo terminaste de hablar
// =====================================================================
// En «manos libres» nadie toca el botón de enviar: se manda solo cuando
// pasa un momento de silencio después de haber hablado. Se calibra con el
// ruido de fondo de los primeros instantes (un cuarto con ventilador no
// es silencio absoluto) y exige un poco de voz sostenida para no confundir
// un golpe o una tos con una frase.
// Es lógica pura (recibe el volumen y la hora): se prueba sin micrófono.
// =====================================================================

export type Veredicto = 'nada' | 'hablando' | 'fin' | 'nadie';

export interface OpcionesSilencio {
  /** Silencio, después de hablar, que cuenta como «terminé». */
  silencioMs?: number;
  /** Si en este tiempo no se oyó voz, se da por «no habló nadie». */
  esperaMs?: number;
  /** Voz seguida mínima para contar como habla (no un golpe). */
  minHablaMs?: number;
  /** El ruido de fondo ya se conoce (el «oído» lo mide siempre): no hace falta calibrar al empezar. */
  pisoInicial?: number;
  /** Ya se sabe que hablaron (una interrupción confirmada): termina cuando haya silencio, sin pedir más voz. */
  yaHablo?: boolean;
}

export function crearDetector(op: OpcionesSilencio = {}) {
  const silencioMs = op.silencioMs ?? 1500;
  const esperaMs = op.esperaMs ?? 9000;
  const minHablaMs = op.minHablaMs ?? 220;
  let t0 = 0;
  const calibrar = op.pisoInicial === undefined;
  let piso = op.pisoInicial ?? 0.006, muestras = 0;
  let inicioVoz = 0, ultimaVoz = 0;
  let hablo = !!op.yaHablo;
  return {
    /** Se llama con cada medición. Devuelve qué pasa ahora. */
    procesar(rms: number, ahora: number): Veredicto {
      if (!t0) { t0 = ahora; if (hablo) { inicioVoz = ahora; ultimaVoz = ahora; } }
      // Los primeros 400 ms calibran el ruido de fondo (sin contar voz fuerte).
      if (calibrar && ahora - t0 < 400) {
        if (rms < 0.05) { piso = (piso * muestras + rms) / (muestras + 1); muestras++; }
        return 'nada';
      }
      const umbral = Math.max(0.02, piso * 2.8);
      if (rms > umbral) {
        if (!inicioVoz) inicioVoz = ahora;
        ultimaVoz = ahora;
        if (!hablo && ahora - inicioVoz >= minHablaMs) hablo = true;
      } else if (ahora - ultimaVoz > 300) {
        inicioVoz = 0; // un golpe suelto no se acumula con la voz de después
      }
      if (hablo) return ahora - ultimaVoz >= silencioMs ? 'fin' : 'hablando';
      return ahora - t0 >= esperaMs ? 'nadie' : 'nada';
    },
    hablo: () => hablo,
    umbral: () => Math.max(0.02, piso * 2.8),
  };
}
