// =====================================================================
// WEBHOOK DE INSTAGRAM (Zapier) — la dirección es un SECRETO
// =====================================================================
// La dirección del «Catch Hook» de Zapier permite publicar en el Instagram del negocio a quien la tenga,
// así que NO puede vivir en `app_settings`, que cualquiera lee con la llave pública del navegador. Con
// supabase/migracion_ajustes_privados.sql vive en una tabla privada y solo estas tres funciones la tocan:
//   · `leer_webhook_instagram()`  → el dueño la ve completa (para editarla en Configuración);
//   · `guardar_webhook_instagram` → el dueño la cambia (texto vacío = quitarla);
//   · `webhook_instagram_configurado()` → el personal solo sabe si hay una, sin verla.
//
// Mientras esa migración no esté aplicada, las funciones no existen: todo cae al camino de antes (la
// columna `app_settings.instagram_webhook_url` que ya lee y guarda el resto de la app) para que nada
// se rompa en el medio. Nunca se deja una dirección en la caché de ajustes cuando el camino nuevo existe.
// =====================================================================

import { supabase } from '../supabaseClient';

/** ¿El error dice que la función no existe (migración sin aplicar)? */
function faltaLaFuncion(error: any): boolean {
  const m = `${error?.code || ''} ${error?.message || ''}`;
  return /PGRST202|42883|Could not find the function|does not exist/i.test(m);
}

// El panel pide la dirección cada vez que se refrescan sus datos. Sin la migración la función no existe y la
// base respondía 404 cada vez (261 veces en un día): ahora se recuerda unas horas que falta, y si existe se
// guarda la respuesta un minuto y se reparte entre los pedidos que lleguen a la vez.
const CLAVE_FALTA = 'tv_webhook_ig_sin_funcion_v1';
const VIGENCIA_FALTA_MS = 12 * 3_600_000;
const faltaFuncionRecordada = (): boolean => {
  try { const t = Number(localStorage.getItem(CLAVE_FALTA)); return !!t && Date.now() - t < VIGENCIA_FALTA_MS; } catch { return false; }
};
let ultimaLectura: { valor: string | null; t: number } | null = null;
let lecturaEnCurso: Promise<string | null> | null = null;

/** La dirección completa (solo la ve el dueño). `null` = no se pudo leer por el camino nuevo. */
export async function leerWebhookInstagram(): Promise<string | null> {
  if (faltaFuncionRecordada()) return null;
  if (ultimaLectura && Date.now() - ultimaLectura.t < 60_000) return ultimaLectura.valor;
  lecturaEnCurso ??= (async (): Promise<string | null> => {
    try {
      const { data, error } = await supabase.rpc('leer_webhook_instagram');
      if (error) {
        if (faltaLaFuncion(error)) { try { localStorage.setItem(CLAVE_FALTA, String(Date.now())); } catch { /* sin almacenamiento */ } }
        return null;
      }
      return typeof data === 'string' ? data : '';
    } catch { return null; }
  })().then(valor => { ultimaLectura = { valor, t: Date.now() }; return valor; }).finally(() => { lecturaEnCurso = null; });
  return lecturaEnCurso;
}

/** Guarda (o quita, con texto vacío) la dirección. `'legacy'` = la función no existe aún: guárdala como antes. */
export async function guardarWebhookInstagram(url: string): Promise<'rpc' | 'legacy'> {
  ultimaLectura = null;
  const { error } = await supabase.rpc('guardar_webhook_instagram', { p_url: url.trim() });
  if (!error) { try { localStorage.removeItem(CLAVE_FALTA); } catch { /* sin almacenamiento */ } return 'rpc'; }
  if (faltaLaFuncion(error)) return 'legacy';
  throw new Error(error.message || 'No se pudo guardar el webhook de Instagram.');
}

/** ¿Hay una dirección configurada? `null` = no se sabe por el camino nuevo. */
export async function webhookInstagramConfigurado(): Promise<boolean | null> {
  try {
    const { data, error } = await supabase.rpc('webhook_instagram_configurado');
    if (error) return null;
    return data === true;
  } catch { return null; }
}
