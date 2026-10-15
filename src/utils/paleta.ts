// =====================================================================
// PALETA DE MARCA — Esmeralda · Océano · Atardecer · Orquídea
// =====================================================================
// El tema claro/oscuro (src/utils/tema.ts) es cosa de cada aparato. La
// PALETA es de la MARCA: la elige el dueño en Configuración y la ven todos —
// la tienda y el panel— con sus colores, en claro y en oscuro.
//
// Los colores viven en CSS (index.css para Esmeralda, styles/paletas.css para
// las otras tres) y se activan con `<html data-paleta="…">`. Aquí solo se
// decide CUÁL va puesta y se guarda la elección.
//
// ---------------------------------------------------------------------
// DE DÓNDE VIENE LA ELECCIÓN (sin parpadeo: la tienda no puede abrirse en
// Esmeralda y a los instantes cambiar de color)
// ---------------------------------------------------------------------
//   1. El Worker (src/worker/previo.ts) lee `contenido_sitio.paleta_marca` y
//      deja `data-paleta` YA puesto en el HTML que entrega: es lo más fresco
//      y lo que manda cuando existe.
//   2. Si la página no lo trae (APK, desarrollo, el Worker no alcanzó), el
//      script en línea de index.html (#tv-tema) pone la última paleta que
//      este aparato conoció (`technoverse_paleta`).
//   3. Cuando el contenido del sitio llega (o cambia en vivo, o lo cambia otro
//      administrador), `iniciarPaleta()` lo aplica y lo recuerda.
//
// La elección viaja como una fila más de `contenido_sitio` (clave
// `paleta_marca`): ya es pública, ya llega en el HTML previo y ya se refleja en
// vivo en las otras pestañas. No hace falta una columna ni una tabla nuevas.
// =====================================================================

import { alCambiarContenido, cargarContenido, contenidoFresco, guardarContenido, obtenerContenido } from './contenidoSitio';

export type Paleta = 'esmeralda' | 'oceano' | 'atardecer' | 'orquidea';

export interface InfoPaleta {
  id: Paleta;
  nombre: string;
  /** Dos o tres palabras para el selector (en una sola línea, también con la letra grande). */
  caracter: string;
}

export const PALETAS: InfoPaleta[] = [
  { id: 'esmeralda', nombre: 'Esmeralda', caracter: 'La de siempre' },
  { id: 'oceano', nombre: 'Océano', caracter: 'Azul tecnológico' },
  { id: 'atardecer', nombre: 'Atardecer', caracter: 'Coral cálido' },
  { id: 'orquidea', nombre: 'Orquídea', caracter: 'Violeta premium' },
];

/** Clave de `contenido_sitio` donde queda la elección de la marca. */
export const CLAVE_PALETA = 'paleta_marca';
/** Última paleta que conoció este aparato (index.html la lee antes del primer dibujo). */
const CLAVE_RECUERDO = 'technoverse_paleta';
export const EVENTO_PALETA = 'technoverse_paleta_cambiada';

export function esPaleta(v: unknown): v is Paleta {
  return v === 'esmeralda' || v === 'oceano' || v === 'atardecer' || v === 'orquidea';
}

/** La paleta que está puesta ahora en el documento. */
export function paletaActual(): Paleta {
  try {
    const v = document.documentElement.getAttribute('data-paleta');
    if (esPaleta(v)) return v;
  } catch { /* sin documento */ }
  return 'esmeralda';
}

function recordar(p: Paleta): void {
  try { localStorage.setItem(CLAVE_RECUERDO, p); } catch { /* no es crítico */ }
}

/** Pone la paleta en el documento (y avisa a quien la esté mostrando). */
export function aplicarPaleta(p: Paleta): void {
  const raiz = document.documentElement;
  if (raiz.getAttribute('data-paleta') === p) return;
  raiz.setAttribute('data-paleta', p);
  try { window.dispatchEvent(new CustomEvent(EVENTO_PALETA, { detail: { paleta: p } })); } catch { /* sin eventos */ }
}

/** Lo que dice el contenido del sitio: la paleta elegida, o null si la marca nunca eligió. */
function elegidaPorLaMarca(): Paleta | null {
  const v = obtenerContenido(CLAVE_PALETA, '');
  return esPaleta(v) ? v : null;
}

/**
 * Se llama UNA vez en el arranque, junto al tema. Pone la paleta de la marca
 * en cuanto se sabe y la mantiene al día cuando cambia en vivo.
 */
export function iniciarPaleta(): void {
  const sincronizar = () => {
    const elegida = elegidaPorLaMarca();
    if (elegida) { aplicarPaleta(elegida); recordar(elegida); return; }
    // Nadie eligió. Si el contenido ya es tan nuevo como la página, la marca usa
    // la de siempre (y se olvida una paleta vieja que este aparato recordara);
    // si todavía es una copia vieja del aparato, no se decide nada aún.
    if (contenidoFresco()) { aplicarPaleta('esmeralda'); recordar('esmeralda'); }
  };

  sincronizar();
  alCambiarContenido(sincronizar);
  // Sin la página ya hecha (APK, desarrollo) el contenido llega después: al llegar, se decide.
  if (!contenidoFresco()) void cargarContenido().then(sincronizar);
}

/**
 * Elige la paleta de la marca (solo desde Configuración). Se ve al instante en
 * este aparato y se guarda para todos. Si no se pudo guardar, vuelve a la
 * anterior y lanza el error: no se deja una paleta puesta que nadie más ve.
 */
export async function fijarPaletaDeMarca(p: Paleta, quien?: string | null): Promise<void> {
  const anterior = paletaActual();
  const valorAnterior = obtenerContenido(CLAVE_PALETA, '');
  aplicarPaleta(p);
  recordar(p);
  try {
    await guardarContenido(CLAVE_PALETA, p, 'texto', quien);
  } catch (e) {
    aplicarPaleta(anterior);
    recordar(anterior);
    // La caché ya había tomado el valor nuevo: se deja como estaba (esto vuelve a
    // intentar guardar y puede fallar otra vez, da igual; lo que importa es la caché).
    try { await guardarContenido(CLAVE_PALETA, valorAnterior, 'texto', quien); } catch { /* sin conexión */ }
    throw e;
  }
}
