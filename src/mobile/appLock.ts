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
// QUÉ CUENTA COMO "TIEMPO PROLONGADO"
// ---------------------------------------------------------------------
// Dos minutos. Ni tan corto que bloquee por cambiar a WhatsApp a
// responder un cliente, ni tan largo que deje el teléfono expuesto de
// verdad si alguien lo toma mientras está desatendido.
//
// La marca de tiempo se guarda en localStorage, no en memoria: así
// sobrevive a que Android mate el proceso por falta de memoria mientras
// la aplicación estaba en segundo plano (el caso "cierra la
// aplicación" del reporte) y a que se cierre la pestaña del navegador
// en la web. Al volver —aunque sea con la aplicación recién arrancada
// de cero— la marca sigue ahí y el bloqueo se aplica igual.
// =====================================================================

const CLAVE_EN_FONDO_DESDE = 'technoverse_en_fondo_desde';
const UMBRAL_BLOQUEO_MS = 2 * 60 * 1000;

/** Se dispara cuando hay que exigir de nuevo biometría/PIN/contraseña. */
export const EVENTO_FORZAR_REINGRESO = 'technoverse_forzar_reingreso';

function marcarEnFondo(): void {
  try { localStorage.setItem(CLAVE_EN_FONDO_DESDE, String(Date.now())); } catch { /* sin storage no hay marca que poner */ }
}

function comprobarSiHayQueBloquear(): void {
  let desde = 0;
  try { desde = Number(localStorage.getItem(CLAVE_EN_FONDO_DESDE) || '0'); } catch { return; }
  if (!desde) return;

  // Se limpia siempre que se comprueba, haya pasado el umbral o no: la
  // marca solo tiene sentido para UN regreso. Dejarla puesta bloquearía
  // de nuevo en la siguiente comprobación sin que la app volviera a
  // pasar por segundo plano.
  try { localStorage.removeItem(CLAVE_EN_FONDO_DESDE); } catch { /* no es crítico */ }

  if (Date.now() - desde < UMBRAL_BLOQUEO_MS) return;
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
