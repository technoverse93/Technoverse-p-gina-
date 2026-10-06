// =====================================================================
// VENTANAS FLOTANTES DEL PANEL — una sola a la vez, sin tapar la cabecera
// =====================================================================
// Hay dos ventanas que flotan sobre cualquier módulo: el chat (burbuja) y
// Jarvis. Reglas para que nunca se pisen entre ellas ni con el panel:
//
//   · Solo UNA abierta: al abrirse una, la otra se minimiza sola.
//   · Al cambiar de pestaña se minimiza el chat: lo que se abrió para un
//     módulo no queda tapando el siguiente. Jarvis se queda abierto.
//   · En teléfono empiezan DEBAJO de la barra de pestañas. Su alto real se
//     mide (en la APK la barra de estado lo agranda) y queda en la variable
//     CSS `--tv-borde-cab`, que usan las dos ventanas.
// =====================================================================

import { useEffect } from 'react';

const EVENTO = 'tv:capa-flotante';
export type Capa = 'chat' | 'jarvis';

export function avisarCapaAbierta(capa: Capa): void {
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: capa }));
}

/** Llama a `cerrar` cuando se abre otra ventana flotante o cambia la pestaña. */
export function useUnaSolaCapa(capa: Capa, abierta: boolean, cerrar: () => void, pestana?: string): void {
  useEffect(() => {
    if (!abierta) return;
    const otra = (e: Event) => { if ((e as CustomEvent).detail !== capa) cerrar(); };
    window.addEventListener(EVENTO, otra);
    return () => window.removeEventListener(EVENTO, otra);
  }, [abierta, capa, cerrar]);
  useEffect(() => { if (abierta) avisarCapaAbierta(capa); }, [abierta, capa]);
  // Sin `pestana` (Jarvis), cambiar de módulo no la cierra.
  useEffect(() => { if (pestana !== undefined) cerrar(); }, [pestana]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Mide el borde inferior de la barra de pestañas y lo deja en `--tv-borde-cab`. */
export function medirBordeCabecera(cabecera: HTMLElement | null): () => void {
  if (!cabecera) return () => {};
  const fijar = () => {
    const borde = Math.round(cabecera.getBoundingClientRect().bottom) + 8;
    document.documentElement.style.setProperty('--tv-borde-cab', `${borde}px`);
  };
  fijar();
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fijar) : null;
  ro?.observe(cabecera);
  window.addEventListener('resize', fijar);
  return () => { ro?.disconnect(); window.removeEventListener('resize', fijar); };
}
