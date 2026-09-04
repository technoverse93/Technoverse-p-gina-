// =====================================================================
// SUPERVISIÓN · lado del empleado (Zero Trust · Etapa 3)
// =====================================================================
// Dos cosas, ambas solo para el personal (nunca para un Cliente):
//
//   1. LATIDO: cada 15 s deja en `supervision_state` su ruta, entorno y
//      hora, para que el Superadmin sepa quién está en línea y en qué
//      pantalla — sin grabar nada.
//
//   2. GRABACIÓN BAJO DEMANDA: escucha SU propia fila. Solo cuando el
//      Superadmin pone `watch = true` arranca rrweb y transmite. Al
//      soltarlo, para y borra sus propios lotes. rrweb se carga con
//      import() diferido: si nadie lo observa, ni siquiera se descarga la
//      librería —cero costo de batería y de red mientras tanto.
//
// El empleado NO puede activar su propio `watch` (un trigger en la base
// lo revierte), así que esto nunca se auto-dispara ni observa a otro.
// =====================================================================

import { supabase } from '../supabaseClient';
import { esStaff } from '../utils/roles';
import type { User } from '../types';

let latidoTimer: ReturnType<typeof setInterval> | null = null;
let canalControl: any = null;
let detenerGrabacion: (() => void) | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let buffer: any[] = [];
let userId: string | null = null;
let grabando = false;

function entorno(): string {
  try { if ((window as any)?.Capacitor?.isNativePlatform?.()) return 'apk'; } catch { /* web */ }
  return 'web';
}
function rutaActual(): string {
  try { return (location.pathname || '/') + (location.hash || ''); } catch { return '/'; }
}

async function latido(user: User): Promise<void> {
  try {
    await supabase.from('supervision_state').upsert(
      {
        user_id: user.id,
        email: user.email,
        ruta: rutaActual(),
        entorno: entorno(),
        last_seen: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );
  } catch { /* el latido es best-effort */ }
}

async function volcar(): Promise<void> {
  if (!userId || buffer.length === 0) return;
  const lote = buffer;
  buffer = [];
  try { await supabase.from('supervision_events').insert({ user_id: userId, lote }); }
  catch { /* si falla, se pierde ese lote y nada más */ }
}

async function empezarAGrabar(): Promise<void> {
  if (grabando) return;
  grabando = true;
  buffer = [];
  try {
    const { record } = await import('rrweb');
    detenerGrabacion = record({
      emit(evento: any) {
        buffer.push(evento);
        // Vuelca antes si se acumula mucho, para que el espejo no se
        // atrase en pantallas con mucho movimiento.
        if (buffer.length >= 60) void volcar();
      },
      recordCanvas: false,
      collectFonts: false,
    }) || null;
    flushTimer = setInterval(() => void volcar(), 1200);
  } catch {
    grabando = false;
  }
}

async function pararDeGrabar(): Promise<void> {
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  if (detenerGrabacion) { try { detenerGrabacion(); } catch { /* ya parado */ } detenerGrabacion = null; }
  await volcar();
  buffer = [];
  grabando = false;
  // Limpia los lotes propios: el espejo es en vivo, no un archivo. RLS
  // permite borrar solo lo de uno mismo.
  if (userId) { try { await supabase.from('supervision_events').delete().eq('user_id', userId); } catch { /* nada */ } }
}

/** Arranca latido + escucha de control. Solo para personal. Idempotente. */
export function iniciarSupervision(user: User): void {
  if (typeof window === 'undefined' || !user || !esStaff(user.role)) return;
  detenerSupervision();
  userId = user.id;
  void latido(user);
  latidoTimer = setInterval(() => void latido(user), 15000);

  canalControl = supabase
    .channel(`supervision-control-${user.id}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'supervision_state', filter: `user_id=eq.${user.id}` },
      (payload: any) => {
        if (payload?.new?.watch) void empezarAGrabar();
        else void pararDeGrabar();
      }
    )
    .subscribe();
}

/** Corta todo: latido, grabación y canal. Llamar al cerrar sesión. */
export function detenerSupervision(): void {
  if (latidoTimer) { clearInterval(latidoTimer); latidoTimer = null; }
  if (canalControl) { try { supabase.removeChannel(canalControl); } catch { /* nada */ } canalControl = null; }
  void pararDeGrabar();
  userId = null;
}
