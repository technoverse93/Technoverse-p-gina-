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

// Único correo autorizado a cambiar/restablecer un token de seguridad que
// YA existe (ver set_security_pin en la migración: el servidor aplica la
// misma regla, esto solo evita mostrar la opción a quien nunca podría
// usarla). La creación inicial del token — cuando todavía no existe uno —
// sigue abierta a cualquier cuenta Dueño, sin este filtro.
const CORREO_ADMIN_SUPREMO = 'technoverse.admin@gmail.com';

/** ¿Esta cuenta es el administrador supremo, el único que puede cambiar un token de seguridad ya configurado? */
export function esAdminSupremo(email?: string | null): boolean {
  return (email || '').trim().toLowerCase() === CORREO_ADMIN_SUPREMO;
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

/**
 * Cambia el token de 4 dígitos EXIGIENDO el código anterior — a
 * diferencia de `crearTokenSeguridad` (que crea el primero, sin nada que
 * verificar todavía), este es el único camino para reemplazar uno que ya
 * existe. Envuelve `change_security_pin()` en el servidor, que verifica
 * el código anterior contra el hash guardado (con el mismo bloqueo por
 * intentos fallidos de `verificarTokenSeguridad`) antes de aceptar el
 * nuevo, y que además sigue exigiendo — del lado del servidor, no solo
 * aquí — que la cuenta sea la del administrador supremo.
 */
export async function cambiarTokenSeguridad(pinActual: string, pinNuevo: string): Promise<ResultadoPin> {
  if (!/^\d{4}$/.test(pinActual) || !/^\d{4}$/.test(pinNuevo)) {
    return { ok: false, mensaje: 'Los códigos deben ser de 4 dígitos.' };
  }
  try {
    const { error } = await supabase.rpc('change_security_pin', { p_pin_actual: pinActual, p_pin_nuevo: pinNuevo });
    if (error) throw error;
    return { ok: true, mensaje: 'Código actualizado correctamente.' };
  } catch (e) {
    return { ok: false, mensaje: mensajeDeError(e) };
  }
}

// =====================================================================
// PANEL DE GESTIÓN SUPREMO — administración de cuentas Dueño
// =====================================================================
// Todo lo de aquí abajo solo lo puede USAR de verdad la cuenta con el
// correo del administrador supremo: la pantalla que llama a estas
// funciones ya está oculta para cualquier otra cuenta (ver AdminShell.tsx
// y adminNav.ts), pero la restricción real —la que no se puede saltar
// llamando al RPC a mano— vive en el servidor, en cada una de estas
// funciones SECURITY DEFINER.

export interface AdminDueno {
  id: string;
  email: string;
  name: string | null;
  tienePin: boolean;
}

/** Lista las cuentas Dueño (administradores) para el panel de gestión. */
export async function listarAdmins(): Promise<AdminDueno[]> {
  const { data, error } = await supabase.rpc('admin_list_duenos');
  if (error) throw new Error(mensajeDeError(error));
  return ((data as any[]) || []).map(fila => ({
    id: fila.id,
    email: fila.email,
    name: fila.name,
    tienePin: fila.tiene_pin === true,
  }));
}

/**
 * Restablece (borra) el PIN de otra cuenta Dueño. No fija uno nuevo: la
 * cuenta simplemente vuelve a quedar sin PIN, así que en su próximo
 * ingreso el sistema la fuerza a crear uno por el flujo normal de primer
 * ingreso. Así el administrador supremo nunca llega a conocer el PIN
 * ajeno, ni siquiera el que acaba de fijar para otra persona.
 */
export async function restablecerPinDeAdmin(userId: string): Promise<ResultadoPin> {
  try {
    const { error } = await supabase.rpc('admin_reset_security_pin', { p_user_id: userId });
    if (error) throw error;
    return { ok: true, mensaje: 'PIN restablecido. Esa cuenta deberá crear uno nuevo en su próximo ingreso.' };
  } catch (e) {
    return { ok: false, mensaje: mensajeDeError(e) };
  }
}

/**
 * Envía el correo de restablecimiento de contraseña a otra cuenta Dueño.
 *
 * Reutiliza la Edge Function `admin-force-password-reset` que ya existe
 * para forzar el reseteo de clientes (CRM → ClienteFicha): la misma
 * función, con service_role del lado del servidor. Se le agregó ahí un
 * segundo nivel de permiso — cuando el CORREO DE DESTINO pertenece a
 * otra cuenta Dueño, exige que quien llama sea exactamente el
 * administrador supremo — así que el filtro real no es este archivo, es
 * el servidor.
 */
export async function enviarRestablecimientoContrasena(email: string): Promise<ResultadoPin> {
  try {
    const { data, error } = await supabase.functions.invoke('admin-force-password-reset', {
      body: { email },
    });
    if (error || !data?.success) {
      let detalle = '';
      try { detalle = (await (error as any)?.context?.json())?.error || ''; } catch { /* sin detalle */ }
      throw new Error(detalle || data?.error || (error as any)?.message || 'No se pudo enviar el correo de reseteo.');
    }
    return { ok: true, mensaje: `Enlace de restablecimiento enviado a ${email}.` };
  } catch (e) {
    return { ok: false, mensaje: mensajeDeError(e) };
  }
}
