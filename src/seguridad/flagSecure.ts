// =====================================================================
// FLAG_SECURE — bloqueo REAL de capturas en la APK (Zero Trust · Etapa 4)
// =====================================================================
// En Android, `FLAG_SECURE` es lo único que de verdad impide una captura,
// una grabación de pantalla y la vista previa en el conmutador de apps. No
// es un truco de JavaScript: lo aplica el sistema operativo sobre la
// ventana, así que no hay forma de esquivarlo desde la web.
//
// ---------------------------------------------------------------------
// POR QUÉ ESTO NO IMPORTA UN PAQUETE
// ---------------------------------------------------------------------
// El puente nativo lo expone un plugin de Capacitor que este proyecto
// TODAVÍA NO TIENE INSTALADO. En vez de agregar la dependencia a ciegas
// —no se puede compilar ni probar una APK desde aquí, y un plugin
// incompatible rompería el build de Android para todos—, se registra el
// puente por su nombre y se llama con guantes:
//
//   · en web              → no hace nada (no hay ventana nativa).
//   · en APK sin plugin   → la llamada rechaza con "not implemented",
//                           se atrapa, y la app sigue igual de sana.
//   · en APK con plugin   → empieza a funcionar SOLA, sin tocar una
//                           línea de este archivo ni de quien lo llama.
//
// Es decir: el interruptor ya está cableado y la lista blanca ya lo
// gobierna. Falta únicamente enchufar el plugin y recompilar la APK, que
// es un paso que exige un teléfono real para verificarse.
// =====================================================================

import { Capacitor } from '@capacitor/core';
import { PrivacyScreen as PantallaPrivada } from '@capacitor-community/privacy-screen';

/** Último estado APLICADO, para no repetir la llamada nativa en cada latido. */
let estadoAplicado: boolean | null = null;

/**
 * Activa o desactiva el bloqueo nativo de capturas.
 *
 * Nunca lanza: si el puente no existe todavía, se olvida del estado para
 * volver a intentarlo la próxima vez (por si el plugin aparece tras una
 * actualización OTA + recompilación).
 */
export async function fijarFlagSecure(activo: boolean): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  if (estadoAplicado === activo) return;
  estadoAplicado = activo;
  try {
    if (activo) await PantallaPrivada.enable();
    else await PantallaPrivada.disable();
  } catch {
    estadoAplicado = null;
  }
}

/** ¿Corre dentro de la APK? Lo usa el escudo para saber qué capa evaluar. */
export function esNativo(): boolean {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
}
