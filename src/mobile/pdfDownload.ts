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
  /**
   * true cuando el fallo es porque el plugin nativo no está disponible en
   * este APK (una instalación anterior a que se agregara esta función, que
   * solo llega compilando un .apk nuevo — un bundle OTA nunca puede traer
   * código nativo). Con esto la pantalla que llama puede caer a abrir el
   * PDF con el navegador del sistema en vez de dejar al cajero sin nada.
   */
  pluginNoDisponible?: boolean;
}

/** Descarga el PDF de `url` y lo guarda en Documentos con `nombreArchivo`. */
export async function descargarPdfNativo(url: string, nombreArchivo: string): Promise<ResultadoDescarga> {
  let Filesystem: (typeof import('@capacitor/filesystem'))['Filesystem'];
  let Directory: (typeof import('@capacitor/filesystem'))['Directory'];
  try {
    ({ Filesystem, Directory } = await import('@capacitor/filesystem'));
  } catch {
    return {
      ok: false,
      pluginNoDisponible: true,
      mensaje: 'Esta instalación de la app todavía no trae el guardado nativo. Se necesita descargar el APK más reciente.',
    };
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
