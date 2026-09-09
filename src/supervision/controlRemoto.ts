// =====================================================================
// CONTROL REMOTO ASISTIDO — receptor (objetivo) y emisor (superadmin)
// =====================================================================
// El espejo (motorEspejo.ts) manda el DOM del objetivo HACIA el panel.
// Esto es lo inverso y complementario: lleva los comandos de entrada del
// superadmin HACIA el objetivo, que los aplica sobre SU PROPIA sesión.
//
// LO QUE NUNCA PASA: la pantalla del superadmin no se transmite a nadie.
// Solo viaja el comando (un clic en tal punto, un scroll, un texto). El
// objetivo ve su propia pantalla, como siempre; el superadmin la ve por
// el espejo que ya existía.
//
// AUTORIZACIÓN (ver migracion_control_remoto.sql):
//   · Empleados: sin prompt. Al iniciar sesión en equipo empresarial el
//     receptor queda armado (llave = user.id). Igual SIEMPRE se ve un
//     indicador de "soporte activo".
//   · Clientes: se arma SOLO si autorizan desde el pie de página
//     (components/store/SoporteRemoto.tsx). Sin autorización, no se abre.
//   · ENVIAR comandos es solo del superadmin (lo sostiene la RLS del
//     canal, no la confianza del cliente).
//
// COORDENADAS RELATIVAS, NO ABSOLUTAS
// ---------------------------------------------------------------------
// El comando viaja como fracción [0..1] del viewport del objetivo, no en
// píxeles. Así da igual que el panel vea la pantalla escalada: el clic
// cae en el mismo elemento sin importar el tamaño de cada lado.
// =====================================================================

import { supabase } from '../supabaseClient';

function tema(llave: string): string {
  return `control:${llave}`;
}

// ---------------------------------------------------------------------
// COMANDOS
// ---------------------------------------------------------------------
export type ComandoControl =
  | { t: 'click'; xr: number; yr: number }
  | { t: 'clic-derecho'; xr: number; yr: number }
  | { t: 'scroll'; dyr: number }
  | { t: 'texto'; v: string }
  | { t: 'tecla'; k: string }
  | { t: 'fin' };

// =====================================================================
// RECEPTOR — vive en el aparato del objetivo (cliente o empleado)
// =====================================================================
export interface ReceptorControl {
  detener: () => void;
}

/**
 * Después de este tiempo sin recibir un comando nuevo, se da el control
 * por pausado y se retira el indicador. Un empleado puede pasar todo su
 * turno con el receptor ARMADO —listo para recibir— sin que nadie lo
 * esté controlando en ese momento; el indicador debe reflejar lo segundo,
 * no lo primero. Antes se mostraba desde el arranque, y se quedaba fijo
 * arriba de la pantalla TODO el turno, tapando la barra superior y el
 * centro de notificaciones — el bug real detrás de "queda atrapado en la
 * gaveta al iniciar sesión".
 */
const INACTIVIDAD_OCULTA_MS = 4000;

export function iniciarReceptorControl(
  llave: string,
  opciones?: { discreto?: boolean; alCortar?: () => void }
): ReceptorControl {
  let activo = true;
  let canal: any = null;
  let indicador: HTMLElement | null = null;
  let relojInactividad: ReturnType<typeof setTimeout> | null = null;

  function ocultarIndicador(): void {
    if (relojInactividad) { clearTimeout(relojInactividad); relojInactividad = null; }
    try { indicador?.remove(); } catch { /* nada */ }
    indicador = null;
  }

  function mostrarIndicador(): void {
    if (indicador) return; // ya visible
    indicador = crearIndicador(!!opciones?.discreto, () => detener());
  }

  /** Un comando real llegó: se ve el aviso, y se reinicia el reloj de silencio. */
  function marcarActividad(): void {
    mostrarIndicador();
    if (relojInactividad) clearTimeout(relojInactividad);
    relojInactividad = setTimeout(ocultarIndicador, INACTIVIDAD_OCULTA_MS);
  }

  function detener(): void {
    if (!activo) return;
    activo = false;
    try { if (canal) supabase.removeChannel(canal); } catch { /* nada */ }
    canal = null;
    ocultarIndicador();
    try { opciones?.alCortar?.(); } catch { /* nada */ }
  }

  try {
    canal = supabase.channel(tema(llave), { config: { private: true } });
    canal.on('broadcast', { event: 'cmd' }, (m: any) => {
      if (!activo) return;
      const fin = m?.payload?.t === 'fin';
      if (!fin) marcarActividad();
      try { aplicarComando(m?.payload as ComandoControl); } catch { /* un comando suelto no debe romper la sesión */ }
      if (fin) ocultarIndicador();
    });
    canal.subscribe();
  } catch {
    // Si el canal no abre, no hay nada que prometer: se queda inactivo,
    // sin indicador y sin poder recibir comandos.
    activo = false;
  }

  return { detener };
}

/**
 * Aplica UN comando sobre el DOM local. Todo por coordenadas relativas y
 * eventos sintéticos: nunca navega a otra página ni toca almacenamiento.
 */
function aplicarComando(cmd: ComandoControl | undefined): void {
  if (!cmd || typeof window === 'undefined') return;

  if (cmd.t === 'scroll') {
    window.scrollBy({ top: cmd.dyr * window.innerHeight, behavior: 'auto' });
    return;
  }

  if (cmd.t === 'click') {
    const x = Math.round(cmd.xr * window.innerWidth);
    const y = Math.round(cmd.yr * window.innerHeight);
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    if (!el) return;
    try { el.focus?.({ preventScroll: true } as any); } catch { /* algunos no enfocan */ }
    const comun = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
    el.dispatchEvent(new PointerEvent('pointerdown', comun as any));
    el.dispatchEvent(new MouseEvent('mousedown', comun));
    el.dispatchEvent(new PointerEvent('pointerup', comun as any));
    el.dispatchEvent(new MouseEvent('mouseup', comun));
    el.dispatchEvent(new MouseEvent('click', comun));
    return;
  }

  if (cmd.t === 'clic-derecho') {
    // Pensado para el "modo trackpad" del control desde un celular: el
    // gesto que en una laptop es un dos-dedos-toque, acá es un botón
    // aparte que manda esto en vez de 'click'. Solo dispara `contextmenu`
    // —lo que abre los menús contextuales de la web—, nunca `click`.
    const x = Math.round(cmd.xr * window.innerWidth);
    const y = Math.round(cmd.yr * window.innerHeight);
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    if (!el) return;
    const comun = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window, button: 2 };
    el.dispatchEvent(new MouseEvent('contextmenu', comun));
    return;
  }

  if (cmd.t === 'texto') {
    const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
    if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA' && !(el as any).isContentEditable)) return;
    escribirEnCampo(el, cmd.v);
    return;
  }

  if (cmd.t === 'tecla') {
    const el = (document.activeElement as HTMLElement) || document.body;
    const init = { key: cmd.k, bubbles: true, cancelable: true } as KeyboardEventInit;
    el.dispatchEvent(new KeyboardEvent('keydown', init));
    if (cmd.k === 'Backspace') {
      const campo = el as HTMLInputElement;
      if (campo && typeof campo.value === 'string') escribirEnCampo(campo, campo.value.slice(0, -1), true);
    }
    el.dispatchEvent(new KeyboardEvent('keyup', init));
    return;
  }
}

/**
 * Escribe en un input/textarea controlado por React. Poner `.value` a
 * secas no dispara el onChange de React; hay que usar el setter nativo y
 * emitir un evento `input` para que el estado del componente se entere.
 */
function escribirEnCampo(el: HTMLInputElement | HTMLTextAreaElement, valor: string, reemplazar = false): void {
  try {
    const nuevo = reemplazar ? valor : (el.value + valor);
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, nuevo); else el.value = nuevo;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } catch { /* campo raro: se ignora */ }
}

/**
 * Indicador de "soporte activo". Imperativo (no React) para que funcione
 * igual en la tienda y en el panel sin cablearlo por ningún árbol. Para
 * el cliente lleva botón "Cortar"; para el empleado es un distintivo
 * discreto, informativo (el arranque/paro lo maneja el superadmin), pero
 * SIEMPRE visible: la persona debe poder saber que la están asistiendo.
 */
function crearIndicador(discreto: boolean, alCortar: () => void): HTMLElement {
  const barra = document.createElement('div');
  barra.setAttribute('data-tv-control', '1');
  barra.style.cssText = [
    'position:fixed', 'z-index:2147483647', 'left:50%', 'transform:translateX(-50%)',
    'top:' + (discreto ? '8px' : '10px'),
    'display:flex', 'align-items:center', 'gap:10px',
    'padding:' + (discreto ? '4px 10px' : '8px 14px'),
    'border-radius:999px', 'font:600 12px/1.2 system-ui,sans-serif',
    'color:#fff', 'background:' + (discreto ? 'rgba(15,118,110,0.92)' : '#0f766e'),
    'box-shadow:0 6px 20px -6px rgba(0,0,0,0.5)', 'pointer-events:auto', 'max-width:92vw',
  ].join(';');

  const punto = document.createElement('span');
  punto.style.cssText = 'width:8px;height:8px;border-radius:999px;background:#fff;animation:tvpulse 1.2s infinite';
  const texto = document.createElement('span');
  texto.textContent = discreto ? 'Soporte técnico activo' : 'Soporte remoto activo — un técnico está asistiendo tu pantalla';
  barra.appendChild(punto);
  barra.appendChild(texto);

  if (!discreto) {
    const cortar = document.createElement('button');
    cortar.type = 'button';
    cortar.textContent = 'Cortar';
    cortar.style.cssText = 'margin-left:4px;padding:4px 12px;border-radius:999px;border:0;font:700 12px system-ui,sans-serif;color:#0f766e;background:#fff;cursor:pointer';
    cortar.addEventListener('click', () => alCortar());
    barra.appendChild(cortar);
  }

  try {
    if (!document.getElementById('tv-control-kf')) {
      const kf = document.createElement('style');
      kf.id = 'tv-control-kf';
      kf.textContent = '@keyframes tvpulse{0%,100%{opacity:1}50%{opacity:.25}}';
      document.head.appendChild(kf);
    }
    document.body.appendChild(barra);
  } catch { /* sin DOM: nada que mostrar */ }
  return barra;
}

// =====================================================================
// EMISOR — vive en el panel del superadmin
// =====================================================================
export interface EmisorControl {
  enviar: (cmd: ComandoControl) => void;
  cerrar: () => void;
}

export function abrirEmisorControl(llave: string): EmisorControl {
  let listo = false;
  let canal: any = null;
  try {
    canal = supabase.channel(tema(llave), { config: { private: true } });
    canal.subscribe((estado: string) => { listo = estado === 'SUBSCRIBED'; });
  } catch { /* sin canal: enviar será no-op */ }

  return {
    enviar: (cmd) => {
      if (!canal || !listo) return;
      try { void canal.send({ type: 'broadcast', event: 'cmd', payload: cmd }); } catch { /* comando perdido */ }
    },
    cerrar: () => {
      try { if (canal) { void canal.send({ type: 'broadcast', event: 'cmd', payload: { t: 'fin' } }); supabase.removeChannel(canal); } } catch { /* nada */ }
      canal = null;
      listo = false;
    },
  };
}
