// =====================================================================
// ABRIR WHATSAPP AL INSTANTE (banners, producto, carrito, pie de página)
// =====================================================================
// Un enlace https://wa.me/… en el teléfono abre una PESTAÑA nueva, descarga la página de wa.me desde internet y
// recién entonces salta a la app: 2-3 segundos medidos en la tablet (el dueño: «tarda mucho en abrir»). En Android
// se abre la app directo con un «intent» que trae su propio respaldo (wa.me si no hay WhatsApp); en iPhone, con
// `whatsapp://` y respaldo. En computadora se abre wa.me en pestaña nueva (WhatsApp Web).
// =====================================================================

/** El número de la tienda en formato internacional sin signos (506 + 8 dígitos). */
export function numeroWhatsApp(telefono?: string | null): string | null {
  const d = String(telefono || '').replace(/\D/g, '');
  if (d.length === 8) return '506' + d;
  return d.length >= 10 ? d : null;
}

/** Enlace wa.me con el mensaje ya escrito. */
export function enlaceWhatsApp(telefono: string | null | undefined, mensaje?: string): string | null {
  const n = numeroWhatsApp(telefono);
  if (!n) return null;
  return `https://wa.me/${n}${mensaje ? `?text=${encodeURIComponent(mensaje)}` : ''}`;
}

/** ¿Es un enlace a WhatsApp (wa.me o api.whatsapp.com)? */
export function esEnlaceWhatsApp(url?: string | null): boolean {
  return !!url && /^https?:\/\/(wa\.me|api\.whatsapp\.com)\//i.test(url);
}

const esAndroid = () => typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent || '');
const esIOS = () => typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent || '');

/** Abre WhatsApp lo más rápido posible. Devuelve false si no es un enlace de WhatsApp (que siga el enlace normal). */
export function abrirWhatsApp(url: string): boolean {
  if (!esEnlaceWhatsApp(url)) return false;
  try {
    const u = new URL(url);
    const numero = u.hostname.toLowerCase() === 'wa.me' ? u.pathname.replace(/\D/g, '') : (u.searchParams.get('phone') || '');
    const texto = u.searchParams.get('text') || '';
    const consulta = `phone=${numero}${texto ? `&text=${encodeURIComponent(texto)}` : ''}`;
    if (numero && esAndroid()) {
      // Android: un «intent» con su respaldo adentro. Chrome abre WhatsApp (o WhatsApp Business) y SOLO si no hay
      // ninguno instalado va a wa.me. La primera versión usaba un temporizador que preguntaba si la página había
      // quedado oculta; en la tablet Chrome no lo avisa, así que el respaldo se disparaba IGUAL y la pestaña quedaba
      // en la página de wa.me: al volver, la tienda ya no estaba y el siguiente toque «no funcionaba».
      window.location.href = `intent://send/?${consulta}#Intent;scheme=whatsapp;S.browser_fallback_url=${encodeURIComponent(url)};end`;
      return true;
    }
    if (numero && esIOS()) {
      // iPhone: no hay «intent». Se abre la app y, si en 1,5 s la página no perdió el foco ni quedó oculta, no hay
      // app: se va a wa.me. Cualquiera de las tres señales cuenta como «se abrió».
      let salio = false;
      const marcar = () => { salio = true; };
      window.addEventListener('blur', marcar, { once: true });
      window.addEventListener('pagehide', marcar, { once: true });
      document.addEventListener('visibilitychange', marcar, { once: true });
      window.location.href = `whatsapp://send?${consulta}`;
      setTimeout(() => { if (!salio && !document.hidden && document.hasFocus()) window.location.href = url; }, 1500);
      return true;
    }
    window.open(url, '_blank', 'noopener');
    return true;
  } catch {
    return false;
  }
}

/** Para el `onClick` de un enlace: si es de WhatsApp lo abre al instante y evita la navegación normal. */
export function alTocarEnlace(e: { preventDefault: () => void }, url?: string | null): void {
  if (url && abrirWhatsApp(url)) e.preventDefault();
}
