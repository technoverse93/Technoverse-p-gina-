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
}

/** Lo que aceptan los selectores de archivo, en los dos lados. */
export const ACEPTA_ADJUNTOS = 'image/*,video/mp4,video/webm,video/quicktime';

function extensionDe(file: File): string {
  const porNombre = (file.name.split('.').pop() || '').toLowerCase();
  if (porNombre && porNombre.length <= 5) return porNombre;
  const porTipo = (file.type.split('/').pop() || '').toLowerCase();
  return porTipo || 'bin';
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
