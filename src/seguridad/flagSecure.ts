// =====================================================================
// FLAG_SECURE — bloqueo REAL de capturas en la APK
// =====================================================================
// En Android, `FLAG_SECURE` es lo único que de verdad impide una captura,
// una grabación de pantalla y la vista previa en el conmutador de apps. No
// es un truco de JavaScript: lo aplica el sistema operativo sobre la
// ventana, así que no hay forma de esquivarlo desde la web.
//
// ---------------------------------------------------------------------
// UNA SOLA EXCEPCIÓN, EXPLÍCITA: LA CUENTA DEL ADMINISTRADOR
// ---------------------------------------------------------------------
// Protegido por defecto para todos —incluso antes de saber quién inició
// sesión, por eso también se activa de forma ESTÁTICA en
// capacitor.config.ts (`PrivacyScreen.enable: true`), desde el primer
// fotograma—. App.tsx llama a `fijarFlagSecureSegunCorreo(currentUser?.email)`
// cada vez que cambia la sesión: si es la cuenta del administrador
// (`esAdminSupremo`, el mismo correo que gobierna Ubicaciones y
// Supervisión), se levanta; para cualquier otra cuenta o sin sesión,
// vuelve a aplicarse.
//
// La versión anterior a esta no ofrecía ningún `disable()` porque convivía
// con una función de "pantalla completa nativa" ya retirada del proyecto
// (ver git log). Ahora sí hace falta: es justo el mecanismo que le permite
// al administrador tomar sus propias capturas para documentar el sistema.
// =====================================================================

import { Capacitor } from '@capacitor/core';
import { PrivacyScreen } from '@capacitor-community/privacy-screen';

/** Último estado aplicado, para no repetir la llamada nativa de más. */
let aplicado: boolean | null = null;

async function fijar(activo: boolean): Promise<void> {
  if (!Capacitor.isNativePlatform() || aplicado === activo) return;
  aplicado = activo;
  try {
    if (activo) await PrivacyScreen.enable();
    else await PrivacyScreen.disable();
  } catch {
    aplicado = null; // se reintentará en el próximo llamado
  }
}

/**
 * Activa el bloqueo nativo de capturas. Se llama al arrancar, para todos,
 * antes incluso de saber si hay sesión — protegido por defecto.
 *
 * Nunca lanza: en web no hace nada (no hay ventana nativa que blindar), y
 * si el puente nativo fallara por cualquier motivo, la app sigue sana.
 */
export async function activarFlagSecure(): Promise<void> {
  await fijar(true);
}

/**
 * Reacciona al correo de la sesión activa: lo levanta SOLO para la cuenta
 * del administrador, lo mantiene puesto para cualquier otra (o ninguna).
 */
export async function fijarFlagSecureSegunCorreo(esAdmin: boolean): Promise<void> {
  await fijar(!esAdmin);
}

/** ¿Corre dentro de la APK? */
export function esNativo(): boolean {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
}
