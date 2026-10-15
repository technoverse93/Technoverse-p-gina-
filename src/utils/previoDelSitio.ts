// =====================================================================
// LO QUE EL BORDE DEJÓ DENTRO DE LA PÁGINA — para dibujar ya con lo definitivo
// =====================================================================
// El Worker de Cloudflare (src/worker/previo.ts) mete en el HTML, dentro de
// `<script id="tv-previo" type="application/json">`, el contenido editable
// del sitio y la configuración pública (logo, teléfono, horario) tal como
// están en ESE momento en Supabase. Aquí se lee, una sola vez y de forma
// síncrona, antes de que React dibuje nada.
//
// Por qué: sin esto la primera pantalla salía con los textos, el ícono y el
// logo de fábrica y, cuando llegaba la respuesta de Supabase, cambiaban a
// los que el dueño había editado (un parpadeo tras otro, visto en un video
// el 2026-10-14). Con esto la primera pantalla ya es la definitiva.
//
// Si la etiqueta no está (servidor de desarrollo, la APK, o el Worker no
// alcanzó a leer), todo devuelve null y la app sigue por su camino de
// siempre: copia guardada en el aparato y, si hace falta, una espera corta.
// =====================================================================

import type { AppSettings } from '../types';

interface Previo {
  contenido: Record<string, string>;
  ajustes: Partial<AppSettings> | null;
  /** El borde comprobó que la tienda pública no tiene nada que mostrar. */
  catalogoVacio: boolean;
  /** Filas de `banners` tal cual de la base (se mapean en storage.ts), o null si el borde no las trajo. */
  banners: Record<string, unknown>[] | null;
}

let leido: Previo | null | undefined;

function leer(): Previo | null {
  if (leido !== undefined) return leido;
  leido = null;
  try {
    if (typeof document === 'undefined') return leido;
    const texto = document.getElementById('tv-previo')?.textContent;
    if (!texto) return leido;
    const j = JSON.parse(texto);
    if (!j || j.v !== 1 || !j.c || typeof j.c !== 'object') return leido;

    const contenido: Record<string, string> = {};
    for (const [clave, valor] of Object.entries(j.c as Record<string, unknown>)) {
      contenido[clave] = valor == null ? '' : String(valor);
    }

    let ajustes: Partial<AppSettings> | null = null;
    const s = j.s as Record<string, unknown> | null;
    if (s && typeof s === 'object') {
      const cad = (v: unknown) => (typeof v === 'string' ? v : '');
      ajustes = {
        cedulaJuridica: cad(s.cedula_juridica),
        companyPhone: cad(s.company_phone),
        companyAddress: cad(s.company_address),
        workshopAddress: cad(s.workshop_address),
        pickupHours: cad(s.pickup_hours),
        maxStockLimit: Number(s.max_stock_limit) || 50,
      };
      // El logo solo si vino: si el Worker lo omitió por pesado, NO se pisa
      // el que ya hubiera en la copia del aparato.
      if (typeof s.store_logo === 'string' && s.store_logo) ajustes.storeLogo = s.store_logo;
    }
    const banners = Array.isArray(j.b)
      ? (j.b as unknown[]).filter((f): f is Record<string, unknown> => !!f && typeof f === 'object' && typeof (f as any).id === 'string')
      : null;
    leido = { contenido, ajustes, catalogoVacio: j.vacio === true, banners };
  } catch {
    leido = null;
  }
  return leido;
}

/** Contenido editable ({ clave: valor }) tal como estaba al abrir la página, o null. */
export function contenidoPrevio(): Record<string, string> | null {
  return leer()?.contenido ?? null;
}

/** Configuración pública al abrir la página (sin el webhook de Instagram), o null. */
export function ajustesPrevios(): Partial<AppSettings> | null {
  return leer()?.ajustes ?? null;
}

/** Los banners (filas crudas de la base) que el borde dejó en el HTML, o null si no los trajo. */
export function bannersPrevios(): Record<string, unknown>[] | null {
  return leer()?.banners ?? null;
}

/**
 * ¿El borde comprobó, al abrir la página, que la tienda no tiene NADA que
 * mostrar? Solo vale como «sí»: false significa «no se sabe», no «hay».
 */
export function catalogoVacioPrevio(): boolean {
  return leer()?.catalogoVacio === true;
}
