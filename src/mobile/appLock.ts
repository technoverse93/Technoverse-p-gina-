// =====================================================================
// BLOQUEO POR INACTIVIDAD — re-autenticación obligatoria al volver
// =====================================================================
// DESDE ESTA ORDEN, LA APK Y LA WEB SIGUEN POLÍTICAS DISTINTAS
// ---------------------------------------------------------------------
// Hasta ahora este archivo aplicaba la MISMA regla de "cero tolerancia"
// (cualquier segundo plano, por breve que sea, exige volver a
// autenticarse) tanto en la APK como en el navegador. Esa regla sigue
// intacta para la APK — es la protección real de un teléfono que puede
// perderse o prestarse — pero en la web resultó tedioso y
// contraproducente: cambiar a WhatsApp un segundo y volver ya disparaba
// un candado de verificación, interrumpiendo una compra o un cobro a
// medio llenar sin ningún motivo de seguridad real detrás (una pestaña
// de navegador no se "pierde" ni se la presta nadie).
//
// La orden es explícita: en la web, cambiar de pestaña o minimizar el
// navegador NUNCA debe bloquear ni cerrar la sesión por sí solo. Lo
// único que debe forzar de nuevo la verificación es INACTIVIDAD REAL
// — cero interacción (mouse, teclado, scroll, toques) durante 5 minutos
// exactos — sin importar si la pestaña estuvo visible o en segundo
// plano durante ese lapso.
//
// Por eso `iniciarBloqueoPorInactividad()` bifurca en dos caminos que
// comparten el mismo evento de salida (`EVENTO_FORZAR_REINGRESO`, que
// `App.tsx` ya sabía interpretar) pero se activan por señales distintas:
//
//   · APK  → `vigilarSegundoPlanoNativo()`: sigue exactamente igual que
//     antes, cero tolerancia al segundo plano. Ver su bloque de
//     comentarios más abajo para el porqué de cada pieza.
//   · Web  → `vigilarInactividadReal()`: ignora por completo que la
//     pestaña se oculte o se vuelva a mostrar, y solo actúa tras 5
//     minutos exactos sin ninguna interacción con la página.
// =====================================================================

import { marcarBloqueo } from '../utils/biometriaNativa';

const CLAVE_EN_FONDO_DESDE = 'technoverse_en_fondo_desde';

/**
 * Se dispara cuando hay que exigir de nuevo biometría/contraseña.
 *
 * El evento viaja con `detail.ausenteMs`: milisegundos que se considera
 * que la persona estuvo fuera (calculados de forma distinta según el
 * camino — ver cada uno). `App.tsx` lo usa SOLO para decidir si restaura
 * la pantalla actual o cierra sesión — la exigencia de re-autenticación
 * en sí es incondicional en ambos caminos.
 */
export const EVENTO_FORZAR_REINGRESO = 'technoverse_forzar_reingreso';

/** Umbral de "ausencia breve": por debajo de esto se restaura la pantalla en vez de cerrar sesión. */
export const UMBRAL_REINGRESO_RAPIDO_MS = 2 * 60 * 1000;

function esAplicacionNativa(): boolean {
  try {
    const cap = (window as any)?.Capacitor;
    return typeof cap?.isNativePlatform === 'function' ? cap.isNativePlatform() : !!cap?.isNative;
  } catch {
    return false;
  }
}

// =====================================================================
// CAMINO APK — cero tolerancia al segundo plano (SIN CAMBIOS DE FONDO)
// =====================================================================
// POR QUÉ DOS MECANISMOS A LA VEZ (@capacitor/app Y visibilitychange)
// ---------------------------------------------------------------------
// La primera versión de esto usaba solo `document.visibilitychange`,
// pensado para no depender de un plugin nativo nuevo (uno nuevo solo
// funcionaría en el próximo .apk compilado). Probado en la APK real,
// no bastó: el WebView de Android no siempre dispara ese evento cuando
// la actividad pasa a segundo plano por el botón de inicio o el
// selector de apps recientes, así que la app seguía entrando sola.
//
// @capacitor/app y su evento `appStateChange` SÍ hablan directo con el
// ciclo de vida real de la actividad de Android, y es el mecanismo que
// Capacitor recomienda exactamente para esto. Se usa como fuente
// principal dentro de la APK, con `visibilitychange` como respaldo para
// cualquier instalación anterior a este cambio que todavía no traiga el
// plugin — un bundle OTA nunca puede agregar código nativo — hasta que
// se instale el próximo .apk.
//
// SIN PERÍODO DE GRACIA (orden explícita, "cero tolerancia")
// ---------------------------------------------------------------------
// Cualquier minimizado, por breve que sea, marca `requiere_auth` y exige
// biometría/contraseña al volver. La marca de tiempo se guarda en
// localStorage, no en memoria: así sobrevive a que Android mate el
// proceso por falta de memoria mientras la aplicación estaba en segundo
// plano. Al volver —aunque sea con la aplicación recién arrancada de
// cero— la marca sigue ahí y el bloqueo se aplica igual.
//
// LOS 2 MINUTOS: no son un plazo de gracia para ENTRAR, son un umbral
// para decidir QUÉ HACER DESPUÉS de entrar
// ---------------------------------------------------------------------
//   · Ausencia ≤ 2 minutos: `App.tsx` NO desmonta nada — solo superpone
//     un candado de re-autenticación encima de la pantalla actual, y
//     cualquier dato sin guardar sigue exactamente donde estaba.
//   · Ausencia > 2 minutos: cierre de sesión real (conservando el pase
//     de la huella si está activada) y vuelta a la tienda pública.
function marcarEnFondo(): void {
  try { localStorage.setItem(CLAVE_EN_FONDO_DESDE, String(Date.now())); } catch { /* sin storage no hay marca que poner */ }
}

/**
 * FALLO DE SEGURIDAD CORREGIDO — condición de carrera en el arranque en
 * frío.
 * ---------------------------------------------------------------------
 * Android puede MATAR el proceso de la app mientras está en segundo
 * plano (por memoria, es lo normal, no una falla). Al reabrirla, React
 * arranca de cero con `currentUser = null`, y la sesión de Supabase se
 * restaura en un efecto ASÍNCRONO en App.tsx. Si esta función solo
 * disparara el evento y dejara que App.tsx decidiera, su manejador —que
 * por UX tiene un guard `if (!currentUser) return`— lo ignoraría por
 * completo en un arranque en frío, porque el evento llegaría antes de
 * que el efecto asíncrono de recuperación de sesión alcanzara a poblar
 * `currentUser`. La sesión —perfectamente válida en Supabase, porque
 * nunca se cerró de verdad— se restauraría sola.
 *
 * La corrección: marcar el bloqueo AQUÍ, de forma síncrona, ANTES de
 * disparar el evento y sin depender de ningún estado de React. Así,
 * cuando el efecto de recuperación de sesión de App.tsx llegue a
 * comprobar `sesionBloqueada()` —milisegundos después, ya asíncrono—,
 * la respuesta va a ser `true` sin importar si `currentUser` alcanzó a
 * poblarse o no.
 */
function comprobarSiHayQueBloquear(): void {
  let desde = 0;
  try { desde = Number(localStorage.getItem(CLAVE_EN_FONDO_DESDE) || '0'); } catch { return; }
  if (!desde) return;

  // Se limpia siempre que se comprueba: la marca solo tiene sentido para
  // UN regreso. Dejarla puesta bloquearía de nuevo en la siguiente
  // comprobación sin que la app volviera a pasar por segundo plano.
  try { localStorage.removeItem(CLAVE_EN_FONDO_DESDE); } catch { /* no es crítico */ }

  const ausenteMs = Math.max(0, Date.now() - desde);

  marcarBloqueo(true);
  window.dispatchEvent(new CustomEvent(EVENTO_FORZAR_REINGRESO, { detail: { ausenteMs } }));
}

/**
 * @capacitor/app solo existe dentro de la APK y solo en un .apk
 * compilado después de agregar esta dependencia. Si no está —una
 * instalación anterior—, se sigue solo con `visibilitychange`.
 */
async function suscribirseAlCicloDeVidaNativo(): Promise<void> {
  try {
    const { App } = await import('@capacitor/app');
    App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) marcarEnFondo();
      else comprobarSiHayQueBloquear();
    });
  } catch {
    // Plugin no disponible en esta instalación: queda visibilitychange
    // como único mecanismo hasta el próximo .apk.
  }
}

function vigilarSegundoPlanoNativo(): void {
  void suscribirseAlCicloDeVidaNativo();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') marcarEnFondo();
    else comprobarSiHayQueBloquear();
  });

  // Cubre el cierre real de la aplicación: si no llegó a dispararse
  // `visibilitychange` a tiempo, esto deja la marca puesta de todas formas.
  window.addEventListener('pagehide', marcarEnFondo);

  // Comprobación inicial: la aplicación se acaba de abrir de cero
  // (proceso nuevo) y puede que ya hubiera una marca de un cierre
  // anterior esperando desde antes.
  comprobarSiHayQueBloquear();
}

// =====================================================================
// CAMINO WEB — tolerancia total al cambio de pestaña, solo inactividad
// real (5 minutos)
// =====================================================================
// Deliberadamente NO escucha `visibilitychange` ni `pagehide`: cambiar
// de pestaña, minimizar el navegador o dejar la pestaña en segundo plano
// no hacen NADA por sí solos, sin importar cuánto duren. Lo único que
// cuenta es si hubo o no una interacción real con ESTA página en los
// últimos 5 minutos.
//
// Mientras la pestaña está oculta no puede llegar ninguno de los eventos
// de abajo (no hay forma de mover el mouse sobre una pestaña que no se
// ve), así que el reloj sigue corriendo solo — que es exactamente lo
// correcto: si alguien deja la tienda abierta de fondo y se va a comer,
// 5 minutos después la sesión sí pide verificarse de nuevo, aunque nunca
// haya "vuelto" a la pestaña a comprobarlo. Si en cambio solo fue a
// revisar WhatsApp un momento y regresa antes de los 5 minutos, no pasa
// absolutamente nada.
const UMBRAL_INACTIVIDAD_WEB_MS = 5 * 60 * 1000;

/**
 * Cualquiera de estos cuenta como "la persona sigue aquí" y reinicia el
 * conteo desde cero. Deliberadamente amplio — mouse, teclado, rueda del
 * mouse, scroll y toque — para no depender de un solo tipo de gesto.
 */
const EVENTOS_ACTIVIDAD_WEB: Array<keyof WindowEventMap> = [
  'mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'scroll',
];

function vigilarInactividadReal(): void {
  let temporizador: ReturnType<typeof setTimeout> | null = null;

  const expulsar = () => {
    // `ausenteMs` va por encima del umbral "rápido" (2 minutos) a
    // propósito: 5 minutos de inactividad real deben pedir usuario y
    // clave de nuevo (el mismo cierre que "Cerrar sesión"), no solo
    // superponer el candado flotante pensado para una ausencia breve.
    window.dispatchEvent(new CustomEvent(EVENTO_FORZAR_REINGRESO, { detail: { ausenteMs: UMBRAL_INACTIVIDAD_WEB_MS } }));
  };

  const reiniciarConteo = () => {
    if (temporizador) clearTimeout(temporizador);
    temporizador = setTimeout(expulsar, UMBRAL_INACTIVIDAD_WEB_MS);
  };

  EVENTOS_ACTIVIDAD_WEB.forEach(evento => {
    window.addEventListener(evento, reiniciarConteo, { passive: true });
  });

  // Arranca el reloj desde que se monta la aplicación: quien abre la
  // pestaña y no vuelve a tocarla también debe caer a los 5 minutos,
  // no quedar exento por no haber generado todavía ningún evento.
  reiniciarConteo();
}

/**
 * Arranca la vigilancia correspondiente según la plataforma. Se llama
 * una sola vez, al montar la aplicación.
 */
export function iniciarBloqueoPorInactividad(): void {
  if (typeof document === 'undefined') return;

  if (esAplicacionNativa()) {
    vigilarSegundoPlanoNativo();
  } else {
    vigilarInactividadReal();
  }
}
