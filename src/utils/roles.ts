// =====================================================================
// ROLES DEL SISTEMA — modelo Zero Trust
// =====================================================================
// El backend (ver supabase/migracion_zero_trust_roles.sql) reconoce cuatro
// roles. La identidad de verdad y la inmutabilidad viven en la base: estas
// funciones son solo para decidir QUÉ MUESTRA la interfaz. Nunca son la
// barrera de seguridad —esa es RLS + el trigger forzar_rol_inmutable—, así
// que si alguien las burlara en el cliente, el servidor sigue diciendo que
// no.
//
//   superadmin : el correo technoverse.admin@gmail.com, y solo ese.
//   admin      : administración (lo que antes era "Dueño").
//   empleado   : opera el panel, sin gestión de cuentas ni ajustes.
//   Cliente    : comprador de la tienda; nunca entra al panel.
// =====================================================================

export type Rol = 'superadmin' | 'admin' | 'empleado' | 'Cliente';

/** ¿Trabaja aquí? Cualquiera del personal (entra al panel). */
export function esStaff(rol?: string | null): boolean {
  return rol === 'superadmin' || rol === 'admin' || rol === 'empleado';
}

/**
 * ¿Nivel de gestión? Es lo que el rol 'Dueño' gateaba antes: ver ajustes,
 * administrar cuentas, exigir el PIN de seguridad. `empleado` queda fuera.
 */
export function esGestion(rol?: string | null): boolean {
  return rol === 'superadmin' || rol === 'admin';
}

/** ¿La raíz? Solo el superadmin. */
export function esSuperadmin(rol?: string | null): boolean {
  return rol === 'superadmin';
}
