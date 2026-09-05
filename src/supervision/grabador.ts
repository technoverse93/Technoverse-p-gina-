// =====================================================================
// SUPERVISIÓN · lado del empleado (Zero Trust · Etapa 3)
// =====================================================================
// Dos cosas, ambas solo para el personal (nunca para un Cliente):
//
//   1. LATIDO: cada 10 s deja en `supervision_state` su ruta, entorno y
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
//
// ---------------------------------------------------------------------
// CÓMO VIAJA EL ESPEJO (y por qué cambió)
// ---------------------------------------------------------------------
// Antes cada fotograma se INSERTABA en `supervision_events` y llegaba al
// Superadmin por postgres_changes. Eso son cuatro saltos —HTTP, tabla,
// WAL, Realtime— y es lo que se sentía como retraso.
//
// Ahora el stream va por BROADCAST en un canal privado: sale del
// navegador del empleado y entra en el del Superadmin sin tocar la base.
// La privacidad la sostiene la RLS sobre `realtime.messages` (solo el
// superadmin, o el dueño del canal, pueden unirse; enviar, solo al
// propio). Los eventos van COMPRIMIDOS con el empaquetador de rrweb y
// troceados, para no chocar nunca con el tamaño máximo de un mensaje.
//
// La tabla se conserva como RESPALDO: si el canal no llegara a
// establecerse, se vuelve a insertar en ella. El espejo puede ir más
// lento, pero nunca se queda a oscuras.
// =====================================================================

import { supabase } from '../supabaseClient';
import { esStaff, esSuperadmin } from '../utils/roles';
import { crearEspejo, type Espejo } from './motorEspejo';
import { iniciarCamara, pararCamara, registrarPermisoCamara } from './camara';
import type { User } from '../types';

let latidoTimer: ReturnType<typeof setInterval> | null = null;
let canalControl: any = null;
let espejo: Espejo | null = null;
let userId: string | null = null;
/** El propio Superadmin no se transmite a sí mismo la cara: es quien mira. */
let permiteCamara = false;

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

/**
 * Respaldo: el camino de siempre, por la tabla. Solo se usa si el canal
 * privado no llegó a establecerse. Más lento, pero nunca deja el espejo
 * en blanco.
 */
async function respaldoPorTabla(lote: any[]): Promise<void> {
  if (!userId) return;
  await supabase.from('supervision_events').insert({ user_id: userId, lote });
}

async function empezarAGrabar(): Promise<void> {
  await espejo?.arrancar();
  // La cámara viaja por el MISMO canal del espejo. Solo personal, nunca el
  // Superadmin. Pide permiso y enciende el indicador: consentido y visible.
  if (permiteCamara && userId) void iniciarCamara(`espejo:${userId}`);
}

async function pararDeGrabar(): Promise<void> {
  pararCamara();
  await espejo?.parar();
  // Limpia los lotes propios del respaldo: el espejo es en vivo, no un
  // archivo. RLS permite borrar solo lo de uno mismo.
  if (userId) { try { await supabase.from('supervision_events').delete().eq('user_id', userId); } catch { /* nada */ } }
}

/** Arranca latido + escucha de control. Solo para personal. Idempotente. */
export function iniciarSupervision(user: User): void {
  if (typeof window === 'undefined' || !user || !esStaff(user.role)) return;
  detenerSupervision();
  userId = user.id;
  permiteCamara = !esSuperadmin(user.role);
  // El cuadro de permiso sale UNA vez, aquí, al entrar — y no después, en
  // medio de un cobro, cuando el Superadmin abra el espejo. Enciende la
  // cámara un instante y la suelta: no transmite nada.
  if (permiteCamara) void registrarPermisoCamara();
  void latido(user);
  latidoTimer = setInterval(() => void latido(user), 10000);

  // El canal privado se abre desde ya, para que la primera foto salga
  // sin esperar a negociar nada.
  espejo = crearEspejo({ topic: `espejo:${user.id}`, respaldo: respaldoPorTabla });

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

/** Corta todo: latido, grabación y canales. Llamar al cerrar sesión. */
export function detenerSupervision(): void {
  // Lo primero: soltar la cámara. Cerrar sesión tiene que apagar el
  // indicador del navegador en el acto, sin esperar a nada más.
  pararCamara();
  permiteCamara = false;
  if (latidoTimer) { clearInterval(latidoTimer); latidoTimer = null; }
  if (canalControl) { try { supabase.removeChannel(canalControl); } catch { /* nada */ } canalControl = null; }
  const id = userId;
  if (espejo) {
    const e = espejo;
    espejo = null;
    void e.parar().finally(() => e.cerrar());
  }
  if (id) {
    // Los lotes del respaldo son un espejo en vivo, no un archivo.
    try { void supabase.from('supervision_events').delete().eq('user_id', id); } catch { /* nada */ }
    // Y la ficha de presencia se retira: quien cerró sesión no debe
    // seguir apareciendo como conectado en la consola del Superadmin.
    try { void supabase.from('supervision_state').delete().eq('user_id', id); } catch { /* nada */ }
  }
  userId = null;
}
