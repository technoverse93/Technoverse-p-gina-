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
    users: [{ id: 'admin-id', email: 'technoverse.admin@gmail.com', role: 'superadmin', name: 'Administrador Technoverse' }],
    products: [], inventory_movements: [], repair_orders: [], orders: [],
    chat_conversations: [],
    audit_log: [], clients: [], deliveries: [], marketing_campaigns: [], marketing_requests: [],
    banners: DEFAULT_BANNERS, settings: DEFAULT_SETTINGS, historical_skus: []
  };
}

let localCache: Database = getDefaultDB();
let broadcastChannel: BroadcastChannel | null = null;

// =====================================================================
// CACHÉ LOCAL DEL CATÁLOGO — "cache-first"
// =====================================================================
// EL PROBLEMA QUE RESUELVE
// ---------------------------------------------------------------------
// `localCache` arrancaba SIEMPRE vacío (`getDefaultDB()` trae
// `products: []`). Es decir: cada vez que alguien abría la tienda o la
// APK, el catálogo no existía hasta que Supabase contestaba. Ese viaje
// de ida y vuelta —636 productos por una conexión móvil— son los ~2
// segundos de pantalla vacía que se reportaron. No era lentitud del
// servidor: era que no había NADA que pintar mientras tanto.
//
// Ahora la última copia buena del catálogo se guarda en el propio
// aparato y se rehidrata de forma SÍNCRONA al cargar este módulo, antes
// de que React pinte por primera vez. El primer fotograma ya lleva
// productos; la respuesta de Supabase llega después y actualiza sin que
// se note (stale-while-revalidate).
//
// ---------------------------------------------------------------------
// QUÉ SE GUARDA Y QUÉ NO — ES UNA DECISIÓN DE PRIVACIDAD, NO DE TAMAÑO
// ---------------------------------------------------------------------
// SOLO se guardan las tablas que ya son públicas para cualquiera que
// abra la tienda: catálogo, banners y la configuración visible (logo,
// teléfono, dirección). NO se guarda nada de `clients`, `orders`,
// `audit_log`, `chat_conversations` ni `repair_orders`: son datos de
// personas reales, y `localStorage` lo lee cualquiera que tenga el
// teléfono o la computadora en la mano. Guardar el catálogo ahí no
// revela nada que no esté ya en pantalla; guardar la cartera de clientes
// sí. Esa línea no se cruza para ganar medio segundo.
const CLAVE_CACHE = 'technoverse_cache_publico';

// Sube este número si cambia la FORMA de lo guardado. Una caché con
// versión distinta se descarta en vez de intentar interpretarla.
const VERSION_CACHE = 1;

// Si el almacenamiento está lleno o bloqueado (modo incógnito, cuota),
// se deja de intentar por el resto de la sesión: reintentar en cada
// refresco solo gasta CPU para volver a fallar igual.
let cacheDeshabilitada = false;

function guardarCacheLocal(): void {
  if (cacheDeshabilitada || typeof window === 'undefined') return;
  try {
    localStorage.setItem(CLAVE_CACHE, JSON.stringify({
      v: VERSION_CACHE,
      products: localCache.products,
      banners: localCache.banners,
      settings: localCache.settings,
    }));
  } catch {
    cacheDeshabilitada = true;
  }
}

/**
 * Rehidrata la caché. Se llama UNA vez, más abajo, en cuanto
 * `lastSyncedDb` existe.
 *
 * Toca las DOS copias a propósito. `lastSyncedDb` es la base contra la
 * que `saveDB()` calcula qué se agregó, cambió o borró. Si se rellenara
 * solo `localCache`, el primer guardado compararía 636 productos contra
 * una base vacía, los daría todos por NUEVOS e intentaría insertarlos de
 * nuevo en Supabase. Rehidratar solo la mitad no sería una optimización:
 * sería un duplicador de catálogo.
 */
function hidratarCacheLocal(): void {
  if (typeof window === 'undefined') return;
  try {
    const bruto = localStorage.getItem(CLAVE_CACHE);
    if (!bruto) return;
    const guardado = JSON.parse(bruto);
    if (!guardado || guardado.v !== VERSION_CACHE) return;

    if (Array.isArray(guardado.products)) {
      localCache.products = guardado.products;
      lastSyncedDb.products = structuredClone(guardado.products);
    }
    if (Array.isArray(guardado.banners)) {
      localCache.banners = guardado.banners;
      lastSyncedDb.banners = structuredClone(guardado.banners);
    }
    if (guardado.settings) {
      localCache.settings = guardado.settings;
      lastSyncedDb.settings = structuredClone(guardado.settings);
    }
  } catch {
    // Caché ilegible: se arranca en blanco, exactamente como antes de
    // que existiera. Nunca vale la pena romper el arranque por esto.
  }
}

/** Tablas cuya recarga debe refrescar la copia guardada en el aparato. */
const TABLAS_CACHEABLES = new Set(['products', 'banners']);

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

// Contador de versión: se incrementa en CADA punto del archivo donde
// `localCache` cambia (todos pasan por aquí). Permite a quien sondea el
// estado (ver los `setInterval` de respaldo en PublicStore/InventarioControl)
// preguntar "¿cambió algo?" con una comparación de enteros en vez de tener
// que pedir siempre una copia completa para descubrirlo.
let dbVersion = 0;
export function getDBVersion(): number {
  return dbVersion;
}

function notifyUpdate() {
  dbVersion++;
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
  // `structuredClone` hace la misma copia profunda e independiente que antes
  // (nadie puede mutar `localCache` a través del objeto devuelto: sigue
  // siendo el mismo contrato que ya usan `saveDB`-tras-`getDB` en toda la
  // app), pero sin pasar por texto: JSON.stringify + JSON.parse serializa
  // cada valor a string y lo vuelve a parsear, el doble de trabajo que
  // clonar directamente. Con 11 tablas y llamadas frecuentes (sondeos de
  // respaldo, event handlers) esa vuelta por texto era costo puro de CPU
  // en el hilo principal — justo lo que causa los tirones (jank) en gama
  // baja / Android.
  return structuredClone(localCache);
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
 * Anota en la bitácora un PROBLEMA al subir una imagen.
 *
 * POR QUÉ SOLO LOS PROBLEMAS
 *   Cuando una subida falla, la foto se queda incrustada en la fila — que es
 *   exactamente lo que se ve cuando la subida ni se intentó. Los dos casos son
 *   indistinguibles mirando los datos, y desde un celular no hay forma cómoda
 *   de abrir la consola del navegador. Por eso el rastro va a la base.
 *
 *   Pero solo el rastro que sirve. Durante la puesta a punto esto registraba
 *   también los aciertos y el inicio de cada recorrido, y con eso una sola
 *   carga de producto dejaba ocho líneas. Multiplicado por el uso diario, la
 *   bitácora del negocio quedaba enterrada en ruido técnico. Ahora la regla es
 *   simple: **si hay una línea acá, algo necesita atención**. Los aciertos se
 *   ven en el resultado mismo (la fila guarda una URL en vez de la foto).
 *
 * Escribe directo a la tabla en vez de usar addAuditLog() a propósito: esa
 * función termina llamando a saveDB(), y esto corre DENTRO de saveDB.
 */
function anotarProblemaSubida(acción: string, detalle: string) {
  try {
    // OJO CON ESTA LÍNEA — acá estuvo un error que costó varias rondas de
    // diagnóstico. Antes decía:
    //
    //     void supabase.from('audit_logs').insert({ ... });
    //
    // La intención era "mandalo y no me hagas esperar". Pero en Supabase,
    // `.from(...).insert(...)` NO envía nada: devuelve un constructor de
    // consulta PEREZOSO, y la petición recién sale cuando alguien le hace
    // `await` o `.then()`. Con `void` no la esperaba nadie, así que la consulta
    // se armaba y se tiraba sin ejecutarse jamás.
    //
    // El resultado fue el peor posible para diagnosticar: el registro que tenía
    // que delatar los fallos de subida no escribía NUNCA, ni cuando fallaba ni
    // cuando funcionaba. Parecía que este código entero no se ejecutaba.
    //
    // Con `.then()` explícito la petición sale de verdad y sigue sin bloquear
    // el guardado, que era lo que se buscaba.
    supabase.from('audit_logs').insert({
      id: `LOG-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      user_email: 'sistema',
      module: 'Imágenes',
      action: acción,
      detail: detalle.slice(0, 500),
    }).then(
      ({ error }: any) => {
        if (error) console.warn('[Imágenes] No se pudo anotar el diagnóstico:', error.message);
      },
      () => { /* el diagnóstico jamás puede tumbar un guardado */ }
    );
  } catch {
    // Ídem: cualquier problema acá se traga en silencio.
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
    // Quedarse incrustada por ser diminuta es el comportamiento buscado, no un
    // problema: no se anota.
    if (dataUrl.length < MINIMO_PARA_SUBIR) return dataUrl;

    const coma = dataUrl.indexOf(',');
    const cabecera = dataUrl.slice(5, coma);           // ej. "image/webp;base64"
    if (!cabecera.includes(';base64')) {
      anotarProblemaSubida('Formato inesperado', `${id} — cabecera "${cabecera}"`);
      return dataUrl;
    }
    const tipo = cabecera.split(';')[0];
    const ext = EXTENSION_POR_TIPO[tipo];
    if (!ext) {
      anotarProblemaSubida('Tipo no admitido', `${id} — tipo "${tipo}"`);
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
      anotarProblemaSubida('Subida fallida', `${ruta} — ${error.message}`);
      return dataUrl;
    }

    const { data } = supabase.storage.from(BUCKET_IMAGENES).getPublicUrl(ruta);
    if (!data?.publicUrl) {
      anotarProblemaSubida('Sin URL pública', ruta);
      return dataUrl;
    }
    // El acierto no se anota en la bitácora: ya se nota en que la fila queda
    // con una URL en lugar de la imagen entera. En consola sí, que es gratis.
    console.info('[Imágenes] Subida a Storage:', ruta, `${bytes.length} bytes`);
    return data.publicUrl;
  } catch (err: any) {
    anotarProblemaSubida('Excepción al subir', String(err?.message || err));
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
  if (pendientes.length) {
    console.info(`[Imágenes] Subiendo ${pendientes.length} imagen(es) a Storage…`);
    await Promise.all(pendientes);
  }
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
  // Lista explícita de columnas para el `select()` de lectura — exactamente
  // las que `fromRow` de verdad usa (unión con las que escribe `toRow`,
  // para no perder una columna que un `fromRow` lea pero `toRow` nunca
  // escriba, como `expires_at` en campañas). Sin esto, cada sincronización
  // bajaba la fila COMPLETA de Postgres, incluida cualquier columna que la
  // app nunca lee — ancho de banda pagado por nada, sobre todo en móvil.
  columns: string;
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
    columns: 'id,name,sku,category,price,cost,stock,image_url,discount_percent,discount_start_date,discount_end_date,active,description,min_stock,weight,dimensions,warehouse_row,shelf,physical_location,warranty,is_double_stock,internal_stock,client_stock,linked_spare_part_sku,visible_en_tienda,caabys,brand',
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
      visible_en_tienda: p.visibleEnTienda || false,
      caabys: p.caabys || '8399000000000',
      brand: p.brand || null
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
      visibleEnTienda: r.visible_en_tienda === true,
      caabys: r.caabys || '8399000000000',
      brand: r.brand || undefined
    })
  }),
  configFor<InventoryMovement>({
    key: 'inventory_movements', table: 'inventory_movements', idKey: 'id',
    columns: 'id,product_id,product_name,quantity_change,type,notes,user_email,resulting_stock,reference,created_at',
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
    columns: 'id,ticket,customer_id,customer_name,customer_email,customer_phone,device,device_category,device_brand,device_model,damage_reported,damage_category,diagnosis_manual,repuestos,labor_cost,total_cost,status,warranty_months,blockchain_hash,bitacora,repair_location,needed_tools,created_at',
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
    columns: 'id,customer_id,customer_name,customer_email,items,subtotal,membership_discount,shipping_cost,tax_amount,total,payment_method,payment_details,status,xml_verified,hda_status,xml_content,pickup_in_person,created_at,costo_repuestos,costo_regalias,margen_neto',
    toRow: (o) => ({
      id: o.id, customer_id: o.customerId || '', customer_name: o.customerName || '',
      customer_email: o.customerEmail || '', items: o.items || [], subtotal: o.subtotal || 0,
      membership_discount: o.membershipDiscount || 0, shipping_cost: o.shippingCost || 0,
      tax_amount: o.taxAmount || 0, total: o.total || 0, payment_method: o.paymentMethod,
      payment_details: o.paymentDetails || {}, status: o.status, xml_verified: o.xmlVerified || false,
      hda_status: o.hdaStatus || 'Pendiente', xml_content: o.xmlContent || null,
      pickup_in_person: o.pickupInPerson || false, created_at: o.timestamp || new Date().toISOString(),
      costo_repuestos: o.costoRepuestos || 0, costo_regalias: o.costoRegalias || 0,
      margen_neto: o.margenNeto ?? null
    }),
    fromRow: (r): Order => ({
      id: r.id, customerId: r.customer_id || '', customerName: r.customer_name || '',
      customerEmail: r.customer_email || '', items: r.items || [], subtotal: r.subtotal || 0,
      membershipDiscount: r.membership_discount || 0, shippingCost: r.shipping_cost || 0,
      taxAmount: r.tax_amount || 0, total: r.total || 0, paymentMethod: r.payment_method,
      paymentDetails: r.payment_details || {}, status: r.status, xmlVerified: r.xml_verified || false,
      hdaStatus: r.hda_status || 'Pendiente', xmlContent: r.xml_content || undefined,
      pickupInPerson: r.pickup_in_person || false, timestamp: r.created_at,
      costoRepuestos: Number(r.costo_repuestos) || 0, costoRegalias: Number(r.costo_regalias) || 0,
      margenNeto: r.margen_neto === null || r.margen_neto === undefined ? undefined : Number(r.margen_neto)
    })
  }),
  configFor<AuditLog>({
    key: 'audit_log', table: 'audit_logs', idKey: 'id',
    columns: 'id,user_email,module,action,detail,created_at',
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
    columns: 'id,name,email,phone,province,address_detail,cards_tokenized,balance,notes,pickup_in_person',
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
    columns: 'id,type,recipient_name,recipient_phone,province,address_detail,status,assigned_repartidor_id,assigned_repartidor_name,incidences,digital_signature',
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
    columns: 'id,code,type,value,usage_limit,used,applicable_category,active,expires_at',
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
    columns: 'id,product_id,product_name,product_sku,price,caption,image_url,status,scheduled_at,error_detail,created_by,created_at',
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
    columns: 'id,title,description,image_url,link,type,active,start_date,end_date',
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
    columns: 'sku,name,category,price,cost,image_url',
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
  const { data, error } = await supabase.from(cfg.table).select(cfg.columns);
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
  (lastSyncedDb as any)[cfg.key] = structuredClone(items);

  // Se guarda la copia buena para el próximo arranque. Va agrupado
  // (`coalesce`) porque una ráfaga de Realtime puede refrescar la misma
  // tabla varias veces seguidas, y serializar el catálogo entero en cada
  // una sería trabajo de CPU repetido en el hilo principal — justo lo
  // que este cambio viene a evitar.
  if (TABLAS_CACHEABLES.has(cfg.key as string)) {
    coalesce('cache-local', guardarCacheLocal, 500);
  }

  notifyUpdate();
}

function initTableRealtimeSync(cfg: TableConfig<any>) {
  refreshTableFromSupabase(cfg).then(() => {
    genericReady[cfg.key as string] = true;
    flushGenericPending(cfg);
  });
}

/**
 * Vuelve a leer "products" de Supabase de inmediato y deja `localCache`
 * (y por lo tanto `getDB()`) al día.
 *
 * POR QUÉ EXISTE: el canal de Realtime también refresca esta tabla, pero
 * con una ventana de "coalescing" de 200ms (ver `montarCanal`) pensada
 * para agrupar varios cambios seguidos, no para garantizar que esté lista
 * en el instante exacto en que alguien la necesita. Justo después de un
 * cobro (`adjust_stock` corre del lado de Supabase, sin pasar por
 * `saveDB()`) es exactamente ese instante: si la pantalla de Cobros lee
 * `getDB().products` ahí mismo, puede ver todavía el stock de ANTES de
 * descontar, y parece —a quien está probando— que el descuento no
 * ocurrió, aunque en la base ya esté correcto.
 */
export async function refreshProductsFromSupabase(): Promise<void> {
  const cfg = TABLE_CONFIGS.find(c => c.key === 'products');
  if (cfg) await refreshTableFromSupabase(cfg);
}

async function syncTableToSupabase(cfg: TableConfig<any>, added: any[], modified: any[], deleted: any[]) {
  if (!genericReady[cfg.key as string]) {
    if (!genericPending[cfg.key as string]) genericPending[cfg.key as string] = [];
    genericPending[cfg.key as string].push({ added, modified, deleted });
    return;
  }

  const errors: string[] = [];

  // FALLO CORREGIDO: esto insertaba UNA fila por petición, en un bucle
  // secuencial. Para un puñado de filas no se nota, pero una importación
  // masiva de ~300-600 artículos disparaba esa misma cantidad de idas y
  // vueltas a Supabase, una detrás de otra — varios minutos en total. Y como
  // quien llama a `saveDB()` no esperaba a que terminara (ver
  // `handleImportSelected` en InventarioControl.tsx), el panel mostraba
  // "¡Éxito!" y cerraba el modal mientras la subida seguía corriendo de
  // fondo: bastaba con cambiar de pantalla o que el teléfono bloqueara la
  // pestaña para cortarla a la mitad. Se comprobó en producción: de una
  // importación de 632 productos, solo 81 de sus movimientos de inventario
  // (la fase que corre DESPUÉS de products) llegaron a guardarse.
  //
  // Insertar en LOTES reduce una importación de 600 filas a 1-2 peticiones
  // en vez de 600, así que hay muchísima menos ventana para que un corte a
  // mitad de camino deje datos a medias — y de paso es muchísimo más rápido.
  const LOTE_INSERCION = 200;
  for (let i = 0; i < added.length; i += LOTE_INSERCION) {
    const lote = added.slice(i, i + LOTE_INSERCION);
    const { error } = await supabase.from(cfg.table).insert(lote.map(cfg.toRow));
    if (!error) continue;

    // El lote completo falló (por ejemplo, una sola fila del lote choca con
    // un id ya existente). Se reintenta fila por fila SOLO ese lote, para no
    // perder las demás filas y para conservar la tolerancia a colisiones
    // que ya tenía este código: insert (no upsert) porque el checkout/
    // registro de clientes anónimos no tiene permiso de SELECT directo en
    // orders/client_profiles/logistics_deliveries, y upsert() lo necesita
    // para resolver ON CONFLICT DO UPDATE aunque al final no haya ningún
    // conflicto real. Una colisión real (código 23505) se trata como éxito
    // silencioso: la fila ya existe, que es justo lo que se quería lograr.
    for (const item of lote) {
      const { error: errorFila } = await supabase.from(cfg.table).insert(cfg.toRow(item));
      if (errorFila && (errorFila as any).code !== '23505') {
        errors.push(`crear en ${cfg.table} (${item[cfg.idKey]}): ${errorFila.message}`);
      }
    }
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

// =====================================================================
// MENSAJES EN VUELO — lo que arreglaba de verdad el "retraso de 2-3 s"
// =====================================================================
// El síntoma no era que el mensaje tardara en aparecer: aparecía al
// instante (la interfaz ya era optimista), se BORRABA solo, y volvía dos
// o tres segundos después. Eso confundía, porque parecía lentitud de red
// cuando en realidad era la aplicación pisándose a sí misma.
//
// La secuencia exacta:
//   1. Se toca "Enviar" y el mensaje se pinta al instante.
//   2. Sale el INSERT hacia Supabase, que tarda lo que tarde la red.
//   3. ENTRE MEDIO, el sondeo que corría cada 2 segundos ejecutaba
//      `refreshChatFromSupabase()`, que NO fusiona: reemplaza entero
//      `localCache.chat_conversations` por lo que hay en el servidor. Y
//      en el servidor todavía no estaba el mensaje.
//   4. `notifyUpdate()` avisaba, la pantalla releía la caché… y el
//      mensaje recién escrito desaparecía.
//   5. Al completarse el INSERT, el siguiente sondeo lo traía de vuelta.
//
// De ahí los 2-3 segundos: era exactamente un ciclo de sondeo.
//
// Este registro guarda los mensajes que ya se pintaron pero que el
// servidor todavía no confirma. Cualquier recarga completa los vuelve a
// inyectar, así que un mensaje enviado NUNCA puede desaparecer de la
// pantalla por una recarga que llegó a destiempo.
const mensajesEnVuelo = new Map<string, { convId: string; msg: ChatMessage }>();

export function marcarMensajeEnVuelo(convId: string, msg: ChatMessage): void {
  mensajesEnVuelo.set(msg.id, { convId, msg });
}

export function confirmarMensajeEnVuelo(id: string): void {
  mensajesEnVuelo.delete(id);
}

/**
 * Devuelve a su sitio los mensajes que el servidor todavía no reporta.
 *
 * Se llama SIEMPRE justo antes de publicar el resultado de una recarga
 * completa. Si el servidor ya trae el mensaje, se da por confirmado y se
 * saca del registro; si no, se reinyecta para que la pantalla no lo
 * pierda.
 */
function reinyectarMensajesEnVuelo(conversaciones: ChatConversation[]): void {
  if (mensajesEnVuelo.size === 0) return;
  for (const [id, { convId, msg }] of mensajesEnVuelo) {
    const conv = conversaciones.find(c => c.id === convId);
    if (!conv) continue;
    if (conv.messages.some(m => m.id === id)) {
      mensajesEnVuelo.delete(id);   // el servidor ya lo tiene: misión cumplida
      continue;
    }
    conv.messages.push(msg);
  }
}

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
    reinyectarMensajesEnVuelo(conversations);
    localCache.chat_conversations = conversations;
    lastSyncedDb.chat_conversations = structuredClone(conversations);
    notifyUpdate();
    return;
  }

  // MODO STAFF / CLIENTE LOGUEADO: lectura directa (RLS filtra por rol/correo).
  const { data: convRows, error: convError } = await supabase.from('chat_conversations').select('id,customer_name,customer_email,status,unread_count,assigned_admin_email,customer_token,updated_at,created_at');
  if (convError) {
    notifySyncError(`No se pudo leer chat_conversations: ${convError.message}`);
    return;
  }
  const { data: msgRows, error: msgError } = await supabase.from('chat_messages').select('id,conversation_id,sender,text,created_at,image_url,is_internal_note').order('created_at', { ascending: true });
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
  reinyectarMensajesEnVuelo(conversations);
  localCache.chat_conversations = conversations;
  lastSyncedDb.chat_conversations = structuredClone(conversations);
  notifyUpdate();
}

/**
 * Aplica UN mensaje nuevo directamente en memoria, sin releer la tabla
 * entera.
 *
 * ---------------------------------------------------------------------
 * FALLO QUE ESTO CORRIGE: 20-30 segundos de demora en el chat
 * ---------------------------------------------------------------------
 * Antes, CUALQUIER evento de `chat_messages` —así fuera un solo mensaje—
 * disparaba `refreshChatFromSupabase()`: un `select('*')` de TODA la
 * tabla de mensajes de TODAS las conversaciones, sin límite ni filtro.
 * Con el historial que ya acumuló el negocio en producción, esa recarga
 * completa dejó de ser instantánea — cuanto más creciera el chat, más
 * lento se ponía CADA mensaje nuevo, para cualquiera que estuviera
 * mirando (cliente o administrador), aunque el WebSocket avisara al
 * instante.
 *
 * La corrección: el propio evento de Realtime ya trae la fila completa
 * del mensaje insertado (`payload.new`), así que alcanza con agregar
 * ESE mensaje a la conversación que ya está en memoria — sin ir a la
 * base de datos por nada más. Si la conversación todavía no estuviera
 * en caché (poco común: mensaje de una conversación recién creada que
 * este cliente no había cargado), se recurre a la recarga completa como
 * respaldo, nunca como camino normal.
 */
function aplicarMensajeEntrante(row: any): void {
  if (!row?.id || !row?.conversation_id) return;
  agregarMensajeAConversacion(row.conversation_id, {
    id: row.id, sender: row.sender, text: row.text, timestamp: row.created_at,
    imageUrl: row.image_url || undefined, isInternalNote: !!row.is_internal_note,
  });
}

/**
 * Mete un mensaje en su conversación, venga por donde venga.
 *
 * Lo usan los dos canales de recepción —`postgres_changes` (personal con
 * sesión) y la difusión (cliente anónimo)— porque el trabajo es idéntico
 * y duplicarlo garantizaba que un día se arreglara solo uno.
 *
 * Es idempotente por `id`: que el mismo mensaje llegue por los dos
 * caminos a la vez no lo duplica en pantalla.
 */
function agregarMensajeAConversacion(convId: string, msg: ChatMessage): void {
  if (!convId || !msg?.id) return;
  const conv = (localCache.chat_conversations || []).find(c => c.id === convId);
  if (!conv) {
    // Conversación que este cliente todavía no tiene en memoria (recién
    // creada, o su primer mensaje): no hay nada parcial que agregar, así
    // que aquí sí hace falta la recarga completa, una sola vez.
    coalesce('chat', () => refreshChatFromSupabase(), 30);
    return;
  }
  if (conv.messages.some(m => m.id === msg.id)) return; // ya lo teníamos

  conv.messages.push(msg);
  // Si era un mensaje propio que estaba esperando confirmación, ya no
  // hace falta protegerlo de las recargas: el servidor lo devolvió.
  confirmarMensajeEnVuelo(msg.id);
  lastSyncedDb.chat_conversations = structuredClone(localCache.chat_conversations);
  notifyUpdate();
}

// =====================================================================
// DIFUSIÓN EN TIEMPO REAL — el canal del cliente anónimo
// =====================================================================
// Aquí estaba la razón de fondo por la que existía el sondeo cada 2
// segundos, y por la que no bastaba con borrarlo:
//
// Un visitante del chat público NO tiene sesión de Supabase. Realtime
// aplica las políticas RLS con el token de quien se suscribe, y la
// política de `chat_messages` exige `is_staff() O el correo de la
// conversación = current_email()`. Para un anónimo `current_email()` es
// nulo, así que NUNCA le llega un `postgres_changes` de un mensaje. Esa
// restricción es correcta —nadie sin sesión debe poder leer chats
// ajenos— y no se toca.
//
// La salida no es aflojar RLS ni volver al sondeo, sino usar el OTRO
// mecanismo de Realtime: la difusión (broadcast), que es un canal de
// publicación/suscripción y no consulta ninguna tabla, así que no pasa
// por RLS de filas. Cada conversación tiene su propio canal
// `chat-conv-<id>`, y el identificador de la conversación es largo y
// aleatorio: funciona como la llave de esa sala. El cliente se suscribe
// SOLO a la suya —la que ya tiene en su propio token—, así que sigue sin
// poder escuchar conversaciones de otros, igual que antes.
const canalesDifusion = new Map<string, any>();

/**
 * Canal de una conversación, creado la primera vez que hace falta.
 *
 * Sirve para las dos cosas a la vez, escuchar y publicar, porque un
 * canal de Supabase es bidireccional: abrir uno para enviar y otro para
 * recibir sería pagar dos conexiones por la misma sala.
 */
function canalDeConversacion(convId: string): any {
  let canal = canalesDifusion.get(convId);
  if (canal) return canal;
  try {
    canal = supabase.channel(`chat-conv-${convId}`, {
      // `self: false` evita que quien publica reciba su propio mensaje de
      // vuelta. No rompería nada —`agregarMensajeAConversacion` descarta
      // por id— pero es tráfico y trabajo para nada.
      config: { broadcast: { self: false } },
    });
    canal.on('broadcast', { event: 'mensaje' }, ({ payload }: any) => {
      if (payload?.msg) agregarMensajeAConversacion(payload.convId || convId, payload.msg);
    });
    canal.subscribe();
    canalesDifusion.set(convId, canal);
  } catch {
    return null;
  }
  return canal;
}

/**
 * Publica un mensaje ya guardado para que la otra parte lo vea al
 * instante.
 *
 * Se llama DESPUÉS de que el INSERT salió bien, nunca antes: la difusión
 * es un acelerador de entrega, no la fuente de la verdad. Si fallara, el
 * mensaje sigue en la base y llega igual por el refresco al volver a la
 * pestaña — por eso los errores se tragan sin ruido.
 */
function difundirMensaje(convId: string, msg: ChatMessage): void {
  try {
    canalDeConversacion(convId)?.send({
      type: 'broadcast',
      event: 'mensaje',
      payload: { convId, msg },
    });
  } catch {
    /* la entrega instantánea es un extra; la verdad ya está en la base */
  }
}

/** Abre los canales de las conversaciones que este cliente puede ver. */
function sincronizarCanalesDeDifusion(): void {
  for (const conv of localCache.chat_conversations || []) {
    if (conv?.id) canalDeConversacion(conv.id);
  }
}

function initChatRealtimeSync() {
  refreshChatFromSupabase().then(() => {
    chatReady = true;
    flushChatPending();
    sincronizarCanalesDeDifusion();
  });

  // -------------------------------------------------------------------
  // SIN SONDEO. Ni cada 2 segundos ni cada 30.
  // -------------------------------------------------------------------
  // Aquí corría un `setInterval` de 2 segundos que releía TODO el chat.
  // Hacía dos daños a la vez:
  //
  //   · Borraba de la pantalla el mensaje recién enviado cuando caía
  //     entre el pintado optimista y el INSERT (ver `mensajesEnVuelo`
  //     más arriba). Ese era el "retraso de 2-3 segundos" reportado.
  //   · Descargaba la tabla entera de mensajes cada 2 segundos, para
  //     todo el mundo, creciera lo que creciera el historial.
  //
  // Ahora la recepción es puramente por WebSocket: `postgres_changes`
  // para quien tiene sesión, y difusión para el cliente anónimo (ver el
  // bloque de difusión). Lo único que queda son refrescos POR EVENTO,
  // que no son sondeo: ocurren cuando algo cambió de verdad, no cada N
  // segundos contra el reloj.
  if (typeof window !== 'undefined') {
    // Al volver a la pestaña: mientras estuvo oculta el navegador pudo
    // haber dormido el WebSocket, así que se comprueba una vez lo que se
    // haya perdido. Una sola lectura al volver, no una cada 2 segundos
    // mientras se está mirando.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        coalesce('chat', () => refreshChatFromSupabase().then(sincronizarCanalesDeDifusion), 300);
      }
    });

    // Al recuperar la conexión, por lo mismo: es un evento real, no un
    // reloj. Cubre el caso del WebView de Android que pierde el socket
    // en silencio al cambiar de wifi a datos.
    window.addEventListener('online', () => {
      coalesce('chat', () => refreshChatFromSupabase().then(sincronizarCanalesDeDifusion), 300);
    });
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
      if (msgErr) {
        errors.push(`crear mensaje ${msg.id}: ${msgErr}`);
      } else {
        // Guardado de verdad: ya se puede soltar la protección contra
        // recargas y avisarle al otro lado por el canal instantáneo.
        confirmarMensajeEnVuelo(msg.id);
        difundirMensaje(conv.id, msg);
      }
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
      if (msgErr) {
        errors.push(`crear mensaje ${msg.id}: ${msgErr}`);
      } else {
        confirmarMensajeEnVuelo(msg.id);
        difundirMensaje(conv.id, msg);
      }
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
    lastSyncedDb.settings = structuredClone(settings);
    // El logo y el nombre de la tienda salen de aquí: cachearlos evita
    // que la cabecera aparezca sin marca en el primer fotograma.
    coalesce('cache-local', guardarCacheLocal, 500);
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
// El canal abierto ahora mismo, para poder cerrarlo y volver a abrirlo.
let canalActual: ReturnType<typeof supabase.channel> | null = null;

function montarCanal() {
  const channel = supabase.channel(`technoverse-realtime-sync-${Date.now()}`);

  TABLE_CONFIGS.forEach((cfg) => {
    channel.on('postgres_changes', { event: '*', schema: 'public', table: cfg.table }, () => {
      coalesce(`table:${cfg.key as string}`, () => refreshTableFromSupabase(cfg));
    });
  });

  // chat_conversations sigue recargando completo: es una tabla chica (una
  // fila por conversación, no por mensaje) y ahí viven unread_count,
  // status y assigned_admin_email — datos que si no se agrupan bien
  // pueden desincronizarse. 30 ms de coalescing porque un INSERT en
  // chat_messages casi siempre llega junto con un UPDATE de
  // chat_conversations (el mismo guardado los dispara a los dos).
  //
  // chat_messages, en cambio, YA NO recarga la tabla entera en el caso
  // normal (INSERT): aplica la fila directo desde el propio evento, ver
  // `aplicarMensajeEntrante` — es lo que corrige la demora de 20-30
  // segundos que crecía junto con el historial del chat. UPDATE/DELETE
  // sobre un mensaje son rarísimos en este chat (los mensajes no se
  // editan) y sí recargan completo, sin que valga la pena optimizarlos.
  channel
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_conversations' }, () => coalesce('chat', () => refreshChatFromSupabase(), 30))
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (payload) => aplicarMensajeEntrante(payload.new))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_messages' }, () => coalesce('chat', () => refreshChatFromSupabase(), 30))
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'chat_messages' }, () => coalesce('chat', () => refreshChatFromSupabase(), 30))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings' }, () => coalesce('settings', () => refreshSettingsFromSupabase()))
    .subscribe();

  canalActual = channel;
}

/**
 * FALLO QUE ESTO CORRIGE: el panel no se enteraba de las ventas nuevas.
 *
 * El canal se abría UNA vez al arrancar la aplicación, cuando todavía no
 * había nadie con sesión. Del lado del servidor, Realtime decide qué
 * filas puede ver cada suscriptor aplicando las políticas RLS con el
 * token que tenía EN EL MOMENTO DE SUSCRIBIRSE. Como en ese momento era
 * un visitante anónimo, y un anónimo no puede leer pedidos, los eventos
 * de `orders` nunca llegaban aunque el canal estuviera conectado.
 *
 * Iniciar sesión después no arregla el canal ya suscrito: hay que
 * volverlo a montar con el token nuevo. Eso es exactamente lo que hace
 * esto — y también al cerrar sesión, para dejar de recibir lo que ya no
 * corresponde.
 *
 * Efecto práctico: las ventas, el tráfico y los cambios de inventario
 * aparecen solos, sin recargar.
 */
function initRealtimeChannel() {
  montarCanal();

  supabase.auth.onAuthStateChange((evento) => {
    // TOKEN_REFRESHED no cambia quién es la persona: volver a montar el
    // canal en cada refresco sería reconectar cada hora sin motivo.
    if (evento !== 'SIGNED_IN' && evento !== 'SIGNED_OUT' && evento !== 'INITIAL_SESSION') return;
    try {
      if (canalActual) supabase.removeChannel(canalActual);
    } catch {
      /* si no se pudo cerrar, el canal viejo caduca solo */
    }
    canalActual = null;
    montarCanal();

    // Al entrar, la sesión ve filas que antes estaban ocultas (sus
    // pedidos, o TODOS si es el dueño). Sin esta recarga habría que
    // esperar al primer cambio para verlas.
    if (evento === 'SIGNED_IN') {
      TABLE_CONFIGS.forEach(cfg => coalesce(`table:${cfg.key as string}`, () => refreshTableFromSupabase(cfg), 400));
    }
  });
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

  // FALLO CORREGIDO — catálogo y chat lentos al abrir la APK.
  //
  // Antes las 11 tablas de TABLE_CONFIGS se pedían TODAS en paralelo desde
  // el primer instante (`TABLE_CONFIGS.forEach(...)`), al mismo tiempo que
  // la primera lectura del chat. En una conexión móvil esas peticiones
  // comparten el mismo ancho de banda que la de "products" (636 filas): un
  // visitante que solo quiere ver el catálogo pagaba, sin saberlo, la
  // descarga completa de "inventory_movements" (644 filas) y de otras ocho
  // tablas de uso exclusivo del panel — ANTES de que su propio catálogo
  // terminara de llegar. Lo mismo le pasaba a la primera carga del chat.
  //
  // AdminPanel.tsx ya evita este problema para el CÓDIGO (carga perezosa:
  // "nadie fuera de /admin lo paga" — ver el comentario en App.tsx). Esto
  // extiende el mismo principio a los DATOS: lo que la tienda pública
  // necesita para el primer pintado —catálogo y chat— arranca YA; el resto
  // (movimientos, reparaciones, ventas, auditoría, clientes, entregas,
  // campañas, SKUs históricos) espera un respiro corto.
  //
  // Es seguro diferirlas: si alguna escritura llega antes de que su tabla
  // esté lista (`genericReady`), `syncTableToSupabase` ya la encola en
  // `genericPending` y la aplica sola en cuanto la tabla arranca — no se
  // pierde nada, solo se pospone medio segundo.
  const productsCfg = TABLE_CONFIGS.find(c => c.key === 'products');
  const tablasAdmin = TABLE_CONFIGS.filter(c => c.key !== 'products');
  if (productsCfg) initTableRealtimeSync(productsCfg);
  initChatRealtimeSync();
  initSettingsRealtimeSync();
  initRealtimeChannel();

  const arrancarTablasDeAdmin = () => tablasAdmin.forEach(initTableRealtimeSync);
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    // Tan pronto el hilo principal respire, pero sin pasar de 1.2s: para
    // el panel (que se abre bastante después de que la app ya cargó) esa
    // espera es imperceptible.
    (window as any).requestIdleCallback(arrancarTablasDeAdmin, { timeout: 1200 });
  } else {
    setTimeout(arrancarTablasDeAdmin, 400);
  }

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

// Rehidratación del catálogo guardado. Va AQUÍ, y no arriba junto a
// `localCache`, por una razón concreta: necesita escribir también en
// `lastSyncedDb`, que se declara con `let` en la línea de arriba y hasta
// este punto está en zona muerta temporal. Es código de módulo, así que
// corre de forma síncrona al importar `storage.ts` — antes de que React
// monte nada. Para cuando la tienda hace su primer `getDB()`, el catálogo
// ya está ahí.
hidratarCacheLocal();

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
  lastSyncedDb = structuredClone(newDb);
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
    const reconciliado: any = structuredClone(newDb);
    clavesFallidas.forEach((k) => {
      reconciliado[k] = structuredClone((oldDb as any)[k]);
    });
    localCache = reconciliado;
    lastSyncedDb = structuredClone(reconciliado);
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
