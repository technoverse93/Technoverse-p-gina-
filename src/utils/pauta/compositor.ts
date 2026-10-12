// =====================================================================
// COMPOSITOR DE PAUTA — dibuja la pieza final en un canvas
// =====================================================================
// La IA hace, como mucho, el FONDO. Todo lo que tiene que ser exacto lo
// dibuja esto, en el aparato: el logo real, el nombre, el precio, la
// etiqueta de oferta y el botón. Así nunca sale un precio inventado ni un
// texto mal escrito (los modelos de imagen escriben mal), y la pieza se
// puede editar y volver a dibujar al instante.
//
//   renderizar(canvas, pieza)  → pinta la pieza (escala 1 = tamaño real)
//   aBlob / miniaturaDe        → para descargar, subir y guardar
// =====================================================================

import { ESTILOS, FORMATOS, colones, type FormatoId, type Paleta, type Pieza } from './modelo';

type Rect = { x: number; y: number; w: number; h: number };
type Alinear = 'left' | 'center' | 'right';

const FUENTE = '"Inter", "Space Grotesk", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const fuente = (peso: number, tam: number) => `${peso} ${Math.max(8, Math.round(tam))}px ${FUENTE}`;

// ------------------------------- imágenes -------------------------------
const cacheImg = new Map<string, Promise<HTMLImageElement | null>>();
export function cargarImagen(src: string | null | undefined): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null);
  let p = cacheImg.get(src);
  if (!p) {
    p = new Promise<HTMLImageElement | null>(ok => {
      const img = new Image();
      if (!/^data:/i.test(src)) img.crossOrigin = 'anonymous';
      img.onload = () => ok(img);
      img.onerror = () => ok(null);
      img.src = src;
    });
    cacheImg.set(src, p);
    if (cacheImg.size > 24) cacheImg.delete(cacheImg.keys().next().value as string);
  }
  return p;
}

let fuentesListas: Promise<unknown> | null = null;
function esperarFuentes(): Promise<unknown> {
  if (!fuentesListas) {
    const cargar = (typeof document !== 'undefined' && document.fonts?.load)
      ? Promise.all([800, 700, 600, 500].map(w => document.fonts.load(fuente(w, 48)).catch(() => null)))
      : Promise.resolve();
    fuentesListas = Promise.race([cargar, new Promise(ok => setTimeout(ok, 1800))]);
  }
  return fuentesListas;
}

// ------------------------------- utilidades -------------------------------
function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}
const hexA = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};
function espaciado(ctx: CanvasRenderingContext2D, px: number) { try { (ctx as any).letterSpacing = `${px}px`; } catch { /* sin soporte */ } }

/** Parte un texto en líneas que quepan en `w`. Con `partir`, también parte palabras que no caben solas. */
function envolver(ctx: CanvasRenderingContext2D, texto: string, w: number, partir = true): string[] {
  const palabras = texto.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lineas: string[] = [];
  let actual = '';
  for (let palabra of palabras) {
    while (partir && ctx.measureText(palabra).width > w && palabra.length > 1) {
      let n = palabra.length - 1;
      while (n > 1 && ctx.measureText(palabra.slice(0, n)).width > w) n--;
      if (actual) { lineas.push(actual); actual = ''; }
      lineas.push(palabra.slice(0, n));
      palabra = palabra.slice(n);
    }
    const prueba = actual ? `${actual} ${palabra}` : palabra;
    if (ctx.measureText(prueba).width <= w) actual = prueba;
    else { if (actual) lineas.push(actual); actual = palabra; }
  }
  if (actual) lineas.push(actual);
  return lineas;
}

type Ajustado = { lineas: string[]; tam: number; alto: number };
/** Achica la letra hasta que el texto quepa en `w` y en `maxLineas`. */
function ajustar(ctx: CanvasRenderingContext2D, texto: string, o: { w: number; maxLineas: number; tam: number; min: number; peso: number; lh: number }): Ajustado {
  // Primero se achica la letra (sin partir palabras); partir una palabra es el último recurso.
  for (let t = o.tam; t >= o.min; t -= 2) {
    ctx.font = fuente(o.peso, t);
    const ls = envolver(ctx, texto, o.w, false);
    if (ls.length <= o.maxLineas && ls.every(l => ctx.measureText(l).width <= o.w + 0.5)) return { lineas: ls, tam: t, alto: ls.length * t * o.lh };
  }
  ctx.font = fuente(o.peso, o.min);
  const ultimo = envolver(ctx, texto, o.w, true);
  const ls = ultimo.slice(0, o.maxLineas);
  if (ultimo.length > o.maxLineas && ls.length) {
    let u = ls[ls.length - 1];
    while (u.length > 1 && ctx.measureText(`${u}…`).width > o.w) u = u.slice(0, -1);
    ls[ls.length - 1] = `${u.trimEnd()}…`;
  }
  return { lineas: ls, tam: o.min, alto: ls.length * o.min * o.lh };
}

function pintarLineas(ctx: CanvasRenderingContext2D, a: Ajustado, x: number, y: number, o: { peso: number; color: string; alinear: Alinear; lh: number; sombra?: boolean }) {
  ctx.save();
  ctx.font = fuente(o.peso, a.tam);
  ctx.fillStyle = o.color;
  ctx.textAlign = o.alinear;
  ctx.textBaseline = 'top';
  if (o.sombra) { ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = a.tam * 0.18; ctx.shadowOffsetY = a.tam * 0.06; }
  a.lineas.forEach((l, i) => ctx.fillText(l, x, y + i * a.tam * o.lh));
  ctx.restore();
}

// ------------------------------- disposición -------------------------------
type Disposicion = {
  W: number; H: number; m: number;
  logo: Rect; marca: { x: number; y: number; align: Alinear };
  titulo: Rect & { tam: number; min: number; lineas: number; align: Alinear };
  sub: { tam: number; lineas: number; limite: number };
  producto: Rect;
  badge: { cx: number; cy: number; r: number };
  precio: { x: number; y: number; tam: number; align: Alinear };
  cta: Rect;
  pie: { x: number; y: number; tam: number; align: Alinear; w: number };
};

function disposicion(f: FormatoId): Disposicion {
  const { ancho: W, alto: H } = FORMATOS[f];
  switch (f) {
    case 'cuadrado':
      return { W, H, m: 64, logo: { x: 64, y: 60, w: 84, h: 84 }, marca: { x: 164, y: 80, align: 'left' },
        titulo: { x: 64, y: 190, w: 470, h: 330, tam: 78, min: 42, lineas: 4, align: 'left' }, sub: { tam: 34, lineas: 3, limite: 745 },
        producto: { x: 565, y: 180, w: 455, h: 570 }, badge: { cx: 950, cy: 190, r: 84 },
        precio: { x: 64, y: 768, tam: 104, align: 'left' }, cta: { x: 64, y: 896, w: 500, h: 92 }, pie: { x: 64, y: 1016, tam: 26, align: 'left', w: 952 } };
    case 'retrato':
      return { W, H, m: 64, logo: { x: 64, y: 60, w: 84, h: 84 }, marca: { x: 164, y: 80, align: 'left' },
        titulo: { x: 64, y: 190, w: 952, h: 210, tam: 90, min: 52, lineas: 2, align: 'center' }, sub: { tam: 38, lineas: 2, limite: 505 },
        producto: { x: 150, y: 520, w: 780, h: 510 }, badge: { cx: 890, cy: 535, r: 96 },
        precio: { x: 540, y: 1052, tam: 112, align: 'center' }, cta: { x: 290, y: 1190, w: 500, h: 92 }, pie: { x: 540, y: 1308, tam: 26, align: 'center', w: 952 } };
    case 'historia':
      return { W, H, m: 80, logo: { x: 80, y: 250, w: 88, h: 88 }, marca: { x: 184, y: 272, align: 'left' },
        titulo: { x: 80, y: 380, w: 920, h: 330, tam: 104, min: 58, lineas: 3, align: 'center' }, sub: { tam: 44, lineas: 3, limite: 800 },
        producto: { x: 110, y: 770, w: 860, h: 620 }, badge: { cx: 880, cy: 800, r: 112 },
        precio: { x: 540, y: 1410, tam: 124, align: 'center' }, cta: { x: 240, y: 1552, w: 600, h: 108 }, pie: { x: 540, y: 1676, tam: 28, align: 'center', w: 920 } };
    case 'horizontal':
      return { W, H, m: 48, logo: { x: 48, y: 34, w: 72, h: 72 }, marca: { x: 136, y: 52, align: 'left' },
        titulo: { x: 48, y: 134, w: 610, h: 200, tam: 62, min: 34, lineas: 3, align: 'left' }, sub: { tam: 28, lineas: 2, limite: 392 },
        producto: { x: 690, y: 40, w: 470, h: 548 }, badge: { cx: 1086, cy: 100, r: 64 },
        precio: { x: 48, y: 402, tam: 76, align: 'left' }, cta: { x: 48, y: 492, w: 400, h: 66 }, pie: { x: 48, y: 580, tam: 20, align: 'left', w: 610 } };
    case 'banner':
    default:
      return { W, H, m: 90, logo: { x: 90, y: 48, w: 80, h: 80 }, marca: { x: 190, y: 66, align: 'left' },
        titulo: { x: 90, y: 148, w: 960, h: 190, tam: 90, min: 46, lineas: 2, align: 'left' }, sub: { tam: 38, lineas: 1, limite: 420 },
        producto: { x: 1180, y: 24, w: 640, h: 552 }, badge: { cx: 1150, cy: 108, r: 80 },
        precio: { x: 90, y: 436, tam: 90, align: 'left' }, cta: { x: 560, y: 444, w: 460, h: 84 }, pie: { x: 90, y: 548, tam: 24, align: 'left', w: 1000 } };
  }
}

// ------------------------------- fondo -------------------------------
function cubrir(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, W: number, H: number, zoom = 1) {
  const r = Math.max(W / img.width, H / img.height) * zoom;
  const w = img.width * r, h = img.height * r;
  ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
}
function contener(img: { width: number; height: number }, r: Rect, relleno = 0): Rect {
  const w0 = r.w * (1 - relleno * 2), h0 = r.h * (1 - relleno * 2);
  const e = Math.min(w0 / img.width, h0 / img.height);
  const w = img.width * e, h = img.height * e;
  return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
}

function fondoGradiente(ctx: CanvasRenderingContext2D, W: number, H: number, pal: Paleta, foco: Rect) {
  const g = ctx.createLinearGradient(0, 0, W * 0.85, H);
  g.addColorStop(0, pal.fondoA);
  if (pal.fondoC) { g.addColorStop(0.55, pal.fondoB); g.addColorStop(1, pal.fondoC); } else g.addColorStop(1, pal.fondoB);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // Luz detrás del producto.
  const cx = foco.x + foco.w / 2, cy = foco.y + foco.h / 2;
  const luz = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(foco.w, foco.h) * 0.85);
  luz.addColorStop(0, hexA(pal.claro ? '#FFFFFF' : pal.acento, pal.claro ? 0.9 : 0.30));
  luz.addColorStop(1, hexA(pal.claro ? '#FFFFFF' : pal.acento, 0));
  ctx.fillStyle = luz;
  ctx.fillRect(0, 0, W, H);
  // Círculos suaves y puntos: la textura «tecnológica» de la marca.
  ctx.save();
  ctx.globalAlpha = pal.claro ? 0.10 : 0.07;
  ctx.fillStyle = pal.claro ? pal.fondoA === '#F7FAFF' ? '#0B2A5B' : pal.acento : '#FFFFFF';
  ctx.beginPath(); ctx.arc(W * 0.92, H * 0.12, Math.min(W, H) * 0.34, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(W * 0.04, H * 0.96, Math.min(W, H) * 0.28, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = pal.claro ? 0.16 : 0.12;
  ctx.fillStyle = pal.claro ? '#0B2A5B' : '#FFFFFF';
  const paso = Math.max(26, Math.min(W, H) / 22);
  for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) { ctx.beginPath(); ctx.arc(W - paso * (i + 1.2), H - paso * (j + 1.2), 2.4, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

/** Un fondo de foto (IA o del producto) con un velo para que el texto se lea. */
function fondoFoto(ctx: CanvasRenderingContext2D, img: HTMLImageElement, W: number, H: number, pal: Paleta, borroso: boolean) {
  if (borroso) {
    // Difuminado sin depender de ctx.filter: se dibuja chiquito y se estira.
    const chico = document.createElement('canvas');
    chico.width = 40; chico.height = Math.max(8, Math.round(40 * H / W));
    chico.getContext('2d')!.drawImage(img, 0, 0, chico.width, chico.height);
    ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    cubrir(ctx, chico, W, H, 1.15);
    ctx.restore();
  } else cubrir(ctx, img, W, H);
  const velo = ctx.createLinearGradient(0, 0, 0, H);
  const base = pal.claro ? '#FFFFFF' : pal.fondoA;
  velo.addColorStop(0, hexA(base, pal.claro ? 0.62 : 0.58));
  velo.addColorStop(0.5, hexA(base, pal.claro ? 0.42 : 0.42));
  velo.addColorStop(1, hexA(base, pal.claro ? 0.74 : 0.80));
  ctx.fillStyle = velo;
  ctx.fillRect(0, 0, W, H);
}

// ------------------------------- producto -------------------------------
type TipoFoto = 'transparente' | 'blanco' | 'foto';
const tipos = new WeakMap<HTMLImageElement, TipoFoto>();
function tipoDeFoto(img: HTMLImageElement): TipoFoto {
  const cache = tipos.get(img);
  if (cache) return cache;
  let t: TipoFoto = 'foto';
  try {
    const c = document.createElement('canvas'); c.width = 32; c.height = 32;
    const x = c.getContext('2d', { willReadFrequently: true })!;
    x.drawImage(img, 0, 0, 32, 32);
    const d = x.getImageData(0, 0, 32, 32).data;
    let transp = 0, blanco = 0, n = 0;
    for (let i = 0; i < 32; i++) for (const j of [0, 1, 30, 31]) for (const [px, py] of [[i, j], [j, i]]) {
      const k = (py * 32 + px) * 4; n++;
      if (d[k + 3] < 24) transp++; else if (d[k] > 232 && d[k + 1] > 232 && d[k + 2] > 232) blanco++;
    }
    t = transp / n > 0.8 ? 'transparente' : (transp + blanco) / n > 0.8 ? 'blanco' : 'foto';
  } catch { t = 'foto'; }
  tipos.set(img, t);
  return t;
}

/** Dibuja el producto y devuelve el rectángulo que ocupó (para pegarle el sello). */
function dibujarProducto(ctx: CanvasRenderingContext2D, img: HTMLImageElement, zona: Rect, pal: Paleta): Rect {
  const tipo = tipoDeFoto(img);
  if (tipo === 'transparente') {
    const r = contener(img, zona, 0.04);
    ctx.save();
    ctx.shadowColor = pal.claro ? 'rgba(11,31,63,0.30)' : 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = zona.h * 0.07; ctx.shadowOffsetY = zona.h * 0.035;
    ctx.drawImage(img, r.x, r.y, r.w, r.h);
    ctx.restore();
    return r;
  }
  // Foto con fondo blanco o foto completa: va sobre una tarjeta redondeada,
  // toda DENTRO de la zona (la sombra y el relleno no se salen).
  const padRel = tipo === 'blanco' ? 0.05 : 0;
  const tarjeta = contener({ width: img.width * (1 + padRel * 2), height: img.height * (1 + padRel * 2) }, zona, 0.015);
  const pad = Math.min(tarjeta.w, tarjeta.h) * padRel / (1 + padRel * 2);
  const r = { x: tarjeta.x + pad, y: tarjeta.y + pad, w: tarjeta.w - pad * 2, h: tarjeta.h - pad * 2 };
  const rad = Math.min(tarjeta.w, tarjeta.h) * 0.07;
  ctx.save();
  ctx.shadowColor = pal.claro ? 'rgba(11,31,63,0.28)' : 'rgba(0,0,0,0.42)';
  ctx.shadowBlur = zona.h * 0.05; ctx.shadowOffsetY = zona.h * 0.025;
  ctx.fillStyle = pal.tarjeta;
  rr(ctx, tarjeta.x, tarjeta.y, tarjeta.w, tarjeta.h, rad);
  ctx.fill();
  ctx.restore();
  ctx.save();
  rr(ctx, tarjeta.x, tarjeta.y, tarjeta.w, tarjeta.h, rad);
  ctx.clip();
  ctx.drawImage(img, r.x, r.y, r.w, r.h);
  ctx.restore();
  return tarjeta;
}

// ------------------------------- adornos -------------------------------
function dibujarSello(ctx: CanvasRenderingContext2D, d: Disposicion['badge'], texto: string, pal: Paleta) {
  const t = texto.trim().toUpperCase();
  if (!t) return;
  ctx.save();
  ctx.translate(d.cx, d.cy);
  ctx.rotate(-0.12);
  const g = ctx.createLinearGradient(-d.r, -d.r, d.r, d.r);
  g.addColorStop(0, pal.acento); g.addColorStop(1, pal.acentoB);
  ctx.shadowColor = 'rgba(0,0,0,0.38)'; ctx.shadowBlur = d.r * 0.3; ctx.shadowOffsetY = d.r * 0.1;
  // Sello de 14 puntas.
  ctx.beginPath();
  const puntas = 14;
  for (let i = 0; i < puntas * 2; i++) {
    const a = (Math.PI * i) / puntas, r = i % 2 ? d.r * 0.9 : d.r;
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fillStyle = g; ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = Math.max(2, d.r * 0.05);
  ctx.strokeStyle = hexA(pal.acentoTexto, 0.28);
  ctx.beginPath(); ctx.arc(0, 0, d.r * 0.76, 0, Math.PI * 2); ctx.stroke();
  // Texto en una o dos líneas, ajustado al círculo.
  const ancho = d.r * 1.5;
  const a = ajustar(ctx, t, { w: ancho, maxLineas: 2, tam: d.r * 0.62, min: d.r * 0.19, peso: 800, lh: 1.02 });
  ctx.fillStyle = pal.acentoTexto; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = fuente(800, a.tam);
  a.lineas.forEach((l, i) => ctx.fillText(l, 0, (i - (a.lineas.length - 1) / 2) * a.tam * 1.04));
  ctx.restore();
}

function dibujarLogo(ctx: CanvasRenderingContext2D, logo: HTMLImageElement | null, d: Disposicion, pal: Paleta) {
  if (logo) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.30)'; ctx.shadowBlur = d.logo.w * 0.2; ctx.shadowOffsetY = d.logo.w * 0.06;
    rr(ctx, d.logo.x, d.logo.y, d.logo.w, d.logo.h, d.logo.w * 0.22);
    ctx.fillStyle = '#031837'; ctx.fill();
    ctx.restore();
    ctx.save();
    rr(ctx, d.logo.x, d.logo.y, d.logo.w, d.logo.h, d.logo.w * 0.22);
    ctx.clip();
    ctx.drawImage(logo, d.logo.x, d.logo.y, d.logo.w, d.logo.h);
    ctx.restore();
  }
  ctx.save();
  ctx.textBaseline = 'top'; ctx.textAlign = d.marca.align;
  ctx.fillStyle = pal.texto;
  ctx.font = fuente(800, d.logo.w * 0.30); espaciado(ctx, d.logo.w * 0.05);
  ctx.fillText('TECHNOVERSE', d.marca.x, d.marca.y);
  ctx.fillStyle = pal.textoSuave;
  ctx.font = fuente(600, d.logo.w * 0.19); espaciado(ctx, d.logo.w * 0.07);
  ctx.fillText('COSTA RICA', d.marca.x, d.marca.y + d.logo.w * 0.38);
  ctx.restore();
}

function dibujarBoton(ctx: CanvasRenderingContext2D, r: Rect, texto: string, pal: Paleta) {
  ctx.save();
  const g = ctx.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h);
  g.addColorStop(0, pal.acento); g.addColorStop(1, pal.acentoB);
  ctx.shadowColor = 'rgba(0,0,0,0.32)'; ctx.shadowBlur = r.h * 0.35; ctx.shadowOffsetY = r.h * 0.12;
  rr(ctx, r.x, r.y, r.w, r.h, r.h / 2);
  ctx.fillStyle = g; ctx.fill();
  ctx.restore();
  const a = ajustar(ctx, texto.toUpperCase(), { w: r.w - r.h * 0.9, maxLineas: 1, tam: r.h * 0.36, min: r.h * 0.2, peso: 800, lh: 1 });
  ctx.save();
  ctx.fillStyle = pal.acentoTexto; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = fuente(800, a.tam);
  espaciado(ctx, a.tam * 0.04);
  ctx.fillText(a.lineas[0] || '', r.x + r.w / 2, r.y + r.h / 2 + a.tam * 0.03);
  ctx.restore();
}

// ------------------------------- la pieza -------------------------------
export async function renderizar(canvas: HTMLCanvasElement, p: Pieza, opc: { escala?: number } = {}): Promise<void> {
  const d = disposicion(p.formato);
  const pal = ESTILOS[p.estilo] || ESTILOS.premium;
  const escala = opc.escala && opc.escala > 0 ? opc.escala : 1;
  const [producto, logo, fondoIa] = await Promise.all([
    cargarImagen(p.productoImg), p.logo ? cargarImagen('/logo.png') : Promise.resolve(null), p.fondo === 'ia' ? cargarImagen(p.fondoImg) : Promise.resolve(null), esperarFuentes(),
  ]) as [HTMLImageElement | null, HTMLImageElement | null, HTMLImageElement | null, unknown];

  canvas.width = Math.round(d.W * escala);
  canvas.height = Math.round(d.H * escala);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(escala, 0, 0, escala, 0, 0);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';

  const hayPrecio = p.mostrarPrecio && Number(p.precio) > 0;
  // Sin producto, la zona de la foto lleva el logo grande como emblema.
  const zona: Rect = { ...d.producto };
  if (!hayPrecio && p.formato !== 'banner' && p.formato !== 'horizontal') { zona.h += d.precio.tam * 0.9; }

  // 1) Fondo
  if (p.fondo === 'ia' && fondoIa) fondoFoto(ctx, fondoIa, d.W, d.H, pal, false);
  else if (p.fondo === 'producto' && producto) fondoFoto(ctx, producto, d.W, d.H, pal, true);
  else fondoGradiente(ctx, d.W, d.H, pal, zona);

  // 2) Producto (o emblema)
  let ocupado: Rect = zona;
  if (p.ocultarProducto && fondoIa) { /* la escena ya trae el producto */ }
  else if (producto) ocupado = dibujarProducto(ctx, producto, zona, pal);
  else if (logo) {
    const lado = Math.min(zona.w, zona.h) * 0.72;
    ctx.save(); ctx.globalAlpha = 0.9;
    const x = zona.x + (zona.w - lado) / 2, y = zona.y + (zona.h - lado) / 2;
    ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = lado * 0.1; ctx.shadowOffsetY = lado * 0.04;
    rr(ctx, x, y, lado, lado, lado * 0.2); ctx.clip();
    ctx.drawImage(logo, x, y, lado, lado);
    ctx.restore();
  }

  // 3) Sello de oferta: en la esquina de arriba a la derecha del producto real.
  const sello = { ...d.badge };
  sello.cx = Math.min(d.W - sello.r - 24, Math.max(sello.r + 24, ocupado.x + ocupado.w - sello.r * 0.35));
  sello.cy = Math.max(sello.r + 24, ocupado.y + sello.r * 0.25);
  dibujarSello(ctx, sello, p.etiqueta, pal);

  // 4) Marca
  if (p.logo) dibujarLogo(ctx, logo, d, pal);

  // 5) Titular y subtítulo
  const mayus = p.estilo !== 'claro';
  const ancho = d.titulo.w;
  const titular = ajustar(ctx, mayus ? p.titular.toUpperCase() : p.titular, { w: ancho, maxLineas: d.titulo.lineas, tam: d.titulo.tam, min: d.titulo.min, peso: 800, lh: 1.06 });
  const xTexto = d.titulo.align === 'center' ? d.titulo.x + ancho / 2 : d.titulo.x;
  pintarLineas(ctx, titular, xTexto, d.titulo.y, { peso: 800, color: pal.texto, alinear: d.titulo.align, lh: 1.06, sombra: p.fondo !== 'gradiente' || !pal.claro });
  let yFin = d.titulo.y + titular.alto;
  if (p.subtitulo.trim()) {
    const ySub = yFin + d.sub.tam * 0.4;
    let lineas = d.sub.lineas, sub = ajustar(ctx, p.subtitulo, { w: ancho, maxLineas: lineas, tam: d.sub.tam, min: d.sub.tam * 0.62, peso: 500, lh: 1.25 });
    while (lineas > 1 && ySub + sub.alto > d.sub.limite) { lineas--; sub = ajustar(ctx, p.subtitulo, { w: ancho, maxLineas: lineas, tam: d.sub.tam, min: d.sub.tam * 0.62, peso: 500, lh: 1.25 }); }
    if (ySub + sub.alto <= d.sub.limite + d.sub.tam * 0.6) pintarLineas(ctx, sub, xTexto, ySub, { peso: 500, color: pal.textoSuave, alinear: d.titulo.align, lh: 1.25, sombra: p.fondo !== 'gradiente' });
  }

  // 6) Precio
  if (hayPrecio) {
    const txt = colones(Number(p.precio));
    const a = ajustar(ctx, txt, { w: d.titulo.w, maxLineas: 1, tam: d.precio.tam, min: d.precio.tam * 0.5, peso: 800, lh: 1 });
    pintarLineas(ctx, a, d.precio.x, d.precio.y, { peso: 800, color: pal.claro ? pal.fondoA === '#F7FAFF' ? '#0B2A5B' : pal.texto : pal.acento, alinear: d.precio.align, lh: 1, sombra: !pal.claro });
  }

  // 7) Botón
  if (p.cta.trim()) {
    const r = { ...d.cta };
    if (!hayPrecio) {
      // Sin precio, el botón ocupa su lugar.
      r.y = Math.min(r.y, d.precio.y + d.precio.tam * 0.2);
      if (d.precio.align === 'left') r.x = d.precio.x;
    }
    dibujarBoton(ctx, r, p.cta, pal);
  }

  // 8) Pie
  const pie = [p.pie.trim(), p.telefono.trim() ? `WhatsApp ${p.telefono.trim()}` : ''].filter(Boolean).join('  ·  ');
  if (pie) {
    const a = ajustar(ctx, pie, { w: d.pie.w, maxLineas: 1, tam: d.pie.tam, min: d.pie.tam * 0.6, peso: 600, lh: 1 });
    pintarLineas(ctx, a, d.pie.x, d.pie.y, { peso: 600, color: pal.textoSuave, alinear: d.pie.align, lh: 1, sombra: p.fondo !== 'gradiente' });
  }
}

// ------------------------------- salidas -------------------------------
export function aBlob(canvas: HTMLCanvasElement, tipo: 'image/jpeg' | 'image/png' = 'image/jpeg', calidad = 0.92): Promise<Blob> {
  return new Promise((ok, mal) => {
    try { canvas.toBlob(b => (b ? ok(b) : mal(new Error('No se pudo generar la imagen.'))), tipo, calidad); }
    catch (e) { mal(e instanceof Error ? e : new Error('No se pudo generar la imagen.')); }
  });
}

/** Imagen chica (data URL) para la galería. */
export function miniaturaDe(canvas: HTMLCanvasElement, ancho = 360): string {
  const c = document.createElement('canvas');
  c.width = ancho; c.height = Math.max(1, Math.round(ancho * canvas.height / canvas.width));
  c.getContext('2d')!.drawImage(canvas, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.7);
}

/** La foto del producto, achicada a JPEG, para pedirle a Gemini una escena a partir de ella. */
export async function comprimirReferencia(src: string, lado = 768): Promise<string | null> {
  const img = await cargarImagen(src);
  if (!img) return null;
  const e = Math.min(1, lado / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * e)); c.height = Math.max(1, Math.round(img.height * e));
  const x = c.getContext('2d')!;
  x.fillStyle = '#FFFFFF'; x.fillRect(0, 0, c.width, c.height);
  x.drawImage(img, 0, 0, c.width, c.height);
  try { return c.toDataURL('image/jpeg', 0.86); } catch { return null; }
}

/** Mide cuánto ocupa un data URL (bytes aproximados). */
export const pesoDeDataUrl = (s: string) => Math.round((s.length - s.indexOf(',') - 1) * 0.75);
