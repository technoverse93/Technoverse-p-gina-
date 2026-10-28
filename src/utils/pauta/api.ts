// =====================================================================
// PAUTA — lo que el Estudio le pide al servidor y a Storage
// =====================================================================
//  · pedirCopy / pedirImagen: los textos y el fondo con IA (la función
//    asistente-ia, acciones «pauta_texto» e «imagen»).
//  · subirPieza: la imagen final al bucket público «marketing» (Instagram
//    la necesita en una dirección pública).
//  · La galería: tabla `pautas` (supabase/migracion_pautas.sql). Si todavía
//    no existe, queda en este aparato (localStorage) y el Estudio lo avisa.
// =====================================================================

import { supabase } from '../../supabaseClient';
import type { CopyPauta, EstiloId, FormatoId, ObjetivoId, Pieza } from './modelo';
import { aGuardable } from './modelo';

// El proyecto no usa `strict`: un tipo «unión» no se estrecha con `ok`, así que
// los campos del éxito son opcionales y quien llama usa `!` después de mirar `ok`.
export type Respuesta<T> = { ok: boolean; error?: string; intentos?: string[] } & Partial<T>;

/** Llama a la función y devuelve siempre el cuerpo (también cuando responde con error). */
async function invocar<T>(cuerpo: Record<string, unknown>): Promise<Respuesta<T>> {
  try {
    const { data, error } = await supabase.functions.invoke('asistente-ia', { body: cuerpo });
    if (error) {
      let detalle = '';
      try { const j = await (error as any).context?.json?.(); detalle = j?.error || ''; if (j?.intentos) return { ok: false, error: detalle || 'No se pudo.', intentos: j.intentos } as Respuesta<T>; } catch { /* sin cuerpo */ }
      return { ok: false, error: detalle || 'No se pudo conectar con Javier. Revisá la conexión.' } as Respuesta<T>;
    }
    return (data || { ok: false, error: 'Respuesta vacía.' }) as Respuesta<T>;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'No se pudo conectar con Javier.' } as Respuesta<T>;
  }
}

export type DatosCopy = {
  nombre: string; categoria?: string; precio?: number; descuento?: number; descripcion?: string; garantia?: string; marca?: string; stock?: number;
  objetivo?: ObjetivoId; instrucciones?: string; telefono?: string; formato?: FormatoId; tono?: string;
};
export const pedirCopy = (datos: DatosCopy) => invocar<{ copy: CopyPauta }>({ accion: 'pauta_texto', datos });

export const pedirImagen = (o: { fondo: string; formato: FormatoId; estilo: EstiloId; referencia?: string }) =>
  invocar<{ imagen: string; proveedor: string; modelo: string; ms: number; quedan?: number }>({ accion: 'imagen', datos: o });

/** Sube la pieza final (JPEG) y devuelve su dirección pública. */
export async function subirPieza(blob: Blob, id: string): Promise<string> {
  // Un nombre NUEVO en cada subida y sin `upsert`: reemplazar un archivo exige poder LEER el bucket, y desde el
  // blindaje (migracion_blindaje_seguridad.sql) nadie lista `marketing`. Con `upsert: true` y el mismo nombre,
  // «Usar de banner» fallaba con «new row violates row-level security policy».
  const ruta = `pautas/${id}-${Date.now().toString(36)}.jpg`;
  const { error } = await supabase.storage.from('marketing').upload(ruta, blob, { contentType: 'image/jpeg', upsert: false, cacheControl: '31536000' });
  if (error) throw new Error(`No se pudo subir la imagen: ${error.message}`);
  const { data } = supabase.storage.from('marketing').getPublicUrl(ruta);
  if (!data?.publicUrl) throw new Error('La imagen se subió pero no tiene dirección pública.');
  return data.publicUrl;
}

// ------------------------------- galería -------------------------------
export interface PautaGuardada {
  id: string; creadaEn: string; creadaPor: string; titulo: string; formato: FormatoId; estilo: EstiloId;
  productoId: string | null; productoNombre: string | null; imagenUrl: string | null; miniatura: string | null;
  copy: Partial<CopyPauta> & { caption?: string; hashtags?: string[] };
  pieza: Omit<Pieza, 'productoImg' | 'fondoImg'>;
  estado: 'borrador' | 'programada' | 'banner'; requestId: string | null; bannerId: string | null;
}

const COLUMNAS = 'id,creada_en,creada_por,titulo,formato,estilo,producto_id,producto_nombre,imagen_url,miniatura,copy,pieza,estado,request_id,banner_id';
const CLAVE_LOCAL = 'tv_pautas_local';
const MAX_LOCAL = 12;

const deFila = (r: any): PautaGuardada => ({
  id: r.id, creadaEn: r.creada_en, creadaPor: r.creada_por || '', titulo: r.titulo || '', formato: r.formato, estilo: r.estilo,
  productoId: r.producto_id || null, productoNombre: r.producto_nombre || null, imagenUrl: r.imagen_url || null, miniatura: r.miniatura || null,
  copy: r.copy || {}, pieza: r.pieza || {}, estado: r.estado || 'borrador', requestId: r.request_id || null, bannerId: r.banner_id || null,
});
const aFila = (p: PautaGuardada) => ({
  id: p.id, creada_en: p.creadaEn, creada_por: p.creadaPor || null, titulo: p.titulo, formato: p.formato, estilo: p.estilo,
  producto_id: p.productoId, producto_nombre: p.productoNombre, imagen_url: p.imagenUrl, miniatura: p.miniatura,
  copy: p.copy, pieza: p.pieza, estado: p.estado, request_id: p.requestId, banner_id: p.bannerId,
});
const faltaLaTabla = (e: any) => !!e && (/PGRST205|42P01/.test(String(e.code)) || /does not exist|schema cache|could not find/i.test(String(e.message)));

function leerLocal(): PautaGuardada[] {
  try { return JSON.parse(localStorage.getItem(CLAVE_LOCAL) || '[]'); } catch { return []; }
}
function escribirLocal(l: PautaGuardada[]) {
  try { localStorage.setItem(CLAVE_LOCAL, JSON.stringify(l.slice(0, MAX_LOCAL))); }
  catch { try { localStorage.setItem(CLAVE_LOCAL, JSON.stringify(l.slice(0, 4))); } catch { /* sin espacio */ } }
}

/** Las piezas guardadas, las más nuevas primero. `nube` indica si vienen de la base o solo de este aparato. */
export async function listarPautas(): Promise<{ items: PautaGuardada[]; nube: boolean }> {
  const { data, error } = await supabase.from('pautas').select(COLUMNAS).order('creada_en', { ascending: false }).limit(60);
  if (error) {
    if (faltaLaTabla(error)) return { items: leerLocal(), nube: false };
    throw new Error(error.message);
  }
  return { items: (data || []).map(deFila), nube: true };
}

/** Guarda (o actualiza) una pieza. Devuelve dónde quedó. */
export async function guardarPauta(p: PautaGuardada): Promise<'nube' | 'local'> {
  const { error } = await supabase.from('pautas').upsert(aFila(p));
  if (!error) return 'nube';
  if (!faltaLaTabla(error)) throw new Error(error.message);
  const resto = leerLocal().filter(x => x.id !== p.id);
  escribirLocal([p, ...resto]);
  return 'local';
}

export async function borrarPauta(id: string): Promise<void> {
  const { error } = await supabase.from('pautas').delete().eq('id', id);
  if (error && !faltaLaTabla(error)) throw new Error(error.message);
  escribirLocal(leerLocal().filter(x => x.id !== id));
  // La imagen de Storage se quita aparte; si falla no importa.
  void supabase.storage.from('marketing').remove([`pautas/${id}.jpg`]).then(() => {}, () => {});
}

export const nuevaId = () => `PAU-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export function aPautaGuardada(o: {
  id: string; titulo: string; pieza: Pieza; productoId: string | null; productoNombre: string | null; imagenUrl: string | null; miniatura: string | null;
  copy: PautaGuardada['copy']; creadaPor: string; estado?: PautaGuardada['estado']; requestId?: string | null; bannerId?: string | null; creadaEn?: string;
}): PautaGuardada {
  return {
    id: o.id, creadaEn: o.creadaEn || new Date().toISOString(), creadaPor: o.creadaPor, titulo: o.titulo, formato: o.pieza.formato, estilo: o.pieza.estilo,
    productoId: o.productoId, productoNombre: o.productoNombre, imagenUrl: o.imagenUrl, miniatura: o.miniatura,
    copy: o.copy, pieza: aGuardable(o.pieza), estado: o.estado || 'borrador', requestId: o.requestId ?? null, bannerId: o.bannerId ?? null,
  };
}

/** Sube el fondo hecho con IA (para poder volver a abrir la pieza con el mismo fondo). */
export async function subirFondo(dataUrl: string, id: string): Promise<string | null> {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const ruta = `pautas/${id}-fondo-${Date.now().toString(36)}.jpg`;
    const { error } = await supabase.storage.from('marketing').upload(ruta, blob, { contentType: blob.type || 'image/jpeg', upsert: false, cacheControl: '31536000' });
    if (error) return null;
    return supabase.storage.from('marketing').getPublicUrl(ruta).data?.publicUrl || null;
  } catch { return null; }
}
