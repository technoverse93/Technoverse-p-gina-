// =====================================================================
// TEXTO QUE SE QUEDA EN SU SITIO: se achica hasta caber, no baja ni se corre
// =====================================================================
// Orden del dueño (2026-10-14): «no quiero que los íconos o textos se
// desplacen a abajo o izquierda por sobre tamaño; que se vea atractivo y no
// invasivo». Con la letra del teléfono agrandada, o con un correo larguísimo,
// un rótulo que no cabía se partía en dos renglones (y empujaba todo lo de
// abajo) o se salía de su tarjeta por la izquierda.
//
// La regla de las pantallas densas (Ciberseguridad, «Nueva pestaña»):
//   · el ícono queda anclado (`flex: none`): nada lo mueve;
//   · el rótulo va en UNA línea;
//   · si no cabe, se achica en pasos hasta el mínimo legible, y solo si ni así
//     cabe se corta con «…» (los correos e IDs largos se cortan AL MEDIO, ver
//     `components/ui/TextoMedio.tsx`, para que siga viéndose el dominio).
//
// Cómo se usa: el elemento lleva `data-ajustar` (y, si hace falta, el mínimo en
// píxeles con `data-ajustar-min`; las etiquetas de los botones se ajustan solas), y el
// contenedor de la pantalla llama a `useAjusteDeTextos(ref)`. El CSS (`[data-ajustar]` en admin.css) pone la línea
// única y los puntos suspensivos; esto solo busca el mayor tamaño que cabe.
// Se ajusta ANTES de que el navegador dibuje (efecto de layout y observador de
// cambios), así que no hay un cuadro con el texto desbordado.
// =====================================================================

import { useLayoutEffect, type RefObject } from 'react';

/** Lo que se ajusta: lo marcado con `data-ajustar` y la etiqueta de cualquier botón (`Btn`), que ya va en una línea. */
const SELECTOR = '[data-ajustar], .tv-btn-label';
/** Por debajo de esto (px) un rótulo deja de leerse: ahí manda el «…». */
const MINIMO_DEFECTO = 9;
/** Holgura en px: `scrollWidth` y `clientWidth` son enteros. */
const HOLGURA = 1;

function desborda(el: HTMLElement): boolean {
  return el.scrollWidth > el.clientWidth + HOLGURA;
}

/** Achica `el` al mayor tamaño de letra que cabe en su línea. */
function ajustarUno(el: HTMLElement): void {
  const minimo = Number(el.dataset.ajustarMin) || MINIMO_DEFECTO;
  const base = parseFloat(getComputedStyle(el).fontSize);
  if (!(base > minimo)) return;
  // Búsqueda binaria entre el mínimo y el tamaño de la hoja de estilos: ~6 lecturas.
  let cabe = minimo;
  let noCabe = base;
  for (let i = 0; i < 6 && noCabe - cabe > 0.25; i++) {
    const medio = (cabe + noCabe) / 2;
    el.style.fontSize = `${medio}px`;
    if (desborda(el)) noCabe = medio; else cabe = medio;
  }
  el.style.fontSize = `${cabe}px`;
}

/**
 * Revisa todos los `[data-ajustar]` de `raiz`. Primero todos vuelven al tamaño
 * de la hoja de estilos (así una pantalla que ya no está apretada recupera su
 * letra), luego se lee el layout UNA vez y solo los apretados se tocan.
 */
export function ajustarTodos(raiz: ParentNode): void {
  const nodos = Array.from(raiz.querySelectorAll<HTMLElement>(SELECTOR));
  if (!nodos.length) return;
  for (const n of nodos) n.style.removeProperty('font-size');
  const apretados = nodos.filter(n => n.clientWidth > 0 && desborda(n));
  for (const n of apretados) ajustarUno(n);
}

/**
 * Mantiene ajustados los `[data-ajustar]` de la pantalla `ref`: al montar, cuando
 * React pinta contenido nuevo, cuando cambia su ancho, al cargar las fuentes y al
 * girar o redimensionar.
 */
export function useAjusteDeTextos(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const raiz = ref.current;
    if (!raiz) return;
    let ancho = raiz.clientWidth;
    let cuadro = 0;
    const ahora = () => ajustarTodos(raiz);
    // El tamaño de la ventana se atiende en el siguiente cuadro: tocar el layout
    // dentro de la llamada de un ResizeObserver provoca avisos de «loop».
    const luego = () => { if (!cuadro) cuadro = requestAnimationFrame(() => { cuadro = 0; ahora(); }); };

    ahora();
    // Contenido nuevo (filas, textos que cambian): el observador corre antes de pintar.
    const cambios = new MutationObserver(ahora);
    cambios.observe(raiz, { childList: true, subtree: true, characterData: true });
    const medidas = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (raiz.clientWidth !== ancho) { ancho = raiz.clientWidth; luego(); }
    });
    medidas?.observe(raiz);
    window.addEventListener('resize', luego);
    document.fonts?.ready.then(luego).catch(() => { /* sin API de fuentes: nada que esperar */ });

    return () => {
      cambios.disconnect();
      medidas?.disconnect();
      window.removeEventListener('resize', luego);
      if (cuadro) cancelAnimationFrame(cuadro);
    };
  }, [ref]);
}
