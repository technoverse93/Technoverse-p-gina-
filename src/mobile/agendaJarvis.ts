// =====================================================================
// AGENDA DE JARVIS — los recordatorios suenan en el teléfono
// =====================================================================
// Jarvis anota los recordatorios en `jarvis_agenda` (servidor). Aquí se
// programan como notificaciones del teléfono (APK): cada vez que Jarvis
// agenda, cierra o deshace algo, y al abrir el panel. Se reprograma todo
// lo pendiente a futuro y se cancela lo que ya no está, así nunca suena
// algo hecho ni falta algo nuevo. Tocar el aviso abre Jarvis.
// En la web no hay nada que programar: la agenda vive en Jarvis.
// =====================================================================

import { Capacitor } from '@capacitor/core';
import { supabase } from '../supabaseClient';

/** Id numérico estable para Android a partir del uuid (rango propio, alto). */
function idDe(uuid: string): number {
  let h = 0;
  for (let i = 0; i < uuid.length; i++) h = (h * 31 + uuid.charCodeAt(i)) | 0;
  return 1_500_000_000 + (Math.abs(h) % 600_000_000);
}
const ES_NUESTRA = (id: number) => id >= 1_500_000_000;

let enCurso: Promise<void> | null = null;

export function sincronizarAgenda(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return Promise.resolve();
  if (enCurso) return enCurso;
  enCurso = (async () => {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const { data, error } = await supabase.from('jarvis_agenda').select('id,texto,cuando')
        .eq('estado', 'pendiente').gt('cuando', new Date().toISOString()).order('cuando').limit(60);
      if (error) return; // sin la tabla todavía, o sin permiso: nada que hacer
      let permiso = await LocalNotifications.checkPermissions();
      if (permiso.display === 'prompt' || permiso.display === 'prompt-with-rationale') permiso = await LocalNotifications.requestPermissions();
      const quedan = new Set((data || []).map((d: any) => idDe(d.id)));
      const { notifications } = await LocalNotifications.getPending();
      const sobran = notifications.filter(n => ES_NUESTRA(Number(n.id)) && !quedan.has(Number(n.id)));
      if (sobran.length) await LocalNotifications.cancel({ notifications: sobran.map(n => ({ id: Number(n.id) })) });
      if (permiso.display !== 'granted' || !data?.length) return;
      await LocalNotifications.schedule({
        notifications: data.map((d: any) => ({
          id: idDe(d.id),
          title: 'Jarvis · recordatorio',
          body: String(d.texto),
          schedule: { at: new Date(d.cuando), allowWhileIdle: true },
          extra: { jarvis: true, agenda: d.id },
        })),
      });
    } catch { /* sin el complemento o sin permiso: Jarvis igual lo tiene anotado */ }
    finally { enCurso = null; }
  })();
  return enCurso;
}
