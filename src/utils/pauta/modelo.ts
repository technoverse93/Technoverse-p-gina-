// =====================================================================
// PAUTA — el modelo de una pieza de publicidad
// =====================================================================
// Una «pieza» es todo lo necesario para dibujar y publicar un anuncio:
// formato, estilo, textos, producto y fondo. El Estudio la edita, el
// compositor la dibuja (compositor.ts) y la galería la guarda sin las
// imágenes (por eso `aGuardable`).
// =====================================================================

import type { Banner } from '../../types';
import { colones as colonesFmt } from '../dinero';

export type FormatoId = 'cuadrado' | 'retrato' | 'historia' | 'horizontal' | 'banner';
export type EstiloId = 'premium' | 'claro' | 'vibrante' | 'oferta';
export type FondoModo = 'gradiente' | 'ia' | 'producto';
export type ObjetivoId = 'venta' | 'oferta' | 'lanzamiento' | 'informar';

export const FORMATOS: Record<FormatoId, { id: FormatoId; nombre: string; corto: string; ancho: number; alto: number; uso: string }> = {
  retrato: { id: 'retrato', nombre: 'Post vertical 4:5', corto: 'Post 4:5', ancho: 1080, alto: 1350, uso: 'Instagram y Facebook: el que más espacio ocupa en el feed' },
  cuadrado: { id: 'cuadrado', nombre: 'Post cuadrado 1:1', corto: 'Post 1:1', ancho: 1080, alto: 1080, uso: 'Instagram, Facebook y WhatsApp' },
  historia: { id: 'historia', nombre: 'Historia / Estado 9:16', corto: 'Historia', ancho: 1080, alto: 1920, uso: 'Historias, reels y estados de WhatsApp' },
  horizontal: { id: 'horizontal', nombre: 'Horizontal 1.91:1', corto: 'Horizontal', ancho: 1200, alto: 628, uso: 'Facebook, anuncios y enlaces' },
  banner: { id: 'banner', nombre: 'Banner web', corto: 'Banner', ancho: 1920, alto: 600, uso: 'Banner grande de la tienda' },
};
export const ORDEN_FORMATOS: FormatoId[] = ['retrato', 'cuadrado', 'historia', 'horizontal', 'banner'];

export type Paleta = {
  nombre: string; descripcion: string;
  fondoA: string; fondoB: string; fondoC?: string;
  texto: string; textoSuave: string;
  acento: string; acentoB: string; acentoTexto: string;
  tarjeta: string; claro: boolean;
};
export const ESTILOS: Record<EstiloId, Paleta> = {
  premium: { nombre: 'Premium', descripcion: 'Azul marino y dorado de la marca', fondoA: '#031837', fondoB: '#0B2A5B', texto: '#FFFFFF', textoSuave: '#C5D3EC', acento: '#E0B863', acentoB: '#B8873A', acentoTexto: '#1A1304', tarjeta: '#FFFFFF', claro: false },
  claro: { nombre: 'Claro', descripcion: 'Limpio, luminoso y sobrio', fondoA: '#F7FAFF', fondoB: '#D9E6F8', texto: '#0B1F3F', textoSuave: '#46597A', acento: '#C9962E', acentoB: '#A8761C', acentoTexto: '#FFFFFF', tarjeta: '#FFFFFF', claro: true },
  vibrante: { nombre: 'Vibrante', descripcion: 'Colorido y llamativo', fondoA: '#3730A3', fondoB: '#9333EA', fondoC: '#EC4899', texto: '#FFFFFF', textoSuave: '#F1E4FF', acento: '#FACC15', acentoB: '#F59E0B', acentoTexto: '#2A1B00', tarjeta: '#FFFFFF', claro: false },
  oferta: { nombre: 'Oferta', descripcion: 'Rojo y naranja de liquidación', fondoA: '#7F1D1D', fondoB: '#DC2626', fondoC: '#F97316', texto: '#FFFFFF', textoSuave: '#FFE4D6', acento: '#FDE047', acentoB: '#FACC15', acentoTexto: '#3A1200', tarjeta: '#FFFFFF', claro: false },
};
export const ORDEN_ESTILOS: EstiloId[] = ['premium', 'claro', 'vibrante', 'oferta'];

export const OBJETIVOS: { id: ObjetivoId; nombre: string }[] = [
  { id: 'venta', nombre: 'Vender' },
  { id: 'oferta', nombre: 'Oferta' },
  { id: 'lanzamiento', nombre: 'Llegó nuevo' },
  { id: 'informar', nombre: 'Informar' },
];

export interface Pieza {
  formato: FormatoId;
  estilo: EstiloId;
  fondo: FondoModo;
  titular: string;
  subtitulo: string;
  etiqueta: string;
  cta: string;
  pie: string;
  precio: number | null;
  mostrarPrecio: boolean;
  /** Foto del producto (data URL o URL pública). */
  productoImg: string | null;
  /** Fondo hecho con IA (data URL o dirección pública), si se generó. */
  fondoImg: string | null;
  /** Dónde quedó guardado ese fondo (para volver a abrir la pieza igual). */
  fondoUrl?: string | null;
  /** La escena de la IA ya trae el producto: no se dibuja la foto encima. */
  ocultarProducto?: boolean;
  logo: boolean;
  /** Teléfono / WhatsApp para el pie (opcional). */
  telefono: string;
}

export function piezaNueva(parcial: Partial<Pieza> = {}): Pieza {
  return {
    formato: 'retrato', estilo: 'premium', fondo: 'gradiente',
    titular: '', subtitulo: '', etiqueta: '', cta: 'Escribinos al WhatsApp', pie: 'Tienda y taller en Costa Rica',
    precio: null, mostrarPrecio: true, productoImg: null, fondoImg: null, logo: true, telefono: '',
    ...parcial,
  };
}

/** Lo que se guarda en la galería: la pieza sin las imágenes pesadas. */
export function aGuardable(p: Pieza): Omit<Pieza, 'productoImg' | 'fondoImg'> {
  const { productoImg: _a, fondoImg: _b, ...resto } = p;
  return resto;
}

/** Los textos que arma Javier (ver supabase/functions/asistente-ia/estudio.ts). */
export interface CopyPauta {
  titular: string; subtitulo: string; etiqueta: string; cta: string; pie: string;
  caption: string; hashtags: string[]; fondo: string; estilo: EstiloId;
}

/** Cómo se llama el producto en el banner de la tienda según el formato de la pieza. */
export function formatoDeBanner(f: FormatoId): NonNullable<Banner['formato']> {
  return f === 'banner' ? 'hero' : f === 'horizontal' ? 'divisor' : 'grid';
}

export const colones = (n: number) => colonesFmt(n);

/** El texto completo para pegar en la red: la publicación y sus hashtags. */
export function textoPublicacion(caption: string, hashtags: string[]): string {
  const h = (hashtags || []).filter(Boolean).join(' ');
  return `${(caption || '').trim()}${h ? `\n\n${h}` : ''}`.trim();
}
