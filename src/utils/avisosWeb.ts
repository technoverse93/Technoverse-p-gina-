// =====================================================================
// AVISOS WEB — que el navegador avise de un chat aunque esté cerrado
// =====================================================================
// La APK solo puede avisar con la app cerrada si trae Firebase (ver
// mobile/pushNativo.ts), y eso depende de un proyecto de Google del dueño.
// Chrome (teléfono o compu), Edge, Firefox y Safari tienen su propio
// servicio de avisos estándar: con el permiso del navegador y una
// suscripción, el servidor (asistente-ia/avisosWeb.ts) manda el aviso
// CIFRADO para este navegador y su service worker (public/sw-avisos.js) lo
// muestra, aunque no haya ninguna pestaña abierta.
//
// Solo para el personal. Se activa con un toque (el navegador exige que el
// permiso se pida desde un toque) y queda: al volver a entrar se renueva
// solo. Al cerrar sesión, el servidor deja de mandarle avisos.
// =====================================================================

import { supabase } from '../supabaseClient';
import { CLAVE_ABRIR_CONV } from '../mobile/jarvisAtajo';

/**
 * La llave PÚBLICA VAPID del servidor (pública por diseño). La función la crea la primera vez y guarda la
 * privada donde nadie la lee; se pide al activar o renovar, así nunca queda una suscripción con otra llave.
 */
async function llavePublica(): Promise<string | 'sin_sql' | null> {
  try {
    const { data, error } = await supabase.functions.invoke('asistente-ia', { body: { accion: 'avisos_web_llave' } });
    if (!error && data?.ok && typeof data.publica === 'string') return data.publica;
    return data?.falta === 'sql' ? 'sin_sql' : null;
  } catch { return null; }
}
const SW = '/sw-avisos.js';
const K_ACTIVO = 'tv_avisos_web';

export type EstadoWeb = 'activo' | 'apagado' | 'sin_soporte' | 'bloqueado' | 'sin_sql' | 'error';
export const TEXTO_ESTADO_WEB: Record<EstadoWeb, string> = {
  activo: 'Activos en este navegador: te avisa de cada chat aunque lo cierres.',
  apagado: 'Apagados en este navegador.',
  sin_soporte: 'Este navegador no tiene avisos (la app del teléfono no los trae: abrí el panel en Chrome).',
  bloqueado: 'El navegador tiene los avisos bloqueados para este sitio. Habilitalos en el candado de la barra de direcciones.',
  sin_sql: 'Falta correr en Supabase el SQL de avisos web (migracion_avisos_web.sql).',
  error: 'No se pudo activar. Probá de nuevo en un momento.',
};

const leer = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const escribir = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };
const b64u = (b: ArrayBuffer | null) => {
  if (!b) return '';
  let s = '';
  for (const x of new Uint8Array(b)) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const deB64u = (t: string) => {
  const s = t.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s + '='.repeat((4 - (s.length % 4)) % 4)), c => c.charCodeAt(0));
};

/** ¿Este navegador puede recibir avisos con todo cerrado? (El WebView de la APK no.) */
export function soportaAvisosWeb(): boolean {
  try {
    if ((window as any)?.Capacitor?.isNativePlatform?.()) return false;
    return window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  } catch { return false; }
}

async function registro(): Promise<ServiceWorkerRegistration> {
  const r = await navigator.serviceWorker.register(SW, { scope: '/' });
  await navigator.serviceWorker.ready;
  return r;
}

async function guardarEnServidor(s: PushSubscription): Promise<EstadoWeb> {
  const { error } = await supabase.rpc('registrar_avisos_web', {
    p_endpoint: s.endpoint, p_p256dh: b64u(s.getKey('p256dh')), p_auth: b64u(s.getKey('auth')),
    p_agente: (navigator.userAgent || '').slice(0, 120),
  });
  if (!error) return 'activo';
  return error.code === 'PGRST202' || /does not exist|schema cache/i.test(error.message) ? 'sin_sql' : 'error';
}

/** Cómo está este navegador ahora (sin pedir nada). */
export async function estadoAvisosWeb(): Promise<EstadoWeb> {
  if (!soportaAvisosWeb()) return 'sin_soporte';
  if (Notification.permission === 'denied') return 'bloqueado';
  if (Notification.permission !== 'granted' || leer(K_ACTIVO) !== '1') return 'apagado';
  try {
    const r = await navigator.serviceWorker.getRegistration('/');
    return (await r?.pushManager.getSubscription()) ? 'activo' : 'apagado';
  } catch { return 'error'; }
}

/** Pide el permiso (llamar desde un toque), suscribe este navegador y se lo cuenta al servidor. */
export async function activarAvisosWeb(): Promise<EstadoWeb> {
  if (!soportaAvisosWeb()) return 'sin_soporte';
  try {
    const permiso = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    if (permiso !== 'granted') return permiso === 'denied' ? 'bloqueado' : 'apagado';
    const publica = await llavePublica();
    if (publica === 'sin_sql') return 'sin_sql';
    if (!publica) return 'error';
    const r = await registro();
    let s = await r.pushManager.getSubscription();
    // Una suscripción hecha con otra llave (si un día se cambia el par VAPID) ya no sirve: se rehace.
    const llave = s?.options?.applicationServerKey ? b64u(s.options.applicationServerKey) : null;
    if (s && llave && llave !== publica) { await s.unsubscribe().catch(() => false); s = null; }
    if (!s) s = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: deB64u(publica) });
    const e = await guardarEnServidor(s);
    escribir(K_ACTIVO, e === 'activo' ? '1' : null);
    return e;
  } catch {
    return 'error';
  }
}

/** Al entrar de nuevo con la sesión: si ya estaban activos aquí, se vuelven a anotar (otra cuenta, suscripción renovada). */
export async function renovarAvisosWeb(): Promise<void> {
  if (!soportaAvisosWeb() || Notification.permission !== 'granted' || leer(K_ACTIVO) !== '1') return;
  // Con el permiso ya dado no pregunta nada: rehace la suscripción si cambió la llave y la vuelve a anotar.
  await activarAvisosWeb();
}

/** Apaga los avisos en este navegador (botón) o al cerrar sesión (`soloServidor`: la suscripción queda para la próxima cuenta). */
export async function apagarAvisosWeb(soloServidor = false): Promise<void> {
  if (!soportaAvisosWeb()) return;
  try {
    const r = await navigator.serviceWorker.getRegistration('/');
    const s = await r?.pushManager.getSubscription();
    if (s) {
      await supabase.rpc('quitar_avisos_web', { p_endpoint: s.endpoint });
      if (!soloServidor) await s.unsubscribe().catch(() => false);
    }
  } catch { /* sin red: el servidor la borra cuando el navegador la dé de baja */ }
  if (!soloServidor) escribir(K_ACTIVO, null);
}

/**
 * Se llama una vez al arrancar: tocar un aviso con la app ya abierta lleva a esa conversación, y si el aviso
 * abrió una pestaña nueva (`/admin/chat?conv=…`), la conversación queda pedida para la pestaña Chat.
 */
export function iniciarAvisosWeb(): void {
  if (!soportaAvisosWeb()) return;
  try {
    const u = new URL(window.location.href);
    const conv = u.searchParams.get('conv');
    if (conv && u.pathname.startsWith('/admin/chat')) {
      try { sessionStorage.setItem(CLAVE_ABRIR_CONV, conv); } catch { /* va solo el evento */ }
      u.searchParams.delete('conv');
      window.history.replaceState(window.history.state, '', u.pathname + u.search + u.hash);
    }
  } catch { /* dirección rara: se ignora */ }
  navigator.serviceWorker.addEventListener('message', e => {
    const d = e.data as { tipo?: string; conv?: string } | null;
    if (d?.tipo !== 'abrir-conv' || !d.conv) return;
    void import('../mobile/jarvisAtajo').then(m => m.manejar(`technoverse://jarvis?modulo=chat&conv=${encodeURIComponent(d.conv!)}`));
  });
}
