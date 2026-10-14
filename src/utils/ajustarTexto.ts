// =====================================================================
// TEXTO QUE SE QUEDA EN SU SITIO: se achica hasta caber, no baja ni se corre
// =====================================================================
// Orden del dueño (2026-10-14): «no quiero que los íconos o textos se
// desplacen a abajo o izquierda por sobre tamaño; que se vea atractivo y no
// invasivo» y, después, «repará ese problema con la letra en todo el sistema».
// Con la letra del teléfono agrandada, o con un correo larguísimo, un rótulo que
// no cabía se partía en dos renglones (y empujaba todo lo de abajo) o se salía de
// su tarjeta por la izquierda.
//
// La regla (vale para TODO el panel y la tienda):
//   · el ícono queda anclado (`flex: none`): nada lo mueve;
//   · el rótulo va en UNA línea;
//   · si no cabe, se achica en pasos hasta el mínimo legible, y solo si ni así
//     cabe se corta con «…» (los correos e IDs largos se cortan AL MEDIO, ver
//     `components/ui/TextoMedio.tsx`, para que siga viéndose el dominio).
//
// Cómo se usa: el elemento lleva `data-ajustar` o la clase `tv-1l` (y, si hace falta, el
// mínimo en píxeles con `data-ajustar-min`). Las piezas del kit del panel (`Stat`,
// `Card`, `PageHead`, `Field`, `Chip`, `Btn`…) ya lo traen. El CSS (admin.css, «UNA
// LÍNEA») pone la línea única y los puntos suspensivos; esto solo busca el mayor tamaño
// que cabe.
//
// Quién lo corre: UN solo vigía para toda la página (`instalarAjusteGlobal`, se arranca
// en `main.tsx`). Mira lo que React pinta —también los modales y los portales— y ajusta
// ANTES de que el navegador dibuje, así que no hay un cuadro con el texto desbordado.
// Una pantalla puede además registrar su raíz con `useAjusteDeTextos(ref)`: se vuelve a
// ajustar entera cuando cambia lo que tiene dentro o su ancho (una pestaña oculta que
// vuelve a verse, el teléfono que gira).
// =====================================================================

import { useLayoutEffect, type RefObject } from 'react';

/** Lo que se ajusta: lo marcado, las etiquetas de botón y los rótulos de las piezas del kit del panel. */
const SELECTOR = [
  '[data-ajustar]', '.tv-1l', '[data-tv1l]', '.tv-btn-label',
  '.tv-stat-lt', '.tv-stat-value', '.tv-stat-foot', '.tv-chip', '.tv-card-title',
  '.tv-cabecera-t', '.tv-cabecera .tv-pista', '.tv-field > .tv-label', '.tv-field > .tv-hint', '.tv-folder-label',
].join(', ');
/**
 * Piso de lectura, en píxeles QUE SE VEN: un rótulo no se achica por debajo de esto (ahí manda el «…») ni por debajo de
 * `PISO_RELATIVO` de su tamaño de diseño. Medirlo en lo que se ve —y no en lo que declara el CSS— importa con la letra
 * grande del sistema: un pie de 12 px que el teléfono dibuja a 18 px puede bajar hasta ~10 px, pero no hasta los 6 px
 * «declarados» que dibujarían 9 px. El mínimo propio de un elemento (`data-ajustar-min`) también es en píxeles que se ven.
 */
const MINIMO_DEFECTO = 10;
const PISO_RELATIVO = 0.85;
/** Holgura en px: `scrollWidth` y `clientWidth` son enteros. */
const HOLGURA = 1;
/** Contenedores que se vuelven a ajustar enteros cuando algo cambia dentro (los vecinos de un rótulo cambian su ancho). */
const ZONA = '.tv-card, .tv-stat, li, tr, [role="tab"], [role="row"], section, header, nav, label, button, form, dialog, article, details';

/** El `font-size` en línea que el elemento traía antes de ajustarse (lo pone el JSX, no nosotros). */
const ORIGINAL = new WeakMap<HTMLElement, string>();

function desborda(el: HTMLElement): boolean {
  return el.scrollWidth > el.clientWidth + HOLGURA;
}

/**
 * Cuánto agranda el aparato un tamaño de letra declarado: 1 normalmente, 1,3 o 1,5 con la letra grande del sistema.
 * Se mide con una sonda oculta, la misma que ve crecer cualquier otro texto.
 */
let sonda: HTMLElement | null = null;
function escalaDeLetra(): number {
  if (!sonda) {
    sonda = document.createElement('span');
    sonda.setAttribute('aria-hidden', 'true');
    sonda.style.position = 'absolute';
    sonda.style.visibility = 'hidden';
    sonda.style.pointerEvents = 'none';
    sonda.style.width = '0';
    sonda.style.height = '0';
    sonda.style.overflow = 'hidden';
    sonda.style.fontSize = '100px';
    sonda.textContent = 'A';
  }
  if (!sonda.isConnected) document.body.appendChild(sonda);
  const f = parseFloat(getComputedStyle(sonda).fontSize) / 100;
  return f > 0 ? f : 1;
}

/** Devuelve el elemento al tamaño de la hoja de estilos (o al que le puso el JSX): solo deshace lo que puso este módulo. */
function restaurar(el: HTMLElement): void {
  const previo = ORIGINAL.get(el);
  if (previo === undefined) return; // nunca se tocó: nada que devolver
  if (previo) el.style.fontSize = previo; else el.style.removeProperty('font-size');
}

/**
 * Lo que se calculó para un rótulo: con las medidas de la hoja de estilos (`cw` = ancho de su caja, `sw` = ancho de su texto
 * en una línea) y la letra del sistema `f`, el tamaño que le cabe es `px`. Si nada de eso cambió, el resultado es el mismo y
 * no hace falta volver a medir (una pasada que no encuentra cambios no toca el layout).
 */
const MEMO = new WeakMap<HTMLElement, { cw: number; sw: number; f: number; px: string }>();
/** Cómo quedó cada rótulo ajustado (caja, largo del texto, letra del sistema y tamaño): si sigue igual, ya está hecho. */
const FIJADO = new WeakMap<HTMLElement, { w: number; largo: number; f: number; px: string }>();

function yaFijado(el: HTMLElement, f: number): boolean {
  const r = FIJADO.get(el);
  return !!r && r.px === el.style.fontSize && r.w === el.clientWidth && r.largo === (el.textContent?.length ?? 0) && r.f === f;
}

/** Achica `el` al mayor tamaño de letra que cabe en su línea (`f` = escala de la letra del sistema). */
function ajustarUno(el: HTMLElement, f: number): void {
  // Siempre se parte del tamaño de la hoja de estilos: así el piso no baja un poco más en cada revisión.
  restaurar(el);
  const cw = el.clientWidth;
  const sw = el.scrollWidth;
  const memo = MEMO.get(el);
  if (memo && memo.cw === cw && memo.sw === sw && memo.f === f) {
    if (memo.px) el.style.fontSize = memo.px;
    FIJADO.set(el, { w: el.clientWidth, largo: el.textContent?.length ?? 0, f, px: el.style.fontSize });
    return;
  }
  // Tamaño con que la hoja de estilos dibuja el rótulo (ya con la letra del sistema) y el que DECLARA.
  const dibujado = parseFloat(getComputedStyle(el).fontSize);
  const declarado = dibujado / f;
  const propio = Number(el.dataset.ajustarMin);
  const piso = propio || Math.max(MINIMO_DEFECTO, declarado * PISO_RELATIVO);
  const minimo = Math.min(piso / f, declarado);
  if (!(declarado > minimo)) return;
  if (!ORIGINAL.has(el)) ORIGINAL.set(el, el.style.fontSize);
  // El ancho de una línea de texto crece en proporción a su letra: el tamaño que cabe sale de una regla de tres y se
  // comprueba (casi siempre 1-2 lecturas del layout en vez de las 6 de una búsqueda binaria). Se achica un poco de más
  // (1 %) para no quedar a un píxel del borde.
  let x = declarado;
  let ancho = sw;
  let caja = cw;
  for (let i = 0; i < 4; i++) {
    if (ancho <= caja + HOLGURA) break;
    x = Math.max(minimo, x * (caja / ancho) * 0.99);
    el.style.fontSize = `${x}px`;
    if (x <= minimo) break;
    ancho = el.scrollWidth;
    caja = el.clientWidth;
  }
  MEMO.set(el, { cw, sw, f, px: el.style.fontSize });
  FIJADO.set(el, { w: el.clientWidth, largo: el.textContent?.length ?? 0, f, px: el.style.fontSize });
}

// ---------------------------------------------------------------------
// CURACIÓN: un rótulo corto que la letra grande parte en dos renglones pasa a ir en uno
// ---------------------------------------------------------------------
// Casi todo el panel y la tienda están escritos con utilidades sueltas (Tailwind), no con las
// piezas del kit: a un botón, un título o un contador nadie le puso `tv-1l`. Con la letra grande
// del sistema esos rótulos cortos se parten («Exportar / CSV») y empujan lo que tienen al lado.
// Esto los encuentra por lo que hacen, no por quién los escribió: un texto CORTO que hoy ocupa dos
// o más renglones se marca con `data-tv1l`
// (el CSS le pone la línea única) y entra al ajuste de tamaño como cualquier otro rótulo.
//
// Lo que NO toca, a propósito:
//   · nada si la letra del sistema es la normal: lo que se parte a tamaño normal está pensado así;
//   · lo que en una línea mediría más del doble del ancho que tiene (cortarlo con «…» ocultaría demasiado);
//   · los párrafos (más de `largoMaximo` caracteres, o con bloques dentro), que fluyen en varios renglones;
//   · lo marcado a mano (`data-no-1l`), lo editable y los campos de formulario.
/** Elementos que pueden ser un rótulo: se miran todos y solo se «curan» los que de verdad se parten. */
const CANDIDATOS = 'button, [role="button"], [role="tab"], summary, th, label, h1, h2, h3, h4, h5, h6, span, p, div, a, b, strong, small, em, li';
/**
 * Un rótulo es corto; más largo que esto es un texto que SÍ debe fluir en varios renglones. Las etiquetas de campo, los
 * controles y los títulos aguantan más que un texto suelto: son rótulos por naturaleza.
 */
function largoMaximo(el: HTMLElement): number {
  if (el.tagName === 'LABEL') return 64;
  if (/^(BUTTON|SUMMARY|TH|H[1-6])$/.test(el.tagName) || el.matches('[role="button"], [role="tab"]')) return 48;
  return 36;
}
/** ¿Tiene `el` más de `max` caracteres de texto? Se corta apenas se pasa: un contenedor enorme no se lee entero. */
function textoMasLargoQue(el: HTMLElement, max: number): boolean {
  let n = 0;
  const recorrido = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (recorrido.nextNode()) { n += recorrido.currentNode.textContent?.trim().length ?? 0; if (n > max) return true; }
  return n === 0; // sin texto: tampoco es un rótulo
}
/** Cuántas veces su ancho actual puede medir un rótulo (ya achicado al piso) para que valga la pena dejarlo en una línea. */
const LIMITE_CORTE = 2;
/** Lo que nunca se cura: ya está resuelto a mano, se edita, o es un texto que debe fluir. */
const NO_TOCAR = '[data-ajustar], .tv-1l, [data-tv1l], .tv-btn-label, [contenteditable], [data-no-1l], .tv-clamp-2, textarea, input, select, pre, code, svg';
/** Dentro de un rótulo solo puede haber íconos y énfasis en línea; un bloque dentro lo vuelve un contenido, no un rótulo. */
const BLOQUES = 'p, div, ul, ol, table, form, input, select, textarea, br, img, video, canvas, button, a, h1, h2, h3, h4, h5, h6';
/** Un control (botón, encabezado de tabla…) es un rótulo aunque no tenga hermanos. */
const ES_CONTROL = 'button, summary, th, [role="button"], [role="tab"]';

/**
 * En cuántos renglones se dibuja el texto de `el`: se cuentan los rectángulos de sus nodos de texto
 * (no el alto de la caja, que puede ser fijo). El texto de lo que flota encima (una insignia con su
 * cuenta, un punto de estado) no cuenta: no es parte del rótulo.
 */
function lineasDe(el: HTMLElement): number {
  const tops: number[] = [];
  let alto = 0;
  const recorrido = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (recorrido.nextNode()) {
    const nodo = recorrido.currentNode;
    if (!nodo.textContent?.trim()) continue;
    let flota = false;
    for (let a = nodo.parentElement; a && a !== el; a = a.parentElement) {
      const pos = getComputedStyle(a).position;
      if (pos === 'absolute' || pos === 'fixed') { flota = true; break; }
    }
    if (flota) continue;
    const rango = document.createRange();
    rango.selectNodeContents(nodo);
    for (const r of rango.getClientRects()) if (r.width > 0.5 && r.height > 0.5) { tops.push(r.top); alto = Math.max(alto, r.height); }
  }
  tops.sort((a, b) => a - b);
  let renglones = 0;
  let ultimo = -Infinity;
  for (const t of tops) if (t > ultimo + Math.max(2, alto * 0.5)) { renglones++; ultimo = t; }
  return renglones;
}

/**
 * Lo que ya se miró y no se partía: `ancho` del elemento y largo de su texto en ese momento. Mientras no cambien (ni la letra
 * del sistema), no hace falta volver a medirlo en cada revisión.
 */
const SIN_PARTIR = new WeakMap<HTMLElement, { ancho: number; largo: number; f: number }>();

/** Marca con `data-tv1l` los rótulos cortos de `raiz` que la letra grande parte en 2+ renglones. */
function curarRenglones(raiz: ParentNode, f: number): void {
  if (f < 1.04) return; // letra normal: lo que se parte, se parte por diseño
  // Si `raiz` está dentro de algo que no se cura (un campo editable, un texto con recorte a propósito), nada de lo que tiene se cura.
  if ((raiz as Element).closest?.(NO_TOCAR)) return;
  // Fase 1 · solo estructura (sin leer el layout): ¿puede ser un rótulo?
  const excluidos = new Set<Element>(raiz.querySelectorAll(NO_TOCAR));
  const dentroDeExcluido = (el: Element): boolean => { for (let a: Element | null = el; a && a !== raiz; a = a.parentElement) if (excluidos.has(a)) return true; return false; };
  const posibles: HTMLElement[] = [];
  for (const el of raiz.querySelectorAll<HTMLElement>(CANDIDATOS)) {
    if (el.childElementCount > 4 || textoMasLargoQue(el, largoMaximo(el)) || dentroDeExcluido(el)) continue;
    if (el.querySelector(el.matches(ES_CONTROL) ? 'p, div, ul, ol, table, form, input, select, textarea, br' : BLOQUES)) continue;
    posibles.push(el);
  }
  if (!posibles.length) return;
  // Fase 2 · lecturas del layout (todas juntas, sin escribir entre ellas): ¿hoy se parte?
  const partidos: Array<{ el: HTMLElement; ancho: number }> = [];
  for (const el of posibles) {
    const ancho0 = el.clientWidth;
    if (ancho0 === 0) continue;
    const largo0 = el.textContent?.length ?? 0;
    const visto = SIN_PARTIR.get(el);
    if (visto && visto.ancho === ancho0 && visto.largo === largo0 && visto.f === f) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'inline' || cs.display === 'contents' || (cs.display === 'table-cell' && el.tagName !== 'TH')) continue;
    if (!el.matches(ES_CONTROL)) {
      const padre = el.parentElement;
      if (!padre) continue;
      // En el panel un texto corto que se parte empuja lo de abajo; en la tienda solo si comparte fila con un hermano
      // (un título grande de sección que baja de renglón es parte de su diseño).
      if (!el.closest('#admin-panel-root')) {
        if (/^H[1-6]$/.test(el.tagName) || padre.children.length < 2) continue;
        const pd = getComputedStyle(padre);
        const enFila = (pd.display === 'flex' || pd.display === 'inline-flex') ? !pd.flexDirection.startsWith('column') : pd.display === 'grid' || pd.display === 'inline-grid';
        if (!enFila) continue;
      }
    }
    if (lineasDe(el) >= 2) partidos.push({ el, ancho: ancho0 });
    else SIN_PARTIR.set(el, { ancho: ancho0, largo: largo0, f });
  }
  if (!partidos.length) return;
  // Fase 3 · ¿cuánto mide en UNA línea? (se prueba con `nowrap`, todo junto: una escritura y una lectura)
  const previos = partidos.map(({ el }) => el.style.whiteSpace);
  for (const { el } of partidos) el.style.whiteSpace = 'nowrap';
  const enUnaLinea = partidos.map(({ el }) => el.scrollWidth);
  partidos.forEach(({ el }, i) => { el.style.whiteSpace = previos[i]; });
  // Fase 4 · escrituras.
  partidos.forEach(({ el, ancho }, i) => {
    // Si ni achicado hasta el piso cabría en el doble del ancho que tiene (una columna de 50 px para un rótulo de 200),
    // cortarlo con «…» ocultaría demasiado: ahí es mejor que se parta.
    if (enUnaLinea[i] * PISO_RELATIVO > ancho * LIMITE_CORTE) return;
    el.setAttribute('data-tv1l', '');
    if (!el.title) el.title = el.textContent?.trim() ?? '';
    liberarAncestros(el);
  });
}

/**
 * Un texto que deja de partirse ya no cede ancho por sí solo: si sus contenedores son hijos de una fila flex o de una
 * rejilla y no traen `min-width: 0`, no se encogen por debajo de lo que mide la línea entera y se salen de la caja
 * (un encabezado de modal que se corta por la derecha). Se les quita ese piso con `data-tv-min0` (el CSS lo traduce).
 */
function liberarAncestros(el: HTMLElement): void {
  let a = el.parentElement;
  for (let i = 0; a && i < 8 && a !== document.body; i++, a = a.parentElement) {
    const padre = a.parentElement;
    if (!padre) break;
    const d = getComputedStyle(padre).display;
    if (d === 'flex' || d === 'inline-flex' || d === 'grid' || d === 'inline-grid') a.setAttribute('data-tv-min0', '');
  }
}

/**
 * Revisa todos los rótulos de `raiz` (y a ella misma, si lo es). Primero todos vuelven
 * al tamaño de la hoja de estilos (así una pantalla que ya no está apretada recupera su
 * letra), luego se lee el layout UNA vez y solo los apretados se tocan. Con `soloApretados`
 * no se devuelve nada: solo se achica lo que hoy no cabe.
 */
export function ajustarTodos(raiz: ParentNode, soloApretados = false): void {
  const f = escalaDeLetra();
  curarRenglones(raiz, f);
  const nodos = Array.from(raiz.querySelectorAll<HTMLElement>(SELECTOR));
  if ((raiz as Element).matches?.(SELECTOR)) nodos.unshift(raiz as HTMLElement);
  if (!nodos.length) return;
  // `soloApretados`: lo que ya cabe no se toca (ni se le devuelve su tamaño) → no hay escrituras que obliguen a medir de nuevo.
  // Se usa en las revisiones por cambios de una pantalla; el regreso al tamaño de hoja ocurre al girar, al cargar las fuentes y al montar.
  if (!soloApretados) for (const n of nodos) restaurar(n);
  const apretados = nodos.filter(n => n.clientWidth > 0 && desborda(n) && !(soloApretados && yaFijado(n, f)));
  for (const n of apretados) ajustarUno(n, f);
}

// ---------------------------------------------------------------------
// EL VIGÍA GLOBAL
// ---------------------------------------------------------------------
const raices = new Set<HTMLElement>();
let instalado = false;
/** Cada cuánto, como mucho, se revisa entera una pantalla registrada cuando no paran de llegar cambios (ms). */
const ENTRE_PASADAS = 160;

/**
 * Arranca (una sola vez) el vigía de toda la página: ajusta lo que React pinta, en
 * cualquier lugar —incluidos modales y portales—, antes de que el navegador dibuje.
 */
export function instalarAjusteGlobal(): void {
  if (instalado || typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  instalado = true;
  let cuadro = 0;
  const completo = () => { cuadro = 0; ajustarTodos(document.body); };
  // Cambios de tamaño de ventana/fuentes: se atienden en el siguiente cuadro (tocar el layout dentro de
  // la llamada de un ResizeObserver provoca avisos de «loop»).
  const luego = () => { if (!cuadro) cuadro = requestAnimationFrame(completo); };

  const zonaDe = (n: Node | null): Element | null => {
    const e = !n ? null : n.nodeType === 1 ? (n as Element) : n.parentElement;
    return e ? (e.closest(ZONA) ?? e) : null;
  };
  // Pasada completa de una pantalla registrada: se ajusta de inmediato la primera vez y, si sigue habiendo cambios (un número que
  // se anima en cada cuadro, un reloj), como mucho cada ENTRE_PASADAS ms: lo que cambió ya se ajustó en su zona.
  const ultima = new WeakMap<HTMLElement, number>();
  const diferida = new WeakMap<HTMLElement, number>();
  /** Devuelve `true` si la revisó en este momento (entonces lo que haya dentro ya quedó ajustado). */
  const pasadaCompleta = (raiz: HTMLElement): boolean => {
    const ahora = performance.now();
    const espera = (ultima.get(raiz) ?? -Infinity) + ENTRE_PASADAS - ahora;
    if (espera <= 0) { ultima.set(raiz, ahora); ajustarTodos(raiz, true); return true; }
    if (!diferida.has(raiz)) {
      diferida.set(raiz, window.setTimeout(() => { diferida.delete(raiz); if (raiz.isConnected) { ultima.set(raiz, performance.now()); ajustarTodos(raiz, true); } }, espera));
    }
    return false;
  };
  const vigia = new MutationObserver(registros => {
    const zonas = new Set<Element>();
    const pantallas = new Set<HTMLElement>();
    for (const r of registros) {
      if (r.target.nodeType === 1 && !(r.target as Element).isConnected) continue;
      for (const raiz of raices) if (raiz.contains(r.target)) pantallas.add(raiz);
      if (r.type === 'characterData') { const z = zonaDe(r.target); if (z) zonas.add(z); continue; }
      for (const n of r.addedNodes) { const z = zonaDe(n.nodeType === 1 ? n : r.target); if (z) zonas.add(z); }
      if (r.removedNodes.length) { const z = zonaDe(r.target); if (z) zonas.add(z); }
    }
    // Los vecinos de lo que cambió cambian de ancho: la pantalla entera se revisa (sin saturar: ver ENTRE_PASADAS).
    const hechas = [...pantallas].filter(pasadaCompleta);
    // Lo que cambió fuera de ellas —o dentro de una que hoy se difirió— se ajusta ya, antes de pintar;
    // una zona dentro de otra ya se cubre con la mayor.
    const lista = [...zonas].filter(z => z.isConnected && !hechas.some(h => h.contains(z)));
    for (const z of lista) if (!lista.some(o => o !== z && o.contains(z))) ajustarTodos(z);
  });
  // El observador corre antes de pintar (microtarea): no hay un cuadro con el texto desbordado.
  vigia.observe(document.body, { childList: true, subtree: true, characterData: true });
  window.addEventListener('resize', luego);
  window.addEventListener('orientationchange', luego);
  document.fonts?.ready.then(luego).catch(() => { /* sin API de fuentes: nada que esperar */ });
  // Un acordeón que se abre y una animación que termina cambian el ancho de lo que tienen dentro.
  const alTerminar = (e: Event) => { const z = zonaDe(e.target as Node); if (z) ajustarTodos(z); };
  document.addEventListener('toggle', alTerminar, true);
  document.addEventListener('transitionend', alTerminar, true);
  document.addEventListener('animationend', alTerminar, true);
}

/**
 * Mantiene ajustados los rótulos de la pantalla `ref`: al montar, cuando React pinta
 * contenido nuevo dentro, cuando cambia su ancho (una pestaña oculta que vuelve a verse,
 * el teléfono que gira), al cargar las fuentes y al redimensionar.
 */
export function useAjusteDeTextos(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const raiz = ref.current;
    if (!raiz) return;
    instalarAjusteGlobal();
    raices.add(raiz);
    let ancho = raiz.clientWidth;
    let cuadro = 0;
    const ahora = () => ajustarTodos(raiz);
    const luego = () => { if (!cuadro) cuadro = requestAnimationFrame(() => { cuadro = 0; ahora(); }); };

    ahora();
    const medidas = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (raiz.clientWidth !== ancho) { ancho = raiz.clientWidth; luego(); }
    });
    medidas?.observe(raiz);

    return () => {
      raices.delete(raiz);
      medidas?.disconnect();
      if (cuadro) cancelAnimationFrame(cuadro);
    };
  }, [ref]);
}
