// =====================================================================
// PUENTE CON EL MINI-WIDGET NATIVO (native-android/jarvis/)
// =====================================================================
// El widget abre una ventanita ENCIMA de la pantalla de inicio que es el
// mismo Jarvis de la app, con la misma sesión (lo pidió el dueño: «hacer
// todo como lo haría con mi sesión», sin huella; el teléfono es solo suyo).
// Esa ventanita es la página `jarvis-rapido.html` (src/rapido.tsx).
//
// Activarlo es solo encender una marca en el teléfono (Jarvis → Ajustes →
// Mini-widget, con la huella de siempre para entrar a la app). No hay
// llaves aparte: las reglas del servidor son las de tu sesión, y bloquear
// el teléfono o cerrar sus sesiones también apaga el widget.
//
// Solo existe en la APK con el widget nuevo (`version` 2). En la web o en
// una APK más vieja, `disponible()` / `version()` lo dicen.
// =====================================================================

import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/** La que entiende esta página. La APK del widget con llave decía 1 (o nada). */
export const VERSION_WIDGET = 2;

export interface PedidoVentanita {
  /** Se abrió con el micrófono del widget: empezar a escuchar. */
  voz: boolean;
  /** Cuenta de aperturas: cambia con cada toque al widget. */
  n: number;
}

interface PluginJarvisWidget {
  activar(): Promise<{ ok: boolean }>;
  desactivar(): Promise<{ ok: boolean }>;
  estado(): Promise<{ activo: boolean; enVentanita?: boolean; version?: number }>;
  /** Abre el aviso de Android para poner el widget en la pantalla de inicio. */
  ponerEnInicio(): Promise<{ pedido: boolean }>;
  /** Solo en la ventanita: la cierra. */
  cerrar(): Promise<void>;
  /** Solo en la ventanita: abre la app (en un módulo, si se indica) y la cierra. */
  abrirApp(o: { modulo?: string }): Promise<void>;
  /** La última pregunta y respuesta, para mostrarla en el widget. */
  ultimaRespuesta(o: { pregunta: string; respuesta: string }): Promise<void>;
  addListener(evento: 'pedido', fn: (p: PedidoVentanita) => void): Promise<PluginListenerHandle>;
}

const Plugin = registerPlugin<PluginJarvisWidget>('JarvisWidget');

export type EstadoWidget = { activo: boolean; enVentanita: boolean; version: number };

export const widgetNativo = {
  disponible(): boolean {
    return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('JarvisWidget');
  },
  async estado(): Promise<EstadoWidget> {
    if (!this.disponible()) return { activo: false, enVentanita: false, version: 0 };
    try {
      const e = await Plugin.estado();
      return { activo: !!e.activo, enVentanita: !!e.enVentanita, version: Number(e.version) || 1 };
    } catch {
      return { activo: false, enVentanita: false, version: 0 };
    }
  },
  activar: () => Plugin.activar(),
  desactivar: () => Plugin.desactivar(),
  async ponerEnInicio(): Promise<boolean> {
    try { return (await Plugin.ponerEnInicio()).pedido; } catch { return false; }
  },
  cerrar: () => Plugin.cerrar().catch(() => { /* fuera de la ventanita no hay nada que cerrar */ }),
  abrirApp: (modulo?: string) => Plugin.abrirApp(modulo ? { modulo } : {}).catch(() => { /* nada */ }),
  ultimaRespuesta: (pregunta: string, respuesta: string) =>
    Plugin.ultimaRespuesta({ pregunta: pregunta.slice(0, 300), respuesta: respuesta.slice(0, 600) }).catch(() => { /* el widget queda como estaba */ }),
  alPedir: (fn: (p: PedidoVentanita) => void) => Plugin.addListener('pedido', fn),
};
