// =====================================================================
// DESCARGA NATIVA DEL PDF DE FACTURA (APK)
// =====================================================================
// Dentro de la APK (una WebView), un enlace a la URL pública de Supabase
// lo resuelve el sistema operativo y no la app: Android abre el
// navegador predeterminado y saca a quien está cobrando de la pantalla
// de facturación. En un mostrador, eso significa perder de vista el
// cobro para ver un PDF que después hay que ir a buscar en las
// Descargas del navegador del teléfono.
//
// Con @capacitor/filesystem se descarga el PDF y se escribe directo en
// la carpeta pública de Documentos del dispositivo, sin salir de la app
// ni abrir nada externo. En la web (`isNative()` falso) este módulo no
// se usa: ahí el comportamiento correcto sigue siendo el enlace normal
// del navegador.
// =====================================================================

export interface ResultadoDescarga {
  ok: boolean;
  mensaje: string;
}

/** Descarga el PDF de `url` y lo guarda en Documentos con `nombreArchivo`. */
export async function descargarPdfNativo(url: string, nombreArchivo: string): Promise<ResultadoDescarga> {
  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');

    const respuesta = await fetch(url);
    if (!respuesta.ok) throw new Error(`No se pudo descargar el comprobante (HTTP ${respuesta.status}).`);
    const blob = await respuesta.blob();

    // Filesystem.writeFile pide el contenido en base64: FileReader es la
    // forma estándar de convertir un Blob sin depender de Buffer (que no
    // existe en el navegador/WebView).
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
