// =====================================================================
// INTERRUPCIÓN POR VOZ — saber cuándo le hablás encima a Javier
// =====================================================================
// Mientras Javier habla, el micrófono sigue abierto (con cancelación de eco),
// pero a veces el eco de su propia voz se cuela. Por eso no se corta a la
// primera: se hace en dos pasos, como lo haría una persona.
//
//   1. «Pausar»: se oye algo bastante más fuerte que el eco, de manera
//      sostenida (~160 ms) → Javier se calla EN EL ACTO.
//   2. «Confirmar»: ya sin su voz sonando, se mira si seguís hablando
//      (~150 ms de voz en 1.8 s) → era de verdad: se queda callado y te escucha.
//      Si no (una tos, un portazo, el eco), «falsa alarma»: Javier sigue
//      donde iba, y la próxima vez se pide un poquito más de volumen.
//
// El volumen del eco se va midiendo solo (si el altavoz se oye fuerte, el
// umbral sube) y no se dispara justo cuando empieza una oración de Javier
// (ahí el eco da un golpe mientras el cancelador se acomoda).
// Lógica pura (recibe el volumen y la hora): se prueba sin micrófono.
// =====================================================================

export type AccionInterrupcion = 'nada' | 'pausar' | 'confirmar' | 'falsa';
export type EstadoInterrupcion = 'vigilando' | 'pausado' | 'confirmado';

export interface OpcionesInterruptor {
  /** Desde que arranca la vigilancia no se dispara (el cancelador de eco se acomoda). */
  graciaMs?: number;
  /** Voz seguida por encima del umbral para pausar. */
  sostenidoMs?: number;
  /** Tras empezar cada oración de Javier, no se dispara. */
  trasOracionMs?: number;
  /** Voz acumulada (ya pausado) para confirmar que hablás de verdad. */
  confirmarMs?: number;
  /** Ya pausado, espera a que se apague el eco antes de medir. */
  esperaEcoMs?: number;
  /** Cuánto se espera la confirmación antes de dar la falsa alarma. */
  ventanaMs?: number;
  /** Volumen mínimo para pausar (RMS 0–1). */
  minimo?: number;
}

export function crearInterruptor(op: OpcionesInterruptor = {}) {
  const gracia = op.graciaMs ?? 800;
  const sostenido = op.sostenidoMs ?? 160;
  const trasOracion = op.trasOracionMs ?? 450;
  const confirmar = op.confirmarMs ?? 150;
  const esperaEco = op.esperaEcoMs ?? 120;
  const ventana = op.ventanaMs ?? 1800;
  const minimo = op.minimo ?? 0.04;
  let t0 = 0, previo = 0;
  let eco = 0.004;               // volumen del eco que se cuela (se mide solo)
  let factor = 1;                // sube tras cada falsa alarma
  let estado: EstadoInterrupcion = 'vigilando';
  let desde = 0;                 // desde cuándo suena algo por encima del umbral
  let tPausa = 0, umbralPausa = 0, vozMs = 0;
  const umbral = () => Math.max(minimo, eco * 3) * factor;
  return {
    /** Se llama con cada medición. `inicioOracion`: cuándo empezó a sonar la última oración de Javier. */
    procesar(rms: number, ahora: number, inicioOracion = 0): AccionInterrupcion {
      if (!t0) { t0 = ahora; previo = ahora; }
      const dt = Math.min(250, Math.max(0, ahora - previo));
      previo = ahora;
      if (estado === 'vigilando') {
        const u = umbral();
        // El eco se va midiendo, pero la voz fuerte no lo infla.
        eco += 0.04 * (Math.min(rms, u) - eco);
        if (ahora - t0 < gracia || ahora - inicioOracion < trasOracion) { desde = 0; return 'nada'; }
        if (rms > u) {
          if (!desde) desde = ahora;
          if (ahora - desde >= sostenido) { estado = 'pausado'; tPausa = ahora; umbralPausa = u; vozMs = 0; return 'pausar'; }
        } else desde = 0;
        return 'nada';
      }
      if (estado === 'pausado') {
        const pasado = ahora - tPausa;
        if (pasado >= esperaEco && rms > Math.max(0.025, umbralPausa * 0.5)) vozMs += dt;
        if (vozMs >= confirmar) { estado = 'confirmado'; return 'confirmar'; }
        if (pasado >= ventana) { estado = 'vigilando'; desde = 0; factor = Math.min(2.5, factor * 1.25); return 'falsa'; }
      }
      return 'nada';
    },
    estado: (): EstadoInterrupcion => estado,
    umbral,
    eco: () => eco,
  };
}
