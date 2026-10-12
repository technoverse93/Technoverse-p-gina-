// =====================================================================
// «OYE PHILL» — puente con el complemento nativo
// =====================================================================
// Un servicio del teléfono (native-android/oye/) espera el llamado «Oye
// Phill» con un reconocedor de voz que corre EN el teléfono, sin internet, y
// abre Phill en manos libres. Es opcional y empieza apagado: se prende en
// Phill → Ajustes → Oye Phill (ver OyePhillAjustes.tsx), donde se baja el
// «oído» (~40 MB, una sola vez) y se dan los permisos.
//
// Todas las llamadas responden en vez de lanzar: si la APK es vieja (sin el
// complemento) o se está en la web, no hacen nada.
// =====================================================================

import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { esSuperadmin } from '../utils/roles';
import type { EstadoOye } from '../utils/oyePhill';

interface Resp { ok: boolean; error?: string }
type RespEstado = Resp & Partial<EstadoOye>;
export type AjusteAndroid = 'overlay' | 'bateria' | 'notificaciones' | 'app' | 'asistente';
export interface LineaOida { texto: string; fin: boolean; despierta: boolean; motivo: string }

interface PluginOye {
  estado(): Promise<RespEstado>;
  bajarModelo(): Promise<RespEstado>;
  cancelarBajada(): Promise<Resp>;
  borrarModelo(): Promise<RespEstado>;
  vocabulario(o: { frases: string[] }): Promise<Resp & { sabe?: boolean; conocidas?: string[]; desconocidas?: string[] }>;
  configurar(o: { frases?: string[]; sensibilidad?: number }): Promise<RespEstado>;
  iniciar(): Promise<RespEstado>;
  detener(): Promise<RespEstado>;
  pausar(o: { activo: boolean }): Promise<Resp>;
  probar(o: { activo: boolean }): Promise<RespEstado>;
  pedirMicrofono(): Promise<RespEstado>;
  abrirAjuste(o: { cual: AjusteAndroid }): Promise<Resp>;
  addListener(evento: string, fn: (d: any) => void): Promise<PluginListenerHandle>;
}

const P = registerPlugin<PluginOye>('OyePhill');

export const ESTADO_VACIO: EstadoOye = {
  ok: false, version: 0, vosk: false, modeloListo: false, modeloMB: 0, bajando: false, permisoMic: false, notificaciones: true, overlay: false,
  bateriaLibre: false, activo: false, servicio: false, motor: 'apagado', detalle: '', probando: false, sensibilidad: 1, frases: [], ultimoOido: '', ultimaDecision: '', sdk: 0,
};

const aEstado = (r: RespEstado | null | undefined): EstadoOye => ({ ...ESTADO_VACIO, ...(r || {}) } as EstadoOye);
const mal = (error: string): Resp => ({ ok: false, error });

/** Escucha un evento del complemento; devuelve cómo dejar de escucharlo. */
function escuchar(evento: string, fn: (d: any) => void): () => void {
  if (!oyePhill.disponible()) return () => {};
  let handle: PluginListenerHandle | null = null;
  let soltado = false;
  void P.addListener(evento, fn).then(h => { if (soltado) void h.remove(); else handle = h; }).catch(() => { /* sin avisos en vivo */ });
  return () => { soltado = true; void handle?.remove(); };
}

export const oyePhill = {
  /** ¿Se está dentro de la app del teléfono? (aunque sea una APK vieja, sin «Oye Phill») */
  enApp(): boolean {
    return Capacitor.isNativePlatform();
  },
  /** ¿Esta APK trae «Oye Phill»? (una vieja, o la web, no) */
  disponible(): boolean {
    return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('OyePhill');
  },
  async estado(): Promise<EstadoOye> {
    if (!oyePhill.disponible()) return ESTADO_VACIO;
    try { return aEstado(await P.estado()); } catch { return ESTADO_VACIO; }
  },
  /** Baja el oído con su porcentaje (fase: «bajando» o «descomprimiendo»). */
  async bajarModelo(alProgreso?: (fase: string, p: number) => void): Promise<Resp & { estado?: EstadoOye }> {
    const suelta = alProgreso ? escuchar('modelo', (m: { fase: string; progreso: number }) => alProgreso(m.fase, m.progreso)) : () => {};
    try {
      const r = await P.bajarModelo();
      return { ok: !!r.ok, error: r.error, estado: aEstado(r) };
    } catch {
      return mal('No se pudo bajar el oído.');
    } finally { suelta(); }
  },
  async cancelarBajada(): Promise<void> { try { await P.cancelarBajada(); } catch { /* ya terminó */ } },
  async borrarModelo(): Promise<EstadoOye> { try { return aEstado(await P.borrarModelo()); } catch { return ESTADO_VACIO; } },
  async vocabulario(frases: string[]): Promise<{ sabe: boolean; conocidas: string[]; desconocidas: string[] }> {
    try {
      const r = await P.vocabulario({ frases });
      return { sabe: !!r.sabe, conocidas: r.conocidas || [], desconocidas: r.desconocidas || [] };
    } catch { return { sabe: false, conocidas: [], desconocidas: [] }; }
  },
  async configurar(o: { frases?: string[]; sensibilidad?: number }): Promise<EstadoOye> {
    try { return aEstado(await P.configurar(o)); } catch { return ESTADO_VACIO; }
  },
  async iniciar(): Promise<Resp & { estado?: EstadoOye }> {
    try { const r = await P.iniciar(); return { ok: !!r.ok, error: r.error, estado: aEstado(r) }; } catch { return mal('No se pudo activar.'); }
  },
  async detener(): Promise<void> { try { await P.detener(); } catch { /* ya estaba apagado */ } },
  async pausar(activo: boolean): Promise<void> { try { await P.pausar({ activo }); } catch { /* sin servicio */ } },
  async probar(activo: boolean): Promise<Resp> {
    try { const r = await P.probar({ activo }); return { ok: !!r.ok, error: r.error }; } catch { return mal('No se pudo probar.'); }
  },
  async pedirMicrofono(): Promise<EstadoOye> { try { return aEstado(await P.pedirMicrofono()); } catch { return ESTADO_VACIO; } },
  async abrirAjuste(cual: AjusteAndroid): Promise<Resp> { try { return await P.abrirAjuste({ cual }); } catch { return mal('No se pudo abrir esa pantalla.'); } },
  alEstado: (fn: (e: EstadoOye) => void) => escuchar('estado', d => fn(aEstado(d))),
  alOir: (fn: (l: LineaOida) => void) => escuchar('oyo', d => fn({ texto: String(d?.texto ?? ''), fin: !!d?.fin, despierta: !!d?.despierta, motivo: String(d?.motivo ?? '') })),
  alNivel: (fn: (n: number) => void) => escuchar('nivel', d => fn(Math.max(0, Math.min(1, Number(d?.n) || 0)))),
};

/**
 * Al abrir la app: si «Oye Phill» estaba activado y el servicio no corre (se
 * reinició el teléfono o Android lo cerró), se vuelve a prender (la app está a
 * la vista, que es cuando Android lo permite). Solo para la cuenta del dueño:
 * con otra cuenta en el mismo teléfono, se apaga.
 */
export async function restaurarOyePhill(rol?: string | null): Promise<void> {
  if (!oyePhill.disponible()) return;
  const e = await oyePhill.estado();
  if (!e.activo) return;
  if (!esSuperadmin(rol)) { await oyePhill.detener(); return; }
  if (!e.servicio && e.modeloListo && e.permisoMic && e.vosk) await oyePhill.iniciar();
}

/** Al cerrar sesión (o si bloquean el aparato): «Oye Phill» se apaga y queda apagado hasta que se vuelva a prender. */
export async function detenerOyePhill(): Promise<void> {
  if (!oyePhill.disponible()) return;
  await oyePhill.detener();
}
