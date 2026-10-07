// =====================================================================
// AVISOS DE JARVIS — cuando Jarvis te habla primero
// =====================================================================
// El servidor vigila solo (ver supabase/functions/asistente-ia/proactivo.ts)
// y deja cada aviso en `jarvis_avisos`. Aquí se reciben EN VIVO:
//   · se notifican en el teléfono (APK: notificación nativa; web: la del
//     navegador si diste permiso);
//   · se avisa a Jarvis (evento `jarvis-aviso`) para la campana.
// Además, en la APK queda programado todos los días a las 7:05 el aviso
// del resumen de la mañana (suena aunque la app esté cerrada).
// =====================================================================

import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { supabase } from '../supabaseClient';

export type AvisoJarvis = { id: string; tipo: string; titulo: string; cuerpo: string; nivel: string; destino: string | null; creado_en: string; leido_en: string | null };
export const EVENTO_AVISO = 'jarvis-aviso';
const ID_RESUMEN = 1_499_999_001;

let canal: ReturnType<typeof supabase.channel> | null = null;

function idNotif(uuid: string): number {
  let h = 0;
  for (let i = 0; i < uuid.length; i++) h = (h * 31 + uuid.charCodeAt(i)) | 0;
  return 1_400_000_000 + (Math.abs(h) % 90_000_000);
}

async function notificar(a: AvisoJarvis): Promise<void> {
  const titulo = a.tipo === 'resumen' ? 'Jarvis · resumen de la mañana' : `Jarvis · ${a.titulo}`;
  const cuerpo = a.tipo === 'resumen' ? a.cuerpo.slice(0, 180) : a.cuerpo;
  try {
    if (Capacitor.isNativePlatform()) {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const p = await LocalNotifications.checkPermissions();
      if (p.display !== 'granted') return;
      await LocalNotifications.schedule({ notifications: [{ id: idNotif(a.id), title: titulo, body: cuerpo, extra: { jarvis: true, aviso: a.id } }] });
    } else if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
      new Notification(titulo, { body: cuerpo, tag: a.id });
    }
  } catch { /* sin permiso o sin complemento: queda en la campana */ }
}

/** El aviso diario del resumen (APK): suena a las 7:05 aunque la app esté cerrada. */
async function programarResumen(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    let p = await LocalNotifications.checkPermissions();
    if (p.display === 'prompt' || p.display === 'prompt-with-rationale') p = await LocalNotifications.requestPermissions();
    if (p.display !== 'granted') return;
    const { notifications } = await LocalNotifications.getPending();
    if (notifications.some(n => Number(n.id) === ID_RESUMEN)) return;
    await LocalNotifications.schedule({ notifications: [{
      id: ID_RESUMEN, title: 'Jarvis · buenos días', body: 'Tu resumen de la mañana está listo. Tocá para escucharlo.',
      schedule: { on: { hour: 7, minute: 5 }, allowWhileIdle: true }, extra: { jarvis: true, avisos: true },
    }] });
  } catch { /* sin complemento: el resumen igual queda en la campana */ }
}

/** Arranca la escucha en vivo (una sola vez, solo para el superadmin). */
export async function iniciarAvisosJarvis(): Promise<void> {
  if (canal) return;
  const { data } = await supabase.auth.getUser();
  const uid = data?.user?.id;
  if (!uid) return;
  canal = supabase.channel(`jarvis-avisos-${uid}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'jarvis_avisos', filter: `user_id=eq.${uid}` }, payload => {
      const a = payload.new as AvisoJarvis;
      try { window.dispatchEvent(new CustomEvent(EVENTO_AVISO, { detail: a })); } catch { /* nada */ }
      void notificar(a);
    })
    .subscribe();
  void programarResumen();
}

/** Los avisos recientes (los de los últimos 7 días y los que no leíste). */
export async function cargarAvisos(): Promise<AvisoJarvis[]> {
  const desde = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data, error } = await supabase.from('jarvis_avisos').select('id,tipo,titulo,cuerpo,nivel,destino,creado_en,leido_en')
    .or(`leido_en.is.null,creado_en.gte.${desde}`).order('creado_en', { ascending: false }).limit(60);
  if (error) return [];
  return (data || []) as AvisoJarvis[];
}

export async function marcarLeidos(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await supabase.from('jarvis_avisos').update({ leido_en: new Date().toISOString() }).in('id', ids);
}

/** Cuántos avisos sin leer hay (para el número de la campana). */
export function useAvisosSinLeer(activo: boolean): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!activo) return;
    let vivo = true;
    const contar = () => void cargarAvisos().then(l => { if (vivo) setN(l.filter(a => !a.leido_en).length); });
    contar();
    const al = () => contar();
    window.addEventListener(EVENTO_AVISO, al);
    window.addEventListener('jarvis-avisos-leidos', al);
    return () => { vivo = false; window.removeEventListener(EVENTO_AVISO, al); window.removeEventListener('jarvis-avisos-leidos', al); };
  }, [activo]);
  return n;
}

