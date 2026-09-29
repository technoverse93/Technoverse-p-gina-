// =====================================================================
// IDENTIFICACIONES DE COSTA RICA — detección, formato y validación
// =====================================================================
// Un solo sitio para las reglas de la cédula física, la jurídica, el
// DIMEX y el NITE, que antes vivían repartidas entre la pantalla de cobro
// y la tienda. No importa nada del proyecto: es pura lógica.
//
//   01  Cédula física     9 dígitos            1-0906-0965
//   02  Cédula jurídica  10 dígitos, empieza 3  3-101-012009
//   03  DIMEX          11 o 12 dígitos
//   04  NITE             10 dígitos (y no empieza con 3)
//
// La jurídica y el NITE miden lo mismo (10); lo que las distingue es que
// TODA cédula jurídica empieza con 3. Por eso con 10 dígitos se puede
// deducir el tipo, y por eso una jurídica que no empieza con 3 es un
// error de digitación que vale la pena avisar.
// =====================================================================

export type TipoIdentificacion = '01' | '02' | '03' | '04';

export const LONGITUD_MAXIMA = 12;

/** Solo dígitos, recortado a la longitud máxima que existe. */
export function soloDigitos(crudo: string): string {
  return (crudo || '').replace(/\D/g, '').slice(0, LONGITUD_MAXIMA);
}

/**
 * Deduce el tipo por la cantidad de dígitos. Null mientras no alcance
 * para saberlo (menos de 9, o un largo que ningún tipo usa).
 */
export function detectarTipo(digitos: string): TipoIdentificacion | null {
  switch (digitos.length) {
    case 9: return '01';
    case 10: return digitos.startsWith('3') ? '02' : '04';
    case 11:
    case 12: return '03';
    default: return null;
  }
}

/** Cuántos dígitos admite cada tipo, para no dejar teclear de más. */
export function longitudMaximaDe(tipo: TipoIdentificacion): number {
  if (tipo === '01') return 9;
  if (tipo === '03') return 12;
  return 10;
}

/** Con guiones, como se escribe en papel. Lo que no encaja se deja tal cual. */
export function formatear(tipo: TipoIdentificacion, digitos: string): string {
  const d = soloDigitos(digitos);
  if (tipo === '01' && d.length > 1) {
    return [d.slice(0, 1), d.slice(1, 5), d.slice(5, 9)].filter(Boolean).join('-');
  }
  if (tipo === '02' && d.length > 1) {
    return [d.slice(0, 1), d.slice(1, 4), d.slice(4, 10)].filter(Boolean).join('-');
  }
  return d;
}

/** Devuelve el motivo del rechazo, o null si la identificación sirve. */
export function motivoInvalida(tipo: TipoIdentificacion, crudo: string): string | null {
  const d = (crudo || '').replace(/\D/g, '');
  if (!d) return 'La identificación es obligatoria.';
  switch (tipo) {
    case '01':
      if (d.length !== 9) return 'La Cédula Física debe tener 9 dígitos.';
      if (d.startsWith('0')) return 'La Cédula Física no puede empezar con 0.';
      return null;
    case '02':
      if (d.length !== 10) return 'La Cédula Jurídica debe tener 10 dígitos.';
      if (!d.startsWith('3')) return 'La Cédula Jurídica empieza con 3 (por ejemplo 3-101-123456).';
      return null;
    case '03':
      if (d.length !== 11 && d.length !== 12) return 'El DIMEX debe tener 11 o 12 dígitos.';
      return null;
    case '04':
      if (d.length !== 10) return 'El NITE debe tener 10 dígitos.';
      return null;
    default:
      return 'Tipo de identificación inválido.';
  }
}
