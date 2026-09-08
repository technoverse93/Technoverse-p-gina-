// =====================================================================
// ADJUNTOS DEL CHAT — fotos y videos, para el cliente y para el admin
// =====================================================================
// Un solo camino de subida para los dos lados. Antes solo el personal
// podía adjuntar: la política del bucket exigía `is_staff()`, así que al
// cliente le fallaba en silencio. Ahora el cliente también puede, pero
// únicamente dentro de la carpeta de SU conversación, y el bucket tiene
// tope de tamaño y lista de tipos permitidos del lado del servidor.
//
// LAS FOTOS SE COMPRIMEN, LOS VIDEOS NO
// ---------------------------------------------------------------------
// Una foto de teléfono son 4-8 MB y no aporta nada frente a 1000 px: se
// reescala y se sube como JPEG, que es lo que ya hacía el panel. Un video
// no se puede recomprimir en el navegador sin librerías pesadas, así que
// se sube tal cual y se RECHAZA antes de salir si pasa del tope — mejor
// un aviso claro que una subida de 40 MB que el servidor va a cortar.
// =====================================================================

import { supabase } from '../supabaseClient';
import { compressImage } from './storage';

/** Igual que el tope del bucket (ver migración). */
export const TOPE_ADJUNTO_BYTES = 25 * 1024 * 1024;

export interface Adjunto {
  imageUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
}

/** Lo que aceptan los selectores de archivo, en los dos lados. */
export const ACEPTA_ADJUNTOS = 'image/*,video/mp4,video/webm,video/quicktime';

/**
 * Formatos de video que el bucket acepta del lado del servidor.
 *
 * Tiene que ser LA MISMA lista que `allowed_mime_types` del bucket. Si no
 * coincide, el archivo sale del teléfono, viaja entero y el servidor lo
 * rechaza al final con un error técnico ("mime type ... is not supported")
 * que a la persona no le dice nada. Comprobándolo aquí, el aviso sale al
 * instante y en español.
 */
const VIDEOS_ACEPTADOS = new Set(['video/mp4', 'video/webm', 'video/quicktime']);

/** `video/quicktime` no es una extensión: es el nombre del formato. */
const EXTENSION_POR_TIPO: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/aac': 'aac',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
};

/**
 * Extensión SEGURA para la ruta del archivo.
 *
 * La política de subida del bucket exige que la ruta case con
 * `^[^/]+/[0-9]+\.[A-Za-z0-9]{1,5}$`. Aquí estaba el fallo del video: si el
 * archivo venía sin extensión en el nombre —cosa normal cuando se elige
 * desde la galería de Android, que entrega un `content://`— se caía al tipo
 * MIME y se armaba la ruta con "quicktime", nueve letras. La ruta dejaba de
 * casar con la política, el servidor rechazaba la subida y desde fuera se
 * veía como que "no hace nada". Ahora la extensión sale de una tabla y, en
 * el peor caso, se recorta a algo que la política sí admite.
 */
function extensionDe(file: File): string {
  const porTipo = EXTENSION_POR_TIPO[file.type.toLowerCase()];
  if (porTipo) return porTipo;
  const porNombre = (file.name.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (porNombre && porNombre.length <= 5) return porNombre;
  const cola = (file.type.split('/').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return cola.slice(0, 5) || 'bin';
}

/**
 * Sube una NOTA DE VOZ ya grabada y devuelve su URL pública.
 *
 * Va aparte de `subirAdjuntoChat` a propósito: el audio no viene de un
 * selector de archivos sino del micrófono (ver `grabadorVoz.ts`), llega
 * como Blob sin nombre, y no hay nada que comprimir ni validar contra una
 * galería. El único límite real es el mismo tope del bucket.
 *
 * El tipo del Blob se recorta a su parte base ("audio/webm;codecs=opus" →
 * "audio/webm") porque el bucket compara contra la lista de MIME exactos
 * de la migración: mandarle el `;codecs=...` pegado hace que el servidor
 * rechace la subida.
 */
export async function subirNotaDeVoz(convId: string, blob: Blob): Promise<Adjunto> {
  if (blob.size > TOPE_ADJUNTO_BYTES) {
    const mb = Math.round(blob.size / (1024 * 1024));
    throw new Error(`Esa nota de voz pesa ${mb} MB y el máximo es 25 MB. Grabá una más corta.`);
  }
  const tipo = (blob.type || 'audio/webm').split(';')[0].toLowerCase();
  const extension = EXTENSION_POR_TIPO[tipo] || 'webm';
  const ruta = `${convId}/${Date.now()}.${extension}`;
  const { error } = await supabase.storage
    .from('chat-images')
    .upload(ruta, blob, { contentType: tipo });
  if (error) throw error;
  const { data } = supabase.storage.from('chat-images').getPublicUrl(ruta);
  return { audioUrl: data.publicUrl };
}

/**
 * Sube una foto o un video y devuelve la URL pública que va al mensaje.
 *
 * Lanza con un mensaje legible si el archivo no sirve: quien llama solo
 * tiene que enseñarlo tal cual.
 */
export async function subirAdjuntoChat(convId: string, file: File): Promise<Adjunto> {
  const esVideo = file.type.startsWith('video/');
  const esImagen = file.type.startsWith('image/');
  if (!esVideo && !esImagen) {
    throw new Error('Solo se pueden enviar fotos o videos.');
  }

  if (esVideo) {
    if (!VIDEOS_ACEPTADOS.has(file.type.toLowerCase())) {
      throw new Error(
        'Ese formato de video no se admite. Se pueden enviar MP4, WEBM o MOV. ' +
        'Si lo grabaste con la cámara, mandalo desde la galería.'
      );
    }
    if (file.size > TOPE_ADJUNTO_BYTES) {
      const mb = Math.round(file.size / (1024 * 1024));
      throw new Error(`Ese video pesa ${mb} MB y el máximo es 25 MB. Grabá uno más corto o bajale la calidad.`);
    }
    const ruta = `${convId}/${Date.now()}.${extensionDe(file)}`;
    const { error } = await supabase.storage
      .from('chat-images')
      .upload(ruta, file, { contentType: file.type });
    if (error) throw error;
    const { data } = supabase.storage.from('chat-images').getPublicUrl(ruta);
    return { videoUrl: data.publicUrl };
  }

  // Imagen: se reescala antes de salir, igual que en el panel.
  const dataUrl: string = await new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(lector.result as string);
    lector.onerror = reject;
    lector.readAsDataURL(file);
  });
  const comprimida = await compressImage(dataUrl, 1000, 1000, 0.7);
  const blob = await (await fetch(comprimida)).blob();
  const ruta = `${convId}/${Date.now()}.jpg`;
  const { error } = await supabase.storage
    .from('chat-images')
    .upload(ruta, blob, { contentType: 'image/jpeg' });
  if (error) throw error;
  const { data } = supabase.storage.from('chat-images').getPublicUrl(ruta);
  return { imageUrl: data.publicUrl };
}
