// Copia de src/utils/nombresCerebro.ts para la función (Deno no lee src/). Mantener iguales.
// =====================================================================
// CEREBRO DE JARVIS — nombres en lenguaje humano
// =====================================================================
// Lo que Jarvis aprende de internet se guardaba con la búsqueda tal cual
// («site:planetcellcr.com plancha OR separador», «"Planet Group CR" sitio
// web oficial») y en la ficha se veía la dirección cruda. Eso es técnico y
// es de la IA; la persona tiene que ver nombres que entienda:
//
//   site:planetcellcr.com plancha OR separador  →  Plancha y separador · Planet Cell
//   "planetgroupcr.com" cargador usb tipo c      →  Cargador USB tipo C · Planet Group
//   https://encontralo.cr/producto/57540         →  Encontralo (sitio web)
//
// Separación de datos: la etiqueta guardada y la URL siguen en la base
// (la IA las usa); aquí solo se decide CÓMO SE MUESTRAN. El servidor usa la
// misma lógica (supabase/functions/asistente-ia/cerebro.ts) para que lo
// nuevo ya se guarde con nombre limpio.
// =====================================================================

/** Sitios conocidos con su nombre como lo dice la gente. */
const SITIOS: Record<string, string> = {
  planetcellcr: 'Planet Cell', planetgroupcr: 'Planet Group', encontralo: 'Encontralo', extremetechcr: 'Extreme Tech',
  portalmayorista: 'Portal Mayorista', topenergycr: 'Top Energy', youtube: 'YouTube', youtu: 'YouTube', instagram: 'Instagram',
  tiktok: 'TikTok', facebook: 'Facebook', rocketreach: 'RocketReach', tenorshare: 'Tenorshare', unlocktool: 'UnlockTool',
  bccr: 'Banco Central', presidencia: 'Presidencia', gsmarena: 'GSMArena', amazon: 'Amazon', mercadolibre: 'Mercado Libre',
  apple: 'Apple', samsung: 'Samsung', xiaomi: 'Xiaomi', wikipedia: 'Wikipedia', kolbi: 'Kölbi', crhoy: 'CRHoy',
  nacion: 'La Nación', walmart: 'Walmart', ebay: 'eBay', aliexpress: 'AliExpress', reddit: 'Reddit',
};
const PALABRAS_SITIO = ['cell', 'group', 'tech', 'energy', 'store', 'shop', 'mobile', 'movil', 'phone', 'mayorista', 'portal'];

/** «planetcellcr.com» o «https://www.encontralo.cr/x» → «Planet Cell» / «Encontralo». */
export function sitioHumano(dominioOUrl: string): string {
  let host = String(dominioOUrl || '').trim().toLowerCase();
  try { if (/^https?:\/\//.test(host)) host = new URL(host).hostname; } catch { /* no es una URL */ }
  host = host.replace(/^www\./, '').replace(/\/.*$/, '');
  const partes = host.split('.').filter(Boolean);
  if (!partes.length) return '';
  // La parte con nombre: la primera que no sea un TLD corto.
  let base = partes.length > 2 && partes[0].length <= 3 ? partes[1] : partes[0];
  if (SITIOS[base]) return SITIOS[base];
  // «planetcellcr» → «planet cell»: se separan palabras conocidas y se quita «cr» final.
  base = base.replace(/cr$/, '').replace(/-/g, ' ');
  for (const w of PALABRAS_SITIO) base = base.replace(new RegExp(`(?<=[a-z])${w}`, 'g'), ` ${w}`);
  return base.split(' ').filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

const RELLENO = /\b(site|sitio web oficial|sitio oficial|pagina oficial|página oficial|oficial)\b/gi;

/** Una búsqueda cruda → un nombre corto y humano. */
export function limpiarBusqueda(consulta: string): { tema: string; sitio: string } {
  let t = String(consulta || '');
  let sitio = '';
  // site:dominio y dominios sueltos → nombre del sitio
  t = t.replace(/site:\s*([a-z0-9.-]+\.[a-z]{2,})/gi, (_m, d) => { sitio ||= sitioHumano(d); return ' '; });
  t = t.replace(/\bhttps?:\/\/\S+/gi, m => { sitio ||= sitioHumano(m); return ' '; });
  t = t.replace(/"?\b([a-z0-9-]+\.(?:com|cr|net|org|co|io|shop|store)(?:\.[a-z]{2})?)\b"?/gi, (_m, d) => { sitio ||= sitioHumano(d); return ' '; });
  // operadores y adornos de búsqueda
  t = t.replace(/["“”«»]/g, ' ').replace(/\s-\S+/g, ' ').replace(/\b(OR|AND|NOT)\b/g, ',').replace(RELLENO, ' ');
  // «Costa Rica» y «CR» sobran: todo es de aquí.
  t = t.replace(/\bcosta\s+rica\b/gi, ' ').replace(/\bcr\b/gi, ' ');
  // palabras repetidas y comas sobrantes
  const vistas = new Set<string>();
  const palabras = t.split(/\s+/).filter(Boolean).filter(w => {
    const k = w.toLowerCase().replace(/[,;]/g, '');
    if (!k) return true;
    if (vistas.has(k)) return false;
    vistas.add(k); return true;
  });
  t = palabras.join(' ').replace(/\s*,\s*(,\s*)*/g, ', ').replace(/^[,\s]+|[,\s]+$/g, '').replace(/\s+/g, ' ');
  // «a, b, c» → «a, b y c»
  const items = t.split(/\s*,\s*/).filter(Boolean);
  if (items.length > 1) t = `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
  // Siglas comunes en mayúscula
  t = t.replace(/\b(usb|ssd|ram|frp|amd|cpu|gpu|led|lcd|oled|sim|esim|gb|tb)\b/gi, m => m.toUpperCase()).replace(/\btipo c\b/gi, 'tipo C');
  if (t.length > 46) t = t.slice(0, 45).replace(/\s+\S*$/, '') + '…';
  return { tema: t ? t.charAt(0).toUpperCase() + t.slice(1) : '', sitio };
}

/**
 * Cómo se MUESTRA una idea del cerebro. `tipo` y `url` son los de la fila;
 * lo guardado no se toca. Nunca devuelve una URL ni sintaxis de búsqueda.
 */
export function nombreHumano(etiqueta: string, tipo?: string, url?: string | null): string {
  const e = String(etiqueta || '').trim();
  const sinPrefijo = e.replace(/^(Inventario|Taller|Internet) · /, '');
  const prefijo = /^(Inventario|Taller) · /.exec(e)?.[1];
  if (prefijo) return `${sinPrefijo} en ${prefijo.toLowerCase()}`;
  // Lo que aprendió con «aprender tema» ya tiene nombre limpio: solo se dice de dónde.
  if (/^Internet · /.test(e)) { const de = url ? sitioHumano(url) : ''; return de ? `${sinPrefijo} · ${de}` : `${sinPrefijo} (internet)`; }
  const tecnico = /site:|https?:\/\/|"|\bOR\b|\bAND\b|\.[a-z]{2,4}\b/.test(sinPrefijo);
  if (tipo === 'fuente' || tecnico) {
    const { tema, sitio } = limpiarBusqueda(sinPrefijo);
    const de = sitio || (url ? sitioHumano(url) : '');
    // El nombre del sitio no se repite dentro del tema («Planet Group cargadores · Planet Group»).
    let t2 = tema;
    if (de) for (const w of de.split(' ')) t2 = t2.replace(new RegExp(`\\b${w}\\b`, 'gi'), ' ');
    t2 = t2.replace(/\s+/g, ' ').replace(/^[,\s]+|[,\s]+$/g, '').trim();
    if (t2) t2 = t2.charAt(0).toUpperCase() + t2.slice(1);
    if (t2 && de) return `${t2} · ${de}`;
    if (tema && de) return `${tema} · ${de}`;
    if (tema) return tema;
    if (de) return `${de} (sitio web)`;
  }
  return sinPrefijo.length > 48 ? sinPrefijo.slice(0, 47) + '…' : sinPrefijo;
}

/**
 * Lo que devuelve una página de internet trae menús, encabezados y basura
 * («inalambrico Cargador multiplataforma Cargador reloj Cargador Universal…»,
 * «Opens in new window», «Edición Impresa»). Esto se queda solo con frases
 * de verdad, para guardarlas y para mostrarlas.
 */
export function limpiarExtracto(texto: string, max = 220): string {
  const t = String(texto || '').replace(/https?:\/\/\S+/g, ' ').replace(/[#*_>|]+/g, ' ').replace(/Opens in new window|Edici[oó]n Impresa|Ver m[aá]s|Leer m[aá]s|Inicio de sesi[oó]n/gi, ' ');
  const trozos = t.split(/(?<=[.!?])\s+|\s+·\s+|\s{2,}/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const buenos = trozos.filter(s => {
    const w = s.split(' ');
    if (w.length < 3) return false;
    // Un menú: muchas palabras seguidas en Mayúscula, sin comas ni verbos.
    const mayus = w.filter(x => /^[A-ZÁÉÍÓÚÑ]/.test(x)).length / w.length;
    if (w.length >= 7 && mayus > 0.45 && !/,/.test(s)) return false;
    // Palabras repetidas una y otra vez (listas de categorías).
    const unicas = new Set(w.map(x => x.toLowerCase())).size / w.length;
    return !(w.length >= 8 && unicas < 0.7);
  });
  let r = buenos.join(' ').replace(/\s+/g, ' ').trim();
  if (r.length > max) r = r.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
  return r;
}
