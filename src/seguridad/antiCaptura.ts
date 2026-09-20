// =====================================================================
// ANTI-CAPTURA WEB — lo que un navegador SÍ puede hacer
// =====================================================================
// Regla: NADIE captura, salvo UNA excepción explícita — la cuenta del
// administrador (mismo correo que gobierna Ubicaciones/Supervisión, ver
// `esAdminSupremo` en securityPin.ts). App.tsx llama a
// `fijarExencionAntiCaptura(esAdminSupremo(currentUser?.email))` cada vez
// que cambia la sesión; mientras esa sesión esté abierta, este escudo no
// hace nada. Para cualquier otra cuenta o sin sesión, el bloqueo sigue
// intacto.
//
// Los listeners quedan SIEMPRE puestos (no se agregan ni se quitan según
// la sesión): lo que cambia es si el EFECTO se aplica o no. Así no hay
// carrera posible entre "todavía no sé quién inició sesión" y un evento
// que llega justo en ese instante.
//
// Tres defensas, todas del NAVEGADOR (el bloqueo REAL de Android está en
// flagSecure.ts, que lo aplica el sistema operativo):
//
//   1. LÁMINA "NO SE PERMITEN CAPTURAS" — una capa que tapa TODA la
//      pantalla, en negro y con el aviso, en cuanto la ventana pierde el
//      foco o se cambia de app (`blur` / `visibilitychange`). Es lo que
//      hace VISIBLE el bloqueo también en la web: la mayoría de las
//      herramientas de captura y de grabación sacan el foco de la página
//      o la mandan a segundo plano un instante, y en ese instante lo que
//      hay para capturar es la lámina, no el contenido. También tapa la
//      miniatura del conmutador de apps al minimizar.
//
//   2. IMPRESIÓN EN BLANCO — `@media print` oculta el documento al
//      imprimir o "Guardar como PDF".
//
//   3. PrintScreen — al soltar la tecla se pisa el portapapeles, así una
//      captura recién tomada no sirve al pegarla.
//
// ---------------------------------------------------------------------
// HONESTIDAD TÉCNICA
// ---------------------------------------------------------------------
// Un sitio web NO puede frenar un PrtScn de hardware instantáneo que NO
// saca el foco de la página (ni la foto de otro teléfono a la pantalla):
// eso es límite del navegador y del sistema, no de este código. La lámina
// cubre los caminos que sí pasan por perder foco/visibilidad, que son la
// mayoría de las apps de captura y de grabación de pantalla.
// =====================================================================

const ID_ESTILO = 'tv-anti-captura-impresion';
const ID_VELO = 'tv-anti-captura-velo';
/** Clase en <html> que la hoja de impresión usa para saltarse el bloqueo. */
const CLASE_EXENTO = 'tv-anti-captura-exento';
let puesto = false;
let exento = false;

/**
 * Concede o retira la excepción, en vivo. Al conceder mientras la lámina
 * ya estuviera puesta, se quita de inmediato — no hace falta que la
 * persona vuelva a cambiar de pestaña para que deje de verla.
 */
export function fijarExencionAntiCaptura(activa: boolean): void {
  exento = activa;
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.classList.toggle(CLASE_EXENTO, activa);
  }
  if (activa) ocultarVelo();
}

// ---------------------------------------------------------------------
// 1. Lámina "no se permiten capturas"
// ---------------------------------------------------------------------
function crearVelo(): HTMLElement | null {
  if (typeof document === 'undefined' || !document.body) return null;
  let velo = document.getElementById(ID_VELO);
  if (velo) return velo;
  velo = document.createElement('div');
  velo.id = ID_VELO;
  velo.setAttribute('aria-hidden', 'true');
  velo.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:2147483647',
    'display:none', 'flex-direction:column', 'align-items:center',
    'justify-content:center', 'gap:10px', 'text-align:center', 'padding:24px',
    'background:#0b0f0e', 'color:#e6ede9',
    'font:600 15px system-ui,-apple-system,sans-serif',
    'pointer-events:none', 'user-select:none', '-webkit-user-select:none',
  ].join(';');
  velo.innerHTML =
    '<div style="font-size:34px" aria-hidden="true">🔒</div>' +
    '<div>No se permiten capturas de pantalla</div>' +
    '<div style="font-size:12px;opacity:.7;font-weight:500">Contenido protegido de Technoverse</div>';
  document.body.appendChild(velo);
  return velo;
}

function mostrarVelo(): void {
  if (exento) return;
  const v = crearVelo();
  if (v) v.style.display = 'flex';
}

function ocultarVelo(): void {
  const v = document.getElementById(ID_VELO);
  if (v) v.style.display = 'none';
}

function alCambiarVisibilidad(): void {
  if (document.visibilityState === 'hidden') mostrarVelo();
  else ocultarVelo();
}

// ---------------------------------------------------------------------
// 2. Impresión en blanco
// ---------------------------------------------------------------------
function hojaDeImpresion(): void {
  if (document.getElementById(ID_ESTILO)) return;
  const estilo = document.createElement('style');
  estilo.id = ID_ESTILO;
  // `visibility` y no `display:none`: algunos navegadores cancelan la
  // impresión si el documento queda sin caja, y una impresión cancelada
  // deja la duda de si salió algo. Así sale una hoja, pero en blanco.
  // `html:not(.tv-anti-captura-exento)` en cada selector: así la cuenta
  // exenta (fijarExencionAntiCaptura) SÍ puede imprimir normal, sin tener
  // que quitar y volver a poner esta hoja según quién tenga sesión.
  estilo.textContent = `@media print {
    html:not(.${CLASE_EXENTO}) body > * { visibility: hidden !important; }
    html:not(.${CLASE_EXENTO}) body::after {
      content: "Contenido protegido - Technoverse";
      visibility: visible !important;
      position: fixed; inset: 0;
      display: flex; align-items: center; justify-content: center;
      font: 600 12pt system-ui, sans-serif; color: #999;
    }
  }`;
  document.head.appendChild(estilo);
}

// ---------------------------------------------------------------------
// 3. PrintScreen → pisar el portapapeles
// ---------------------------------------------------------------------
function pisarPortapapeles(): void {
  if (exento) return;
  const intentar = () => {
    try {
      if (!document.hasFocus()) return;
      void navigator.clipboard?.writeText('')?.catch?.(() => {});
    } catch { /* sin permiso de portapapeles */ }
  };
  intentar();
  [120, 350, 800, 1500].forEach(ms => setTimeout(intentar, ms));
}

function alTeclear(e: KeyboardEvent): void {
  if (exento) return;
  // Imprimir / Guardar como PDF: se corta antes de abrir el diálogo.
  if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
    e.preventDefault();
    e.stopPropagation();
  }
}

function alSoltarTecla(e: KeyboardEvent): void {
  if (e.key !== 'PrintScreen') return;
  pisarPortapapeles();
}

// ---------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------
/**
 * Activa el escudo web, una sola vez, para toda la aplicación (tienda y
 * panel, con y sin sesión). Idempotente. Ver `fijarExencionAntiCaptura`
 * para la única excepción (la cuenta del administrador).
 */
export function iniciarAntiCaptura(): void {
  if (typeof window === 'undefined' || puesto) return;
  puesto = true;
  crearVelo();
  hojaDeImpresion();
  document.addEventListener('visibilitychange', alCambiarVisibilidad);

  // FALLO CORREGIDO — la lámina tapaba la pantalla al escribir en el
  // celular. En un aparato TÁCTIL, abrir el teclado en pantalla dispara un
  // `blur` de la ventana como comportamiento normal del navegador móvil
  // (el foco pasa un instante al teclado del sistema); no es que la
  // persona haya cambiado de app. Con `blur` puesto ahí, cada vez que un
  // cliente tocaba un campo para escribir, la lámina lo tapaba TODO,
  // texto incluido. `blur`/`focus` solo tienen sentido en escritorio,
  // donde escribir en un campo nunca le quita el foco a la ventana —ahí
  // sí sirve para pescar herramientas de grabación que toman foco sin
  // ocultar la pestaña—. En táctil queda SOLO `visibilitychange`, que
  // sigue cubriendo cambiar de app de verdad o minimizar, y que el
  // teclado en pantalla no dispara nunca.
  const esTactil = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  if (!esTactil) {
    window.addEventListener('blur', mostrarVelo);
    window.addEventListener('focus', ocultarVelo);
  }

  window.addEventListener('keydown', alTeclear, true);
  window.addEventListener('keyup', alSoltarTecla, true);
}
