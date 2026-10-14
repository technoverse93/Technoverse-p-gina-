/**
 * =====================================================================
 * LO QUE EL BORDE LE DEJA AL NAVEGADOR DENTRO DEL HTML
 * =====================================================================
 * El dueño lo vio en un video (2026-10-14): al abrir la tienda salía el
 * texto de fábrica («Estamos renovando el inventario…»), el logo viejo y el
 * ícono viejo, y a los pocos instantes cambiaban a lo que él ya había
 * editado. Un refrescamiento tras otro.
 *
 * Por qué pasaba: lo editable (`contenido_sitio`) y la configuración
 * pública (`app_settings`: logo, teléfono, horario) viven en Supabase, y la
 * página los pedía DESPUÉS de dibujar la primera pantalla. En una visita
 * nueva —y su equipo borra los datos del navegador al cerrarlo, así que para
 * él TODA visita es nueva— no hay nada guardado que pintar antes.
 *
 * Qué se hace aquí: este Worker ya corre delante del HTML en cada visita,
 * así que de paso lee esas dos tablas (en paralelo con el HTML, sin sumar
 * espera) y las deja dentro de la página en una etiqueta de DATOS
 * (`<script type="application/json">`). Esa etiqueta no se ejecuta, así que
 * la política de seguridad (CSP) no la toca. El navegador la lee antes de
 * dibujar (src/utils/previoDelSitio.ts) y la primera pantalla ya sale
 * definitiva.
 *
 * REGLA DE ORO (la misma del portero): esto NUNCA puede tumbar el sitio.
 * Si Supabase tarda, falla o devuelve algo raro, la página se entrega tal
 * cual y el navegador cae a su propio camino (pide los datos y espera un
 * instante antes de dibujar). Todo con tope de tiempo y sin lanzar errores.
 * =====================================================================
 */

import { CATEGORIAS_REPUESTO } from '../utils/categorias';

/** Lo que viaja dentro de la página. */
export interface PrevioDelSitio {
  v: 1;
  /** Cuándo se leyó (ms desde 1970). */
  t: number;
  /** Contenido editable del sitio: { clave: valor }. */
  c: Record<string, string>;
  /** Configuración pública (columnas tal cual de `app_settings`), o null. */
  s: Record<string, unknown> | null;
  /**
   * `true` SOLO si se comprobó que la tienda pública no tiene nada que
   * mostrar (ni un artículo con existencias fuera de las categorías de
   * repuestos). Con eso una visita nueva dibuja «Sin artículos disponibles»
   * de una vez, en vez de un esqueleto y recién después ese mensaje. Si no se
   * pudo comprobar, no viene.
   */
  vacio?: true;
}

// Solo lo que ya ve cualquiera en la tienda. NO va `instagram_webhook_url`:
// es una dirección de servicio, no sirve para dibujar nada.
const COLUMNAS_AJUSTES =
  'cedula_juridica,company_phone,company_address,workshop_address,pickup_hours,max_stock_limit,store_logo';

// Lo MISMO que la tienda esconde del público (src/components/PublicStore.tsx,
// `visiblesEnTienda`): repuestos y artículos sin existencias. La base ya
// oculta los inactivos a cualquier visitante. Pedir de más es seguro (a lo
// sumo se muestra un esqueleto un instante); pedir de menos no lo sería.
const CATEGORIAS_ESCONDIDAS = [...CATEGORIAS_REPUESTO, 'Repuestos'];
const RUTA_CATALOGO =
  'products?select=id&stock=gt.0&limit=1&category=not.in.(' +
  CATEGORIAS_ESCONDIDAS.map(c => `%22${encodeURIComponent(c)}%22`).join(',') +
  ')';

// Tope de espera por la lectura. Por encima de esto la página sale sin ella.
const TOPE_LECTURA_MS = 700;

// Cuánto se reusa la última lectura dentro del mismo Worker (visitas
// seguidas no vuelven a preguntarle a la base) y cuánto vale como respaldo
// si Supabase falla justo ahora. Un cambio del dueño llega en segundos.
const VIGENCIA_MS = 4000;
const RESPALDO_MS = 10 * 60 * 1000;

// Un logo gigante inflaría cada visita: por encima de esto se omite y el
// navegador lo toma de su propia copia o de la base.
const MAX_LOGO_CARACTERES = 60_000;

// Solo el dato ya leído (texto plano) se comparte entre visitas. Una promesa
// en vuelo NO: un Worker no debe esperar I/O que inició otra visita.
let ultimo: { en: number; datos: PrevioDelSitio } | null = null;

async function pedir(base: string, llave: string, ruta: string, senal: AbortSignal): Promise<unknown> {
  const r = await fetch(`${base}/rest/v1/${ruta}`, {
    headers: { apikey: llave, Authorization: `Bearer ${llave}`, Accept: 'application/json' },
    signal: senal,
  });
  if (!r.ok) return null;
  return r.json();
}

async function leer(base: string, llave: string): Promise<PrevioDelSitio | null> {
  const abortar = new AbortController();
  const reloj = setTimeout(() => abortar.abort(), TOPE_LECTURA_MS);
  try {
    const [filas, ajustes, catalogo] = await Promise.all([
      pedir(base, llave, 'contenido_sitio?select=clave,valor', abortar.signal).catch(() => null),
      pedir(base, llave, `app_settings?select=${COLUMNAS_AJUSTES}&id=eq.true&limit=1`, abortar.signal).catch(() => null),
      pedir(base, llave, RUTA_CATALOGO, abortar.signal).catch(() => null),
    ]);
    // Sin el contenido no hay nada que adelantar (la lista vacía SÍ vale: es
    // un sitio sin ediciones y el navegador sabrá que no debe esperar).
    if (!Array.isArray(filas)) return null;

    const c: Record<string, string> = {};
    for (const f of filas as { clave?: unknown; valor?: unknown }[]) {
      if (f && typeof f.clave === 'string') c[f.clave] = f.valor == null ? '' : String(f.valor);
    }

    let s: Record<string, unknown> | null = null;
    if (Array.isArray(ajustes) && ajustes[0] && typeof ajustes[0] === 'object') {
      s = { ...(ajustes[0] as Record<string, unknown>) };
      if (typeof s.store_logo === 'string' && s.store_logo.length > MAX_LOGO_CARACTERES) delete s.store_logo;
    }
    const previo: PrevioDelSitio = { v: 1, t: Date.now(), c, s };
    // Solo una lista VACÍA y bien formada prueba que no hay nada que mostrar;
    // un error o una respuesta rara no prueba nada.
    if (Array.isArray(catalogo) && catalogo.length === 0) previo.vacio = true;
    return previo;
  } catch {
    return null;
  } finally {
    clearTimeout(reloj);
  }
}

/**
 * La lectura más reciente posible, o null. NUNCA lanza ni tarda más que el
 * tope. Se llama al inicio de la visita y se espera al final, para que corra
 * en paralelo con el resto.
 */
export async function obtenerPrevio(base: string, llave: string): Promise<PrevioDelSitio | null> {
  try {
    const ahora = Date.now();
    if (ultimo && ahora - ultimo.en < VIGENCIA_MS) return ultimo.datos;

    const datos = await leer(base, llave);
    if (datos) {
      ultimo = { en: Date.now(), datos };
      return datos;
    }
    // Falló ahora: lo último que se leyó sirve de respaldo (mejor eso que
    // los textos de fábrica).
    if (ultimo && Date.now() - ultimo.en < RESPALDO_MS) return ultimo.datos;
    return null;
  } catch {
    return null;
  }
}

/** JSON seguro para ir DENTRO de una etiqueta <script> (sin cerrarla ni abrir comentarios). */
function jsonParaHtml(previo: PrevioDelSitio): string {
  return JSON.stringify(previo)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Mete la etiqueta de datos justo antes de `</head>`. Devuelve null si el
 * HTML no tiene esa marca (no es la página que se esperaba): en ese caso se
 * entrega sin tocar.
 */
export function inyectarPrevio(html: string, previo: PrevioDelSitio): string | null {
  const i = html.indexOf('</head>');
  if (i < 0) return null;
  const etiqueta = `<script id="tv-previo" type="application/json">${jsonParaHtml(previo)}</script>`;
  return html.slice(0, i) + etiqueta + html.slice(i);
}

/** ¿Es una página de la aplicación (y no un archivo suelto ni la ventanita de Jarvis)? */
export function esPaginaDeLaApp(ruta: string): boolean {
  if (ruta === '/index.html') return true;
  const ultimoTramo = ruta.split('/').pop() || '';
  return !ultimoTramo.includes('.');
}

/**
 * Devuelve la misma respuesta con los datos dentro del HTML. Si algo no
 * cuadra (no es 200, no es HTML, vino comprimida, no tiene `</head>`) se
 * devuelve la ORIGINAL sin tocar.
 */
export async function conPrevio(respuesta: Response, previo: PrevioDelSitio): Promise<Response> {
  try {
    if (respuesta.status !== 200) return respuesta;
    if (!(respuesta.headers.get('Content-Type') || '').includes('text/html')) return respuesta;

    // Se lee una COPIA: si no se puede inyectar, la original sigue intacta.
    const html = await respuesta.clone().text();
    const nuevo = inyectarPrevio(html, previo);
    if (!nuevo) return respuesta;

    const h = new Headers(respuesta.headers);
    // El cuerpo cambió de tamaño y ya está en texto plano.
    h.delete('Content-Length');
    h.delete('Content-Encoding');
    h.delete('ETag');
    return new Response(nuevo, { status: 200, statusText: respuesta.statusText, headers: h });
  } catch {
    return respuesta;
  }
}
