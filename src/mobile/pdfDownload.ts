// =====================================================================
// MOTOR DE DESCARGA/VISUALIZACIÓN DEL PDF DE FACTURA (APK Y WEB)
// =====================================================================
// Dentro de la APK (una WebView), un enlace a la URL pública de Supabase
// lo resuelve el sistema operativo y no la app: Android abre el
// navegador predeterminado y saca a quien está cobrando de la pantalla
// de facturación. En un mostrador, eso significa perder de vista el
// cobro para ver un PDF que después hay que ir a buscar en las
// Descargas del navegador del teléfono.
//
// ---------------------------------------------------------------------
// TRES CAPAS EN LA APK, DE MEJOR A PEOR, SIN NUNCA DEJAR AL CAJERO SIN NADA
// ---------------------------------------------------------------------
// 1. @capacitor/filesystem: guarda el PDF directo en Documentos, sin
//    salir de la app. Es la mejor experiencia, pero es un plugin NATIVO
//    — solo existe en un .apk compilado después de agregarlo. Un
//    bundle OTA nunca puede traerlo: por eso una APK instalada antes de
//    este cambio jamás lo va a tener, y no hay forma de "actualizarlo"
//    sin volver a instalar el .apk.
// 2. Web Share API (`navigator.share` con un File adjunto): NO es un
//    plugin de Capacitor, es un estándar web que trae la propia WebView
//    de Android desde hace varios años — funciona en CUALQUIER versión
//    de esta app, vieja o nueva, sin recompilar nada. Abre la hoja
//    nativa de "Guardar en Archivos / Abrir con…" de Android.
// 3. Abrir con el navegador del sistema (`window.open(url, '_system')`):
//    el último recurso, garantizado en cualquier WebView de Capacitor
//    desde su primera versión. El PDF se ve, aunque no quede guardado
//    automáticamente.
//
// En la web (`isNative()` falso) nada de esto aplica: ahí se fuerza la
// descarga real del archivo con un blob + <a download>, en vez de abrir
// una pestaña con el visor de PDF del navegador.
// =====================================================================

export interface ResultadoDescarga {
  ok: boolean;
  mensaje: string;
}

/** Paso 1: guardar directo en Documentos con @capacitor/filesystem. */
async function guardarConFilesystem(blob: Blob, nombreArchivo: string): Promise<ResultadoDescarga> {
  let Filesystem: (typeof import('@capacitor/filesystem'))['Filesystem'];
  let Directory: (typeof import('@capacitor/filesystem'))['Directory'];
  try {
    ({ Filesystem, Directory } = await import('@capacitor/filesystem'));
  } catch {
    return { ok: false, mensaje: 'El guardado nativo no está disponible en esta instalación.' };
  }

  try {
    // En Android 9-12 escribir en Documentos requiere el permiso en
    // tiempo de ejecución, no solo declarado en el manifiesto. Pedirlo
    // aquí explícitamente evita depender de que el plugin lo solicite
    // solo — si la persona ya lo había negado antes, esto lo deja claro
    // en vez de fallar con un error genérico de escritura.
    try {
      const permiso = await Filesystem.checkPermissions();
      if (permiso.publicStorage !== 'granted') {
        const pedido = await Filesystem.requestPermissions();
        if (pedido.publicStorage !== 'granted') {
          return {
            ok: false,
            mensaje: 'Sin permiso de almacenamiento no se puede guardar el comprobante. Actívelo en Ajustes del teléfono para esta app.',
          };
        }
      }
    } catch {
      // Algunos Android (13+) ya no exponen este permiso: si la consulta
      // falla, se sigue de largo y que sea writeFile quien decida.
    }

    const base64 = await new Promise<string>((resolve, reject) => {
      const lector = new FileReader();
      lector.onload = () => resolve(((lector.result as string) || '').split(',')[1] || '');
      lector.onerror = () => reject(lector.error);
      lector.readAsDataURL(blob);
    });

    await Filesystem.writeFile({
      path: nombreArchivo,
      data: base64,
      directory: Directory.Documents,
      recursive: true,
    });

    return { ok: true, mensaje: `Comprobante guardado en Documentos como "${nombreArchivo}".` };
  } catch (e: any) {
    return { ok: false, mensaje: e?.message || 'No se pudo guardar el comprobante en el dispositivo.' };
  }
}

/** Paso 2: hoja nativa de compartir/guardar de Android, sin plugin. */
async function compartirConWebShare(blob: Blob, nombreArchivo: string): Promise<ResultadoDescarga> {
  try {
    if (typeof navigator === 'undefined' || !navigator.share) {
      return { ok: false, mensaje: 'Compartir no está disponible en este dispositivo.' };
    }
    const archivo = new File([blob], nombreArchivo, { type: 'application/pdf' });
    if (navigator.canShare && !navigator.canShare({ files: [archivo] })) {
      return { ok: false, mensaje: 'Este dispositivo no puede compartir archivos PDF.' };
    }
    await navigator.share({ files: [archivo], title: nombreArchivo });
    return { ok: true, mensaje: 'Elija "Guardar en Archivos" o el visor de PDF para abrirlo.' };
  } catch (e: any) {
    // AbortError: la persona cerró la hoja de compartir sin elegir nada.
    // No es un fallo real — no tiene sentido caer al paso 3 encima.
    if (e?.name === 'AbortError') return { ok: true, mensaje: '' };
    return { ok: false, mensaje: e?.message || 'No se pudo abrir la hoja de compartir.' };
  }
}

/**
 * Punto de entrada para la APK: intenta guardar directo, si no puede
 * ofrece compartir/abrir, y si tampoco puede, abre el navegador del
 * sistema. Solo devuelve `ok:false` cuando las TRES capas fallaron —
 * ahí es cuando quien llama debe avisar que no se pudo hacer nada.
 */
export async function guardarComprobanteNativo(url: string, nombreArchivo: string): Promise<ResultadoDescarga> {
  let blob: Blob;
  try {
    const respuesta = await fetch(url);
    if (!respuesta.ok) throw new Error(`No se pudo descargar el comprobante (HTTP ${respuesta.status}).`);
    blob = await respuesta.blob();
  } catch (e: any) {
    return { ok: false, mensaje: e?.message || 'No se pudo descargar el comprobante.' };
  }

  const porArchivo = await guardarConFilesystem(blob, nombreArchivo);
  if (porArchivo.ok) return porArchivo;

  const porCompartir = await compartirConWebShare(blob, nombreArchivo);
  if (porCompartir.ok) return { ok: true, mensaje: porCompartir.mensaje || 'Comprobante listo.' };

  try {
    window.open(url, '_system');
    return { ok: true, mensaje: 'Se abrió con el navegador del dispositivo.' };
  } catch {
    return { ok: false, mensaje: 'No se pudo guardar, compartir ni abrir el comprobante en este dispositivo.' };
  }
}

/**
 * Punto de entrada para la web: fuerza la descarga real del archivo en
 * vez de abrir una pestaña con el visor de PDF del navegador (que es lo
 * que hace un `<a target="_blank">` normal en Chrome/Edge).
 */
export async function descargarComprobanteWeb(url: string, nombreArchivo: string): Promise<ResultadoDescarga> {
  try {
    const respuesta = await fetch(url);
    if (!respuesta.ok) throw new Error(`No se pudo descargar el comprobante (HTTP ${respuesta.status}).`);
    const blob = await respuesta.blob();

    const urlBlob = URL.createObjectURL(blob);
    const enlace = document.createElement('a');
    enlace.href = urlBlob;
    enlace.download = nombreArchivo;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    // Revocar de inmediato puede cortar la descarga en algunos
    // navegadores antes de que termine de escribir el archivo a disco.
    setTimeout(() => URL.revokeObjectURL(urlBlob), 15000);

    return { ok: true, mensaje: `Descargando "${nombreArchivo}"...` };
  } catch (e: any) {
    // Último recurso: al menos que se pueda ver, aunque no se fuerce la
    // descarga — mejor que dejar al cajero sin nada.
    try {
      window.open(url, '_blank', 'noopener,noreferrer');
      return { ok: true, mensaje: 'Se abrió el comprobante en una pestaña nueva.' };
    } catch {
      return { ok: false, mensaje: e?.message || 'No se pudo descargar el comprobante.' };
    }
  }
}
