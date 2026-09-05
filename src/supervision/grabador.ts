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
import { esStaff } from '../utils/roles';
import type { User } from '../types';

let latidoTimer: ReturnType<typeof setInterval> | null = null;
let canalControl: any = null;
let canalEspejo: any = null;
let espejoListo = false;
let detenerGrabacion: (() => void) | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let observadorTema: MutationObserver | null = null;
let tomarFoto: ((isCheckout?: boolean) => void) | null = null;
let buffer: any[] = [];
let userId: string | null = null;
let grabando = false;

/** Tope por mensaje. El límite real de Realtime es bastante mayor; se
 *  deja holgura para las cabeceras y para el peor caso de compresión. */
const TROZO_MAX = 120_000;

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
 * Manda un lote por el canal rápido; si el canal no está listo o falla,
 * cae a la tabla. Trocea siempre: un lote con una foto completa puede
 * pasar del tamaño máximo de un mensaje aunque vaya comprimido.
 */
async function enviarLote(lote: any[]): Promise<void> {
  if (!userId || lote.length === 0) return;

  if (canalEspejo && espejoListo) {
    try {
      const cuerpo = JSON.stringify(lote);
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const partes = Math.ceil(cuerpo.length / TROZO_MAX) || 1;
      for (let i = 0; i < partes; i++) {
        await canalEspejo.send({
          type: 'broadcast',
          event: 'lote',
          payload: { id, i, n: partes, d: cuerpo.slice(i * TROZO_MAX, (i + 1) * TROZO_MAX) },
        });
      }
      return;
    } catch { /* el canal falló: se sigue por la tabla */ }
  }

  // Respaldo: el camino de siempre. Más lento, pero nunca deja el espejo
  // en blanco si el canal privado no llegó a establecerse.
  try { await supabase.from('supervision_events').insert({ user_id: userId, lote }); }
  catch { /* si falla, se pierde ese lote y nada más */ }
}

async function volcar(): Promise<void> {
  if (!userId || buffer.length === 0) return;
  const lote = buffer;
  buffer = [];
  await enviarLote(lote);
}

/**
 * El cambio de tema (claro/oscuro) es una clase que se pone y se quita en
 * <html>. Ese tipo de mutación global reescribe de golpe cómo se pinta
 * TODO el documento, y el espejo se quedaba en blanco hasta la siguiente
 * foto automática.
 *
 * Aquí se vigila el <html> y, en cuanto cambia su `class` o su `style`,
 * se fuerza una foto completa nueva y se manda de inmediato: el espejo se
 * reconstruye con el tema nuevo en el acto, sin pantallazo blanco.
 */
function vigilarTema(addCustomEvent: (tag: string, payload: any) => void): void {
  try {
    observadorTema?.disconnect();
    observadorTema = new MutationObserver(() => {
      try {
        // Avisa a la consola de que lo que viene es un cambio de tema,
        // para que remonte el espejo en vez de intentar parchearlo.
        addCustomEvent('tema', { clase: document.documentElement.className });
        tomarFoto?.(true);
      } catch { /* si rrweb ya paró, no pasa nada */ }
      void volcar();
    });
    observadorTema.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme'],
    });
  } catch { /* sin MutationObserver: se autocura en el checkout periódico */ }
}

async function empezarAGrabar(): Promise<void> {
  if (grabando) return;
  grabando = true;
  buffer = [];
  try {
    const { record, pack, addCustomEvent } = await import('rrweb');
    tomarFoto = (isCheckout?: boolean) => record.takeFullSnapshot?.(isCheckout);

    detenerGrabacion = record({
      emit(evento: any) {
        buffer.push(evento);
        // Umbral bajo: en pantallas con mucho movimiento vuelca enseguida
        // para que el espejo no se atrase.
        if (buffer.length >= 20) void volcar();
      },
      // Comprime cada evento. Sin esto una foto completa con los estilos
      // dentro no cabría en un mensaje del canal.
      packFn: pack,
      recordCanvas: false,
      collectFonts: false,
      // Deja las hojas de estilo dentro de la foto: sin esto el panel
      // interior podía renderizarse sin estilos y verse "en blanco".
      inlineStylesheet: true,
      maskAllInputs: false,
      // 'all' emite CADA tecla en vivo. El valor por defecto ('last') solo
      // manda el contenido del input al perder el foco — por eso no se veía
      // teclear el chat, ni los montos ni los datos de facturación en vivo.
      sampling: { input: 'all' },
      // Re-emite una foto COMPLETA cada 12 s. Si la consola se engancha un
      // instante tarde o se pierde la foto inicial, se autocura en el
      // próximo checkout en vez de quedar con el interior en blanco.
      checkoutEveryNms: 12000,
    }) || null;

    vigilarTema(addCustomEvent);

    // 100 ms: con el canal de broadcast el viaje ya no pasa por la base,
    // así que el único retraso que queda es este intervalo. La contraseña
    // sigue enmascarada por rrweb (comportamiento por defecto), que es lo
    // único que no debe viajar ni siquiera al Superadmin.
    flushTimer = setInterval(() => void volcar(), 100);
    // La foto inicial sale de inmediato para enganchar rápido.
    setTimeout(() => void volcar(), 0);
  } catch {
    grabando = false;
  }
}

async function pararDeGrabar(): Promise<void> {
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  if (observadorTema) { try { observadorTema.disconnect(); } catch { /* nada */ } observadorTema = null; }
  if (detenerGrabacion) { try { detenerGrabacion(); } catch { /* ya parado */ } detenerGrabacion = null; }
  tomarFoto = null;
  await volcar();
  buffer = [];
  grabando = false;
  // Limpia los lotes propios del respaldo: el espejo es en vivo, no un
  // archivo. RLS permite borrar solo lo de uno mismo.
  if (userId) { try { await supabase.from('supervision_events').delete().eq('user_id', userId); } catch { /* nada */ } }
}

/** Arranca latido + escucha de control. Solo para personal. Idempotente. */
export function iniciarSupervision(user: User): void {
  if (typeof window === 'undefined' || !user || !esStaff(user.role)) return;
  detenerSupervision();
  userId = user.id;
  void latido(user);
  latidoTimer = setInterval(() => void latido(user), 10000);

  // Canal privado del espejo. Se deja abierto desde el principio para que
  // la primera foto salga sin esperar a negociar nada.
  try {
    canalEspejo = supabase.channel(`espejo:${user.id}`, { config: { private: true } });
    canalEspejo.subscribe((estado: string) => { espejoListo = estado === 'SUBSCRIBED'; });
  } catch { espejoListo = false; }

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
  if (latidoTimer) { clearInterval(latidoTimer); latidoTimer = null; }
  if (canalControl) { try { supabase.removeChannel(canalControl); } catch { /* nada */ } canalControl = null; }
  void pararDeGrabar();
  const id = userId;
  if (canalEspejo) { try { supabase.removeChannel(canalEspejo); } catch { /* nada */ } canalEspejo = null; }
  espejoListo = false;
  // Retira la ficha de presencia: si cerró sesión, no debe seguir
  // apareciendo como conectado en la consola del Superadmin.
  if (id) { try { void supabase.from('supervision_state').delete().eq('user_id', id); } catch { /* nada */ } }
  userId = null;
}
