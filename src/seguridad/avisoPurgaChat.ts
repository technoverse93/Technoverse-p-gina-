// =====================================================================
// AVISO DE CIERRE DEL CHAT (purga global)
// =====================================================================
// Cuando el Superadmin purga los chats, `storage.ts` vacía el estado local
// en el acto y dispara `technoverse_chat_wipe`. Aquí se recoge y se pinta
// el aviso, para que el cliente NO se quede mirando un chat que acaba de
// desaparecer sin explicación.
//
// Por qué en el DOM y no en un componente: el aviso tiene que salir esté
// donde esté la persona —en la tienda, en un modal de chat, en el panel—,
// y sin depender de que el componente de chat siga montado. Justo después
// de la purga ese componente puede haberse desmontado ya, así que colgarlo
// de él sería colgarlo de algo que quizá no existe en ese instante.
//
// Es un aviso, no una barrera: se puede cerrar y la aplicación sigue
// funcionando con normalidad. Lo único que se acabó es la conversación.
// =====================================================================

const ID_AVISO = 'tv-aviso-purga-chat';
/** Se retira solo, para no dejar un cartel pegado toda la sesión. */
const DURACION_MS = 12000;

let temporizador: ReturnType<typeof setTimeout> | null = null;

function quitar(): void {
  document.getElementById(ID_AVISO)?.remove();
  if (temporizador) { clearTimeout(temporizador); temporizador = null; }
}

function mostrar(): void {
  quitar();

  const caja = document.createElement('div');
  caja.id = ID_AVISO;
  caja.setAttribute('role', 'status');
  caja.style.cssText = [
    'position:fixed', 'left:50%', 'transform:translateX(-50%)',
    // Sobre la barra inferior del móvil, respetando el área segura.
    'bottom:calc(18px + env(safe-area-inset-bottom, 0px))',
    'z-index:2147483000', 'max-width:min(440px, calc(100vw - 32px))',
    'display:flex', 'align-items:flex-start', 'gap:10px',
    'padding:12px 14px', 'border-radius:14px',
    'background:#12201b', 'border:1px solid #2a3d34', 'color:#e8efec',
    'font:500 13px/1.45 system-ui,sans-serif',
    'box-shadow:0 18px 40px -18px rgba(0,0,0,.75)',
  ].join(';');

  const icono = document.createElement('span');
  icono.textContent = '💬';
  icono.style.cssText = 'font-size:16px;line-height:1.2;flex:0 0 auto';

  const texto = document.createElement('span');
  texto.style.cssText = 'flex:1 1 auto;min-width:0';
  texto.textContent = 'El chat ha sido finalizado por el administrador.';

  const cerrar = document.createElement('button');
  cerrar.type = 'button';
  cerrar.setAttribute('aria-label', 'Cerrar aviso');
  cerrar.textContent = '✕';
  cerrar.style.cssText =
    'flex:0 0 auto;background:none;border:0;color:#8aa79b;cursor:pointer;' +
    'font-size:13px;padding:0 2px;line-height:1.2';
  cerrar.onclick = quitar;

  caja.append(icono, texto, cerrar);
  document.body.appendChild(caja);

  temporizador = setTimeout(quitar, DURACION_MS);
}

/** Engancha el aviso. Se llama una vez al arrancar la aplicación. */
export function iniciarAvisoDePurga(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('technoverse_chat_wipe', mostrar);
}
