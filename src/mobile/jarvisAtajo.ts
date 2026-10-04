// =====================================================================
// ATAJO A JARVIS — widget de la pantalla de inicio y atajo del ícono
// =====================================================================
// El widget nativo (native-android/JarvisWidget.java) y el atajo de
// mantener presionado el ícono abren la app con `technoverse://jarvis`
// (`?voz=1` para empezar a escuchar de una). Aquí se recibe ese enlace,
// se lleva al panel si hacía falta y se avisa con el evento `tv:jarvis`.
//
// El pedido queda guardado unos segundos en sessionStorage: si el panel
// todavía no está montado (arranque en frío, bloqueo con huella), lo
// recoge en cuanto aparece. Abrir Jarvis no salta ninguna seguridad: usa
// la sesión del panel, y sin sesión se ve el inicio de sesión de siempre.
// =====================================================================

import { isNative } from './platform';

const CLAVE = 'tv_jarvis_pedido';
const VIGENCIA_MS = 60_000;
export const EVENTO_JARVIS = 'tv:jarvis';
export type PedidoJarvis = { voz: boolean; en: number };

function manejar(url: string | undefined | null): void {
  if (!url || !/^technoverse:\/\/jarvis/i.test(url)) return;
  const pedido: PedidoJarvis = { voz: /[?&]voz=1/.test(url), en: Date.now() };
  try { sessionStorage.setItem(CLAVE, JSON.stringify(pedido)); } catch { /* sin almacenamiento: va solo el evento */ }
  if (!window.location.pathname.startsWith('/admin')) {
    window.history.pushState(null, '', '/admin');
    window.dispatchEvent(new PopStateEvent('popstate'));
  }
  window.dispatchEvent(new CustomEvent(EVENTO_JARVIS, { detail: pedido }));
}

/** Lo que haya pendiente (y lo consume). */
export function tomarPedidoJarvis(): PedidoJarvis | null {
  try {
    const crudo = sessionStorage.getItem(CLAVE);
    if (!crudo) return null;
    sessionStorage.removeItem(CLAVE);
    const p = JSON.parse(crudo) as PedidoJarvis;
    return Date.now() - p.en < VIGENCIA_MS ? p : null;
  } catch { return null; }
}

/** Se llama una vez al arrancar la app. Solo hace algo en la APK. */
export async function iniciarAtajoJarvis(): Promise<void> {
  if (!isNative()) return;
  try {
    const { App } = await import('@capacitor/app');
    void App.addListener('appUrlOpen', e => manejar(e.url));
    const inicio = await App.getLaunchUrl();
    manejar(inicio?.url);
  } catch { /* sin el complemento: el widget abre la app y nada más */ }
}
