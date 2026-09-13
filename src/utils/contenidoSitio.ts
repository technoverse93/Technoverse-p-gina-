// =====================================================================
// CONTENIDO EDITABLE DEL SITIO — caché + guardado del modo edición
// =====================================================================
// Cada pieza editable de la tienda tiene una CLAVE estable. Aquí se
// mantiene una caché en memoria de lo que hay en la tabla
// `contenido_sitio`; si una clave no tiene valor guardado, la app usa el
// texto por defecto que trae en el código. Un cambio se refleja al
// instante (evento local) y en las otras pestañas (Realtime).
// =====================================================================

import { supabase } from '../supabaseClient';

const cache = new Map<string, string>();
let cargado = false;
const EVENTO = 'technoverse_contenido';

function avisar(): void {
  try { window.dispatchEvent(new CustomEvent(EVENTO)); } catch { /* SSR */ }
}

/** Trae todo el contenido de la base a la caché. Falla en silencio. */
export async function cargarContenido(): Promise<void> {
  try {
    const { data, error } = await supabase.from('contenido_sitio').select('clave,valor');
    if (error) return;
    cache.clear();
    for (const r of data || []) {
      if (r?.clave) cache.set(String(r.clave), r.valor == null ? '' : String(r.valor));
    }
    cargado = true;
    avisar();
  } catch {
    /* sin tabla/red: se usan los textos por defecto del código */
  }
}

export function contenidoCargado(): boolean { return cargado; }

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
          avisar();
        }
      })
      // CAMINO DE RESPALDO: reconciliación por si un cambio no llegó por
      // broadcast (o vino de fuera de la app). Llega más tarde y solo
      // confirma lo que el broadcast ya pintó.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contenido_sitio' }, () => { void cargarContenido(); })
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
