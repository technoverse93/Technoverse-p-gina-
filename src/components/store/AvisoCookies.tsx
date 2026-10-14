// =====================================================================
// AVISO DE COOKIES
// =====================================================================
// El aviso de siempre, al pie de la tienda: dice que el sitio usa cookies y
// el almacenamiento del navegador, y se va para no volver cuando la persona
// lo acepta o lo cierra. Nada más: no pide ningún permiso del aparato (ni
// ubicación ni cámara) ni agrupa nada tras un «Aceptar». Lo de supervisión
// y ubicación se explica, con todas las letras, en el menú plegable
// «Privacidad y soporte» del pie, al que lleva «Más información».
//
// ---------------------------------------------------------------------
// COMPORTAMIENTO
// ---------------------------------------------------------------------
//   · Aparece mientras la persona no lo haya aceptado ni cerrado.
//   · «Aceptar» y la X hacen lo mismo: dan el aviso por conocido, guardan
//     esa decisión en este aparato y DESMONTAN el aviso (no queda fijo
//     ocupando pantalla, ni vuelve en las visitas siguientes).
//   · El estado inicial se lee de forma SÍNCRONA, antes del primer dibujo:
//     quien ya lo aceptó nunca ve aparecer y desaparecer la franja (la
//     regla de la tienda es que nada parpadea al abrir).
//   · Si el navegador no deja guardar (modo privado, almacenamiento
//     bloqueado), igual se oculta durante esta visita.
//
// Es una franja NO bloqueante: la tienda sigue usable detrás, sin fondo
// oscuro. En teléfono queda por encima del botón del chat (no lo tapa).
// =====================================================================

import { useState } from 'react';
import { Cookie, X } from 'lucide-react';

/** Dónde se recuerda, en este aparato, que la persona ya vio el aviso. */
const CLAVE = 'technoverse_aviso_cookies_v1';

function yaLoVio(): boolean {
  try { return !!localStorage.getItem(CLAVE); } catch { return false; }
}

function recordarQueLoVio(): void {
  try { localStorage.setItem(CLAVE, new Date().toISOString()); } catch { /* sin almacenamiento: se oculta igual esta visita */ }
}

/** Abre el menú «Privacidad y soporte» del pie y lo trae a la vista. */
function verMasInformacion(): void {
  const menu = document.getElementById('privacidad-y-soporte') as HTMLDetailsElement | null;
  if (!menu) return;
  menu.open = true;
  menu.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

export default function AvisoCookies() {
  const [visible, setVisible] = useState(() => !yaLoVio());

  if (!visible) return null;

  // Aceptar y cerrar son lo mismo: se da por conocido, se guarda y se desmonta.
  const cerrar = () => {
    recordarQueLoVio();
    setVisible(false);
  };

  return (
    // El contenedor no captura toques (`pointer-events-none`): solo la tarjeta. En teléfono sube por encima del botón
    // flotante del chat (que vive abajo a la derecha); desde `md` queda centrada y el botón queda a su lado.
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5.25rem+env(safe-area-inset-bottom,0px))] z-[60] flex justify-center px-3 md:bottom-5 md:px-5">
      <div
        role="region"
        aria-label="Aviso de cookies"
        className="pointer-events-auto flex max-h-[45dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-elevated)] shadow-[var(--float-shadow-lg)]"
      >
        {/* El texto es lo único que se desplaza si la letra del teléfono es enorme: los botones quedan siempre a la vista. */}
        <div className="flex min-h-0 flex-1 items-start gap-3 overflow-y-auto p-3.5 pb-2 sm:p-4 sm:pb-2">
          <Cookie className="mt-0.5 h-5 w-5 flex-shrink-0" style={{ color: 'var(--accent)' }} aria-hidden="true" />
          <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            Usamos cookies para que la tienda funcione (carrito, tema y sesión) y para proteger el
            sitio. No usamos cookies de publicidad.
          </p>
          <button
            type="button"
            onClick={cerrar}
            aria-label="Cerrar aviso de cookies"
            className="-mr-1 -mt-1 flex-shrink-0 rounded-lg p-1.5"
            style={{ color: 'var(--text-muted)' }}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="flex flex-none items-center gap-4 px-3.5 pb-3.5 sm:px-4 sm:pb-4 sm:pl-[3.25rem]">
          <button
            type="button"
            onClick={cerrar}
            className="rounded-xl px-5 py-2 text-[13px] font-bold whitespace-nowrap"
            style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
          >
            Aceptar
          </button>
          <button
            type="button"
            onClick={verMasInformacion}
            className="min-w-0 text-[12.5px] font-semibold underline underline-offset-2"
            style={{ color: 'var(--text-primary)' }}
          >
            <span className="tv-btn-label">Más información</span>
          </button>
        </div>
      </div>
    </div>
  );
}
