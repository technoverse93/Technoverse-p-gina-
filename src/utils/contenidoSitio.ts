// =====================================================================
// CONTENIDO EDITABLE DEL SITIO — caché + guardado del modo edición
// =====================================================================
// Cada pieza editable de la tienda tiene una CLAVE estable. Aquí se
// mantiene una caché en memoria de lo que hay en la tabla
// `contenido_sitio`; si una clave no tiene valor guardado, la app usa el
// texto por defecto que trae en el código. Un cambio se refleja al
// instante (evento local) y en las otras pestañas (Realtime).
//
// SIN PARPADEOS (pedido del dueño, 2026-10-14): lo editado tiene que salir
// DEFINITIVO en el primer dibujo, no «texto de fábrica» y a los pocos
// instantes el editado. Por eso la caché se llena ANTES de que React dibuje:
//   1. con lo que el Worker dejó dentro del HTML (previoDelSitio.ts): es lo
//      más reciente y es lo único que cuenta como «fresco»;
//   2. si no hubo, con la última copia guardada en este aparato;
//   3. si no hay copia (o puede estar vieja), la tienda espera un instante la
//      respuesta de Supabase antes de dibujar (ver ModoEdicionProvider).
// =====================================================================

import { supabase } from '../supabaseClient';
import { contenidoPrevio } from './previoDelSitio';

const cache = new Map<string, string>();
const EVENTO = 'technoverse_contenido';

// La copia que se guarda en este aparato. Es contenido público (el mismo
// que ve cualquiera en la tienda): no hay nada privado aquí.
const CLAVE_COPIA = 'technoverse_contenido_sitio';
const VERSION_COPIA = 1;

/** Lo que hay en la caché es tan nuevo como la página (vino con el HTML o ya se leyó de Supabase). */
let fresco = false;
/** Había una copia guardada en este aparato al arrancar (puede estar vieja). */
let hayCopiaLocal = false;

function avisar(): void {
  try { window.dispatchEvent(new CustomEvent(EVENTO)); } catch { /* SSR */ }
}

function guardarCopia(): void {
  try {
    window.localStorage.setItem(CLAVE_COPIA, JSON.stringify({ v: VERSION_COPIA, c: Object.fromEntries(cache) }));
  } catch { /* almacenamiento lleno o bloqueado: solo se pierde la copia */ }
}

/** Llena la caché antes del primer dibujo (se ejecuta al cargar el módulo). */
function hidratar(): void {
  if (typeof window === 'undefined') return;
  try {
    const bruto = window.localStorage.getItem(CLAVE_COPIA);
    const copia = bruto ? JSON.parse(bruto) : null;
    if (copia && copia.v === VERSION_COPIA && copia.c && typeof copia.c === 'object') {
      for (const [clave, valor] of Object.entries(copia.c as Record<string, unknown>)) {
        cache.set(clave, valor == null ? '' : String(valor));
      }
      hayCopiaLocal = true;
    }
  } catch { /* copia ilegible: se sigue sin ella */ }

  // Lo que vino con la página es más nuevo que la copia y manda sobre ella.
  const previo = contenidoPrevio();
  if (previo) {
    cache.clear();
    for (const [clave, valor] of Object.entries(previo)) cache.set(clave, valor);
    fresco = true;
    guardarCopia();
  }
}

hidratar();

function igualALaCache(nuevo: Map<string, string>): boolean {
  if (nuevo.size !== cache.size) return false;
  for (const [clave, valor] of nuevo) if (cache.get(clave) !== valor) return false;
  return true;
}

let enCurso: Promise<void> | null = null;
// Llegó un aviso de cambio mientras había una lectura en vuelo: esa pudo salir
// ANTES del cambio, así que al terminar se lee otra vez.
let leerOtraVez = false;

/**
 * Trae todo el contenido de la base a la caché. Falla en silencio. Si ya hay
 * una lectura en marcha, devuelve ESA (no se repite el pedido). Avisa a los
 * componentes solo si algo cambió de verdad: lo que ya se dibujó bien no se
 * toca.
 */
export function cargarContenido(): Promise<void> {
  if (enCurso) return enCurso;
  enCurso = (async () => {
    try {
      const { data, error } = await supabase.from('contenido_sitio').select('clave,valor');
      if (error) return;
      const nuevo = new Map<string, string>();
      for (const r of data || []) {
        if (r?.clave) nuevo.set(String(r.clave), r.valor == null ? '' : String(r.valor));
      }
      fresco = true;
      if (igualALaCache(nuevo)) {
        if (!hayCopiaLocal) { guardarCopia(); hayCopiaLocal = true; }
        return;
      }
      cache.clear();
      for (const [clave, valor] of nuevo) cache.set(clave, valor);
      guardarCopia();
      hayCopiaLocal = true;
      avisar();
    } catch {
      /* sin tabla/red: se usan los textos por defecto del código */
    } finally {
      enCurso = null;
      if (leerOtraVez) { leerOtraVez = false; void cargarContenido(); }
    }
  })();
  return enCurso;
}

/** Recarga por un aviso de cambio (Realtime): nunca se pierde, aunque ya haya una lectura en vuelo. */
function recargarPorCambio(): void {
  if (enCurso) { leerOtraVez = true; return; }
  void cargarContenido();
}

/** ¿La caché ya es tan nueva como la página? (Vino con el HTML o ya se leyó de Supabase.) */
export function contenidoFresco(): boolean {
  return fresco;
}

/** ¿Hay una copia guardada en este aparato (aunque pueda estar vieja)? */
export function hayContenidoLocal(): boolean {
  return hayCopiaLocal;
}

/**
 * Espera a que la caché sea fresca, con tope de tiempo. Nunca lanza: si no
 * llegó a tiempo, quien la llamó sigue con lo que haya (copia guardada o
 * textos de fábrica) y todo se corrige solo cuando la respuesta llegue.
 */
export function esperarContenido(topeMs: number): Promise<void> {
  if (fresco) return Promise.resolve();
  return new Promise<void>(resolver => {
    const reloj = setTimeout(resolver, topeMs);
    void cargarContenido().then(() => { clearTimeout(reloj); resolver(); });
  });
}

// Sin la página ya hecha (servidor de desarrollo, la APK, o el Worker no
// alcanzó a leer) la lectura arranca YA, al cargar el módulo, y no cuando
// React ya se montó: así llega antes de que haga falta.
if (typeof window !== 'undefined' && !fresco) void cargarContenido();

/** Valor guardado para la clave, o el `defecto` si no hay (o está vacío). */
export function obtenerContenido(clave: string, defecto: string): string {
  const v = cache.get(clave);
  return v == null || v === '' ? defecto : v;
}

/** Guarda (upsert) un valor. Actualiza la caché de inmediato y persiste. */
export async function guardarContenido(
  clave: string,
  valor: string,
  tipo: 'texto' | 'color' | 'icono' = 'texto',
  porQuien?: string | null
): Promise<void> {
  // 1. UI local a 0 ms (caché + evento).
  cache.set(clave, valor);
  guardarCopia();
  avisar();
  // 2. Aviso instantáneo a las OTRAS pestañas/administradores por broadcast
  //    (<50 ms), sin esperar a la base ni recargar toda la tabla.
  enviarBroadcast(clave, valor);
  // 3. Persistencia en segundo plano.
  const { error } = await supabase
    .from('contenido_sitio')
    .upsert({ clave, valor, tipo, updated_at: new Date().toISOString(), updated_by: porQuien || null });
  if (error) throw error;
}

/**
 * Escucha cambios: los locales (mismo aparato, evento) y los remotos (otra
 * pestaña u otro admin, Realtime, que recarga la caché). Devuelve la
 * función para dejar de escuchar.
 */
// UN SOLO canal de Realtime para TODO el contenido, compartido por todos
// los componentes editables.
//
// FALLO CORREGIDO (pantalla en blanco): antes cada componente abría su
// propio canal `contenido-${Date.now()}`. Cuando dos montaban en el mismo
// milisegundo el nombre colisionaba; supabase-js devuelve el MISMO canal
// para un nombre repetido, y llamar `.on()` sobre uno ya suscrito lanza
// "cannot add postgres_changes after subscribe()". Esa excepción tumbaba
// el render entero. Con un único canal de nombre fijo eso no puede pasar.
let canalRealtime: any = null;
let suscriptores = 0;

function abrirCanalRealtime(): void {
  if (canalRealtime) return;
  try {
    canalRealtime = supabase
      // `self: false`: quien edita ya aplicó el cambio local; no necesita
      // recibir su propio broadcast de vuelta.
      .channel('contenido_sitio_global', { config: { broadcast: { self: false } } })
      // CAMINO RÁPIDO (<50 ms): el que edita difunde el cambio y las demás
      // pestañas lo aplican directo a la caché, sin recargar la tabla.
      .on('broadcast', { event: 'set' }, ({ payload }: any) => {
        if (payload && typeof payload.clave === 'string') {
          cache.set(payload.clave, payload.valor == null ? '' : String(payload.valor));
          guardarCopia();
          avisar();
        }
      })
      // CAMINO DE RESPALDO: reconciliación por si un cambio no llegó por
      // broadcast (o vino de fuera de la app). Llega más tarde y solo
      // confirma lo que el broadcast ya pintó.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contenido_sitio' }, () => { recargarPorCambio(); })
      .subscribe();
  } catch {
    // Si el canal no se pudo abrir, el contenido igual funciona: solo se
    // pierde el reflejo en vivo. NUNCA debe tumbar la app.
    canalRealtime = null;
  }
}

/** Difunde un cambio a las otras pestañas por el canal compartido. */
function enviarBroadcast(clave: string, valor: string): void {
  try {
    abrirCanalRealtime();
    canalRealtime?.send({ type: 'broadcast', event: 'set', payload: { clave, valor } });
  } catch {
    /* si el canal no está listo, la reconciliación por postgres_changes cubre */
  }
}

/**
 * Como `suscribirContenido`, pero SOLO escucha la caché de este aparato: no abre
 * el canal de Realtime. Para lo que corre en el arranque de toda la app (la
 * paleta de marca) y no debe abrir una conexión por sí solo; los cambios en
 * vivo le llegan cuando algún componente editable ya la tiene abierta.
 */
export function alCambiarContenido(alCambiar: () => void): () => void {
  window.addEventListener(EVENTO, alCambiar);
  return () => window.removeEventListener(EVENTO, alCambiar);
}

export function suscribirContenido(alCambiar: () => void): () => void {
  window.addEventListener(EVENTO, alCambiar);
  suscriptores++;
  abrirCanalRealtime();
  return () => {
    window.removeEventListener(EVENTO, alCambiar);
    suscriptores = Math.max(0, suscriptores - 1);
    if (suscriptores === 0 && canalRealtime) {
      try { supabase.removeChannel(canalRealtime); } catch { /* nada */ }
      canalRealtime = null;
    }
  };
}
