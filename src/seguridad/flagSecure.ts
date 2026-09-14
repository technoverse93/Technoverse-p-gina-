// =====================================================================
// FLAG_SECURE — bloqueo REAL de capturas en la APK
// =====================================================================
// En Android, `FLAG_SECURE` es lo único que de verdad impide una captura,
// una grabación de pantalla y la vista previa en el conmutador de apps. No
// es un truco de JavaScript: lo aplica el sistema operativo sobre la
// ventana, así que no hay forma de esquivarlo desde la web.
//
// ---------------------------------------------------------------------
// SIN LISTA BLANCA, A PROPÓSITO
// ---------------------------------------------------------------------
// La versión anterior de esto tenía excepciones por cuenta, porque
// convivía con una función de "pantalla completa nativa" que el
// Superadmin usaba para supervisar el aparato de otra persona —y
// FLAG_SECURE ciega TODA captura por igual, incluida la del propio
// Superadmin mirando. Esa función de pantalla completa nativa ya no
// existe en este proyecto, así que ese conflicto desapareció: la regla
// es una sola, para todos, sin excepción — que es lo que se pidió.
//
// Se activa también de forma ESTÁTICA en capacitor.config.ts
// (`PrivacyScreen.enable: true`), para que la ventana quede protegida
// desde el primer fotograma, antes incluso de que este código corra. La
// llamada de aquí es una segunda capa por si ese arranque estático no se
// aplicara en algún flujo.
// =====================================================================

import { Capacitor } from '@capacitor/core';
import { PrivacyScreen } from '@capacitor-community/privacy-screen';

let activado = false;

/**
 * Activa el bloqueo nativo de capturas. Sin `disable`: no existe ningún
 * caso en el que deba apagarse, así que no se ofrece ese camino.
 *
 * Nunca lanza: en web no hace nada (no hay ventana nativa que blindar), y
 * si el puente nativo fallara por cualquier motivo, la app sigue sana.
 */
export async function activarFlagSecure(): Promise<void> {
  if (!Capacitor.isNativePlatform() || activado) return;
  activado = true;
  try {
    await PrivacyScreen.enable();
  } catch {
    activado = false; // se reintentará en el próximo llamado
  }
}

/** ¿Corre dentro de la APK? */
export function esNativo(): boolean {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
}
