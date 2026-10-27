// =====================================================================
// MONTOS EN COLONES: UN SOLO FORMATO EN TODO EL SISTEMA
// =====================================================================
// Antes cada pantalla usaba `toLocaleString()` (el idioma del aparato) o `toLocaleString('es-CR')`.
// El resultado cambiaba según el teléfono: en un Android en español los montos de 4 cifras salían
// sin separador («₡5300» al lado de «₡520.000»), con 'es-CR' el separador era un espacio
// («₡520 000») y en un aparato en inglés salían comas («₡520,000»). Aquí el formato es fijo:
// punto de miles y coma decimal, sin depender del idioma ni de la versión del navegador.
// =====================================================================

/**
 * Número con punto de miles y coma decimal: miles(5300) → «5.300»; miles(67600.5) → «67.600,50».
 * Sin `decimales`, un entero va sin decimales y un monto con fracción lleva 2 (no se redondea en silencio
 * un IVA o un total cobrado).
 */
export function miles(monto: number, decimales?: number): string {
  const n = Number(monto) || 0;
  const dec = decimales ?? (Math.abs(n - Math.round(n)) < 0.005 ? 0 : 2);
  const [entero, fraccion] = Math.abs(n).toFixed(dec).split('.');
  const conPuntos = entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (n < 0 && Number(entero + (fraccion || '')) !== 0 ? '-' : '') + conPuntos + (fraccion ? ',' + fraccion : '');
}

/** Colones redondeados con su símbolo: colones(5300) → «₡5.300». */
export function colones(monto: number, decimales = 0): string {
  return '₡' + miles(monto, decimales);
}
