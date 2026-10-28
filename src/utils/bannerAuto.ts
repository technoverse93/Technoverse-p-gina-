// =====================================================================
// GENERACIÓN AUTOMÁTICA DE BANNERS a partir de un producto
// =====================================================================
// Toma la imagen, el nombre y el precio de un producto y arma un banner
// de formato "grid" listo para la tienda, sin que nadie tenga que
// diseñarlo. Es lo que usa el botón "Generar banner automático".
// =====================================================================

import type { Banner, Product } from '../types';
import { colones as colonesFmt } from './dinero';

function idNuevo(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* sin crypto: cae al reloj */ }
  return `banner-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Precio formateado en colones. */
function colones(n: number): string {
  return colonesFmt(n);
}

/** La descripción del producto en una línea: sus viñetas («- 256 GB…- Original…») pasan a «256 GB… · Original…». */
function descripcionCorta(texto?: string): string {
  const partes = (texto || '').split(/\s*(?:^|\n|\s-\s|-\s(?=[A-ZÁÉÍÓÚÑ0-9]))\s*|\s*[•·]\s*/).map(t => t.replace(/^[-–•·\s]+/, '').trim()).filter(Boolean);
  const linea = partes.join(' · ');
  return linea.length > 120 ? linea.slice(0, 117).replace(/\s+\S*$/, '').replace(/[\s·,;:]+$/, '') + '…' : linea;
}

/**
 * Construye un banner de cuadrícula desde un producto. La etiqueta de
 * oferta es el descuento si lo hay; si no, el precio, que siempre es un
 * gancho válido. Reutiliza la MISMA foto del producto (ya vive en Storage,
 * así que no se vuelve a subir nada).
 */
export function generarBannerDeProducto(p: Product, formato: Banner['formato'] = 'grid'): Banner {
  const tieneDescuento = !!p.discountPercent && p.discountPercent > 0;
  return {
    id: idNuevo(),
    title: p.name || 'Nuevo producto',
    description: descripcionCorta(p.description) || 'Ya disponible en Technoverse.',
    imageUrl: p.imageUrl,
    link: undefined,
    type: 'General',
    formato,
    oferta: tieneDescuento ? `-${p.discountPercent}%` : colones(p.price || 0),
    active: true,
  };
}
