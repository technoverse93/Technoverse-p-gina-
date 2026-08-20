// =====================================================================
// BLOQUEO POR INACTIVIDAD — re-autenticación obligatoria al volver
// =====================================================================
// VULNERABILIDAD QUE ESTO CIERRA
// ---------------------------------------------------------------------
// El mecanismo de "sesión cerrada con llave" (`marcarBloqueo` en
// biometriaNativa.ts) ya existía y funciona bien, pero SOLO se activaba
// al tocar "Cerrar sesión" a mano. Si la persona simplemente mandaba la
// aplicación a segundo plano, cerraba la pestaña, o apagaba la
// pantalla del teléfono sin pasar por ese botón, la sesión se quedaba
// completamente abierta y sin ninguna llave puesta: al volver a abrir
// la aplicación —minutos u horas después— entraba sola, sin pedir
// huella ni contraseña. Es el hueco exacto que reporta esta auditoría.
//
// ---------------------------------------------------------------------
// POR QUÉ DOS MECANISMOS A LA VEZ (@capacitor/app Y visibilitychange)
// ---------------------------------------------------------------------
// La primera versión de esto usaba solo `document.visibilitychange`,
// pensado para no depender de un plugin nativo nuevo (uno nuevo solo
// funcionaría en el próximo .apk compilado). Probado en la APK real,
// no bastó: el WebView de Android no siempre dispara ese evento cuando
// la actividad pasa a segundo plano por el botón de inicio o el
// selector de apps recientes —a diferencia de una pestaña de
// escritorio, donde sí es fiable—, así que la app seguía entrando sola.
//
// @capacitor/app y su evento `appStateChange` SÍ hablan directo con el
// ciclo de vida real de la actividad de Android, y es el mecanismo que
// Capacitor recomienda exactamente para esto. Se usa como fuente
// principal dentro de la APK, con `visibilitychange` como respaldo:
// cubre la web (donde `@capacitor/app` ni se importa) y, dentro de la
// APK, cualquier instalación anterior a este cambio que todavía no
// traiga el plugin —un bundle OTA nunca puede agregar código nativo—,
// hasta que se instale el próximo .apk.
//
// ---------------------------------------------------------------------
// SIN PERÍODO DE GRACIA (orden explícita, "cero tolerancia")
// ---------------------------------------------------------------------
// Versión anterior: solo bloqueaba si la aplicación pasó más de dos
// minutos en segundo plano. La auditoría de seguridad de este proyecto
// lo marcó como inaceptable — "el sistema DEBE bloquear el acceso y
// pedir re-autenticación al retomar la app", sin excepción por tiempo.
// Cualquier minimizado, por breve que sea, marca `requiere_auth` y exige
// biometría/PIN al volver.
//
// La marca de tiempo se guarda en localStorage, no en memoria: así
// sobrevive a que Android mate el proceso por falta de memoria mientras
// la aplicación estaba en segundo plano (el caso "cierra la
// aplicación" del reporte) y a que se cierre la pestaña del navegador
// en la web. Al volver —aunque sea con la aplicación recién arrancada
// de cero— la marca sigue ahí y el bloqueo se aplica igual.
// =====================================================================

import { marcarBloqueo } from '../utils/biometriaNativa';

const CLAVE_EN_FONDO_DESDE = 'technoverse_en_fondo_desde';

/** Se dispara cuando hay que exigir de nuevo biometría/PIN/contraseña. */
export const EVENTO_FORZAR_REINGRESO = 'technoverse_forzar_reingreso';

function marcarEnFondo(): void {
  try { localStorage.setItem(CLAVE_EN_FONDO_DESDE, String(Date.now())); } catch { /* sin storage no hay marca que poner */ }
}

/**
 * FALLO DE SEGURIDAD CORREGIDO — condición de carrera en el arranque en
 * frío.
 * ---------------------------------------------------------------------
 * Este era el hueco real detrás de "a veces deja entrar como si nada":
 * Android puede MATAR el proceso de la app mientras está en segundo
 * plano (por memoria, es lo normal, no una falla). Al reabrirla, React
 * arranca de cero con `currentUser = null`, y la sesión de Supabase se
 * restaura en un efecto ASÍNCRONO en App.tsx.
 *
 * Esta función se llamaba también al arrancar, y antes SOLO disparaba el
 * evento `EVENTO_FORZAR_REINGRESO` — dejando que App.tsx decidiera si
 * bloquear. Pero su manejador tenía (y sigue teniendo, por UX) un guard
 * `if (!currentUser) return`. En un arranque en frío ese guard SIEMPRE
 * se cumplía, porque el evento se disparaba antes de que el efecto
 * asíncrono de recuperación de sesión llegara a poner `currentUser`. El
 * evento se disparaba, el manejador lo ignoraba por completo, y la
 * recuperación de sesión seguía su curso libremente: `sesionBloqueada()`
 * nunca se había puesto en `true`, así que la sesión —perfectamente
 * válida en el almacenamiento de Supabase, porque nunca se cerró de
 * verdad— se restauraba sola. Ese es exactamente el "entra sin pedir
 * nada" reportado, y por qué era intermitente: en una reanudación
 * "tibia" (proceso no matado) `currentUser` ya estaba poblado y todo
 * funcionaba; solo fallaba tras un arranque en frío real.
 *
 * La corrección: marcar el bloqueo AQUÍ, de forma síncrona, ANTES de
 * disparar el evento y sin depender de ningún estado de React. Así,
 * cuando el efecto de recuperación de sesión de App.tsx llegue a
 * comprobar `sesionBloqueada()` —milisegundos después, ya asíncrono—,
 * la respuesta va a ser `true` sin importar si `currentUser` alcanzó a
 * poblarse o no. El evento sigue disparándose después, para la UX de
 * cerrar la sesión visible al instante si la pestaña seguía montada.
 */
function comprobarSiHayQueBloquear(): void {
  let desde = 0;
  try { desde = Number(localStorage.getItem(CLAVE_EN_FONDO_DESDE) || '0'); } catch { return; }
  if (!desde) return;

  // Se limpia siempre que se comprueba: la marca solo tiene sentido para
  // UN regreso. Dejarla puesta bloquearía de nuevo en la siguiente
  // comprobación sin que la app volviera a pasar por segundo plano.
  try { localStorage.removeItem(CLAVE_EN_FONDO_DESDE); } catch { /* no es crítico */ }

  // Sin umbral de tiempo: CUALQUIER paso por segundo plano exige volver
  // a autenticarse, así haya durado un segundo o una hora. Y sin esperar
  // a React: ver el comentario de la función.
  marcarBloqueo(true);
  window.dispatchEvent(new CustomEvent(EVENTO_FORZAR_REINGRESO));
}

function esAplicacionNativa(): boolean {
  try {
    const cap = (window as any)?.Capacitor;
    return typeof cap?.isNativePlatform === 'function' ? cap.isNativePlatform() : !!cap?.isNative;
  } catch {
    return false;
  }
}

/**
 * @capacitor/app solo existe dentro de la APK y solo en un .apk
 * compilado después de agregar esta dependencia. Si no está —web, o
 * una instalación anterior—, se sigue solo con `visibilitychange`.
 */
async function suscribirseAlCicloDeVidaNativo(): Promise<void> {
  if (!esAplicacionNativa()) return;
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

/**
 * Arranca la vigilancia de segundo plano. Se llama una sola vez, al
 * montar la aplicación.
 */
export function iniciarBloqueoPorInactividad(): void {
  if (typeof document === 'undefined') return;

  void suscribirseAlCicloDeVidaNativo();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') marcarEnFondo();
    else comprobarSiHayQueBloquear();
  });

  // Cubre el cierre real de la pestaña/aplicación: si no llegó a
  // dispararse `visibilitychange` a tiempo, esto deja la marca puesta
  // de todas formas.
  window.addEventListener('pagehide', marcarEnFondo);

  // Comprobación inicial: la aplicación se acaba de abrir de cero
  // (proceso nuevo) y puede que ya hubiera una marca de un cierre
  // anterior esperando desde antes.
  comprobarSiHayQueBloquear();
}
