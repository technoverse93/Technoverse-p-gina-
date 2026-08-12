// =====================================================================
// ACTUALIZACIÓN OTA (Over-The-Air) DE LA APK
// =====================================================================
// El APK deja de ser "instalar y listo": en cada arranque, este módulo
// pregunta a Supabase Storage si hay una versión más nueva del bundle web
// (el HTML/JS/CSS que corre dentro de la APK) que la que tiene instalada
// ahora mismo, y si la hay, la descarga y la deja lista para el próximo
// reinicio o el próximo backgrounding — sin pasar por la Play Store ni
// pedirle a nadie que reinstale nada a mano.
//
// ---------------------------------------------------------------------
// CÓMO LLEGA UNA VERSIÓN NUEVA HASTA ACÁ
// ---------------------------------------------------------------------
// Cada push a `main` dispara el workflow .github/workflows/ota-publish.yml,
// que compila el proyecto, empaqueta `dist/` en un .zip y sube ese .zip
// más un manifiesto `latest.json` (versión = SHA corto del commit + URL
// del .zip) al bucket público de Supabase Storage "ota-updates". Esta
// función lee ese mismo manifiesto.
//
// ---------------------------------------------------------------------
// POR QUÉ ES "MANUAL" Y NO "AUTO UPDATE" DEL PLUGIN
// ---------------------------------------------------------------------
// El modo automático de @capgo/capacitor-updater espera la nube de Capgo
// (un servicio de terceros de pago). Este proyecto no depende de ningún
// servicio externo más allá de Supabase, que ya es la base de todo lo
// demás — así que se usa el modo self-hosted/manual: `autoUpdate: false`
// en capacitor.config.ts, y esta función hace ella misma la comprobación,
// la descarga y la activación.
//
// ---------------------------------------------------------------------
// POR QUÉ NUNCA PUEDE ROMPER EL ARRANQUE
// ---------------------------------------------------------------------
// Esto corre en CADA arranque de la app, antes de que nadie haya hecho
// nada. Un fallo de red, un manifiesto mal formado, o un APK viejo que
// todavía no trae el plugin (la primera instalación con este código
// tiene que llegar por la vía normal, igual que siempre — OTA no puede
// habilitarse retroactivamente en un APK que nunca lo tuvo) NUNCA debe
// impedir que la aplicación abra. Cada paso está en su propio try/catch
// silencioso; en el peor de los casos, la app sigue con el bundle que ya
// tenía y lo vuelve a intentar en el próximo arranque.
// =====================================================================

import { isNative } from './platform';

const MANIFEST_URL = 'https://hzatdfrjcqiimgqxcwwh.supabase.co/storage/v1/object/public/ota-updates/latest.json';

interface OtaManifest {
  /** SHA corto del commit que generó este build. */
  version: string;
  /** URL pública del .zip con el `dist/` de esa versión. */
  url: string;
}

export async function initOtaUpdater(): Promise<void> {
  if (!isNative()) return;

  let CapacitorUpdater: (typeof import('@capgo/capacitor-updater'))['CapacitorUpdater'];
  try {
    ({ CapacitorUpdater } = await import('@capgo/capacitor-updater'));
  } catch {
    // Plugin no disponible: un APK compilado antes de agregar OTA no lo
    // trae, y no hay forma de instalarlo sin volver a instalar el APK.
    return;
  }

  // Obligatorio y lo primero: le avisa a la capa nativa que el JS
  // arrancó bien. Sin esto, pasado `appReadyTimeout` el plugin revierte
  // solo al bundle anterior por si el nuevo viniera roto — una llamada
  // que nunca llega se interpreta como "esto no sirve".
  try {
    await CapacitorUpdater.notifyAppReady();
  } catch {
    /* nunca debe impedir que la app siga arrancando */
  }

  try {
    const actual = await CapacitorUpdater.current();
    const versionActual = actual?.bundle?.version || null;

    const respuesta = await fetch(MANIFEST_URL, { cache: 'no-store' });
    if (!respuesta.ok) return;

    const manifiesto: OtaManifest = await respuesta.json();
    if (!manifiesto?.version || !manifiesto?.url) return;
    if (manifiesto.version === versionActual) return; // ya está al día

    const nuevoBundle = await CapacitorUpdater.download({
      version: manifiesto.version,
      url: manifiesto.url,
    });

    // `next()` y no `set()`: deja el bundle nuevo listo para el próximo
    // reinicio o el próximo backgrounding, sin interrumpir a quien está
    // usando la app ahora mismo con un recargado forzado.
    await CapacitorUpdater.next({ id: nuevoBundle.id });
  } catch {
    // Cualquier fallo de red o de descarga se ignora en silencio: la app
    // sigue con el bundle que ya tenía instalado y lo reintenta en el
    // próximo arranque.
  }
}
