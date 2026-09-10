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
  cache.set(clave, valor);
  avisar();
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
export function suscribirContenido(alCambiar: () => void): () => void {
  window.addEventListener(EVENTO, alCambiar);
  const canal = supabase
    .channel(`contenido-${Date.now()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'contenido_sitio' }, () => { void cargarContenido(); })
    .subscribe();
  return () => {
    window.removeEventListener(EVENTO, alCambiar);
    try { supabase.removeChannel(canal); } catch { /* nada */ }
  };
}
