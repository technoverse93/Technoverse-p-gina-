// =====================================================================
// GUARDAR Y COMPARTIR IMÁGENES (APK y web)
// =====================================================================
// Para las piezas del Estudio de pauta (y cualquier imagen que haya que
// sacar de la app). Mismas tres capas que el PDF de factura, de mejor a peor
// y sin dejar a nadie sin nada:
//   · APK: se guarda en Documentos (plugin de archivos) y, si no se puede,
//     se abre la hoja de compartir de Android (estándar web, funciona en
//     cualquier versión de la app).
//   · Web: descarga directa con un enlace temporal.
// =====================================================================

import { Capacitor } from '@capacitor/core';

export type ResultadoImagen = { ok: boolean; mensaje: string };

const aBase64 = (blob: Blob) => new Promise<string>((ok, mal) => {
  const l = new FileReader();
  l.onload = () => ok(String(l.result || '').split(',')[1] || '');
  l.onerror = () => mal(l.error);
  l.readAsDataURL(blob);
});

/** Hoja de compartir (WhatsApp, Instagram, Drive…). `ok` también si la cerraron sin elegir. */
export async function compartirImagen(blob: Blob, nombre: string, texto = ''): Promise<ResultadoImagen> {
  try {
    if (typeof navigator === 'undefined' || !navigator.share) return { ok: false, mensaje: 'Este aparato no puede abrir la hoja de compartir.' };
    const archivo = new File([blob], nombre, { type: blob.type || 'image/jpeg' });
    if (navigator.canShare && !navigator.canShare({ files: [archivo] })) return { ok: false, mensaje: 'Este aparato no puede compartir imágenes.' };
    await navigator.share({ files: [archivo], title: nombre, ...(texto ? { text: texto } : {}) });
    return { ok: true, mensaje: '' };
  } catch (e: any) {
    if (e?.name === 'AbortError') return { ok: true, mensaje: '' };
    return { ok: false, mensaje: e?.message || 'No se pudo compartir.' };
  }
}

/** Guarda la imagen en el aparato. */
export async function guardarImagen(blob: Blob, nombre: string): Promise<ResultadoImagen> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      try {
        const permiso = await Filesystem.checkPermissions();
        if (permiso.publicStorage !== 'granted') await Filesystem.requestPermissions();
      } catch { /* Android 13+ ya no lo expone: que decida writeFile */ }
      await Filesystem.writeFile({ path: nombre, data: await aBase64(blob), directory: Directory.Documents, recursive: true });
      return { ok: true, mensaje: `Guardada en Documentos como «${nombre}».` };
    } catch { /* se cae a compartir */ }
    const r = await compartirImagen(blob, nombre);
    return r.ok ? { ok: true, mensaje: r.mensaje || 'Elegí «Guardar» en la hoja de compartir.' } : { ok: false, mensaje: r.mensaje || 'No se pudo guardar la imagen.' };
  }
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nombre; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return { ok: true, mensaje: `Descargada como «${nombre}».` };
  } catch (e: any) {
    return { ok: false, mensaje: e?.message || 'No se pudo descargar la imagen.' };
  }
}
