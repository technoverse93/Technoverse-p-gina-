// =====================================================================
// PANTALLA COMPLETA NATIVA — Android, vía MediaProjection + WebRTC
// =====================================================================
// La contraparte de `capturaPantalla.ts` para cuando `getDisplayMedia` no
// existe (todo navegador móvil y el WebView de la APK). En Android SÍ hay
// una API de sistema operativo que captura la pantalla real —barra de
// notificaciones, otras apps— pero es nativa (MediaProjection), no algo
// que el WebView pueda pedir por su cuenta. `PantallaNativaPlugin.kt` +
// `CapturaPantallaService.kt` (`native-android/`) hacen ese trabajo del
// lado de Kotlin; este archivo solo puentea la señalización.
//
// SEÑALIZACIÓN COMPARTIDA CON ESCRITORIO
// ---------------------------------------------------------------------
// Se reutiliza el MISMO canal privado de Supabase Realtime
// (`temaDePantalla`) y la MISMA presencia (`anunciarPantallaDisponible`)
// que `capturaPantalla.ts` — así la Consola de Supervisión y
// `VisorPantallaCompleta.tsx` no necesitan saber si del otro lado hay un
// navegador de escritorio o una APK Android: ven la misma clave, en el
// mismo formato de oferta/respuesta/hielo, sin código nuevo de ese lado.
//
// iOS NO EXISTE AQUÍ, Y NO ES UN OLVIDO
// ---------------------------------------------------------------------
// La función equivalente en iOS (Broadcast Upload Extension) solo la
// puede arrancar la propia persona, a mano, desde el Centro de Control —
// ningún clic dentro de una app la dispara. Es una política de Apple, no
// una limitación de este código. Este módulo se activa SOLO en Android
// nativo (`puedeCompartirPantallaNativa()`).
//
// FLAG_SECURE: LA ADVERTENCIA QUE HAY QUE LEER ANTES DE PROBARLO
// ---------------------------------------------------------------------
// Si la cuenta de quien usa el teléfono tiene puesto el escudo DLP —la
// regla por defecto para todo el personal, salvo quien esté en la lista
// blanca con `allow_apk`—, Android pinta en NEGRO cualquier captura de
// esta app, incluida esta misma pantalla completa: es el sistema
// operativo protegiendo la ventana de CUALQUIER captura, sin excepción
// para la propia app. Para que el Superadmin vea contenido real hace
// falta el permiso `allow_apk` de esa cuenta en la Consola de Capturas —
// el mismo interruptor que ya la exime del escudo general. Sin eso, esta
// función pide el permiso, arranca el servicio y transmite… un rectángulo
// negro. No es un bug de este archivo: es Android.
// =====================================================================

import { registerPlugin, Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { supabase } from '../supabaseClient';
import { temaDePantalla, anunciarPantallaDisponible, retirarAnuncioPantalla } from './capturaPantalla';
import type { EstadoPantalla, ManejadorPantalla } from './capturaPantalla';

interface EventoHielo { candidato: string; sdpMid: string; sdpMLineIndex: number }
interface EventoEstado { estado: 'lista' | 'conectado' | 'desconectado' }

interface PantallaNativaPlugin {
  disponible(): Promise<{ disponible: boolean }>;
  iniciar(): Promise<{ ok: boolean }>;
  crearOferta(): Promise<{ sdp: string }>;
  fijarRespuesta(opciones: { sdp: string }): Promise<void>;
  agregarHielo(opciones: { candidato: string; sdpMid: string; sdpMLineIndex: number }): Promise<void>;
  detener(): Promise<void>;
  addListener(
    eventName: 'hielo',
    listenerFunc: (data: EventoHielo) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'estado',
    listenerFunc: (data: EventoEstado) => void
  ): Promise<PluginListenerHandle>;
}

const PantallaNativa = registerPlugin<PantallaNativaPlugin>('PantallaNativa');

/** Solo Android nativo: ni web, ni iOS, ni la vista previa del navegador. */
export function puedeCompartirPantallaNativa(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  } catch {
    return false;
  }
}

let activo = false;
let canal: any = null;
let listeners: PluginListenerHandle[] = [];

function limpiar(): void {
  activo = false;
  listeners.forEach(l => { try { l.remove(); } catch { /* nada */ } });
  listeners = [];
  try { if (canal) supabase.removeChannel(canal); } catch { /* nada */ }
  canal = null;
  retirarAnuncioPantalla();
}

/** Corta la sesión nativa actual, si hay una. Llamar al cerrar sesión o al cerrar la app. */
export function detenerPantallaCompletaNativa(): void {
  if (!activo) return;
  limpiar();
  void PantallaNativa.detener().catch(() => { /* nada */ });
}

/**
 * Arranca el ofrecimiento nativo. DEBE llamarse desde un gesto real
 * (clic/toque) — el permiso de MediaProjection lo exige, igual que
 * `getDisplayMedia` en escritorio. Se engancha al mismo gesto de login
 * del personal que ya pide cámara y pantalla completa de escritorio.
 */
export async function ofrecerPantallaCompletaNativa(
  clave: string,
  alCambiarEstado: (e: EstadoPantalla) => void
): Promise<ManejadorPantalla> {
  if (!puedeCompartirPantallaNativa()) {
    alCambiarEstado('sin-soporte');
    return { detener: () => {} };
  }
  detenerPantallaCompletaNativa();

  const disponibilidad = await PantallaNativa.disponible().catch(() => ({ disponible: false }));
  if (!disponibilidad.disponible) {
    alCambiarEstado('sin-soporte');
    return { detener: () => {} };
  }

  alCambiarEstado('pidiendo-permiso');
  const resultado = await PantallaNativa.iniciar().catch(() => ({ ok: false }));
  if (!resultado.ok) {
    // La persona cerró el selector nativo de Android sin autorizar, o el
    // sistema lo denegó. Respuesta válida, igual que "Rechazar".
    alCambiarEstado('rechazada');
    return { detener: () => {} };
  }

  activo = true;
  canal = supabase.channel(temaDePantalla(clave), { config: { private: true } });

  canal.on('broadcast', { event: 'pedir-oferta' }, async () => {
    if (!activo) return;
    try {
      const { sdp } = await PantallaNativa.crearOferta();
      await canal.send({ type: 'broadcast', event: 'oferta', payload: { sdp: { type: 'offer', sdp } } });
    } catch { /* el visor reintenta si no llega respuesta */ }
  });

  canal.on('broadcast', { event: 'respuesta' }, async (m: any) => {
    if (!activo) return;
    try { await PantallaNativa.fijarRespuesta({ sdp: m.payload.sdp.sdp }); } catch { /* nada */ }
  });

  canal.on('broadcast', { event: 'hielo-visor' }, async (m: any) => {
    if (!activo) return;
    try {
      await PantallaNativa.agregarHielo({
        candidato: m.payload.c.candidate,
        sdpMid: m.payload.c.sdpMid ?? '',
        sdpMLineIndex: m.payload.c.sdpMLineIndex ?? 0,
      });
    } catch { /* nada */ }
  });

  const hieloListener = await PantallaNativa.addListener('hielo', (d) => {
    if (!activo || !canal) return;
    try {
      void canal.send({
        type: 'broadcast',
        event: 'hielo-emisor',
        payload: { c: { candidate: d.candidato, sdpMid: d.sdpMid, sdpMLineIndex: d.sdpMLineIndex } },
      });
    } catch { /* nada */ }
  });
  const estadoListener = await PantallaNativa.addListener('estado', (d) => {
    if (d.estado === 'conectado') alCambiarEstado('transmitiendo');
    else if (d.estado === 'desconectado') alCambiarEstado('lista');
  });
  listeners = [hieloListener, estadoListener];

  canal.subscribe();
  anunciarPantallaDisponible(clave);
  alCambiarEstado('lista');

  return { detener: () => detenerPantallaCompletaNativa() };
}
