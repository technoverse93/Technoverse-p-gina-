// =====================================================================
// CRM · CAPTACIÓN DESDE LA TIENDA: de dónde llegó la persona y quién es
// =====================================================================
// Dos cosas pequeñas que usa la tienda (no el panel):
//   1. `capturarOrigenDeVisita()` anota, UNA vez por visitante y por 30 días, cómo llegó: los parámetros de la campaña
//      (utm_source, utm_medium, utm_campaign, utm_content), el sitio desde el que vino (solo el dominio, nunca la dirección
//      completa) y la página donde entró (solo la ruta). Sin cookies de terceros ni identificadores: queda en este aparato.
//   2. `registrarContactoCrm()` le cuenta al CRM quién es la persona cuando ella misma lo dice (abre el chat, se registra o
//      compra), junto con ese origen. La base valida todo y solo RELLENA lo que falta (supabase/migracion_crm.sql); el
//      contacto en sí lo crean los disparadores del servidor, así que si esta llamada falla no se pierde nada.
//
// Es «disparar y olvidar»: nunca lanza, nunca bloquea una compra ni un chat, y si la función todavía no existe en la base
// (migración sin aplicar) se apaga en silencio hasta recargar.
// =====================================================================

import { supabase } from '../supabaseClient';
import { ubicacionGuardada } from './ubicacionCliente';

const CLAVE_ORIGEN = 'technoverse_origen_v1';
const CLAVE_ENVIADOS = 'technoverse_crm_enviados_v1';
const VIGENCIA_MS = 30 * 86_400_000;

interface OrigenGuardado {
  t: number;
  utm_source?: string; utm_medium?: string; utm_campaign?: string; utm_content?: string;
  referrer?: string; landing?: string;
}

const limpio = (v: string | null | undefined): string | undefined => {
  const s = (v || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80);
  return s || undefined;
};

function leerOrigen(): OrigenGuardado | null {
  try {
    const o = JSON.parse(localStorage.getItem(CLAVE_ORIGEN) || 'null');
    return o && typeof o.t === 'number' && Date.now() - o.t < VIGENCIA_MS ? o : null;
  } catch { return null; }
}

/** El sitio desde el que llegó (solo el dominio), o nada si llegó directo o desde esta misma tienda. */
function dominioDeOrigen(): string | undefined {
  try {
    if (!document.referrer) return undefined;
    const host = new URL(document.referrer).hostname.replace(/^www\./, '').toLowerCase();
    if (!host || host === location.hostname.replace(/^www\./, '').toLowerCase()) return undefined;
    return /^[a-z0-9.-]{3,80}$/.test(host) ? host : undefined;
  } catch { return undefined; }
}

/** Se llama al abrir la tienda. Guarda el PRIMER origen; una campaña con parámetros nuevos reemplaza a uno «directo». */
export function capturarOrigenDeVisita(): void {
  try {
    const p = new URLSearchParams(location.search);
    const utm = {
      utm_source: limpio(p.get('utm_source')), utm_medium: limpio(p.get('utm_medium')),
      utm_campaign: limpio(p.get('utm_campaign')), utm_content: limpio(p.get('utm_content')),
    };
    const traeCampana = !!(utm.utm_source || utm.utm_medium || utm.utm_campaign);
    const previo = leerOrigen();
    const yaTeniaCampana = !!(previo && (previo.utm_source || previo.utm_medium || previo.utm_campaign));
    if (previo && (yaTeniaCampana || !traeCampana)) return;
    const o: OrigenGuardado = { t: Date.now(), ...utm, referrer: dominioDeOrigen(), landing: limpio(location.pathname) };
    localStorage.setItem(CLAVE_ORIGEN, JSON.stringify(o));
  } catch { /* sin almacenamiento: no se anota el origen, nada más */ }
}

function origenParaEnviar(): Record<string, string> {
  const o = leerOrigen();
  const salida: Record<string, string> = {};
  if (!o) return salida;
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'referrer', 'landing'] as const) {
    if (o[k]) salida[k] = o[k]!;
  }
  return salida;
}

export interface DatosContactoTienda {
  nombre?: string;
  email?: string;
  telefono?: string;
  canal: 'chat_web' | 'tienda_form' | 'registro';
  /** Una de las 7 provincias. Si no se pasa, se usa la que la persona compartió a propósito (si la compartió). */
  provincia?: string | null;
  /** Qué le interesó («Cargador USB-C»). */
  detalle?: string;
}

let apagado = false;
const enSesion = new Set<string>();

function yaEnviado(clave: string): boolean {
  if (enSesion.has(clave)) return true;
  try {
    const lista: string[] = JSON.parse(sessionStorage.getItem(CLAVE_ENVIADOS) || '[]');
    if (lista.includes(clave)) { enSesion.add(clave); return true; }
    sessionStorage.setItem(CLAVE_ENVIADOS, JSON.stringify([...lista.slice(-20), clave]));
  } catch { /* sin sessionStorage: se cuida solo dentro de esta pestaña */ }
  enSesion.add(clave);
  return false;
}

/**
 * Cuenta a la base quién es la persona. Una vez por correo/teléfono y canal en cada sesión. Devuelve una promesa que NUNCA
 * se rechaza y se resuelve al terminar o a los `esperaMaxMs` (para quien quiera que llegue antes de guardar un pedido).
 */
export function registrarContactoCrm(d: DatosContactoTienda, esperaMaxMs = 1500): Promise<void> {
  if (apagado) return Promise.resolve();
  const email = (d.email || '').trim().toLowerCase();
  const telefono = (d.telefono || '').trim();
  if (!email && !telefono) return Promise.resolve();
  if (yaEnviado(`${email || telefono}|${d.canal}`)) return Promise.resolve();

  let provincia = d.provincia;
  if (provincia === undefined) {
    try { provincia = ubicacionGuardada()?.provincia ?? null; } catch { provincia = null; }
  }

  const envio = new Promise<void>(resolver => {
    try {
      void supabase.rpc('crm_registrar_contacto', {
        p_nombre: (d.nombre || '').trim(), p_email: email || null, p_telefono: telefono || null, p_canal: d.canal,
        p_origen: origenParaEnviar(), p_provincia: provincia || null, p_detalle: d.detalle?.trim() || null,
      }).then(
        ({ error }) => {
          if (error && /PGRST202|42883|Could not find|does not exist/i.test(`${error.code || ''} ${error.message || ''}`)) apagado = true;
          resolver();
        },
        () => resolver(),
      );
    } catch { resolver(); }
  });
  return Promise.race([envio, new Promise<void>(resolver => setTimeout(resolver, esperaMaxMs))]);
}
