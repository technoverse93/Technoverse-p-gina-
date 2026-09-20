// =====================================================================
// CÁMARA DEL CHAT — tomar una foto y mandarla al instante
// =====================================================================
// Un botón de cámara que alimenta EXACTAMENTE el mismo camino de subida
// que ya usaban el clip de adjuntos y la nota de voz (ver
// `adjuntosChat.ts`): la foto sale, se comprime, se sube a Storage y viaja
// como un mensaje más. Aquí solo se resuelve UNA cosa: de dónde sale la
// foto según dónde corre la app.
//
//   • EN LA APK (Android/iOS): se abre la cámara del sistema con
//     `@capacitor/camera`. `source: CameraSource.Camera` fuerza la cámara
//     —no la galería—, así el botón hace lo que dice. El plugin se importa
//     de forma DIFERIDA (solo tras confirmar que corre en nativo) para que
//     su código no entre en el bundle de la web ni pese en el navegador.
//
//   • EN EL NAVEGADOR: esta función devuelve `null` y quien llama recae en
//     un `<input type="file" accept="image/*" capture="environment">`. El
//     atributo `capture` es lo que hace que un teléfono (iOS/Android) abra
//     la cámara trasera directo en vez del selector de galería. No se puede
//     resolver desde JavaScript: tiene que ser un input real disparado por
//     un gesto, por eso el fallback vive en el componente y no aquí.
//
// Cancelar la cámara NO es un error: si la persona cierra la cámara sin
// tomar nada, se devuelve `null` en vez de lanzar, para que el chat no
// muestre un aviso de fallo por algo que la persona hizo a propósito.
// =====================================================================

import { Capacitor } from '@capacitor/core';

/** ¿Hay cámara nativa (APK) disponible? En el navegador es siempre `false`. */
export function hayCamaraNativa(): boolean {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
}

/**
 * Abre la cámara del sistema en la APK y devuelve la foto como `File`,
 * lista para el mismo `subirAdjuntoChat` que usa cualquier otro adjunto.
 *
 * Devuelve `null` en dos casos, ambos normales: (1) no corre en nativo —el
 * navegador usa el input con `capture` en su lugar—, y (2) la persona
 * cerró la cámara sin tomar la foto. Cualquier fallo REAL sí se lanza, para
 * que el componente lo enseñe.
 */
export async function tomarFotoNativa(): Promise<File | null> {
  if (!hayCamaraNativa()) return null;

  const { Camera, CameraSource, CameraResultType } = await import('@capacitor/camera');

  // ---------------------------------------------------------------------
  // FALLO CORREGIDO — "el botón de cámara no responde" en la APK instalada
  // ---------------------------------------------------------------------
  // `Camera.getPhoto()` pide el permiso de cámara por su cuenta la PRIMERA
  // vez, pero si la persona lo negó en ese momento —un toque sin querer, o
  // a propósito— Android deja de mostrar el diálogo de permiso en los
  // toques siguientes: no es que la app no lo pida, es que el sistema ya
  // decidió no volver a preguntar. `getPhoto()` entonces rechaza la
  // promesa de una sin abrir nada visible, y desde el botón eso se ve
  // exactamente como "no responde" — no hay diálogo, no hay foto, ni
  // siquiera un error en pantalla si algo más arriba lo dejara pasar en
  // silencio.
  //
  // Ahora el permiso se comprueba A MANO, ANTES de tocar el hardware: si
  // falta, se pide de forma explícita con `requestPermissions`, y si la
  // persona lo niega, se lanza un mensaje que dice exactamente qué hacer
  // —no un "no se pudo" genérico— en vez de dejar el botón pareciendo
  // roto.
  try {
    const estado = await Camera.checkPermissions();
    if (estado.camera !== 'granted') {
      const pedido = await Camera.requestPermissions({ permissions: ['camera'] });
      if (pedido.camera !== 'granted') {
        throw new Error(
          'Technoverse necesita permiso de cámara para tomar la foto. ' +
          'Activalo en Ajustes del teléfono → Aplicaciones → Technoverse → Permisos → Cámara.'
        );
      }
    }
  } catch (err: any) {
    // El mensaje de "falta el permiso" (armado arriba) SÍ hay que
    // mostrarlo. Cualquier otro fallo viene de que `checkPermissions`
    // mismo no está disponible (plugin viejo, versión de Android rara):
    // no es motivo para rendirse, `getPhoto()` va a pedir el permiso por
    // su cuenta si hiciera falta.
    if (err instanceof Error && err.message.startsWith('Technoverse necesita permiso')) throw err;
  }

  try {
    const foto = await Camera.getPhoto({
      source: CameraSource.Camera,   // la cámara, no la galería
      quality: 80,
      resultType: CameraResultType.Uri,
      correctOrientation: true,
      saveToGallery: false,
    });
    // Con `Uri`, `webPath` es una URL que el WebView sí puede leer; se baja
    // a un Blob y se envuelve como File para que entre por el mismo camino
    // que un archivo elegido a mano.
    const uri = foto.webPath;
    if (!uri) return null;
    const blob = await (await fetch(uri)).blob();
    const ext = (foto.format || 'jpg').toLowerCase() === 'jpeg' ? 'jpg' : (foto.format || 'jpg').toLowerCase();
    const tipo = blob.type || `image/${ext === 'jpg' ? 'jpeg' : ext}`;
    return new File([blob], `camara-${Date.now()}.${ext}`, { type: tipo });
  } catch (err: any) {
    // El plugin lanza al cancelar. Eso no es un fallo que haya que mostrar.
    const msg = String(err?.message || err || '').toLowerCase();
    if (msg.includes('cancel') || msg.includes('cancell') || msg.includes('canceló') || msg.includes('no image')) {
      return null;
    }
    throw err;
  }
}
