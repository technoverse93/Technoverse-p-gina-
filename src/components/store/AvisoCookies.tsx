// =====================================================================
// AVISO DE COOKIES
// =====================================================================
// El aviso de siempre, discreto, al pie de la tienda: dice que el sitio usa cookies y
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
// Es una tarjeta chica y NO bloqueante: una sola fila (texto, «Aceptar» y la
// X), sin fondo oscuro y sin tapar el contenido. En teléfono queda por encima
// del botón del chat (no lo tapa); en pantalla grande, en la esquina inferior
// izquierda, lejos de lo que se mira y del chat. Con la letra del teléfono
// enorme solo crece el texto (que se desplaza); el botón queda siempre a la vista.
// =====================================================================

import { useEffect, useState } from 'react';
import { alCambiarPanel } from '../../utils/panelTienda';
import { X } from 'lucide-react';

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
  // Mientras el chat está abierto el aviso se aparta (sin darse por visto): antes tapaba el botón
  // «Iniciar chat seguro». Al cerrar el chat vuelve.
  const [chatAbierto, setChatAbierto] = useState(false);
  useEffect(() => alCambiarPanel((panel, abierto) => { if (panel === 'chat') setChatAbierto(abierto); }), []);

  if (!visible || chatAbierto) return null;

  // Aceptar y cerrar son lo mismo: se da por conocido, se guarda y se desmonta.
  const cerrar = () => {
    recordarQueLoVio();
    setVisible(false);
  };

  return (
    // El contenedor no captura toques (`pointer-events-none`): solo la tarjeta. En teléfono sube por encima del botón
    // flotante del chat (que vive abajo a la derecha); desde `md` va en la esquina inferior izquierda, chica.
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5.25rem+env(safe-area-inset-bottom,0px))] z-[60] px-3 md:bottom-5 md:right-auto md:px-0 md:pl-5">
      <div
        role="region"
        aria-label="Aviso de cookies"
        className="pointer-events-auto flex w-full items-center gap-2.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] py-2 pl-3 pr-1.5 shadow-[var(--float-shadow-lg)] md:max-w-[24rem]"
      >
        {/* Solo el texto se desplaza si la letra del teléfono es enorme: el botón queda siempre a la vista. */}
        <p className="max-h-[30dvh] min-w-0 flex-1 overflow-y-auto text-[11.5px] leading-snug" style={{ color: 'var(--text-secondary)' }}>
          Usamos cookies para que la tienda funcione y para proteger el sitio.{' '}
          <button
            type="button"
            onClick={verMasInformacion}
            className="font-semibold underline underline-offset-2"
            style={{ color: 'var(--text-primary)' }}
          >
            Más información
          </button>
        </p>
        <button
          type="button"
          onClick={cerrar}
          className="flex-shrink-0 rounded-lg px-3.5 py-1.5 text-[12px] font-bold whitespace-nowrap"
          style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
        >
          Aceptar
        </button>
        <button
          type="button"
          onClick={cerrar}
          aria-label="Cerrar aviso de cookies"
          className="flex-shrink-0 rounded-lg p-1.5"
          style={{ color: 'var(--text-muted)' }}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
