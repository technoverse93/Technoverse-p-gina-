// =====================================================================
// ESTUDIO DE PAUTA — imágenes y textos de publicidad hechos por Phill
// =====================================================================
// Dos cosas que el servidor hace por el Estudio (src/components/admin/
// EstudioPauta.tsx) y por la herramienta «crear_pauta» del chat:
//
//  1) generarImagen: el FONDO o la ESCENA de la pieza, con IA gratis. Se
//     prueban los proveedores en orden y gana el primero que responde:
//       · Gemini (modelo de imagen) — si hay clave y el plan lo permite;
//         es el único que además puede partir de la foto del producto.
//       · Cloudflare Workers AI (FLUX schnell / SDXL lightning) — gratis
//         con clave (CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_AI_TOKEN).
//       · Hugging Face (FLUX schnell) — gratis con HF_TOKEN.
//       · Pollinations — gratis y SIN clave: el último recurso.
//     La IA nunca pone texto: el titular, el precio y el logo los dibuja
//     la app encima (los modelos de imagen escriben mal y se inventan
//     cifras; así el precio que se ve es siempre el real).
//
//  2) generarCopy: titular, subtítulo, etiqueta, botón, pie, texto para
//     redes y hashtags, SOLO con los datos reales del producto. Se
//     descarta lo que traiga porcentajes o montos que no están en los datos.
// =====================================================================

type Pedir = (prompt: string, usuario: string, valido: (j: any) => boolean) => Promise<any | null>;

export type FormatoId = 'cuadrado' | 'retrato' | 'historia' | 'horizontal' | 'banner';
export type EstiloId = 'premium' | 'claro' | 'vibrante' | 'oferta';

/** Tamaño que se le pide a cada modelo (múltiplos de 64) y la proporción que entiende Gemini. */
export const MEDIDAS: Record<FormatoId, { ancho: number; alto: number; ratio: string }> = {
  cuadrado: { ancho: 1024, alto: 1024, ratio: '1:1' },
  retrato: { ancho: 896, alto: 1152, ratio: '4:5' },
  historia: { ancho: 768, alto: 1344, ratio: '9:16' },
  horizontal: { ancho: 1216, alto: 704, ratio: '16:9' },
  banner: { ancho: 1344, alto: 576, ratio: '21:9' },
};
const ESTILOS_IA: Record<EstiloId, string> = {
  premium: 'deep navy blue and metallic gold lighting, luxury technology atmosphere, soft bokeh highlights',
  claro: 'bright clean studio, soft white and light blue gradient, minimal, airy, gentle shadows',
  vibrante: 'vibrant gradient of electric blue, purple and magenta, neon glow, energetic modern look',
  oferta: 'bold red and orange energetic sale atmosphere, dynamic light rays, festive and eye-catching',
};
export const FORMATOS_VALIDOS = Object.keys(MEDIDAS) as FormatoId[];
export const ESTILOS_VALIDOS = Object.keys(ESTILOS_IA) as EstiloId[];

const SIN_TEXTO = 'Professional advertising background. No text, no letters, no numbers, no logos, no watermarks, no people, no hands. Keep the center and the lower third calm and uncluttered so a product photo and text can be placed over it. High quality, sharp, cinematic lighting.';

/** El pedido final al modelo de imagen. `descripcion` es la escena en inglés (la da el copy). */
export function armarPromptImagen(descripcion: string, estilo: EstiloId, conReferencia = false): string {
  const escena = String(descripcion || '').replace(/\s+/g, ' ').trim().slice(0, 400) || 'abstract modern technology backdrop';
  if (conReferencia) {
    return `Use the attached product photo as the exact hero product and keep the product itself unchanged (same shape, colors, logos and details). Place it in a professional advertising scene: ${escena}. Style: ${ESTILOS_IA[estilo]}. No added text, no letters, no numbers, no extra logos, no watermarks. Clean composition with space around the product.`;
  }
  return `${escena}. Style: ${ESTILOS_IA[estilo]}. ${SIN_TEXTO}`;
}

// ------------------------------ utilidades ------------------------------
async function conTope(url: string, init: RequestInit, ms: number): Promise<Response> {
  const corte = new AbortController();
  const t = setTimeout(() => corte.abort(), ms);
  try { return await fetch(url, { ...init, signal: corte.signal }); }
  catch (e) { if (corte.signal.aborted) throw new Error('tiempo agotado'); throw e; }
  finally { clearTimeout(t); }
}
function aBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const corto = (e: unknown) => String(e instanceof Error ? e.message : e).replace(/\s+/g, ' ').slice(0, 140);
const TIPO_IMAGEN = /^image\/(png|jpe?g|webp)$/i;
export type ImagenGenerada = { b64: string; mime: string; proveedor: string; modelo: string };

// ------------------------------- Gemini -------------------------------
let modelosGeminiImg: { lista: string[]; vence: number } | null = null;
async function modelosImagenGemini(clave: string): Promise<string[]> {
  const pedido = (Deno.env.get('GEMINI_IMAGE_MODEL') || '').trim();
  if (modelosGeminiImg && modelosGeminiImg.vence > Date.now()) return modelosGeminiImg.lista;
  let lista: string[] = [];
  try {
    const r = await conTope('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': clave } }, 8000);
    if (r.ok) {
      const d = await r.json();
      lista = (d?.models || [])
        .filter((m: any) => /image/i.test(String(m?.name)) && !/imagen|embedding|live|tts|audio|vision-only/i.test(String(m?.name)) && (m?.supportedGenerationMethods || []).includes('generateContent'))
        .map((m: any) => String(m.name).replace(/^models\//, ''));
    }
  } catch { /* se usa el nombre conocido */ }
  // Los «flash» primero (más baratos y con plan gratis más probable) y los más nuevos antes.
  const numero = (n: string) => Number((/(\d+(?:\.\d+)?)/.exec(n) || [])[1] || 0);
  lista.sort((a, b) => Number(/flash/i.test(b)) - Number(/flash/i.test(a)) || numero(b) - numero(a));
  const final = [...new Set([...(pedido ? [pedido] : []), ...lista, ...(lista.length ? [] : ['gemini-2.5-flash-image'])])].slice(0, 3);
  modelosGeminiImg = { lista: final, vence: Date.now() + 3600_000 };
  return final;
}

async function conGemini(prompt: string, formato: FormatoId, referencia: string | undefined, hasta: number): Promise<ImagenGenerada> {
  const clave = Deno.env.get('GEMINI_API_KEY');
  if (!clave) throw new Error('sin clave de Gemini');
  let ultimo = 'sin modelo de imagen';
  for (const modelo of await modelosImagenGemini(clave)) {
    if (Date.now() > hasta - 5000) break;
    const partes: any[] = [{ text: prompt }];
    const ref = /^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/i.exec(referencia || '');
    if (ref) partes.push({ inlineData: { mimeType: ref[1], data: ref[2] } });
    try {
      const r = await conTope(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': clave },
        body: JSON.stringify({ contents: [{ role: 'user', parts: partes }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: MEDIDAS[formato].ratio } } }),
      }, Math.min(55000, hasta - Date.now()));
      if (!r.ok) { ultimo = `${modelo} ${r.status} ${(await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 90)}`; continue; }
      const d = await r.json();
      const parte = (d?.candidates?.[0]?.content?.parts || []).find((p: any) => (p?.inlineData || p?.inline_data)?.data);
      const datos = parte?.inlineData || parte?.inline_data;
      if (!datos?.data) { ultimo = `${modelo} sin imagen (${d?.candidates?.[0]?.finishReason || d?.promptFeedback?.blockReason || 'texto'})`; continue; }
      return { b64: datos.data, mime: datos.mimeType || datos.mime_type || 'image/png', proveedor: 'gemini', modelo };
    } catch (e) { ultimo = `${modelo} ${corto(e)}`; }
  }
  throw new Error(ultimo);
}

// ----------------------------- Cloudflare -----------------------------
async function conCloudflare(prompt: string, formato: FormatoId, hasta: number): Promise<ImagenGenerada> {
  const cuenta = Deno.env.get('CLOUDFLARE_ACCOUNT_ID'), clave = Deno.env.get('CLOUDFLARE_AI_TOKEN');
  if (!cuenta || !clave) throw new Error('sin clave de Cloudflare');
  const { ancho, alto } = MEDIDAS[formato];
  let ultimo = '';
  for (const [modelo, cuerpo] of [
    ['@cf/black-forest-labs/flux-1-schnell', { prompt, steps: 6 }],
    ['@cf/bytedance/stable-diffusion-xl-lightning', { prompt, width: Math.min(ancho, 1024), height: Math.min(alto, 1024), num_steps: 6 }],
  ] as [string, Record<string, unknown>][]) {
    if (Date.now() > hasta - 5000) break;
    try {
      const r = await conTope(`https://api.cloudflare.com/client/v4/accounts/${cuenta}/ai/run/${modelo}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${clave}` }, body: JSON.stringify(cuerpo),
      }, Math.min(50000, hasta - Date.now()));
      if (!r.ok) { ultimo = `${modelo.split('/').pop()} ${r.status}`; continue; }
      const tipo = r.headers.get('content-type') || '';
      if (/json/i.test(tipo)) {
        const d = await r.json();
        const b64 = d?.result?.image;
        if (!b64) { ultimo = `${modelo.split('/').pop()} sin imagen`; continue; }
        return { b64, mime: 'image/jpeg', proveedor: 'cloudflare', modelo };
      }
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (bytes.length < 2000) { ultimo = `${modelo.split('/').pop()} respuesta vacía`; continue; }
      return { b64: aBase64(bytes), mime: TIPO_IMAGEN.test(tipo) ? tipo : 'image/png', proveedor: 'cloudflare', modelo };
    } catch (e) { ultimo = `${modelo.split('/').pop()} ${corto(e)}`; }
  }
  throw new Error(ultimo || 'sin respuesta');
}

// ---------------------------- Hugging Face ----------------------------
async function conHuggingFace(prompt: string, formato: FormatoId, hasta: number): Promise<ImagenGenerada> {
  const clave = Deno.env.get('HF_TOKEN');
  if (!clave) throw new Error('sin clave de Hugging Face');
  const { ancho, alto } = MEDIDAS[formato];
  const modelo = 'black-forest-labs/FLUX.1-schnell';
  const r = await conTope(`https://router.huggingface.co/hf-inference/models/${modelo}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${clave}`, Accept: 'image/png' },
    body: JSON.stringify({ inputs: prompt, parameters: { width: ancho, height: alto, num_inference_steps: 4 } }),
  }, Math.min(55000, hasta - Date.now()));
  if (!r.ok) throw new Error(`${r.status} ${(await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 90)}`);
  const tipo = r.headers.get('content-type') || '';
  if (!TIPO_IMAGEN.test(tipo)) throw new Error(`respuesta ${tipo || 'sin tipo'}`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.length < 2000) throw new Error('respuesta vacía');
  return { b64: aBase64(bytes), mime: tipo, proveedor: 'huggingface', modelo };
}

// ----------------------------- Pollinations -----------------------------
async function conPollinations(prompt: string, formato: FormatoId, hasta: number): Promise<ImagenGenerada> {
  const { ancho, alto } = MEDIDAS[formato];
  const semilla = Math.floor(Math.random() * 1e9);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 900))}?width=${ancho}&height=${alto}&model=flux&nologo=true&private=true&seed=${semilla}`;
  const r = await conTope(url, {}, Math.min(60000, hasta - Date.now()));
  if (!r.ok) throw new Error(`${r.status}`);
  const tipo = r.headers.get('content-type') || '';
  if (!TIPO_IMAGEN.test(tipo)) throw new Error(`respuesta ${tipo || 'sin tipo'}`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.length < 2000) throw new Error('respuesta vacía');
  return { b64: aBase64(bytes), mime: tipo, proveedor: 'pollinations', modelo: 'flux' };
}

export type ResultadoImagen =
  | ({ ok: true; intentos: string[]; ms: number } & ImagenGenerada)
  | { ok: false; intentos: string[]; ms: number; error: string };

/** Prueba los proveedores en orden (IMAGEN_PROVEEDORES, por defecto todos) hasta que uno entregue. */
export async function generarImagen(op: { prompt: string; formato: FormatoId; referencia?: string; hasta?: number; proveedores?: string[] }): Promise<ResultadoImagen> {
  const t0 = Date.now();
  const hasta = op.hasta ?? t0 + 115_000;
  const orden = (op.proveedores || String(Deno.env.get('IMAGEN_PROVEEDORES') || 'gemini,cloudflare,huggingface,pollinations').split(',').map(x => x.trim().toLowerCase())).filter(Boolean);
  // Con foto de referencia, solo Gemini puede usarla; los demás hacen el fondo sin ella.
  const conRef = !!op.referencia;
  const intentos: string[] = [];
  for (const id of orden) {
    if (Date.now() > hasta - 6000) { intentos.push('sin tiempo'); break; }
    try {
      let r: ImagenGenerada;
      if (id === 'gemini') r = await conGemini(op.prompt, op.formato, op.referencia, hasta);
      else if (conRef) { intentos.push(`${id}: no usa foto de referencia`); continue; }
      else if (id === 'cloudflare') r = await conCloudflare(op.prompt, op.formato, hasta);
      else if (id === 'huggingface') r = await conHuggingFace(op.prompt, op.formato, hasta);
      else if (id === 'pollinations') r = await conPollinations(op.prompt, op.formato, hasta);
      else continue;
      if (r.b64.length > 9_000_000) { intentos.push(`${id}: imagen demasiado grande`); continue; }
      return { ok: true, ...r, intentos, ms: Date.now() - t0 };
    } catch (e) { intentos.push(`${id}: ${corto(e)}`); }
  }
  return { ok: false, intentos, ms: Date.now() - t0, error: 'Ningún generador de imágenes respondió. Probá de nuevo en un momento.' };
}

// ------------------------------- los textos -------------------------------
export type DatosProducto = {
  nombre: string; categoria?: string; precio?: number; descuento?: number; descripcion?: string; garantia?: string; marca?: string; stock?: number;
};
export type OpcionesCopy = { objetivo?: string; tono?: string; instrucciones?: string; telefono?: string; formato?: FormatoId };
export type CopyPauta = {
  titular: string; subtitulo: string; etiqueta: string; cta: string; pie: string; caption: string; hashtags: string[]; fondo: string; estilo: EstiloId;
};

const OBJETIVOS: Record<string, string> = {
  venta: 'vender el producto ya (precio claro y llamado a escribir por WhatsApp)',
  oferta: 'comunicar una oferta o descuento, con urgencia sana',
  lanzamiento: 'anunciar que acaba de llegar, con novedad',
  informar: 'informar de qué sirve el producto y por qué conviene, sin presionar',
};
export const colonesTexto = (n: number) => `₡${Math.round(n || 0).toLocaleString('es-CR')}`;

const PROMPT_COPY = `Sos el publicista de Technoverse Costa Rica (tienda y taller de celulares, accesorios y electrónica). Armá el TEXTO de UNA pieza de publicidad para Instagram, Facebook y estados de WhatsApp, usando SOLO los datos reales que te paso.
Reglas:
- Español de Costa Rica, voseo suave y cercano, sin groserías ni exageraciones. Nada de «el mejor del mundo».
- Usá únicamente lo que está en los DATOS. Prohibido inventar características técnicas, porcentajes, descuentos, precios, plazos, envíos, garantías o existencias que no estén en los datos.
- Cantidades de dinero: solo el precio que viene en los datos, escrito EXACTAMENTE como viene en «precio_texto». Si no hay precio, no menciones dinero.
- Porcentajes: solo si los datos traen un descuento; si no, no pongas ningún «%».
- titular: máximo 34 caracteres, directo y con gancho (puede ir en mayúsculas).
- subtitulo: máximo 70 caracteres.
- etiqueta: máximo 12 caracteres para el sello de la pieza («NUEVO», «OFERTA», «-20%» solo si hay descuento, «ÚLTIMAS» solo si quedan pocas unidades). Si no aplica ninguna, dejala vacía.
- cta: máximo 24 caracteres, el botón («Escribinos al WhatsApp», «Pedilo hoy»).
- pie: máximo 58 caracteres con un dato real de apoyo (garantía si la hay, «Tienda y taller en Costa Rica»).
- caption: 220 a 420 caracteres para la publicación, con 1 a 3 emojis, un llamado a escribir por WhatsApp y, si hay precio, el precio exacto.
- hashtags: entre 6 y 9, sin espacios, incluyendo #CostaRica y #Technoverse.
- fondo: UNA escena de fondo en inglés (máximo 30 palabras) acorde al producto, sin personas, sin texto, sin marcas.
- estilo: uno de premium | claro | vibrante | oferta (el que mejor vaya con el objetivo).
Devolvé SOLO JSON: {"titular":"…","subtitulo":"…","etiqueta":"…","cta":"…","pie":"…","caption":"…","hashtags":["#…"],"fondo":"…","estilo":"…"}`;

const recortar = (t: unknown, n: number) => { const s = String(t ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s; };

/** Los textos de una pieza. Devuelve null si ninguna IA dio algo válido (sin inventar cifras). */
export async function generarCopy(pedir: Pedir, p: DatosProducto, o: OpcionesCopy = {}): Promise<CopyPauta | null> {
  const precio = Number(p.precio) > 0 ? colonesTexto(Number(p.precio)) : '';
  const descuento = Number(p.descuento) > 0 ? Math.round(Number(p.descuento)) : 0;
  const datos = [
    `producto: ${recortar(p.nombre, 120)}`,
    p.categoria ? `categoria: ${recortar(p.categoria, 60)}` : '',
    p.marca ? `marca: ${recortar(p.marca, 40)}` : '',
    precio ? `precio_texto: ${precio}` : 'precio_texto: (no mostrar precio)',
    descuento ? `descuento: ${descuento}%` : 'descuento: ninguno',
    p.garantia ? `garantia: ${recortar(p.garantia, 40)}` : '',
    Number.isFinite(Number(p.stock)) && Number(p.stock) > 0 && Number(p.stock) <= 3 ? `existencias: quedan ${Number(p.stock)}` : '',
    p.descripcion ? `descripcion: ${recortar(p.descripcion, 400)}` : '',
    `objetivo: ${OBJETIVOS[o.objetivo || 'venta'] || OBJETIVOS.venta}`,
    o.tono ? `tono: ${recortar(o.tono, 60)}` : '',
    o.telefono ? `whatsapp: ${recortar(o.telefono, 24)}` : '',
    o.instrucciones ? `pedido_del_dueno: ${recortar(o.instrucciones, 300)}` : '',
  ].filter(Boolean).join('\n');
  const permitidos = new Set<string>();
  if (precio) permitidos.add(precio.replace(/\D/g, ''));
  const valido = (j: any) => {
    if (typeof j?.titular !== 'string' || j.titular.trim().length < 3 || typeof j?.caption !== 'string' || j.caption.trim().length < 40) return false;
    const todo = JSON.stringify([j.titular, j.subtitulo, j.etiqueta, j.cta, j.pie, j.caption]);
    // Cifras que no están en los datos = invento: se descarta y se pide de nuevo.
    for (const m of todo.matchAll(/(\d+)\s?%/g)) if (!descuento || Number(m[1]) !== descuento) return false;
    for (const m of todo.matchAll(/₡\s?([\d.,\s  ]+\d)/g)) if (!permitidos.has(m[1].replace(/\D/g, ''))) return false;
    return true;
  };
  const j = await pedir(PROMPT_COPY, datos, valido);
  if (!j || !valido(j)) return null;
  const etiqueta = recortar(j.etiqueta, 12);
  const hashtags = (Array.isArray(j.hashtags) ? j.hashtags : []).map((h: unknown) => `#${String(h).replace(/[^\p{L}\p{N}_]/gu, '')}`).filter((h: string) => h.length > 2).slice(0, 9);
  for (const base of ['#CostaRica', '#Technoverse']) if (!hashtags.some((h: string) => h.toLowerCase() === base.toLowerCase())) hashtags.push(base);
  return {
    titular: recortar(j.titular, 34), subtitulo: recortar(j.subtitulo, 70), etiqueta: /%/.test(etiqueta) && !descuento ? '' : etiqueta,
    cta: recortar(j.cta, 24) || 'Escribinos al WhatsApp', pie: recortar(j.pie, 58), caption: String(j.caption).trim().slice(0, 700),
    hashtags: hashtags.slice(0, 10), fondo: recortar(j.fondo, 220) || 'abstract modern technology backdrop',
    estilo: ESTILOS_VALIDOS.includes(j.estilo) ? j.estilo : (descuento ? 'oferta' : 'premium'),
  };
}
