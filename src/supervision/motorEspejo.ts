// =====================================================================
// MOTOR DEL ESPEJO — la parte común de toda transmisión de pantalla
// =====================================================================
// Lo usan los dos lados que transmiten:
//
//   · grabador.ts   → el PERSONAL, en el canal `espejo:<user_id>`.
//   · visitante.ts  → quien navega la TIENDA, en `espejo:v:<aparato>`.
//
// Aquí vive todo lo que ambos comparten y que costó afinar: las opciones
// de rrweb, la compresión, el troceado, la cadencia de envío y la
// reacción al cambio de tema. Tenerlo una sola vez evita que un arreglo
// se aplique en un lado y se olvide en el otro.
//
// CÓMO VIAJA: por BROADCAST en un canal privado, sin tocar la base. Los
// eventos van comprimidos con el empaquetador de rrweb y troceados, para
// no chocar nunca con el tamaño máximo de un mensaje.
// =====================================================================

import { supabase } from '../supabaseClient';

/** Tope por mensaje. El límite real de Realtime es mayor; se deja holgura
 *  para las cabeceras y para el peor caso de compresión. */
const TROZO_MAX = 120_000;

export interface OpcionesEspejo {
  /** Canal privado por el que sale el espejo. */
  topic: string;
  /**
   * Camino alternativo si el canal no llegara a establecerse. El personal
   * lo tiene (insertar en `supervision_events`); un visitante anónimo no,
   * porque no puede escribir en esa tabla.
   */
  respaldo?: (lote: any[]) => Promise<void>;
}

export interface Espejo {
  arrancar(): Promise<void>;
  parar(): Promise<void>;
  transmitiendo(): boolean;
  /** Cierra el canal. Llamar al terminar del todo. */
  cerrar(): void;
}

export function crearEspejo({ topic, respaldo }: OpcionesEspejo): Espejo {
  let canal: any = null;
  let canalListo = false;
  let detener: (() => void) | null = null;
  let flushTimer: ReturnType<typeof setInterval> | null = null;
  let observadorTema: MutationObserver | null = null;
  let tomarFoto: ((isCheckout?: boolean) => void) | null = null;
  let buffer: any[] = [];
  let activo = false;

  function abrirCanal(): void {
    if (canal) return;
    try {
      canal = supabase.channel(topic, { config: { private: true } });
      canal.subscribe((estado: string) => { canalListo = estado === 'SUBSCRIBED'; });
    } catch { canalListo = false; }
  }

  async function enviar(lote: any[]): Promise<void> {
    if (lote.length === 0) return;

    if (canal && canalListo) {
      try {
        const cuerpo = JSON.stringify(lote);
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const partes = Math.ceil(cuerpo.length / TROZO_MAX) || 1;
        for (let i = 0; i < partes; i++) {
          await canal.send({
            type: 'broadcast',
            event: 'lote',
            payload: { id, i, n: partes, d: cuerpo.slice(i * TROZO_MAX, (i + 1) * TROZO_MAX) },
          });
        }
        return;
      } catch { /* el canal falló: se intenta el respaldo */ }
    }

    if (respaldo) { try { await respaldo(lote); } catch { /* lote perdido */ } }
  }

  async function volcar(): Promise<void> {
    if (buffer.length === 0) return;
    const lote = buffer;
    buffer = [];
    await enviar(lote);
  }

  /**
   * El cambio de tema (claro/oscuro) es una clase que se pone y se quita
   * en <html>. Esa mutación global reescribe de golpe cómo se pinta TODO
   * el documento, y el espejo se quedaba en blanco hasta la siguiente
   * foto automática.
   *
   * Aquí se vigila el <html> y, en cuanto cambia su `class` o su `style`,
   * se avisa a la consola y se fuerza una foto completa nueva: el espejo
   * se reconstruye con el tema nuevo en el acto.
   */
  function vigilarTema(addCustomEvent: (tag: string, payload: any) => void): void {
    try {
      observadorTema?.disconnect();
      observadorTema = new MutationObserver(() => {
        try {
          addCustomEvent('tema', { clase: document.documentElement.className });
          tomarFoto?.(true);
        } catch { /* si rrweb ya paró, no pasa nada */ }
        void volcar();
      });
      observadorTema.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'style', 'data-theme'],
      });
    } catch { /* sin MutationObserver: se autocura en el checkout periódico */ }
  }

  return {
    transmitiendo: () => activo,

    async arrancar() {
      if (activo) return;
      activo = true;
      buffer = [];
      abrirCanal();
      try {
        const { record, pack, addCustomEvent } = await import('rrweb');
        tomarFoto = (isCheckout?: boolean) => record.takeFullSnapshot?.(isCheckout);

        detener = record({
          emit(evento: any) {
            buffer.push(evento);
            // Umbral bajo: en pantallas con mucho movimiento vuelca
            // enseguida para que el espejo no se atrase.
            if (buffer.length >= 20) void volcar();
          },
          // Comprime cada evento. Sin esto una foto completa con los
          // estilos dentro no cabría en un mensaje del canal.
          packFn: pack,
          recordCanvas: false,
          collectFonts: false,
          // Deja las hojas de estilo dentro de la foto: sin esto el panel
          // interior podía renderizarse sin estilos y verse "en blanco".
          inlineStylesheet: true,
          maskAllInputs: false,
          // 'all' emite CADA tecla en vivo. El valor por defecto ('last')
          // solo manda el contenido del input al perder el foco.
          sampling: { input: 'all' },
          // Foto COMPLETA cada 12 s: si la consola se engancha tarde, se
          // autocura en el próximo checkout en vez de quedar en blanco.
          checkoutEveryNms: 12000,
        }) || null;

        vigilarTema(addCustomEvent);

        // 100 ms: con el canal de broadcast el viaje ya no pasa por la
        // base, así que el único retraso que queda es este intervalo.
        flushTimer = setInterval(() => void volcar(), 100);
        setTimeout(() => void volcar(), 0);
      } catch {
        activo = false;
      }
    },

    async parar() {
      if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
      if (observadorTema) { try { observadorTema.disconnect(); } catch { /* nada */ } observadorTema = null; }
      if (detener) { try { detener(); } catch { /* ya parado */ } detener = null; }
      tomarFoto = null;
      await volcar();
      buffer = [];
      activo = false;
    },

    cerrar() {
      if (canal) { try { supabase.removeChannel(canal); } catch { /* nada */ } canal = null; }
      canalListo = false;
    },
  };
}
