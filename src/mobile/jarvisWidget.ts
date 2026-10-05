// =====================================================================
// PUENTE CON EL MINI-WIDGET NATIVO (native-android/jarvis/)
// =====================================================================
// El widget es Jarvis con la misma sesión de la app (lo pidió el dueño:
// «hacer todo como lo haría con mi sesión», sin huella; el teléfono es solo
// suyo). Se usa EN EL PROPIO RECUADRO de la pantalla de inicio:
//   · Micrófono  → dictado del teléfono; la respuesta aparece (y se lee)
//                  en el widget, sin abrir ninguna ventana (modo «voz»).
//   · Escribir   → Android no deja escribir dentro de un widget: sale solo
//                  una barrita sobre el teclado y la respuesta vuelve al
//                  widget (modo «escribir»).
//   · «Abrir conversación» → Jarvis completo en una hoja (modo «hoja»),
//                  para confirmar acciones, ver tablas o seguir hablando.
// Todo corre en la página `jarvis-rapido.html` (src/rapido.tsx).
//
// Activarlo es encender una marca en el teléfono (Jarvis → Ajustes →
// Mini-widget). Solo existe en la APK con el widget nuevo (`version` 3).
// =====================================================================

import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/** La que entiende esta página: 3 = Jarvis con sesión, usable en el propio recuadro. */
export const VERSION_WIDGET = 3;

export type ModoVentanita = 'hoja' | 'voz' | 'escribir';

export interface PedidoVentanita {
  /** Cómo se abrió: hoja completa, pregunta por voz o barrita para escribir. */
  modo: ModoVentanita;
  /** Lo dictado (modo «voz»), ya pasado a texto por el teléfono. */
  texto?: string;
  /** Compatibilidad: abierta con el micrófono. */
  voz: boolean;
  /** Cuenta de aperturas: cambia con cada toque al widget. */
  n: number;
}

interface PluginJarvisWidget {
  activar(): Promise<{ ok: boolean }>;
  desactivar(): Promise<{ ok: boolean }>;
  estado(): Promise<{ activo: boolean; enVentanita?: boolean; version?: number; modo?: ModoVentanita; conversacion?: string }>;
  ponerEnInicio(): Promise<{ pedido: boolean }>;
  cerrar(): Promise<void>;
  abrirApp(o: { modulo?: string }): Promise<void>;
  ultimaRespuesta(o: { pregunta: string; respuesta: string; conversacion?: string; accion?: boolean }): Promise<void>;
  /** Línea de estado del widget («Pensando…»); vacía la quita. */
  avisar(o: { texto: string }): Promise<void>;
  /** La ventanita deja de tapar: los toques pasan a la pantalla de inicio. */
  soltar(): Promise<void>;
  addListener(evento: 'pedido', fn: (p: PedidoVentanita) => void): Promise<PluginListenerHandle>;
}

const Plugin = registerPlugin<PluginJarvisWidget>('JarvisWidget');

export type EstadoWidget = { activo: boolean; enVentanita: boolean; version: number; modo: ModoVentanita; conversacion: string | null };

const nada = () => { /* fuera de la ventanita o APK vieja: no hay nada que hacer */ };

export const widgetNativo = {
  disponible(): boolean {
    return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('JarvisWidget');
  },
  async estado(): Promise<EstadoWidget> {
    const vacio: EstadoWidget = { activo: false, enVentanita: false, version: 0, modo: 'hoja', conversacion: null };
    if (!this.disponible()) return vacio;
    try {
      const e = await Plugin.estado();
      return { activo: !!e.activo, enVentanita: !!e.enVentanita, version: Number(e.version) || 1, modo: e.modo || 'hoja', conversacion: e.conversacion || null };
    } catch {
      return vacio;
    }
  },
  activar: () => Plugin.activar(),
  desactivar: () => Plugin.desactivar(),
  async ponerEnInicio(): Promise<boolean> {
    try { return (await Plugin.ponerEnInicio()).pedido; } catch { return false; }
  },
  cerrar: () => Plugin.cerrar().catch(nada),
  abrirApp: (modulo?: string) => Plugin.abrirApp(modulo ? { modulo } : {}).catch(nada),
  ultimaRespuesta: (pregunta: string, respuesta: string, extra: { conversacion?: string | null; accion?: boolean } = {}) =>
    Plugin.ultimaRespuesta({
      pregunta: pregunta.slice(0, 300), respuesta: respuesta.slice(0, 1500),
      ...(extra.conversacion ? { conversacion: extra.conversacion } : {}), ...(extra.accion ? { accion: true } : {}),
    }).catch(nada),
  avisar: (texto: string) => Plugin.avisar({ texto }).catch(nada),
  soltar: () => Plugin.soltar().catch(nada),
  alPedir: (fn: (p: PedidoVentanita) => void) => Plugin.addListener('pedido', fn),
};
