// =====================================================================
// HUELLA DEL APARATO — para alimentar el Kill Switch
// =====================================================================
// El bloqueo por "modelo" alcanza a TODOS los equipos de ese modelo. Esta
// huella, en cambio, identifica UN aparato físico concreto, para poder
// bloquear exactamente ese y ninguno más.
//
//   · APK  → identidad NATIVA: fabricante + modelo exacto + el id de
//            instalación que da @capacitor/device. En Android ese id es
//            estable mientras no se reinstale/reset de fábrica; es lo más
//            cercano a un "id de hardware" que el sistema deja ver sin
//            permisos especiales (Google ya no expone el IMEI a las apps).
//   · Web  → un hash de rasgos del navegador y del hardware: dibujo en
//            canvas, tarjeta de vídeo (WebGL), pantalla, núcleos, memoria,
//            zona horaria e idioma. No es único garantizado, pero junta
//            suficientes rasgos para distinguir un equipo de otro.
//
// HONESTIDAD, PORQUE IMPORTA PARA LO QUE SE USA:
// La huella la CALCULA y la MANDA el propio aparato. Sirve para reconocer
// a un equipo normal y cortarle el paso —que es el caso real—, pero un
// atacante decidido puede alterar su navegador para cambiarla. Contra eso
// la barrera de verdad sigue siendo la RLS del servidor y el bloqueo por
// cuenta e IP, que el aparato no controla. No debe venderse como un
// candado de hardware infalsificable: no existe tal cosa desde la web.
// =====================================================================

import { Capacitor } from '@capacitor/core';

export interface HuellaAparato {
  /** El id para el Kill Switch: `apk:...` o `web:...`. */
  huella: string;
  /** Modelo lo más exacto posible (ej. "Honor Pad SE", "iPhone 13"). */
  modelo: string;
  /** Fabricante, cuando se puede saber (ej. "HONOR", "Apple"). */
  fabricante: string;
}

let cache: HuellaAparato | null = null;

/** Hash corto y estable (FNV-1a) de una cadena de rasgos. */
function hash(texto: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Dibujo en canvas: el mismo texto se renderiza distinto según GPU/drivers. */
function rasgoCanvas(): string {
  try {
    const c = document.createElement('canvas');
    c.width = 240; c.height = 60;
    const ctx = c.getContext('2d');
    if (!ctx) return '';
    ctx.textBaseline = 'top';
    ctx.font = "14px 'Arial'";
    ctx.fillStyle = '#f60';
    ctx.fillRect(0, 0, 120, 30);
    ctx.fillStyle = '#069';
    ctx.fillText('Technoverse ☁ fp', 2, 15);
    ctx.fillStyle = 'rgba(102,204,0,0.7)';
    ctx.fillText('Technoverse ☁ fp', 4, 17);
    return c.toDataURL();
  } catch { return ''; }
}

/** Tarjeta de vídeo, vía WebGL: distingue familias de hardware. */
function rasgoWebGL(): string {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl') || c.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) return '';
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const rend = dbg ? gl.getParameter((dbg as any).UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const vend = dbg ? gl.getParameter((dbg as any).UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
    return `${vend}~${rend}`;
  } catch { return ''; }
}

async function huellaWeb(): Promise<HuellaAparato> {
  const n: any = typeof navigator !== 'undefined' ? navigator : {};
  const partes = [
    n.userAgent || '',
    n.language || '',
    (n.languages || []).join(','),
    `${screen?.width || 0}x${screen?.height || 0}x${screen?.colorDepth || 0}`,
    String(window?.devicePixelRatio || 1),
    String(n.hardwareConcurrency || 0),
    String(n.deviceMemory || 0),
    (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } })(),
    n.platform || '',
    rasgoWebGL(),
    rasgoCanvas(),
  ];
  // Modelo aproximado desde el UA, para que el panel muestre algo legible.
  let modelo = 'Equipo web';
  try {
    const ua = n.userAgent || '';
    const m = ua.match(/\(([^)]+)\)/);
    if (m) modelo = m[1].split(';').map((s: string) => s.trim())[0] || modelo;
  } catch { /* da igual */ }
  return { huella: `web:${hash(partes.join('|'))}`, modelo, fabricante: '' };
}

async function huellaNativa(): Promise<HuellaAparato> {
  const { Device } = await import('@capacitor/device');
  const [info, id] = await Promise.all([Device.getInfo(), Device.getId()]);
  const identificador = (id as any)?.identifier || (id as any)?.uuid || '';
  const modelo = (info.model || '').trim() || 'Aparato';
  const fabricante = (info.manufacturer || '').trim();
  // La identidad nativa NO necesita hash: ya es un id estable del sistema.
  return {
    huella: `apk:${fabricante}:${modelo}:${identificador}`.replace(/\s+/g, '_'),
    modelo,
    fabricante,
  };
}

/**
 * Devuelve la huella del aparato. Se calcula una vez y se cachea: no
 * cambia mientras la app está abierta. Nunca lanza —si algo falla, cae a
 * la huella web, que siempre se puede calcular.
 */
export async function obtenerHuellaAparato(): Promise<HuellaAparato> {
  if (cache) return cache;
  try {
    cache = Capacitor.isNativePlatform() ? await huellaNativa() : await huellaWeb();
  } catch {
    try { cache = await huellaWeb(); }
    catch { cache = { huella: 'web:desconocido', modelo: 'Aparato', fabricante: '' }; }
  }
  return cache;
}
