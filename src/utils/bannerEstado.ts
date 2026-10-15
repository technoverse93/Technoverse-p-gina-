// =====================================================================
// ESTADO Y ESTILO DE LOS BANNERS (lo comparten la tienda y el panel)
// =====================================================================
// Un solo lugar para dos decisiones que antes estaban repartidas:
//   · ¿en qué estado está un banner? (activo, programado, vencido o pausado) — la tienda solo muestra los
//     «activo»; el panel muestra el estado con su chip y deja filtrar por él.
//   · ¿con qué colores se pinta un banner de texto? SIEMPRE tokens del tema (nada de hex), así sigue a la
//     paleta de marca y al modo claro/oscuro. Cada par fondo/tinta está comprobado AA por `npm run paletas`.
// =====================================================================

import type { Banner, FormatoBanner, VarianteBanner } from '../types';

export type EstadoBanner = 'activo' | 'programado' | 'vencido' | 'pausado';

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * El estado de un banner HOY. `pausado` = apagado a mano (`active = false`); `programado` = todavía no llega su
 * fecha de inicio; `vencido` = ya pasó su último día (se toma el día entero: uno que «termina el 30» se ve todo el 30).
 */
export function estadoDeBanner(b: Banner, ahora: number = Date.now()): EstadoBanner {
  if (!b || b.active === false) return 'pausado';
  if (b.startDate) {
    const desde = new Date(b.startDate).getTime();
    if (Number.isFinite(desde) && ahora < desde) return 'programado';
  }
  if (b.endDate) {
    const hasta = new Date(b.endDate).getTime();
    if (Number.isFinite(hasta) && ahora > hasta + DIA_MS - 1) return 'vencido';
  }
  return 'activo';
}

/** ¿Este banner debe verse hoy? */
export function estaVigente(b: Banner): boolean {
  return estadoDeBanner(b) === 'activo';
}

/** Menor `prioridad` primero; a igual prioridad se respeta el orden en que vienen. */
export function ordenarBanners<T extends Banner>(lista: T[]): T[] {
  return lista
    .map((b, i) => ({ b, i }))
    .sort((x, y) => ((x.b.prioridad || 0) - (y.b.prioridad || 0)) || (x.i - y.i))
    .map(x => x.b);
}

export const FORMATOS_CON_IMAGEN: FormatoBanner[] = ['hero', 'divisor', 'grid', 'popup'];
/** Los formatos de texto no necesitan imagen (la campaña puede llevarla, el cintillo no). */
export function formatoRequiereImagen(f?: FormatoBanner): boolean {
  return FORMATOS_CON_IMAGEN.includes(f || 'hero');
}

export interface EstiloVariante {
  etiqueta: string;
  fondo: string;
  tinta: string;
  borde: string;
  /** Botón de llamado a la acción: el inverso del fondo, para que se despegue. */
  botonFondo: string;
  botonTinta: string;
  /** Etiqueta de oferta (la insignia). */
  insigniaFondo: string;
  insigniaTinta: string;
}

export const VARIANTES: Record<VarianteBanner, EstiloVariante> = {
  acento: {
    etiqueta: 'Acento',
    fondo: 'var(--accent)', tinta: 'var(--accent-ink)', borde: 'var(--accent)',
    botonFondo: 'var(--accent-ink)', botonTinta: 'var(--accent)',
    insigniaFondo: 'var(--accent-2)', insigniaTinta: 'var(--accent-2-ink)',
  },
  acento2: {
    etiqueta: 'Vivo',
    fondo: 'var(--accent-2)', tinta: 'var(--accent-2-ink)', borde: 'var(--accent-2)',
    botonFondo: 'var(--accent-2-ink)', botonTinta: 'var(--accent-2)',
    insigniaFondo: 'var(--accent-2-ink)', insigniaTinta: 'var(--accent-2)',
  },
  suave: {
    etiqueta: 'Suave',
    fondo: 'var(--accent-2-soft)', tinta: 'var(--text-primary)', borde: 'var(--accent-2)',
    botonFondo: 'var(--accent)', botonTinta: 'var(--accent-ink)',
    insigniaFondo: 'var(--accent-2)', insigniaTinta: 'var(--accent-2-ink)',
  },
  oscuro: {
    etiqueta: 'Oscuro',
    fondo: 'var(--chip-on-bg)', tinta: 'var(--chip-on-ink)', borde: 'var(--chip-on-bg)',
    botonFondo: 'var(--chip-on-ink)', botonTinta: 'var(--chip-on-bg)',
    insigniaFondo: 'var(--accent-2)', insigniaTinta: 'var(--accent-2-ink)',
  },
};

/** La variante de un banner (la «vivo» si no tiene). */
export function estiloDe(b: Pick<Banner, 'variante'>): EstiloVariante {
  return VARIANTES[b.variante && VARIANTES[b.variante] ? b.variante : 'acento2'];
}
