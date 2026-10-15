// =====================================================================
// MÉTRICAS DE LOS BANNERS (vistas y clics)
// =====================================================================
// La tienda cuenta CUÁNTAS veces se vio y se tocó cada banner, sin guardar nada de la persona: solo dos
// números por banner (supabase/migracion_banners_motor.sql: `banner_metricas` y la función `banner_evento`).
//   · Una VISTA por banner y por sesión del navegador (sessionStorage), cuando al menos la mitad del banner
//     estuvo en pantalla casi un segundo.
//   · Un CLIC cada vez que se toca el banner o su botón.
// El personal logueado no cuenta (lo decide la base). Si la migración no está aplicada la función no existe:
// se apaga en silencio hasta recargar, sin errores ni reintentos. Es «disparar y olvidar»: nunca bloquea nada.
//
// El panel (solo personal) lee los totales con `leerMetricasBanners()`.
// =====================================================================

import { supabase } from '../supabaseClient';

export interface MetricasBanner { vistas: number; clics: number }

let apagadas = false;

function faltaLaFuncion(error: any): boolean {
  return /PGRST202|PGRST205|42883|42P01|Could not find|does not exist/i.test(`${error?.code || ''} ${error?.message || ''}`);
}

/** Anota un evento. Seguro de llamar siempre: nunca lanza. */
export function registrarEventoBanner(id: string, tipo: 'vista' | 'clic'): void {
  if (apagadas || !id) return;
  try {
    void supabase.rpc('banner_evento', { p_id: id, p_tipo: tipo }).then(
      ({ error }) => { if (error && faltaLaFuncion(error)) apagadas = true; },
      () => { /* sin red: se pierde un conteo, nada más */ },
    );
  } catch { /* nada */ }
}

/** ¿Ya se contó la vista de este banner en esta sesión? (y la deja anotada) */
export function marcarVistaEnSesion(id: string): boolean {
  const clave = `tv_banner_visto_${id}`;
  try {
    if (sessionStorage.getItem(clave) === '1') return false;
    sessionStorage.setItem(clave, '1');
  } catch { /* sin sessionStorage: se cuenta una vez por montaje */ }
  return true;
}

/** Totales por banner (solo el personal puede leerlos). `null` = la migración no está aplicada. */
export async function leerMetricasBanners(): Promise<Record<string, MetricasBanner> | null> {
  try {
    const { data, error } = await supabase.from('banner_metricas').select('banner_id,vistas,clics');
    if (error) return null;
    const salida: Record<string, MetricasBanner> = {};
    for (const f of data || []) salida[String((f as any).banner_id)] = { vistas: Number((f as any).vistas) || 0, clics: Number((f as any).clics) || 0 };
    return salida;
  } catch { return null; }
}
