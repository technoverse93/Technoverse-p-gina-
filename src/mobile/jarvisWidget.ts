// =====================================================================
// PUENTE CON EL MINI-WIDGET NATIVO (native-android/jarvis/)
// =====================================================================
// El mini-widget del teléfono pregunta sin huella y sin abrir la app con
// una LLAVE propia (ver supabase/functions/asistente-ia/llaves.ts). La app
// la pide al servidor y se la entrega aquí a la parte nativa, que la guarda
// cifrada con el Keystore de Android: el JavaScript no la conserva.
//
// Solo existe en la APK nueva (el plugin «JarvisWidget» se registra en
// MainActivity). En la web o en una APK vieja, `disponible()` es falso.
// =====================================================================

import { Capacitor, registerPlugin } from '@capacitor/core';

interface PluginJarvisWidget {
  activar(o: { url: string; llave: string }): Promise<{ ok: boolean }>;
  desactivar(): Promise<{ ok: boolean }>;
  estado(): Promise<{ activo: boolean }>;
  /** Abre el aviso de Android para poner el widget en la pantalla de inicio. */
  ponerEnInicio(): Promise<{ pedido: boolean }>;
}

const Plugin = registerPlugin<PluginJarvisWidget>('JarvisWidget');

export const widgetNativo = {
  disponible(): boolean {
    return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('JarvisWidget');
  },
  async activo(): Promise<boolean> {
    if (!this.disponible()) return false;
    try { return (await Plugin.estado()).activo; } catch { return false; }
  },
  activar: (url: string, llave: string) => Plugin.activar({ url, llave }),
  desactivar: () => Plugin.desactivar(),
  async ponerEnInicio(): Promise<boolean> {
    try { return (await Plugin.ponerEnInicio()).pedido; } catch { return false; }
  },
};
