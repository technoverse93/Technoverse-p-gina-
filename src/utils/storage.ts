import { supabase } from '../supabaseClient';
import {
  User, Product, InventoryMovement, RepairOrder, Order,
  ChatConversation, ChatMessage,
  AuditLog, ClientProfile, LogisticsDelivery, MarketingCampaign,
  AppSettings, Banner, HistoricalSku, MarketingRequest
} from '../types';

// Toda la base de datos vive en Supabase (Postgres + Realtime). Firebase ya
// no se usa: este módulo mantiene exactamente la misma API pública que antes
// (getDB, saveDB, addAuditLog, saveLogo, getLogo, compressImage, ADMIN_PASSWORD)
// para que ningún otro componente tenga que cambiar, pero por dentro todo se
// sincroniza contra Supabase con Realtime + RLS en vez de Firestore.

export const ADMIN_PASSWORD = "T3chn0V3rs3!Admin2026";

interface Database {
  users: User[];
  products: Product[];
  inventory_movements: InventoryMovement[];
  repair_orders: RepairOrder[];
  orders: Order[];
  chat_conversations: ChatConversation[];
  audit_log: AuditLog[];
  clients: ClientProfile[];
  deliveries: LogisticsDelivery[];
  marketing_campaigns: MarketingCampaign[];
  marketing_requests: MarketingRequest[];
  banners: Banner[];
  settings?: AppSettings;
  historical_skus?: HistoricalSku[];
}

// FALLO CORREGIDO — el "banner fantasma".
//
// Acá había un banner de ejemplo escrito a mano ("Reparación desde Casa /
// Ahorre tiempo") que se usaba como contenido inicial. El problema es que ese
// banner NO existe en la base: la tienda lo dibujaba de entrada, encima del
// carrusel de categorías, y en cuanto llegaba la respuesta de Supabase —con
// cero banners— desaparecía. El resultado era un cartel que aparecía y se iba
// en un parpadeo cada vez que alguien abría la página.
//
// El arranque tiene que reflejar lo que hay de verdad: si todavía no se leyó
// la base, no hay banners que mostrar. Cuando se cargue uno real desde el
// panel, se dibuja solo y sin parpadeo.
const DEFAULT_BANNERS: Banner[] = [];
const DEFAULT_SETTINGS: AppSettings = { cedulaJuridica: '', companyPhone: '', companyAddress: '', workshopAddress: '', pickupHours: '', maxStockLimit: 50, instagramWebhookUrl: '' };

function getDefaultDB(): Database {
  return {
    users: [{ id: 'admin-id', email: 'technoverse.admin@gmail.com', role: 'Dueño', name: 'Administrador Technoverse' }],
    products: [], inventory_movements: [], repair_orders: [], orders: [],
    chat_conversations: [],
    audit_log: [], clients: [], deliveries: [], marketing_campaigns: [], marketing_requests: [],
    banners: DEFAULT_BANNERS, settings: DEFAULT_SETTINGS, historical_skus: []
  };
}

let localCache: Database = getDefaultDB();
let broadcastChannel: BroadcastChannel | null = null;

if (typeof window !== 'undefined') {
  try {
    broadcastChannel = new BroadcastChannel('technoverse_db_channel');
  } catch (e) {
    broadcastChannel = null;
  }
}

// ===================== Identidad del cliente de chat (anónimo) =====================
// El cliente del chat no tiene login: se le asigna un token secreto (uuid) que
// vive en localStorage. Con él (a) el backend le devuelve SOLO sus propias
// conversaciones (RPC get_customer_chat) y (b) puede recuperar su historial al
// volver. authedSession indica si hay una sesión Supabase (staff/cliente
// logueado); en ese caso se lee la tabla directo (RLS filtra), no por token.
const CHAT_TOKEN_KEY = 'technoverse_chat_token';
let authedSession: any = null;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Genera un UUID v4 VÁLIDO en cualquier navegador. crypto.randomUUID() solo
// existe en Safari 15.4+ y en contexto seguro; cuando falta, se construye con
// crypto.getRandomValues (presente en Safari desde hace años). El respaldo
// anterior producía un texto tipo "1784...-abc" que NO es un uuid válido, y la
// columna customer_token (tipo uuid) rechazaba el INSERT → falso "sin conexión"
// al crear un chat nuevo en Safari.
function generateUUID(): string {
  try {
    if (typeof crypto !== 'undefined' && (crypto as any).randomUUID) {
      return (crypto as any).randomUUID();
    }
  } catch { /* sigue al respaldo */ }
  try {
    if (typeof crypto !== 'undefined' && (crypto as any).getRandomValues) {
      const b = (crypto as any).getRandomValues(new Uint8Array(16));
      b[6] = (b[6] & 0x0f) | 0x40; // versión 4
      b[8] = (b[8] & 0x3f) | 0x80; // variante
      const h: string[] = [];
      for (let i = 0; i < 16; i++) h.push(b[i].toString(16).padStart(2, '0'));
      return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
    }
  } catch { /* sigue al respaldo */ }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getCustomerChatToken(): string | null {
  try {
    const t = typeof window !== 'undefined' ? window.localStorage.getItem(CHAT_TOKEN_KEY) : null;
    // Solo se acepta un uuid válido: un token viejo con formato inválido
    // (generado por Safari con el respaldo anterior) se descarta para que
    // ensureCustomerChatToken lo regenere correctamente.
    return t && UUID_RE.test(t) ? t : null;
  } catch { return null; }
}

export function ensureCustomerChatToken(): string {
  let t = getCustomerChatToken();
  if (!t) {
    t = generateUUID();
    try { window.localStorage.setItem(CHAT_TOKEN_KEY, t); } catch { /* almacenamiento no disponible */ }
  }
  return t;
}

function notifyUpdate() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('technoverse_db_updated', { detail: localCache }));
    if (broadcastChannel) {
      try { broadcastChannel.postMessage({ type: 'UPDATE_DB' }); } catch (e) {}
    }
  }
}

function notifySyncError(message: string) {
  console.error('[Supabase Sync Error]', message);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('technoverse_sync_error', { detail: { message } }));
  }
}

export function checkQuotaError(err: any) {
  if (err) console.error('[Supabase Error]', err?.message || err);
}

export function isFirebaseQuotaExceeded() {
  return false;
}

export function getDB(): Database {
  return JSON.parse(JSON.stringify(localCache));
}

function diffArrays<T extends Record<string, any>>(oldArr: T[], newArr: T[], key = 'id') {
  const safeOldArr = (oldArr || []).filter(item => item && item[key] !== undefined);
  const safeNewArr = (newArr || []).filter(item => item && item[key] !== undefined);

  const oldMap = new Map(safeOldArr.map(item => [item[key], item]));
  const added: T[] = [];
  const modified: T[] = [];
  const deleted: T[] = [];

  safeNewArr.forEach(item => {
    if (!oldMap.has(item[key])) added.push(item);
    else {
      const oldItem = oldMap.get(item[key]);
      if (JSON.stringify(oldItem) !== JSON.stringify(item)) modified.push(item);
      oldMap.delete(item[key]);
    }
  });
  oldMap.forEach(item => deleted.push(item));
  return { added, modified, deleted };
}

// Detecta si el lienzo contiene algún pixel no opaco. Se recorre el canal
// alfa completo (1 de cada 4 bytes); en una imagen de 600×600 son ~360 000
// lecturas, unos pocos milisegundos, y en cuanto encuentra el primer pixel
// transparente corta.
function canvasHasTransparency(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  try {
    const { data } = ctx.getImageData(0, 0, width, height);
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) return true;
    }
    return false;
  } catch {
    // Si el lienzo estuviera contaminado (imagen de otro origen) no se puede
    // leer: se asume que sí hay transparencia para no destruirla.
    return true;
  }
}

/** True si la imagen contiene al menos un pixel no opaco. */
export function imageHasTransparency(dataUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!dataUrl || !dataUrl.startsWith('data:')) { resolve(false); return; }
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) { resolve(false); return; }
      ctx.drawImage(img, 0, 0);
      resolve(canvasHasTransparency(ctx, img.width, img.height));
    };
    img.onerror = () => resolve(false);
    img.src = dataUrl;
  });
}

/**
 * Codifica un lienzo con el formato más liviano que conserve lo que hace falta.
 *
 * POR QUÉ WEBP
 *   Las imágenes del catálogo viajan como texto base64 DENTRO del JSON de
 *   productos, así que cada KB de imagen es un KB que el cliente descarga antes
 *   de que la tienda pueda dibujarse. El caso caro era la transparencia: como
 *   JPEG no tiene canal alfa, había que caer en PNG, que comprime fotos muy
 *   mal. Medido sobre una foto de 500x500 con fondo recortado: PNG 228 KB
 *   contra 26 KB en WebP de la misma calidad — 89 % menos. WebP conserva el
 *   alfa igual que PNG y además le gana a JPEG en las imágenes opacas.
 *
 * POR QUÉ SE VERIFICA EL RESULTADO
 *   `toDataURL` no avisa cuando no soporta un formato: ignora el tipo pedido y
 *   devuelve PNG en silencio. Si eso pasara con una foto opaca, el "ahorro"
 *   terminaría pesando MÁS que el JPEG de antes. Por eso no se asume soporte:
 *   se mira el prefijo real de lo que salió y, si no es WebP, se usa el
 *   comportamiento anterior (PNG con alfa, JPEG sin alfa). El peor caso posible
 *   es exactamente lo que ya se guardaba, nunca algo peor.
 */
function encodeCanvas(canvas: HTMLCanvasElement, tieneAlfa: boolean, quality: number): string {
  try {
    const webp = canvas.toDataURL('image/webp', quality);
    if (webp.startsWith('data:image/webp')) return webp;
  } catch {
    // Navegador sin WebP: sigue al respaldo de abajo.
  }
  return tieneAlfa ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', quality);
}

/**
 * Reescala una imagen manteniendo su transparencia.
 *
 * FALLO CORREGIDO: esta función devolvía SIEMPRE `canvas.toDataURL('image/jpeg')`.
 * El formato JPEG no tiene canal alfa, así que cada PNG recortado que se subía
 * al catálogo perdía la transparencia en el momento de guardarlo — el fondo se
 * rellenaba de negro o blanco y ninguna clase de CSS podía recuperarlo, porque
 * el dato ya venía aplanado desde la base.
 *
 * El formato lo elige `encodeCanvas()`: WebP cuando el navegador lo soporta
 * (conserva el alfa y pesa una fracción), y si no, PNG para las imágenes con
 * transparencia y JPEG para las opacas.
 */
export function compressImage(dataUrl: string, maxWidth = 500, maxHeight = 500, quality = 0.7): Promise<string> {
  return new Promise((resolve) => {
    if (!dataUrl || !dataUrl.startsWith('data:')) {
      resolve(dataUrl);
      return;
    }
    const img = new Image();
    img.onload = () => {
      let width = img.width;
      let height = img.height;
      if (width > height) {
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      // El lienzo arranca totalmente transparente y NO se pinta ningún fondo:
      // así el alfa del origen llega intacto al resultado.
      ctx.drawImage(img, 0, 0, width, height);
      try {
        const tieneAlfa = canvasHasTransparency(ctx, width, height);
        const salida = encodeCanvas(canvas, tieneAlfa, quality);
        // Red de seguridad para el respaldo PNG (sin WebP, una imagen con alfa
        // puede quedar enorme): si el resultado se pasa de ~1,2 MB y el
        // original venía más liviano, se prefiere el original tal cual.
        resolve(salida.length > 1_200_000 && dataUrl.length < salida.length ? dataUrl : salida);
      } catch (err) {
        resolve(dataUrl);
      }
    };
    img.onerror = () => {
      resolve(dataUrl);
    };
    img.src = dataUrl;
  });
}

/** Lado máximo, en píxeles, de una imagen de catálogo ya procesada. */
const SALIDA_MAX = 500;

// ===================== Imágenes en Supabase Storage =====================
//
// POR QUÉ EXISTE ESTO
//   Hasta ahora la foto de cada producto viajaba como texto base64 DENTRO de la
//   fila, y por lo tanto dentro del JSON que la tienda descarga al abrirse. Con
//   eso las imágenes son BLOQUEANTES: el catálogo no puede dibujarse hasta que
//   haya llegado el último byte de la última foto. Medido sobre el catálogo
//   real: 8 productos = 401 KB que el cliente baja antes de ver nada, y crece
//   en línea recta (200 productos serían unos 9 MB).
//
//   Guardando la foto en Storage, en la fila queda una URL de ~100 bytes. El
//   JSON del catálogo pasa a pesar un par de KB y se dibuja al instante; las
//   fotos llegan después, cada una por su lado, y el navegador las cachea. La
//   diferencia deja de depender de cuántos productos haya.
//
// POR QUÉ NO ROMPE NADA
//   · Si la subida falla por lo que sea (sin señal, permisos, bucket caído) se
//     devuelve el base64 original y todo sigue funcionando exactamente como
//     antes. El peor caso es el comportamiento de hoy.
//   · Las filas viejas que todavía tengan "data:..." se siguen mostrando sin
//     tocar nada: una etiqueta <img> acepta las dos formas igual.
const BUCKET_IMAGENES = 'productos';

/**
 * Umbral por debajo del cual no compensa el viaje de red y conviene dejar la
 * imagen incrustada.
 *
 * CALIBRADO MAL LA PRIMERA VEZ: estaba en 8 KB, pensado para las fotos de
 * 26-50 KB que producía el catálogo antes. Pero al pasar a WebP las fotos
 * bajaron a ~8 KB, así que quedaban JUSTO por debajo del corte y no subía
 * ninguna: la primera foto de prueba pesó 8.099 bytes contra un umbral de
 * 8.192 y se guardó incrustada. El umbral desactivaba la función entera.
 *
 * Ahora está en 2 KB, que es lo que corresponde al propósito real: evitar el
 * viaje solo para cosas triviales —un ícono SVG de 500 bytes, por ejemplo—.
 * Cualquier foto de producto de verdad queda muy por encima y va al depósito.
 */
const MINIMO_PARA_SUBIR = 2 * 1024;

/**
 * Huella corta y estable del contenido (FNV-1a de 32 bits).
 *
 * Sirve para que la MISMA imagen reutilice siempre el mismo archivo, y para que
 * una imagen distinta estrene nombre. Eso último importa: si se reescribiera el
 * mismo nombre, las cachés del navegador y de la CDN seguirían sirviendo la
 * foto vieja. No se usa criptografía a propósito — acá solo hace falta
 * distinguir contenidos, y esto corre en cualquier navegador sin depender de
 * crypto.subtle ni de contexto seguro.
 */
function huellaContenido(texto: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

const EXTENSION_POR_TIPO: Record<string, string> = {
  'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg',
};

/**
 * Deja constancia en la bitácora de cómo le fue a una subida.
 *
 * POR QUÉ EN LA BASE Y NO EN LA CONSOLA
 *   Cuando una subida falla, la foto se queda incrustada — que es exactamente
 *   lo que se ve cuando la subida NI SE INTENTÓ (por ejemplo, si el navegador
 *   todavía tiene cargada una versión anterior de la app). Los dos casos son
 *   indistinguibles mirando la fila del producto, y desde un celular no hay
 *   forma cómoda de abrir la consola. Escribiéndolo en la bitácora, el rastro
 *   queda donde se puede consultar después y sin depender del dispositivo.
 *
 * Escribe directo a la tabla en vez de usar addAuditLog() a propósito: esa
 * función termina llamando a saveDB(), y esto corre DENTRO de saveDB.
 */
function anotarResultadoSubida(acción: string, detalle: string) {
  try {
    void supabase.from('audit_logs').insert({
      id: `LOG-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      user_email: 'sistema',
      module: 'Imágenes',
      action: acción,
      detail: detalle.slice(0, 500),
    });
  } catch {
    // El diagnóstico jamás puede tumbar un guardado.
  }
}

/**
 * Sube una imagen en base64 al bucket y devuelve su URL pública.
 * Ante cualquier problema devuelve el base64 recibido, sin lanzar excepción:
 * guardar el producto nunca puede fallar por culpa de la foto.
 */
async function subirImagenADeposito(dataUrl: string, carpeta: string, id: string): Promise<string> {
  try {
    if (!dataUrl.startsWith('data:image/')) return dataUrl;
    if (dataUrl.length < MINIMO_PARA_SUBIR) {
      anotarResultadoSubida('Omitida por tamaño', `${id} — ${dataUrl.length} bytes, mínimo ${MINIMO_PARA_SUBIR}`);
      return dataUrl;
    }

    const coma = dataUrl.indexOf(',');
    const cabecera = dataUrl.slice(5, coma);           // ej. "image/webp;base64"
    if (!cabecera.includes(';base64')) {
      anotarResultadoSubida('Omitida, no es base64', `${id} — cabecera "${cabecera}"`);
      return dataUrl;
    }
    const tipo = cabecera.split(';')[0];
    const ext = EXTENSION_POR_TIPO[tipo];
    if (!ext) {
      anotarResultadoSubida('Omitida, tipo no admitido', `${id} — tipo "${tipo}"`);
      return dataUrl;
    }

    const crudo = atob(dataUrl.slice(coma + 1));
    const bytes = new Uint8Array(crudo.length);
    for (let i = 0; i < crudo.length; i++) bytes[i] = crudo.charCodeAt(i);

    const ruta = `${carpeta}/${id}-${huellaContenido(dataUrl)}.${ext}`;
    const { error } = await supabase.storage
      .from(BUCKET_IMAGENES)
      .upload(ruta, bytes, { contentType: tipo, upsert: true, cacheControl: '31536000' });
    // "ya existe" no es un fallo: significa que esta misma foto ya estaba
    // subida y se puede reutilizar el archivo tal cual.
    if (error && !/exists/i.test(error.message)) {
      console.warn('[Imágenes] No se pudo subir a Storage, queda incrustada:', error.message);
      anotarResultadoSubida('Subida fallida', `${ruta} — ${error.message}`);
      return dataUrl;
    }

    const { data } = supabase.storage.from(BUCKET_IMAGENES).getPublicUrl(ruta);
    if (!data?.publicUrl) {
      anotarResultadoSubida('Sin URL pública', ruta);
      return dataUrl;
    }
    anotarResultadoSubida('Subida correcta', `${ruta} — ${bytes.length} bytes`);
    return data.publicUrl;
  } catch (err: any) {
    anotarResultadoSubida('Excepción al subir', String(err?.message || err));
    return dataUrl;
  }
}

/**
 * Recorre el borrador que está por guardarse y reemplaza cada foto incrustada
 * por su URL en Storage. Modifica el objeto recibido a propósito: así la copia
 * en memoria y la fila que se escribe quedan con la URL, y en el próximo
 * guardado ya no hay nada que subir.
 */
async function subirImagenesEmbebidas(db: Database): Promise<void> {
  const pendientes: Promise<void>[] = [];
  const revisar = (fila: any, carpeta: string, id: string) => {
    if (!fila || typeof fila.imageUrl !== 'string' || !fila.imageUrl.startsWith('data:')) return;
    const original = fila.imageUrl;
    pendientes.push(
      subirImagenADeposito(original, carpeta, id).then((url) => { fila.imageUrl = url; })
    );
  };
  (db.products || []).forEach((p: any) => revisar(p, 'catalogo', String(p.id)));
  (db.historical_skus || []).forEach((h: any) => revisar(h, 'skus', String(h.sku)));
  (db.banners || []).forEach((b: any) => revisar(b, 'banners', String(b.id)));
  if (pendientes.length) await Promise.all(pendientes);
}

/**
 * Convierte en transparente el fondo plano o cuadriculado de una imagen.
 *
 * Para qué sirve: muchos bancos de imágenes (pngwing y similares) entregan una
 * VISTA PREVIA en la que el damero gris que representa la transparencia está
 * dibujado dentro de los píxeles. Ese archivo es 100 % opaco, así que no hay
 * nada que preservar al guardarlo — el damero se ve tal cual sobre la tarjeta
 * del producto. Esta función recupera la transparencia real.
 *
 * Cómo trabaja:
 *   1. Recorre el borde de la imagen y se queda con los colores que ocupan más
 *      del 5 % de ese contorno (hasta cuatro). Un damero aporta dos tonos; un
 *      fondo blanco liso, uno solo.
 *   2. Rellena desde los bordes hacia adentro (flood fill) marcando como
 *      transparente todo lo que esté dentro de la tolerancia de esos colores.
 *      Al avanzar por conexión y no por color suelto, un blanco que forme parte
 *      del producto —el interior de un conector, por ejemplo— no se borra.
 *   3. Suaviza el contorno bajando la opacidad de los píxeles que quedaron
 *      rodeados de transparencia, para que no se vea aserrado.
 *
 * El recorte se calcula a resolución completa (más detalle = mejor borde), pero
 * lo que devuelve ya viene reescalado a `SALIDA_MAX` y codificado por
 * `encodeCanvas()`, que conserva el canal alfa. Ante cualquier problema
 * devuelve la imagen original sin tocar.
 */
export function removeFlatBackground(dataUrl: string, tolerance = 26): Promise<string> {
  return new Promise((resolve) => {
    if (!dataUrl || !dataUrl.startsWith('data:')) { resolve(dataUrl); return; }
    const img = new Image();
    img.onload = () => {
      const w = img.width, h = img.height;
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) { resolve(dataUrl); return; }
      ctx.drawImage(img, 0, 0);
      let imageData: ImageData;
      try { imageData = ctx.getImageData(0, 0, w, h); } catch { resolve(dataUrl); return; }
      const d = imageData.data;
      const idx = (x: number, y: number) => (y * w + x) * 4;

      const conteo = new Map();
      const anotar = (x: number, y: number) => {
        const i = idx(x, y);
        const clave = `${d[i] >> 3},${d[i + 1] >> 3},${d[i + 2] >> 3}`;
        conteo.set(clave, (conteo.get(clave) || 0) + 1);
      };
      for (let x = 0; x < w; x++) { anotar(x, 0); anotar(x, h - 1); }
      for (let y = 0; y < h; y++) { anotar(0, y); anotar(w - 1, y); }

      const totalBorde = 2 * (w + h);
      const fondo = [...conteo.entries()]
        .filter(([, n]) => n / totalBorde > 0.05)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([k]) => k.split(',').map(v => (parseInt(v, 10) << 3) + 4) as number[]);

      if (fondo.length === 0) { resolve(dataUrl); return; }

      /** Distancia (en el canal que más difiera) al color de fondo más parecido. */
      const difAlFondo = (i: number) => {
        let mejor = 255;
        for (const [r, g, b] of fondo) {
          const dif = Math.max(Math.abs(d[i] - r), Math.abs(d[i + 1] - g), Math.abs(d[i + 2] - b));
          if (dif < mejor) mejor = dif;
        }
        return mejor;
      };

      // ---- Recorte por desvanecido ------------------------------------------
      // La versión anterior cortaba en seco: un píxel estaba dentro de la
      // tolerancia (se volvía 100 % transparente) o estaba fuera (quedaba 100 %
      // opaco). Con una foto de catálogo real —que casi siempre trae una sombra
      // suave bajo el producto— el gris se aleja del blanco de a poco, cruza la
      // tolerancia a mitad de camino y lo que queda es un borde duro: ese era el
      // halo blanco pegado al producto.
      //
      // Se probó resolverlo dejando que el relleno siguiera el degradado
      // mientras no cruzara un contorno fuerte. MEDIDO SOBRE FOTOS REALES, eso
      // falla feo: en un producto claro sobre fondo claro (un iPhone blanco
      // sobre blanco) el interior del producto es TAN liso como la sombra
      // —contorno mediano 0 en ambos— así que el relleno se colaba adentro y se
      // comía el cuerpo del teléfono entero, dejando solo la pantalla. Peor que
      // el halo. Por eso no se hace por contornos.
      //
      // Lo que sí funciona sin riesgo: el relleno sigue mandando qué zona se
      // puede tocar (solo lo conectado al borde, nunca el interior del
      // producto), pero la transparencia deja de ser un sí/no y pasa a ser una
      // rampa. Cerca del color de fondo -> transparente; a medida que se
      // despega -> va ganando opacidad. La sombra se apaga de forma progresiva
      // en vez de terminar en un recorte con filo.
      // El relleno principal se mantiene igual que siempre: estricto, solo
      // colores muy parecidos a los del borde. Es lo único que nunca se comió
      // un producto en las pruebas, y esa garantía no se negocia.
      const visitado = new Uint8Array(w * h);
      const pila: number[] = [];
      for (let x = 0; x < w; x++) { pila.push(x, 0, x, h - 1); }
      for (let y = 0; y < h; y++) { pila.push(0, y, w - 1, y); }

      while (pila.length) {
        const y = pila.pop(), x = pila.pop();
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const p = y * w + x;
        if (visitado[p]) continue;
        const i = p * 4;
        if (difAlFondo(i) > tolerance) continue;
        visitado[p] = 1;
        d[i + 3] = 0;
        pila.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
      }

      // ---- Erosión acotada del fleco ----------------------------------------
      // Lo que quedaba mal era el anillo claro pegado al producto: la parte de
      // la sombra o del antialias que no llegó a entrar en la tolerancia y se
      // cortaba con filo.
      //
      // El umbral de acá está elegido con números medidos sobre fotos reales de
      // catálogo, no a ojo: el cuerpo claro de un producto se ubica alrededor de
      // 51 de distancia al color de fondo, mientras que el fleco vive por debajo
      // de 40. Por eso se erosiona hasta 40 y ni un punto más: es el margen que
      // se come el anillo dejando el producto fuera de peligro. Y como el
      // recorte avanza de a un píxel por pasada con un tope de cuatro, aunque
      // una foto rara se salga del molde el daño máximo son 4 px de contorno.
      const TOPE_FLECO = 40;
      for (let pasada = 0; pasada < 4; pasada++) {
        const aBorrar: number[] = [];
        for (let y = 1; y < h - 1; y++) {
          for (let x = 1; x < w - 1; x++) {
            const p = y * w + x;
            if (visitado[p]) continue;
            if (!visitado[p - 1] && !visitado[p + 1] && !visitado[p - w] && !visitado[p + w]) continue;
            if (difAlFondo(p * 4) <= TOPE_FLECO) aBorrar.push(p);
          }
        }
        if (!aBorrar.length) break;
        for (const p of aBorrar) { visitado[p] = 1; d[p * 4 + 3] = 0; }
      }

      // ---- Suavizado del contorno -------------------------------------------
      // Baja la opacidad de los píxeles que quedaron rodeados de transparencia
      // para que el recorte no se vea aserrado.
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const p = y * w + x;
          if (visitado[p]) continue;
          const i = p * 4;
          if (d[i + 3] === 0) continue;
          let vecinosTransparentes = 0;
          if (visitado[p - 1]) vecinosTransparentes++;
          if (visitado[p + 1]) vecinosTransparentes++;
          if (visitado[p - w]) vecinosTransparentes++;
          if (visitado[p + w]) vecinosTransparentes++;
          if (vecinosTransparentes >= 3) d[i + 3] = 90;
          else if (vecinosTransparentes === 2) d[i + 3] = 160;
        }
      }

      ctx.putImageData(imageData, 0, 0);

      // FALLO CORREGIDO: hasta acá el recorte trabaja a resolución completa (lo
      // correcto: cuanto más detalle, mejor queda el borde), pero antes se
      // devolvía ESE lienzo tal cual, en PNG y al tamaño original de la foto.
      // Como el resultado se guardaba directo sin volver a pasar por
      // compressImage(), un producto con el fondo quitado terminaba pesando
      // ~132 KB contra los ~26 KB de uno normal: dos productos así pesaban más
      // que los otros siete juntos del catálogo. Ahora el recorte se entrega ya
      // reescalado y codificado igual que cualquier otra imagen.
      try {
        let w2 = w, h2 = h;
        if (w2 > SALIDA_MAX) { h2 = Math.round((h2 * SALIDA_MAX) / w2); w2 = SALIDA_MAX; }
        if (h2 > SALIDA_MAX) { w2 = Math.round((w2 * SALIDA_MAX) / h2); h2 = SALIDA_MAX; }
        if (w2 === w && h2 === h) {
          resolve(encodeCanvas(canvas, true, 0.8));
          return;
        }
        const salida = document.createElement('canvas');
        salida.width = w2; salida.height = h2;
        const ctx2 = salida.getContext('2d');
        if (!ctx2) { resolve(encodeCanvas(canvas, true, 0.8)); return; }
        // Sin pintar fondo: el lienzo nace transparente y el alfa recién
        // calculado llega intacto al reescalado.
        ctx2.drawImage(canvas, 0, 0, w2, h2);
        resolve(encodeCanvas(salida, true, 0.8));
      } catch { resolve(dataUrl); }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// ===================== Motor genérico de sincronización =====================
// Cada colección (excepto productos, chat y settings, que necesitan lógica
// propia) se sincroniza con esta misma receta: tabla de Supabase + Realtime +
// mapeo camelCase <-> snake_case. Así se evita repetir 13 veces variantes del
// mismo bloque de código con el riesgo de que alguna quede mal escrita.

interface TableConfig<T extends Record<string, any>> {
  key: keyof Database;
  table: string;
  idKey: string;
  toRow: (item: T) => any;
  fromRow: (row: any) => T;
}

const genericReady: Record<string, boolean> = {};
const genericPending: Record<string, { added: any[]; modified: any[]; deleted: any[] }[]> = {};

function configFor<T extends Record<string, any>>(cfg: TableConfig<T>) {
  return cfg;
}

const TABLE_CONFIGS: TableConfig<any>[] = [
  configFor<Product>({
    key: 'products', table: 'products', idKey: 'id',
    toRow: (p) => ({
      id: p.id, name: p.name || '', sku: p.sku || '', category: p.category || '',
      price: p.price || 0, cost: p.cost || 0, stock: p.stock || 0, image_url: p.imageUrl || '',
      discount_percent: p.discountPercent || 0, discount_start_date: p.discountStartDate || null,
      discount_end_date: p.discountEndDate || null,
      active: p.active !== false, description: p.description || '', min_stock: p.minStock || 0,
      weight: p.weight ?? null, dimensions: p.dimensions || null, warehouse_row: p.row || null,
      shelf: p.shelf || null, physical_location: p.physicalLocation || null, warranty: p.warranty || null,
      is_double_stock: p.isDoubleStock || false, internal_stock: p.internalStock || 0,
      client_stock: p.clientStock || 0, linked_spare_part_sku: p.linkedSparePartSku || null,
      caabys: p.caabys || '8399000000000'
    }),
    fromRow: (r): Product => ({
      id: r.id, name: r.name, sku: r.sku, category: r.category, price: Number(r.price) || 0,
      cost: Number(r.cost) || 0, stock: r.stock ?? 0, imageUrl: r.image_url || '',
      discountPercent: Number(r.discount_percent) || 0, discountStartDate: r.discount_start_date || undefined,
      discountEndDate: r.discount_end_date || undefined,
      active: r.active !== false, description: r.description || '', minStock: r.min_stock ?? 0,
      weight: r.weight ?? undefined, dimensions: r.dimensions || undefined, row: r.warehouse_row || undefined,
      shelf: r.shelf || undefined, physicalLocation: r.physical_location || undefined, warranty: r.warranty || undefined,
      isDoubleStock: r.is_double_stock || false, internalStock: r.internal_stock ?? 0,
      clientStock: r.client_stock ?? 0, linkedSparePartSku: r.linked_spare_part_sku || undefined,
      caabys: r.caabys || '8399000000000'
    })
  }),
  configFor<InventoryMovement>({
    key: 'inventory_movements', table: 'inventory_movements', idKey: 'id',
    toRow: (m) => ({
      id: m.id, product_id: m.productId || null, product_name: m.productName || '',
      quantity_change: m.quantityChange || 0, type: m.type, notes: m.notes || '',
      user_email: m.userEmail || '', resulting_stock: m.resultingStock ?? null,
      reference: m.reference || null, created_at: m.timestamp || new Date().toISOString()
    }),
    fromRow: (r): InventoryMovement => ({
      id: r.id, productId: r.product_id || '', productName: r.product_name || '',
      quantityChange: r.quantity_change || 0, type: r.type, notes: r.notes || '',
      userEmail: r.user_email || '', resultingStock: r.resulting_stock ?? undefined,
      reference: r.reference || undefined, timestamp: r.created_at
    })
  }),
  configFor<RepairOrder>({
    key: 'repair_orders', table: 'repair_orders', idKey: 'id',
    toRow: (o) => ({
      id: o.id, ticket: o.ticket || '', customer_id: o.customerId || '', customer_name: o.customerName || '',
      customer_email: o.customerEmail || '', customer_phone: o.customerPhone || null,
      device: o.device || '', device_category: o.deviceCategory || null, device_brand: o.deviceBrand || null,
      device_model: o.deviceModel || null, damage_reported: o.damageReported || '', damage_category: o.damageCategory || null,
      diagnosis_manual: o.diagnosisManual || null, repuestos: o.repuestos || [], labor_cost: o.laborCost || 0,
      total_cost: o.totalCost || 0, status: o.status, warranty_months: o.warrantyMonths ?? 3,
      blockchain_hash: o.blockchainHash || null, bitacora: o.bitacora || [],
      repair_location: o.repairLocation || null, needed_tools: o.neededTools || null,
      created_at: o.createdAt || new Date().toISOString()
    }),
    fromRow: (r): RepairOrder => ({
      id: r.id, ticket: r.ticket || '', customerId: r.customer_id || '', customerName: r.customer_name || '',
      customerEmail: r.customer_email || '', customerPhone: r.customer_phone || undefined,
      device: r.device || '', deviceCategory: r.device_category || undefined, deviceBrand: r.device_brand || undefined,
      deviceModel: r.device_model || undefined, damageReported: r.damage_reported || '', damageCategory: r.damage_category || undefined,
      diagnosisManual: r.diagnosis_manual || undefined, repuestos: r.repuestos || [], laborCost: r.labor_cost || 0,
      totalCost: r.total_cost || 0, status: r.status, warrantyMonths: r.warranty_months ?? 3,
      blockchainHash: r.blockchain_hash || undefined, bitacora: r.bitacora || [],
      createdAt: r.created_at, repairLocation: r.repair_location || undefined, neededTools: r.needed_tools || undefined
    })
  }),
  configFor<Order>({
    key: 'orders', table: 'orders', idKey: 'id',
    toRow: (o) => ({
      id: o.id, customer_id: o.customerId || '', customer_name: o.customerName || '',
      customer_email: o.customerEmail || '', items: o.items || [], subtotal: o.subtotal || 0,
      membership_discount: o.membershipDiscount || 0, shipping_cost: o.shippingCost || 0,
      tax_amount: o.taxAmount || 0, total: o.total || 0, payment_method: o.paymentMethod,
      payment_details: o.paymentDetails || {}, status: o.status, xml_verified: o.xmlVerified || false,
      hda_status: o.hdaStatus || 'Pendiente', xml_content: o.xmlContent || null,
      pickup_in_person: o.pickupInPerson || false, created_at: o.timestamp || new Date().toISOString()
    }),
    fromRow: (r): Order => ({
      id: r.id, customerId: r.customer_id || '', customerName: r.customer_name || '',
      customerEmail: r.customer_email || '', items: r.items || [], subtotal: r.subtotal || 0,
      membershipDiscount: r.membership_discount || 0, shippingCost: r.shipping_cost || 0,
      taxAmount: r.tax_amount || 0, total: r.total || 0, paymentMethod: r.payment_method,
      paymentDetails: r.payment_details || {}, status: r.status, xmlVerified: r.xml_verified || false,
      hdaStatus: r.hda_status || 'Pendiente', xmlContent: r.xml_content || undefined,
      pickupInPerson: r.pickup_in_person || false, timestamp: r.created_at
    })
  }),
  configFor<AuditLog>({
    key: 'audit_log', table: 'audit_logs', idKey: 'id',
    toRow: (l) => ({
      id: l.id, user_email: l.userEmail || '', module: l.module, action: l.action, detail: l.detail || '',
      created_at: l.timestamp || new Date().toISOString()
    }),
    fromRow: (r): AuditLog => ({
      id: r.id, userEmail: r.user_email || '', module: r.module, action: r.action, detail: r.detail || '',
      timestamp: r.created_at
    })
  }),
  configFor<ClientProfile>({
    key: 'clients', table: 'client_profiles', idKey: 'id',
    toRow: (c) => ({
      id: c.id, profile_id: (c as any).profileId || null, name: c.name || '', email: c.email || '',
      // FALLO CORREGIDO: esto mandaba `c.province` tal cual, así que un
      // checkout sin provincia (el módulo de envío se quitó) enviaba ''.
      // client_profiles_province_check rechaza '' — solo acepta una de las 7
      // provincias o NULL — y la venta quedaba con el stock ya descontado
      // pero sin factura guardada. `|| null` convierte '' / undefined en
      // NULL, que el CHECK sí permite.
      phone: c.phone || '', province: c.province || null, address_detail: c.addressDetail || '',
      cards_tokenized: c.cardsTokenized || [],
      balance: c.balance || 0, notes: c.notes || '', pickup_in_person: c.pickupInPerson || false
    }),
    fromRow: (r): ClientProfile => ({
      id: r.id, name: r.name || '', email: r.email || '', phone: r.phone || '', province: r.province,
      addressDetail: r.address_detail || '',
      cardsTokenized: r.cards_tokenized || [], balance: r.balance || 0, notes: r.notes || '',
      pickupInPerson: r.pickup_in_person || false
    })
  }),
  configFor<LogisticsDelivery>({
    key: 'deliveries', table: 'logistics_deliveries', idKey: 'id',
    toRow: (d) => ({
      id: d.id, type: d.type, recipient_name: d.recipientName || '', recipient_phone: d.recipientPhone || '',
      province: d.province || '', address_detail: d.addressDetail || '', status: d.status,
      assigned_repartidor_id: d.assignedRepartidorId || null, assigned_repartidor_name: d.assignedRepartidorName || null,
      incidences: d.incidences || [], digital_signature: d.digitalSignature || null
    }),
    fromRow: (r): LogisticsDelivery => ({
      id: r.id, type: r.type, recipientName: r.recipient_name || '', recipientPhone: r.recipient_phone || '',
      province: r.province || '', addressDetail: r.address_detail || '', status: r.status,
      assignedRepartidorId: r.assigned_repartidor_id || undefined, assignedRepartidorName: r.assigned_repartidor_name || undefined,
      incidences: r.incidences || [], digitalSignature: r.digital_signature || undefined
    })
  }),
  configFor<MarketingCampaign>({
    key: 'marketing_campaigns', table: 'marketing_campaigns', idKey: 'id',
    toRow: (m) => ({
      id: m.id, code: m.code, type: m.type, value: m.value || 0, usage_limit: m.limit || 0,
      used: m.used || 0, applicable_category: m.applicableCategory || null, active: m.active !== false
    }),
    fromRow: (r): MarketingCampaign => ({
      id: r.id, code: r.code, type: r.type, value: r.value || 0, limit: r.usage_limit || 0,
      used: r.used || 0, applicableCategory: r.applicable_category || undefined, active: r.active !== false,
      expiresAt: r.expires_at || undefined
    })
  }),
  configFor<MarketingRequest>({
    key: 'marketing_requests', table: 'marketing_requests', idKey: 'id',
    toRow: (m) => ({
      id: m.id, product_id: m.productId || null, product_name: m.productName || '',
      product_sku: m.productSku || null, price: m.price || 0, caption: m.caption || null,
      image_url: m.imageUrl || null, status: m.status, scheduled_at: m.scheduledAt,
      error_detail: m.errorDetail || null, created_by: m.createdBy || null,
      created_at: m.createdAt || new Date().toISOString()
    }),
    fromRow: (r): MarketingRequest => ({
      id: r.id, productId: r.product_id || '', productName: r.product_name || '',
      productSku: r.product_sku || undefined, price: Number(r.price) || 0,
      caption: r.caption || undefined, imageUrl: r.image_url || undefined, status: r.status,
      scheduledAt: r.scheduled_at, errorDetail: r.error_detail || undefined,
      createdBy: r.created_by || undefined, createdAt: r.created_at
    })
  }),
  configFor<Banner>({
    key: 'banners', table: 'banners', idKey: 'id',
    toRow: (b) => ({
      id: b.id, title: b.title || '', description: b.description || '', image_url: b.imageUrl || '',
      link: b.link || null, type: b.type, active: b.active !== false, start_date: b.startDate || null,
      end_date: b.endDate || null
    }),
    fromRow: (r): Banner => ({
      id: r.id, title: r.title || '', description: r.description || '', imageUrl: r.image_url || undefined,
      link: r.link || undefined, type: r.type, active: r.active !== false, startDate: r.start_date || undefined,
      endDate: r.end_date || undefined
    })
  }),
  configFor<HistoricalSku>({
    key: 'historical_skus', table: 'historical_skus', idKey: 'sku',
    toRow: (h) => ({
      sku: h.sku, name: h.name || '', category: h.category || '', price: h.price || 0,
      cost: h.cost || 0, image_url: h.imageUrl || ''
    }),
    fromRow: (r): HistoricalSku => ({
      sku: r.sku, name: r.name || '', category: r.category || '', price: r.price || 0,
      cost: r.cost || 0, imageUrl: r.image_url || undefined
    })
  })
];

async function refreshTableFromSupabase(cfg: TableConfig<any>) {
  const { data, error } = await supabase.from(cfg.table).select('*');
  if (error) {
    notifySyncError(`No se pudo leer "${cfg.table}": ${error.message}`);
    return;
  }
  const items = (data || []).map(cfg.fromRow);
  (localCache as any)[cfg.key] = items;
  // CRÍTICO: lastSyncedDb es la base contra la que se compara cualquier
  // guardado futuro. Si solo se actualizaba localCache pero no lastSyncedDb,
  // este quedaba con los datos de arranque (getDefaultDB()) para siempre en
  // esa colección. Entonces, si UNA sola tabla fallaba al guardar (ej. un SKU
  // duplicado), saveDB() revertía TODO a ese estado de arranque casi vacío,
  // en vez de al último estado real sincronizado — eso vaciaba la interfaz.
  (lastSyncedDb as any)[cfg.key] = JSON.parse(JSON.stringify(items));
  notifyUpdate();
}

function initTableRealtimeSync(cfg: TableConfig<any>) {
  refreshTableFromSupabase(cfg).then(() => {
    genericReady[cfg.key as string] = true;
    flushGenericPending(cfg);
  });
}

async function syncTableToSupabase(cfg: TableConfig<any>, added: any[], modified: any[], deleted: any[]) {
  if (!genericReady[cfg.key as string]) {
    if (!genericPending[cfg.key as string]) genericPending[cfg.key as string] = [];
    genericPending[cfg.key as string].push({ added, modified, deleted });
    return;
  }

  const errors: string[] = [];
  for (const item of added) {
    // insert (no upsert): Postgres exige permiso de SELECT para resolver
    // ON CONFLICT DO UPDATE (lo que genera .upsert()) — incluso si al final no
    // hay ningún conflicto real. El checkout/registro de clientes anónimos no
    // tiene SELECT directo en orders/client_profiles/logistics_deliveries (por
    // diseño, para que nadie lea pedidos ajenos), así que CUALQUIER upsert
    // suyo fallaba con "new row violates row-level security policy". Un
    // INSERT plano no tiene ese requisito. Para seguir tolerando un doble
    // clic/reenvío con el mismo id sin romper la pantalla, una colisión real
    // (código 23505, muy rara con los ids usados) se trata como éxito
    // silencioso: la fila ya existe, que es justo lo que se quería lograr.
    const { error } = await supabase.from(cfg.table).insert(cfg.toRow(item));
    if (error && (error as any).code !== '23505') errors.push(`crear en ${cfg.table} (${item[cfg.idKey]}): ${error.message}`);
  }
  for (const item of modified) {
    const { error } = await supabase.from(cfg.table).update(cfg.toRow(item)).eq(cfg.idKey, item[cfg.idKey]);
    if (error) errors.push(`actualizar en ${cfg.table} (${item[cfg.idKey]}): ${error.message}`);
  }
  for (const item of deleted) {
    const { error } = await supabase.from(cfg.table).delete().eq(cfg.idKey, item[cfg.idKey]);
    if (error) errors.push(`eliminar en ${cfg.table} (${item[cfg.idKey]}): ${error.message}`);
  }

  if (errors.length > 0) {
    const message = errors.join(' | ');
    notifySyncError(message);
    await refreshTableFromSupabase(cfg);
    throw new Error(message);
  }
}

function flushGenericPending(cfg: TableConfig<any>) {
  const pending = genericPending[cfg.key as string] || [];
  genericPending[cfg.key as string] = [];
  pending.forEach(p => {
    syncTableToSupabase(cfg, p.added, p.modified, p.deleted).catch(() => {});
  });
}

// ===================== Chat (conversaciones + mensajes anidados) =====================
// chat_conversations y chat_messages están normalizados en Supabase, pero el
// frontend espera cada conversación con sus mensajes ya embebidos
// (ChatConversation.messages). Este bloque arma esa forma en memoria.

let chatReady = false;
let chatPending: { added: ChatConversation[]; modified: ChatConversation[]; deleted: ChatConversation[] }[] = [];

function chatConvToRow(c: ChatConversation) {
  const row: any = {
    id: c.id, customer_name: c.customerName || '', customer_email: c.customerEmail || '',
    status: c.status || 'nuevo', unread_count: c.unreadCount || 0,
    assigned_admin_email: c.assignedAdminEmail || null
  };
  // Solo se envía customer_token cuando la conversación lo tiene, para que un
  // UPDATE nunca lo borre (omitir la columna preserva su valor en la BD).
  if (c.customerToken) row.customer_token = c.customerToken;
  // updated_at NUNCA se envía desde aquí: un trigger en la BD la sobrescribe
  // con now() en cada UPDATE, así que ningún cliente (ni un reloj local
  // desincronizado) puede falsear la marca de tiempo que usa el filtro de
  // rango temporal de "Resueltos" en el panel del admin.
  return row;
}

async function refreshChatFromSupabase() {
  const token = getCustomerChatToken();

  // MODO CLIENTE (anónimo, sin sesión Supabase): lee SOLO sus conversaciones
  // mediante el RPC seguro, filtradas por su token secreto. Así el cierre del
  // SELECT público del chat no le impide ver su propio historial, y nadie más
  // puede leer conversaciones ajenas.
  if (token && !authedSession) {
    const { data, error } = await supabase.rpc('get_customer_chat', { p_token: token });
    if (error) {
      notifySyncError(`No se pudo leer el chat: ${error.message}`);
      return;
    }
    const conversations = ((data as any[]) || []).map((r: any): ChatConversation => ({
      id: r.id, customerName: r.customer_name || '', customerEmail: r.customer_email || '',
      status: r.status || 'nuevo', unreadCount: r.unread_count || 0,
      assignedAdminEmail: r.assigned_admin_email || undefined,
      customerToken: token,
      messages: ((r.messages as any[]) || []).map((m: any): ChatMessage => ({
        id: m.id, sender: m.sender, text: m.text, timestamp: m.created_at,
        imageUrl: m.image_url || undefined, isInternalNote: !!m.is_internal_note
      }))
    }));
    localCache.chat_conversations = conversations;
    lastSyncedDb.chat_conversations = JSON.parse(JSON.stringify(conversations));
    notifyUpdate();
    return;
  }

  // MODO STAFF / CLIENTE LOGUEADO: lectura directa (RLS filtra por rol/correo).
  const { data: convRows, error: convError } = await supabase.from('chat_conversations').select('*');
  if (convError) {
    notifySyncError(`No se pudo leer chat_conversations: ${convError.message}`);
    return;
  }
  const { data: msgRows, error: msgError } = await supabase.from('chat_messages').select('*').order('created_at', { ascending: true });
  if (msgError) {
    notifySyncError(`No se pudo leer chat_messages: ${msgError.message}`);
    return;
  }

  const messagesByConv: Record<string, ChatMessage[]> = {};
  (msgRows || []).forEach((m: any) => {
    if (!messagesByConv[m.conversation_id]) messagesByConv[m.conversation_id] = [];
    messagesByConv[m.conversation_id].push({
      id: m.id, sender: m.sender, text: m.text, timestamp: m.created_at,
      imageUrl: m.image_url || undefined, isInternalNote: !!m.is_internal_note
    });
  });

  const conversations = (convRows || []).map((r: any): ChatConversation => ({
    id: r.id, customerName: r.customer_name || '', customerEmail: r.customer_email || '',
    status: r.status || 'nuevo',
    unreadCount: r.unread_count || 0, messages: messagesByConv[r.id] || [],
    assignedAdminEmail: r.assigned_admin_email || undefined,
    customerToken: r.customer_token || undefined,
    updatedAt: r.updated_at || r.created_at || undefined
  }));
  localCache.chat_conversations = conversations;
  lastSyncedDb.chat_conversations = JSON.parse(JSON.stringify(conversations));
  notifyUpdate();
}

function initChatRealtimeSync() {
  refreshChatFromSupabase().then(() => {
    chatReady = true;
    flushChatPending();
  });

  // Respaldo por sondeo: el WebSocket de Realtime puede cortarse en
  // silencio dentro del WebView de Android/Capacitor (visto en el APK) y no
  // reconectar solo. El chat es la única tabla donde un mensaje nuevo debe
  // verse casi al instante, así que además del canal en tiempo real se
  // revisa cada pocos segundos mientras la pestaña esté visible.
  if (typeof window !== 'undefined') {
    setInterval(() => {
      if (document.visibilityState === 'visible') refreshChatFromSupabase();
    }, 6000);
  }
}

async function syncChatToSupabase(oldConvs: ChatConversation[], newConvs: ChatConversation[]) {
  if (!chatReady) {
    chatPending.push({ added: [], modified: [], deleted: [] });
    return;
  }

  const { added, modified, deleted } = diffArrays(oldConvs, newConvs, 'id');
  const errors: string[] = [];

  // insertChatRow (no upsert): Postgres exige permiso de SELECT para resolver
  // ON CONFLICT DO UPDATE (lo usa .upsert()) — incluso si al final no hay
  // ningún conflicto real. Como el cliente anónimo del chat ya no tiene SELECT
  // directo (solo lee por el RPC con token, para que nadie lea chats ajenos),
  // CUALQUIER upsert suyo fallaba con "new row violates row-level security
  // policy", en todos los navegadores (no solo Safari). Los mensajes nunca se
  // editan y los IDs son aleatorios (uuid/timestamp+random), así que un
  // INSERT plano es siempre correcto; una colisión real (código 23505,
  // prácticamente imposible) se trata como éxito silencioso (ya existe).
  async function insertChatRow(table: 'chat_conversations' | 'chat_messages', row: any): Promise<string | null> {
    const { error } = await supabase.from(table).insert(row);
    if (error && (error as any).code !== '23505') return error.message;
    return null;
  }

  for (const conv of added) {
    const err = await insertChatRow('chat_conversations', chatConvToRow(conv));
    if (err) errors.push(`crear conversación ${conv.id}: ${err}`);
    for (const msg of conv.messages || []) {
      const msgErr = await insertChatRow('chat_messages', {
        id: msg.id, conversation_id: conv.id, sender: msg.sender, text: msg.text, created_at: msg.timestamp,
        image_url: msg.imageUrl || null, is_internal_note: !!msg.isInternalNote
      });
      if (msgErr) errors.push(`crear mensaje ${msg.id}: ${msgErr}`);
    }
  }

  for (const conv of modified) {
    const { error } = await supabase.from('chat_conversations').update(chatConvToRow(conv)).eq('id', conv.id);
    if (error) errors.push(`actualizar conversación ${conv.id}: ${error.message}`);

    const oldConv = oldConvs.find(c => c.id === conv.id);
    const oldMsgIds = new Set((oldConv?.messages || []).map((m: ChatMessage) => m.id));
    const newMessages = (conv.messages || []).filter((m: ChatMessage) => !oldMsgIds.has(m.id));
    for (const msg of newMessages) {
      const msgErr = await insertChatRow('chat_messages', {
        id: msg.id, conversation_id: conv.id, sender: msg.sender, text: msg.text, created_at: msg.timestamp,
        image_url: msg.imageUrl || null, is_internal_note: !!msg.isInternalNote
      });
      if (msgErr) errors.push(`crear mensaje ${msg.id}: ${msgErr}`);
    }
  }

  for (const conv of deleted) {
    const { error } = await supabase.from('chat_conversations').delete().eq('id', conv.id);
    if (error) errors.push(`eliminar conversación ${conv.id}: ${error.message}`);
  }

  if (errors.length > 0) {
    const message = errors.join(' | ');
    notifySyncError(message);
    await refreshChatFromSupabase();
    throw new Error(message);
  }
}

function flushChatPending() {
  chatPending = [];
}

// ===================== Configuración general / Logo =====================

function settingsToRow(s: AppSettings) {
  return {
    cedula_juridica: s.cedulaJuridica || '', company_phone: s.companyPhone || '',
    company_address: s.companyAddress || '', workshop_address: s.workshopAddress || '',
    pickup_hours: s.pickupHours || '', max_stock_limit: s.maxStockLimit || 50,
    store_logo: s.storeLogo || null, instagram_webhook_url: s.instagramWebhookUrl || null
  };
}

function settingsFromRow(r: any): AppSettings {
  return {
    cedulaJuridica: r.cedula_juridica || '', companyPhone: r.company_phone || '',
    companyAddress: r.company_address || '', workshopAddress: r.workshop_address || '',
    pickupHours: r.pickup_hours || '', maxStockLimit: r.max_stock_limit || 50,
    storeLogo: r.store_logo || undefined, instagramWebhookUrl: r.instagram_webhook_url || undefined
  };
}

let settingsReady = false;

async function refreshSettingsFromSupabase() {
  const { data, error } = await supabase.from('app_settings').select('*').eq('id', true).maybeSingle();
  if (error) {
    notifySyncError(`No se pudo leer app_settings: ${error.message}`);
    return;
  }
  if (data) {
    const settings = settingsFromRow(data);
    localCache.settings = settings;
    lastSyncedDb.settings = JSON.parse(JSON.stringify(settings));
    notifyUpdate();
  }
}

function initSettingsRealtimeSync() {
  refreshSettingsFromSupabase().then(() => { settingsReady = true; });
}

// Coalescing de recargas por Realtime: un mismo guardado suele disparar varios
// eventos postgres_changes seguidos (varias filas, o INSERT+UPDATE). Sin esto,
// CADA evento lanzaba un .select('*') de la tabla ENTERA — descargas y parseos
// redundantes que saturan la RAM/CPU de un equipo como el Galaxy A12. Ahora los
// eventos de una misma clave se agrupan en UNA sola recarga tras una ventana
// corta de silencio (200 ms), imperceptible para el usuario.
const coalesceTimers: Record<string, ReturnType<typeof setTimeout>> = {};
function coalesce(key: string, fn: () => void, delay = 200) {
  if (coalesceTimers[key]) clearTimeout(coalesceTimers[key]);
  coalesceTimers[key] = setTimeout(() => {
    delete coalesceTimers[key];
    fn();
  }, delay);
}

// Antes cada tabla abría su PROPIO canal/websocket (17 canales en total:
// 15 tablas + chat + settings). Abrir tantos canales por separado desde un
// mismo cliente es innecesario y poco confiable: algunos podían tardar en
// suscribirse o fallar en silencio (como pasaba con el logo), mientras que
// productos -al ser el más probado- parecía funcionar siempre. Ahora se usa
// UN SOLO canal multiplexado con todas las tablas, tal como recomienda
// Supabase, eliminando esa fuente de fallos intermitentes.
function initRealtimeChannel() {
  const channel = supabase.channel('technoverse-realtime-sync');

  TABLE_CONFIGS.forEach((cfg) => {
    channel.on('postgres_changes', { event: '*', schema: 'public', table: cfg.table }, () => {
      coalesce(`table:${cfg.key as string}`, () => refreshTableFromSupabase(cfg));
    });
  });

  channel
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_conversations' }, () => coalesce('chat', () => refreshChatFromSupabase()))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages' }, () => coalesce('chat', () => refreshChatFromSupabase()))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings' }, () => coalesce('settings', () => refreshSettingsFromSupabase()))
    .subscribe();
}

async function syncSettingsToSupabase(newSettings: AppSettings) {
  const { error } = await supabase.from('app_settings').update(settingsToRow(newSettings)).eq('id', true);
  if (error) {
    const message = `configuración/logo: ${error.message}`;
    notifySyncError(message);
    await refreshSettingsFromSupabase();
    throw new Error(message);
  }
}

// ===================== Arranque =====================

// Recarga todas las tablas protegidas por RLS. Las tablas se cargan una vez al
// arrancar la app, cuando aún NO hay sesión (anónimo). Tablas con RLS que
// bloquean al anónimo — como client_profiles (solo staff/dueño la ven) — quedan
// vacías. Cuando el admin inicia sesión, hay que volver a leerlas con la sesión
// autenticada; si no, el panel muestra "No hay registros" pese a existir datos.
function refreshAllTables() {
  TABLE_CONFIGS.forEach((cfg) => {
    coalesce(`table:${cfg.key as string}`, () => refreshTableFromSupabase(cfg));
  });
  coalesce('chat', () => refreshChatFromSupabase());
  coalesce('settings', () => refreshSettingsFromSupabase());
}

let started = false;
export function initFirebaseSync() {
  if (started) return;
  started = true;
  console.log('[Sistema] Conectando en tiempo real con Supabase...');

  TABLE_CONFIGS.forEach(initTableRealtimeSync);
  initChatRealtimeSync();
  initSettingsRealtimeSync();
  initRealtimeChannel();

  // Al iniciar/cerrar sesión cambian los permisos RLS (ej. el admin pasa a ver
  // client_profiles). Se relee todo en esos momentos para reflejar lo que el
  // usuario ahora sí puede ver. Se ignora TOKEN_REFRESHED (no cambia permisos)
  // y el INITIAL_SESSION anónimo (ya cubierto por la carga inicial de arriba).
  // Además se rastrea la sesión para que refreshChatFromSupabase sepa si debe
  // leer el chat como staff (tabla directa) o como cliente anónimo (RPC+token).
  supabase.auth.onAuthStateChange((event, session) => {
    authedSession = session || null;
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || (event === 'INITIAL_SESSION' && session)) {
      refreshAllTables();
    }
  });
}

if (typeof window !== 'undefined') {
  initFirebaseSync();
}

// ===================== Guardado principal =====================

let lastSyncedDb: Database = getDefaultDB();

export async function saveDB(newDb: Database) {
  const oldDb = lastSyncedDb;
  localCache = newDb;
  // Se avisa a la interfaz ANTES de subir nada: el panel muestra el producto de
  // inmediato con la foto que ya tiene en memoria, igual que siempre. La subida
  // ocurre a continuación y no se le hace esperar al usuario.
  notifyUpdate();

  // Cambia las fotos incrustadas por URLs de Storage. Va antes de calcular las
  // diferencias para que a la fila se escriba la URL y no el base64. Si alguna
  // subida falla, esa foto se queda incrustada y el guardado sigue normal.
  await subirImagenesEmbebidas(newDb);

  // La foto de referencia se toma DESPUÉS de subir, ya con las URLs puestas:
  // así el próximo guardado no vuelve a intentar subir lo mismo.
  lastSyncedDb = JSON.parse(JSON.stringify(newDb));
  notifyUpdate();

  // Tablas que apuntan a "products" con clave foránea. Deben escribirse
  // DESPUÉS de que el producto exista, o Postgres rechaza la fila.
  const DEPENDIENTES_DE_PRODUCTS = new Set(['inventory_movements', 'repair_orders', 'orders', 'marketing_requests']);

  type Tarea = { label: string; key?: keyof Database; run: () => Promise<void> };
  const fasePadres: Tarea[] = [];
  const faseHijas: Tarea[] = [];

  TABLE_CONFIGS.forEach((cfg) => {
    const oldArr = (oldDb as any)[cfg.key] || [];
    const newArr = (newDb as any)[cfg.key] || [];
    const { added, modified, deleted } = diffArrays(oldArr, newArr, cfg.idKey);
    if (added.length === 0 && modified.length === 0 && deleted.length === 0) return;
    const tarea: Tarea = {
      label: cfg.table,
      key: cfg.key,
      run: () => syncTableToSupabase(cfg, added, modified, deleted)
    };
    if (DEPENDIENTES_DE_PRODUCTS.has(cfg.table)) faseHijas.push(tarea);
    else fasePadres.push(tarea);
  });

  const oldChat = oldDb.chat_conversations || [];
  const newChat = newDb.chat_conversations || [];
  if (JSON.stringify(oldChat) !== JSON.stringify(newChat)) {
    fasePadres.push({ label: 'chat', key: 'chat_conversations', run: () => syncChatToSupabase(oldChat, newChat) });
  }

  if (JSON.stringify(oldDb.settings) !== JSON.stringify(newDb.settings)) {
    fasePadres.push({ label: 'configuracion', run: () => syncSettingsToSupabase(newDb.settings || DEFAULT_SETTINGS) });
  }

  if (fasePadres.length === 0 && faseHijas.length === 0) return;

  // FALLO CORREGIDO: antes las tablas se escribían TODAS en paralelo con un
  // único Promise.allSettled. Cuando se creaba un producto nuevo, el INSERT en
  // "inventory_movements" podía llegar antes que el INSERT en "products" y
  // Postgres lo rechazaba con
  //   violates foreign key constraint "inventory_movements_product_id_fkey".
  // Ahora se escribe primero el padre (products y demás tablas raíz) y solo si
  // eso salió bien se escriben las tablas que lo referencian.
  const fallos: string[] = [];
  const clavesFallidas = new Set<keyof Database>();

  const ejecutarFase = async (fase: Tarea[]) => {
    if (fase.length === 0) return;
    const results = await Promise.allSettled(fase.map(t => t.run()));
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        const reason: any = r.reason;
        fallos.push(`${fase[i].label}: ${reason?.message || reason}`);
        if (fase[i].key) clavesFallidas.add(fase[i].key!);
      }
    });
  };

  await ejecutarFase(fasePadres);

  if (fallos.length === 0) {
    await ejecutarFase(faseHijas);
  } else {
    // El padre falló: las hijas se marcan como no escritas sin intentarlo,
    // porque su clave foránea no podría resolverse.
    faseHijas.forEach(t => { if (t.key) clavesFallidas.add(t.key); });
  }

  if (fallos.length > 0) {
    // FALLO CORREGIDO: antes se revertía la copia local ENTERA al estado
    // anterior, incluidas las tablas que SÍ se habían guardado. El producto
    // quedaba escrito en Supabase pero desaparecía de la vista local, así que
    // al reintentar "Guardar" el formulario ya no lo reconocía como nuevo,
    // entraba por la rama de "SKU existente" y SUMABA el stock otra vez: por
    // eso 1 unidad terminaba siendo 2.
    //
    // Ahora la reversión es por tabla: solo vuelven atrás las que fallaron. Lo
    // que se guardó de verdad permanece visible y un reintento no duplica nada.
    const reconciliado: any = JSON.parse(JSON.stringify(newDb));
    clavesFallidas.forEach((k) => {
      reconciliado[k] = JSON.parse(JSON.stringify((oldDb as any)[k]));
    });
    localCache = reconciliado;
    lastSyncedDb = JSON.parse(JSON.stringify(reconciliado));
    notifyUpdate();
    throw new Error(fallos.join(' | '));
  }
}

// ===================== Logo =====================

export async function saveLogo(base64: string) {
  const compressed = base64.startsWith('data:') ? await compressImage(base64, 400, 400, 0.7) : base64;
  const dbInst = getDB();
  if (!dbInst.settings) dbInst.settings = DEFAULT_SETTINGS;
  dbInst.settings.storeLogo = compressed;

  try {
    await saveDB(dbInst);
  } catch (err: any) {
    throw new Error(err?.message || 'No se pudo guardar el logo en la base de datos.');
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('store_logo_updated'));
  }
}

export async function getLogo(): Promise<string | null> {
  const dbInst = getDB();
  return dbInst.settings?.storeLogo || null;
}

export function addAuditLog(userEmail: string, module: string, action: string, detail: string, existingDb?: Database) {
  const dbInst = existingDb || getDB();
  const newLog: AuditLog = {
    id: `LOG-${Math.floor(100000 + Math.random() * 900000)}`,
    userEmail: userEmail || 'technoverse.admin@gmail.com',
    module, action, detail,
    timestamp: new Date().toISOString()
  };
  if (!dbInst.audit_log) dbInst.audit_log = [];
  dbInst.audit_log.unshift(newLog);
  if (!existingDb) saveDB(dbInst);
}
