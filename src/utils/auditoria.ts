// =====================================================================
// AUDITORÍA DE INGRESOS (Zero Trust · Etapa 2)
// =====================================================================
// Registra una autenticación exitosa. Se llama SOLO desde el embudo de
// login explícito (App.handleLogin), no desde la recuperación de sesión
// al recargar: abrir la app de nuevo no es un ingreso nuevo, y contarlo
// así llenaría el feed de ruido.
//
// El correo y la identidad NO se mandan desde aquí: la función del
// servidor los sella con auth.uid(). Aquí solo se aporta el entorno y una
// cadena corta de dispositivo, que son datos de contexto, no de identidad.
//
// Es "dispara y olvida": si el registro falla, el login del usuario no se
// ve afectado en absoluto.
// =====================================================================

import { supabase } from '../supabaseClient';

/** ¿Corriendo dentro del APK de Capacitor o en el navegador? */
function entornoActual(): 'web' | 'apk' {
  try {
    const w = window as any;
    if (w?.Capacitor?.isNativePlatform?.()) return 'apk';
    if (/^(capacitor|ionic|file):$/.test(location.protocol)) return 'apk';
  } catch {
    /* sin window: se asume web */
  }
  return 'web';
}

/**
 * Cadena corta y legible del dispositivo, para la columna "entorno" del
 * feed. No es una huella: es lo justo para que el supremo reconozca de un
 * vistazo "Chrome / Windows" o "APK · Android". El modelo exacto ya vive
 * en la telemetría de dispositivo (huella.ts); aquí basta lo humano.
 */
function descripcionDispositivo(): string {
  try {
    const ua = navigator.userAgent || '';
    const so =
      /Windows/.test(ua) ? 'Windows' :
      /Android/.test(ua) ? 'Android' :
      /iPhone|iPad|iPod/.test(ua) ? 'iOS' :
      /Mac OS X|Macintosh/.test(ua) ? 'macOS' :
      /Linux/.test(ua) ? 'Linux' : 'Sistema desconocido';
    const nav =
      /Edg\//.test(ua) ? 'Edge' :
      /Chrome\//.test(ua) ? 'Chrome' :
      /Firefox\//.test(ua) ? 'Firefox' :
      /Safari\//.test(ua) ? 'Safari' : 'Navegador';
    return entornoActual() === 'apk' ? `APK · ${so}` : `${nav} / ${so}`;
  } catch {
    return '';
  }
}

/**
 * Deja constancia del ingreso. No lanza: cualquier error se traga a
 * propósito para que un fallo de red o de permisos nunca bloquee la
 * sesión de quien acaba de entrar.
 */
export async function registrarIngreso(): Promise<void> {
  try {
    await supabase.rpc('registrar_ingreso', {
      p_entorno: entornoActual(),
      p_dispositivo: descripcionDispositivo(),
    });
  } catch {
    /* dispara y olvida */
  }
}
