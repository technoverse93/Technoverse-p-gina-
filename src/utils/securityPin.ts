// =====================================================================
// TOKEN DE SEGURIDAD DE 4 DÍGITOS — seguro maestro para cambio de
// contraseña
// =====================================================================
// El PIN nunca se compara en el cliente ni viaja en texto plano a ningún
// sitio que no sea la función de Supabase que lo verifica contra su hash.
// Las tres funciones de aquí son envoltorios delgados sobre las funciones
// `SECURITY DEFINER` de la base (ver
// supabase/migracion_token_seguridad_pin.sql): toda la lógica de verdad
// —el hash, el bloqueo por intentos fallidos— vive en el servidor.
// =====================================================================

import { supabase } from '../supabaseClient';

export interface ResultadoPin {
  ok: boolean;
  mensaje: string;
}

/** ¿Esta cuenta ya tiene un token de seguridad configurado? */
export async function tieneTokenSeguridad(): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('has_security_pin');
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}

/** Traduce el mensaje de una excepción de Postgres a algo presentable. */
function mensajeDeError(e: any): string {
  return e?.message || 'No se pudo completar la operación.';
}

/** Crea o reemplaza el token de 4 dígitos de la cuenta que tiene la sesión abierta. */
export async function crearTokenSeguridad(pin: string): Promise<ResultadoPin> {
  if (!/^\d{4}$/.test(pin)) {
    return { ok: false, mensaje: 'El token debe ser exactamente 4 dígitos.' };
  }
  try {
    const { error } = await supabase.rpc('set_security_pin', { p_pin: pin });
    if (error) throw error;
    return { ok: true, mensaje: 'Token de seguridad creado.' };
  } catch (e) {
    return { ok: false, mensaje: mensajeDeError(e) };
  }
}

/**
 * Verifica el token contra el hash guardado en el servidor.
 *
 * Devuelve `ok: false` tanto para un PIN incorrecto como para un bloqueo
 * temporal por demasiados intentos — el `mensaje` distingue los dos
 * casos (la función de Supabase lanza una excepción con el tiempo de
 * espera cuando se alcanza el límite).
 */
export async function verificarTokenSeguridad(pin: string): Promise<ResultadoPin> {
  if (!/^\d{4}$/.test(pin)) {
    return { ok: false, mensaje: 'El token debe ser exactamente 4 dígitos.' };
  }
  try {
    const { data, error } = await supabase.rpc('verify_security_pin', { p_pin: pin });
    if (error) throw error;
    return data === true
      ? { ok: true, mensaje: 'Token verificado.' }
      : { ok: false, mensaje: 'Token de seguridad incorrecto.' };
  } catch (e) {
    return { ok: false, mensaje: mensajeDeError(e) };
  }
}

/**
 * Cambia la contraseña de la cuenta actual, EXIGIENDO primero el token de
 * seguridad de 4 dígitos como seguro maestro.
 *
 * El orden importa: se verifica el token ANTES de intentar el cambio de
 * contraseña. Si el token falla, `supabase.auth.updateUser` ni se llama —
 * un PIN incorrecto no debe gastar intentos contra Supabase Auth (que
 * tiene su propio límite de tasa, pensado para otra cosa).
 */
export async function cambiarContrasenaConToken(pin: string, nuevaContrasena: string): Promise<ResultadoPin> {
  const verificacion = await verificarTokenSeguridad(pin);
  if (!verificacion.ok) return verificacion;

  if (nuevaContrasena.length < 8) {
    return { ok: false, mensaje: 'La nueva contraseña debe tener al menos 8 caracteres.' };
  }

  try {
    const { error } = await supabase.auth.updateUser({ password: nuevaContrasena });
    if (error) throw error;
    return { ok: true, mensaje: 'Contraseña actualizada correctamente.' };
  } catch (e) {
    return { ok: false, mensaje: mensajeDeError(e) };
  }
}
