// =====================================================================
// AVISOS PUSH EN EL TELÉFONO — que te avise aunque la app esté cerrada
// =====================================================================
// Las notificaciones locales (src/mobile/notificaciones.ts) solo salen
// mientras la app está viva: Android la duerme a los minutos y se corta la
// conexión en vivo. Aquí el servidor manda el aviso (Firebase) y el
// teléfono arma la notificación nativa, con «Responder» como WhatsApp
// (native-android/push/, supabase/functions/asistente-ia/push.ts).
//
// Esta pieza hace de la web lo que le toca:
//   · pedir el permiso de notificaciones y registrar ESTE teléfono (solo
//     el personal), y borrarlo al cerrar sesión;
//   · dejarle al código nativo la dirección de Supabase y su clave pública,
//     para que «Responder» mande sin abrir la app;
//   · avisarle si estás mirando el chat (para no repetir el aviso) y quitar
//     la notificación de la conversación que abrís.
// Solo hace algo en la APK, y solo si la APK trae Firebase.
// =====================================================================

import { Capacitor, registerPlugin } from '@capacitor/core';
import { supabase, SUPABASE_URL, SUPABASE_KEY } from '../supabaseClient';
import { esStaff } from '../utils/roles';

interface PluginPush {
  estado(): Promise<{ firebase: boolean }>;
  obtenerToken(): Promise<{ token: string }>;
  configurar(o: { url: string; clave: string }): Promise<void>;
  chatAbierto(o: { abierto: boolean }): Promise<void>;
  limpiar(o: { conv?: string }): Promise<void>;
}
const Nativo = registerPlugin<PluginPush>('PushNativo');

export type EstadoPush = 'activo' | 'web' | 'apk_vieja' | 'sin_firebase' | 'sin_permiso' | 'sin_sql' | 'error';
/** Estados que no son una falla sino algo opcional todavía sin configurar: se muestran sin rojo. */
export const ESTADO_PENDIENTE: ReadonlySet<EstadoPush> = new Set<EstadoPush>(['sin_firebase', 'web']);
export const TEXTO_ESTADO: Record<EstadoPush, string> = {
  activo: 'Activos en este teléfono: te avisan aunque la app esté cerrada.',
  web: 'Solo funcionan en la app del teléfono (APK).',
  apk_vieja: 'Esta APK es anterior a los avisos. Instalá la nueva.',
  sin_firebase: 'Opcional, sin configurar todavía: mientras tanto los avisos salen con la app abierta. Para que lleguen con la app cerrada hay que conectar Firebase una vez (lo hace el dueño del repositorio).',
  sin_permiso: 'Android tiene las notificaciones apagadas para la app. Activalas en Ajustes del teléfono.',
  sin_sql: 'Falta correr en Supabase el SQL de avisos (migracion_chat_push.sql).',
  error: 'No se pudo activar. Se reintenta al abrir la app.',
};

const K_ACTIVO = 'tv_push_activo';
const K_TOKEN = 'tv_push_token';
const K_ESTADO = 'tv_push_estado';
const leer = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const escribir = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };

/** ¿Este teléfono ya recibe los avisos del servidor? (entonces no se repiten los locales) */
export function pushActivo(): boolean { return Capacitor.isNativePlatform() && leer(K_ACTIVO) === '1'; }
/** Lo último que se supo al activarlo (para mostrarlo en Ajustes). */
export function estadoPush(): EstadoPush | null { return (leer(K_ESTADO) as EstadoPush | null) || null; }

const disponible = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('PushNativo');
let registrando: Promise<EstadoPush> | null = null;
let ultimo = 0;

function fijarEstado(e: EstadoPush): EstadoPush {
  escribir(K_ESTADO, e);
  escribir(K_ACTIVO, e === 'activo' ? '1' : null);
  return e;
}

/**
 * Registra este teléfono para los avisos del personal. Seguro de llamar
 * muchas veces (al abrir y al volver a la app): no repite si hace poco que
 * salió bien.
 */
export function iniciarPush(rol?: string | null, forzar = false): Promise<EstadoPush> {
  if (!Capacitor.isNativePlatform()) return Promise.resolve('web');
  if (!esStaff(rol)) return Promise.resolve(estadoPush() || 'error');
  if (registrando) return registrando;
  if (!forzar && pushActivo() && Date.now() - ultimo < 10 * 60_000) return Promise.resolve('activo');
  registrando = (async (): Promise<EstadoPush> => {
    try {
      if (!disponible()) return fijarEstado('apk_vieja');
      if (!(await Nativo.estado()).firebase) return fijarEstado('sin_firebase');
      // Android 13+ pide permiso para mostrar notificaciones.
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      let p = await LocalNotifications.checkPermissions();
      if (p.display === 'prompt' || p.display === 'prompt-with-rationale') p = await LocalNotifications.requestPermissions();
      if (p.display !== 'granted') return fijarEstado('sin_permiso');
      await Nativo.configurar({ url: SUPABASE_URL, clave: SUPABASE_KEY });
      const { token } = await Nativo.obtenerToken();
      let modelo = '';
      try { const { Device } = await import('@capacitor/device'); const i = await Device.getInfo(); modelo = `${i.manufacturer || ''} ${i.model || ''}`.trim(); } catch { /* sin modelo */ }
      const { error } = await supabase.rpc('registrar_dispositivo_push', { p_token: token, p_modelo: modelo });
      if (error) return fijarEstado(error.code === 'PGRST202' || /does not exist|schema cache/i.test(error.message) ? 'sin_sql' : 'error');
      escribir(K_TOKEN, token);
      ultimo = Date.now();
      return fijarEstado('activo');
    } catch (e) {
      return fijarEstado(/sin_firebase/.test(String((e as Error)?.message || e)) ? 'sin_firebase' : 'error');
    } finally { registrando = null; }
  })();
  return registrando;
}

/** Al cerrar sesión: este teléfono deja de recibir los avisos de la cuenta. */
export async function cerrarPush(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const token = leer(K_TOKEN);
  try {
    if (token) await supabase.rpc('quitar_dispositivo_push', { p_token: token });
    if (disponible()) await Nativo.limpiar({});
  } catch { /* sin red: el servidor lo borra solo cuando Google lo dé de baja */ }
  escribir(K_TOKEN, null);
  escribir(K_ACTIVO, null);
  escribir(K_ESTADO, null);
  ultimo = 0;
}

/** La pestaña Chat está a la vista: no repetir el aviso de lo que ya ves. */
export function avisarChatAbierto(abierto: boolean): void {
  if (!disponible()) return;
  void Nativo.chatAbierto({ abierto }).catch(() => { /* APK sin el puente */ });
}

/** Abriste esa conversación: se quita su notificación. */
export function limpiarNotificacion(conv: string): void {
  if (!disponible() || !conv) return;
  void Nativo.limpiar({ conv }).catch(() => { /* APK sin el puente */ });
}
