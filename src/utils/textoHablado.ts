// =====================================================================
// TEXTO HABLADO — de markdown a lo que se dice en voz alta
// =====================================================================
// Lógica pura (sin navegador): la usan el lector de voz y el flujo que habla
// mientras la respuesta todavía llega (ver flujoVoz.ts), y se prueba aparte.
// =====================================================================

export const MAX_CARACTERES = 1800;
/**
 * Tope de lo que se dice solo, sin que nadie lo pida (la respuesta a una pregunta hecha por voz):
 * unas dos o tres oraciones, ~20 s. Lo demás queda escrito en pantalla.
 */
export const MAX_CARACTERES_AL_RESPONDER = 360;

/** Limpia UNA pieza de texto: sin símbolos de formato, enlaces ni emojis, con «colones». */
export function limpiarInline(t: string): string {
  return String(t || '')
    .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, '$1')               // [texto](enlace) → texto
    .replace(/https?:\/\/\S+/g, ' ')                           // enlaces sueltos
    .replace(/\[[A-ZÉ]+·\d+\]/g, ' ')                          // marcas del carril privado
    .replace(/^#{1,6}\s*/gm, '')                               // títulos
    .replace(/^\s*>\s?/gm, '')                                 // citas
    .replace(/^\s*[-*•]\s+/gm, '')                             // viñetas
    .replace(/^\s*(\d+)[.)]\s+/gm, '$1. ')                     // listas numeradas
    .replace(/[*_~`]+/g, '')                                   // negritas, cursivas, código
    .replace(/₡\s?([\d.,\s]*\d)/g, (_m, n: string) => `${n.replace(/\s+/g, ' ').trim()} colones`)
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[ \t]+/g, ' ');
}

/** El texto completo tal como se dice: sin formato, sin enlaces y sin tablas ni código (avisa que están en pantalla). */
export function paraHablar(md: string): string {
  let t = String(md || '');
  let tabla = false, codigo = false;
  t = t.replace(/```[\s\S]*?```/g, () => { codigo = true; return ' '; });
  t = t.split('\n').filter(l => { if (/^\s*\|.*\|\s*$/.test(l)) { tabla = true; return false; } return true; }).join('\n');
  t = limpiarInline(t).replace(/\n{2,}/g, '\n').trim();
  if (t.length > MAX_CARACTERES) {
    const corte = t.lastIndexOf('.', MAX_CARACTERES);
    t = `${t.slice(0, corte > 400 ? corte + 1 : MAX_CARACTERES)} El resto lo tenés en pantalla.`;
  }
  if (tabla) t += ' Te dejé una tabla en pantalla.';
  if (codigo) t += ' Te dejé un bloque de código en pantalla.';
  return t;
}

const ABREVIATURAS = /(?:^|[\s(¿¡"«])(?:sr|sra|srta|dr|dra|lic|ing|arq|av|tel|etc|vs|núm|num|pág|pag|aprox|ej|pbro|sto|sta)$/i;
const TERMINADOR = /[.!?…:;]/;

/**
 * ¿El carácter `i` cierra una oración? Tiene que ser un punto (o ?, !, …, :, ;)
 * con un espacio o salto detrás —así «3.5» y «₡12.500» no se parten— y no una
 * abreviatura («Sr.», «Dra.», «etc.») ni los primeros puntos de «...».
 */
export function esFinDeOracion(t: string, i: number): boolean {
  if (i < 0 || i >= t.length - 1 || !TERMINADOR.test(t[i]) || !/\s/.test(t[i + 1])) return false;
  if (t[i] === '.') {
    if (t[i + 1] === '.') return false;
    if (ABREVIATURAS.test(t.slice(Math.max(0, i - 6), i))) return false;
  }
  return true;
}

/** Oraciones de hasta ~220 caracteres (las largas se parten en las comas). */
export function enOraciones(t: string): string[] {
  const base: string[] = [];
  let ini = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '\n') { base.push(t.slice(ini, i)); ini = i + 1; }
    else if (esFinDeOracion(t, i)) { base.push(t.slice(ini, i + 1)); ini = i + 1; }
  }
  base.push(t.slice(ini));
  const out: string[] = [];
  for (const o of base.map(x => x.trim()).filter(Boolean)) {
    if (o.length <= 220) { out.push(o); continue; }
    let resto = o;
    while (resto.length > 220) {
      const c = resto.lastIndexOf(',', 220);
      const i = c > 60 ? c + 1 : 220;
      out.push(resto.slice(0, i).trim()); resto = resto.slice(i).trim();
    }
    if (resto) out.push(resto);
  }
  return out;
}
