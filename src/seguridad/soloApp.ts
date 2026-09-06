// =====================================================================
// SOLO EN LA APP — Android fuera de la APK no pinta la aplicación
// =====================================================================
// POR QUÉ EXISTE ESTE ARCHIVO
// ---------------------------------------------------------------------
// La orden es que en Android no se pueda capturar nada, ni en la APK ni en
// el navegador. En la APK ya está resuelto de verdad: FLAG_SECURE se lo
// aplica el sistema a la ventana y no hay forma de esquivarlo.
//
// En el navegador NO SE PUEDE. Y no es una limitación de este proyecto:
// FLAG_SECURE solo puede ponerla EL DUEÑO DE LA VENTANA. En la APK la
// ventana es nuestra; en Chrome la ventana es de Chrome, y Chrome no le
// entrega esa bandera a ninguna página web —ni a la nuestra ni a la de un
// banco—. No hay API, no hay permiso y no hay truco. Una captura con los
// botones físicos ni siquiera genera un evento que la página pueda oír:
// no hay tecla, no hay pérdida de foco, no hay cambio de visibilidad.
//
// Como no se puede TAPAR en el momento, se decide antes: no se pinta.
// Lo que nunca se dibujó no puede salir en ninguna captura. Esa es la
// única forma honesta de cumplir "que no se pueda capturar nada", y por
// eso este archivo existe en vez de un escudo que fingiría funcionar.
//
// ---------------------------------------------------------------------
// EL COSTO, DICHO SIN ADORNOS
// ---------------------------------------------------------------------
// Cualquier persona que abra la tienda desde el navegador de un Android
// —que es por donde llega la mayoría— ya no ve el catálogo. Ve un aviso
// con el teléfono de la tienda. Es una decisión de negocio tomada a
// conciencia por el dueño, no un efecto secundario.
//
// PARA REVERTIRLO: `SOLO_APP_EN_ANDROID = false`, aquí abajo. Una línea.
//
// ---------------------------------------------------------------------
// ALCANCE
// ---------------------------------------------------------------------
// Solo Android en navegador. El escritorio y iOS siguen igual, porque la
// orden fue sobre Android — y porque en iOS la captura no se puede
// impedir ni siquiera desde una app nativa, así que cerrar el navegador
// de iPhone no compraría la garantía que sí compra en Android.
// =====================================================================

import { esNativo } from './flagSecure';

/** Interruptor único. En `false`, este módulo deja de estorbar. */
const SOLO_APP_EN_ANDROID = true;

/**
 * ¿Es un Android FUERA de la APK?
 *
 * `esNativo()` es la mitad que importa y es fiable: la da Capacitor, no el
 * texto del navegador. El `userAgent` solo se usa para saber si estamos en
 * Android, y ahí un cliente que lo falsee no gana nada: falsearlo lo
 * llevaría a ver la tienda, que es justo lo que vería si no hubiera
 * ninguna restricción. No es una defensa contra un atacante, es la forma
 * de no pintar datos donde no se pueden proteger.
 */
export function esNavegadorAndroid(): boolean {
  if (!SOLO_APP_EN_ANDROID) return false;
  if (typeof window === 'undefined') return false;
  if (esNativo()) return false;
  try {
    return /android/i.test(navigator.userAgent || '');
  } catch {
    return false;
  }
}
