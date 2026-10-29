// =====================================================================
// ABRIR WHATSAPP AL INSTANTE (banners, producto, carrito, pie de página)
// =====================================================================
// Un enlace https://wa.me/… en el teléfono abre una PESTAÑA nueva, descarga la página de wa.me desde internet y
// recién entonces salta a la app: 2-3 segundos medidos en la tablet (el dueño: «tarda mucho en abrir»). En un
// teléfono o tableta se abre la app directo con `whatsapp://send`; si la app no está instalada (la página sigue a la
// vista pasado un momento), se cae a wa.me. En computadora se abre wa.me en pestaña nueva (WhatsApp Web).
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

function esMovil(): boolean {
  return typeof navigator !== 'undefined' && /android|iphone|ipad|ipod/i.test(navigator.userAgent || '');
}

/** Abre WhatsApp lo más rápido posible. Devuelve false si no es un enlace de WhatsApp (que siga el enlace normal). */
export function abrirWhatsApp(url: string): boolean {
  if (!esEnlaceWhatsApp(url)) return false;
  try {
    const u = new URL(url);
    const numero = u.hostname.toLowerCase() === 'wa.me' ? u.pathname.replace(/\D/g, '') : (u.searchParams.get('phone') || '');
    const texto = u.searchParams.get('text') || '';
    if (!esMovil() || !numero) { window.open(url, '_blank', 'noopener'); return true; }
    const directo = `whatsapp://send?phone=${numero}${texto ? `&text=${encodeURIComponent(texto)}` : ''}`;
    let salio = false;
    const alOcultarse = () => { if (document.hidden) salio = true; };
    document.addEventListener('visibilitychange', alOcultarse);
    window.location.href = directo;
    // Sin la app: la página sigue a la vista; se abre wa.me (que ofrece instalarla o usar la web).
    setTimeout(() => {
      document.removeEventListener('visibilitychange', alOcultarse);
      if (!salio && !document.hidden) window.location.href = url;
    }, 1400);
    return true;
  } catch {
    return false;
  }
}

/** Para el `onClick` de un enlace: si es de WhatsApp lo abre al instante y evita la navegación normal. */
export function alTocarEnlace(e: { preventDefault: () => void }, url?: string | null): void {
  if (url && abrirWhatsApp(url)) e.preventDefault();
}
