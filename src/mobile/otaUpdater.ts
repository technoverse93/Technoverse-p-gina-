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

import { useEffect, useState } from 'react';
import { isNative } from './platform';

const MANIFEST_URL = 'https://hzatdfrjcqiimgqxcwwh.supabase.co/storage/v1/object/public/ota-updates/latest.json';

interface OtaManifest {
  /** SHA corto del commit que generó este build. */
  version: string;
  /** URL pública del .zip con el `dist/` de esa versión. */
  url: string;
}

/**
 * Estado de la OTA, leíble desde cualquier pantalla (p. ej. el menú de
 * cuenta en AdminShell) sin pasarlo por props.
 *
 * Existe porque, sin esto, quien administra la app no tenía cómo saber
 * si lo que está viendo es la versión nueva o la vieja — "actualicé pero
 * no veo el cambio" resultó ser, en la práctica, que la actualización
 * todavía estaba en cola (`next()` la aplica en el próximo reinicio, no
 * al instante) y no había ninguna pista visible de eso en la pantalla.
 */
export interface OtaStatus {
  isNative: boolean;
  /** Versión (SHA corto) del bundle que está corriendo ahora mismo. */
  currentVersion: string | null;
  /** Versión más reciente publicada, según el último chequeo. */
  latestVersion: string | null;
  /** true = ya se descargó una versión más nueva; falta reiniciar la app para verla. */
  updatePending: boolean;
}

let otaStatus: OtaStatus = { isNative: false, currentVersion: null, latestVersion: null, updatePending: false };
const listeners = new Set<(s: OtaStatus) => void>();

function setOtaStatus(patch: Partial<OtaStatus>) {
  otaStatus = { ...otaStatus, ...patch };
  listeners.forEach(fn => fn(otaStatus));
}

export function getOtaStatus(): OtaStatus {
  return otaStatus;
}

/** Hook de React: se usa donde haga falta mostrar la versión actual. */
export function useOtaStatus(): OtaStatus {
  const [status, setStatus] = useState(otaStatus);
  useEffect(() => {
    const onChange = (s: OtaStatus) => setStatus(s);
    listeners.add(onChange);
    return () => { listeners.delete(onChange); };
  }, []);
  return status;
}

export async function initOtaUpdater(): Promise<void> {
  if (!isNative()) return;
  setOtaStatus({ isNative: true });

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
    setOtaStatus({ currentVersion: versionActual });

    const respuesta = await fetch(MANIFEST_URL, { cache: 'no-store' });
    if (!respuesta.ok) return;

    const manifiesto: OtaManifest = await respuesta.json();
    if (!manifiesto?.version || !manifiesto?.url) return;
    setOtaStatus({ latestVersion: manifiesto.version });
    if (manifiesto.version === versionActual) return; // ya está al día

    const nuevoBundle = await CapacitorUpdater.download({
      version: manifiesto.version,
      url: manifiesto.url,
    });

    // `next()` y no `set()`: deja el bundle nuevo listo para el próximo
    // reinicio o el próximo backgrounding, sin interrumpir a quien está
    // usando la app ahora mismo con un recargado forzado.
    await CapacitorUpdater.next({ id: nuevoBundle.id });
    setOtaStatus({ updatePending: true });
  } catch {
    // Cualquier fallo de red o de descarga se ignora en silencio: la app
    // sigue con el bundle que ya tenía instalado y lo reintenta en el
    // próximo arranque.
  }
}

// ---------------------------------------------------------------------
// VERIFICACIÓN MANUAL ("Buscar actualización" en el menú de cuenta)
// ---------------------------------------------------------------------
// El chequeo de arranque es deliberadamente silencioso y nunca interrumpe
// (deja todo en cola con `next()`). Pero si esa descarga en segundo plano
// falla o se pospuso —o la persona simplemente quiere confirmar YA que
// tiene lo último, sin cerrar y volver a abrir la app—, hacía falta un
// botón que lo intente de nuevo y, si hay algo nuevo, lo aplique al
// toque. Por eso este camino SÍ usa `set()`: a diferencia del arranque,
// aquí la persona pidió la actualización a propósito, así que un
// recargado inmediato es exactamente lo esperado, no una sorpresa.
export type ResultadoVerificacion =
  | { estado: 'no-nativo' }
  | { estado: 'sin-plugin'; mensaje: string }
  | { estado: 'al-dia'; version: string | null }
  | { estado: 'actualizando' }
  | { estado: 'error'; mensaje: string };

export async function verificarActualizacionManual(): Promise<ResultadoVerificacion> {
  if (!isNative()) return { estado: 'no-nativo' };

  let CapacitorUpdater: (typeof import('@capgo/capacitor-updater'))['CapacitorUpdater'];
  try {
    ({ CapacitorUpdater } = await import('@capgo/capacitor-updater'));
  } catch {
    return {
      estado: 'sin-plugin',
      mensaje: 'Esta instalación no trae el sistema de actualizaciones automáticas. Se necesita descargar la versión más reciente de la aplicación.',
    };
  }

  try {
    const actual = await CapacitorUpdater.current();
    const versionActual = actual?.bundle?.version || null;
    setOtaStatus({ currentVersion: versionActual });

    const respuesta = await fetch(MANIFEST_URL, { cache: 'no-store' });
    if (!respuesta.ok) {
      return { estado: 'error', mensaje: 'No se pudo consultar el servidor de actualizaciones. Revise su conexión.' };
    }

    const manifiesto: OtaManifest = await respuesta.json();
    if (!manifiesto?.version || !manifiesto?.url) {
      return { estado: 'error', mensaje: 'El servidor de actualizaciones respondió algo inesperado.' };
    }
    setOtaStatus({ latestVersion: manifiesto.version });

    if (manifiesto.version === versionActual) {
      return { estado: 'al-dia', version: versionActual };
    }

    const nuevoBundle = await CapacitorUpdater.download({
      version: manifiesto.version,
      url: manifiesto.url,
    });

    // `set()` recarga la app de inmediato: no hay nada útil que hacer
    // después de esta línea, el contexto de JavaScript actual va a
    // desaparecer con la recarga.
    await CapacitorUpdater.set({ id: nuevoBundle.id });
    return { estado: 'actualizando' };
  } catch (e: any) {
    return { estado: 'error', mensaje: e?.message || 'No se pudo completar la actualización.' };
  }
}
