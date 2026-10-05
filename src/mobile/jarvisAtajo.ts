// =====================================================================
// ATAJO A JARVIS — widget de la pantalla de inicio y atajo del ícono
// =====================================================================
// El atajo de mantener presionado el ícono, la marca «Jarvis» del widget
// y el botón «Abrir la app» de su ventanita abren la app con
// `technoverse://jarvis` (`?voz=1` para empezar a escuchar de una;
// `?modulo=taller` para abrir ese módulo en vez de Jarvis, cuando la
// ventanita manda a «Ir a…»). Aquí se recibe ese enlace, se lleva al panel
// si hacía falta y se avisa con el evento `tv:jarvis`. (Lo que se hace en
// la ventanita NO pasa por aquí: es su propia página, src/rapido.tsx.)
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
export type PedidoJarvis = { voz: boolean; en: number; modulo?: string };

export function manejar(url: string | undefined | null): void {
  if (!url || !/^technoverse:\/\/jarvis/i.test(url)) return;
  const modulo = /[?&]modulo=([a-z_]{2,40})(?:&|$)/.exec(url)?.[1];
  const pedido: PedidoJarvis = { voz: /[?&]voz=1/.test(url), en: Date.now(), ...(modulo ? { modulo } : {}) };
  try { sessionStorage.setItem(CLAVE, JSON.stringify(pedido)); } catch { /* sin almacenamiento: va solo el evento */ }
  if (!window.location.pathname.startsWith('/admin')) {
    // En frío, el panel arranca directo en el módulo pedido (lee la dirección).
    window.history.pushState(null, '', modulo ? `/admin/${modulo}` : '/admin');
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
