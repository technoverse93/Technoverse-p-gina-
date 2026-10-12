// =====================================================================
// FORMATO DE UNA LÍNEA DEL CHAT: negrita, código y enlaces
// =====================================================================
// Parte el texto de una línea en trozos que el chat dibuja distinto. Solo
// se vuelven enlace las direcciones http/https (nunca «javascript:» u otros):
// «[texto](https://…)» o la dirección suelta, como la del Pull Request que
// deja Phill. La puntuación del final («…/pull/7.») no forma parte del enlace.
// =====================================================================

export type ParteLinea =
  | { tipo: 'texto' | 'negrita' | 'codigo'; texto: string }
  | { tipo: 'enlace'; texto: string; url: string; cola: string };

const PARTIR = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]\n]{1,120}\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<>]+)/g;
const ENLACE_MD = /^\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)$/;
const DIRECCION = /^(.*?)([.,;:!?)»”'"\]]*)$/;

export function partirLinea(t: string): ParteLinea[] {
  const partes: ParteLinea[] = [];
  for (const p of t.split(PARTIR)) {
    if (!p) continue;
    if (p.startsWith('**') && p.endsWith('**') && p.length > 4) { partes.push({ tipo: 'negrita', texto: p.slice(2, -2) }); continue; }
    if (p.startsWith('`') && p.endsWith('`') && p.length > 2) { partes.push({ tipo: 'codigo', texto: p.slice(1, -1) }); continue; }
    const md = ENLACE_MD.exec(p);
    if (md) { partes.push({ tipo: 'enlace', texto: md[1], url: md[2], cola: '' }); continue; }
    if (/^https?:\/\//.test(p)) {
      const m = DIRECCION.exec(p) as RegExpExecArray;
      if (m[1].length > 8) { partes.push({ tipo: 'enlace', texto: m[1], url: m[1], cola: m[2] }); continue; }
    }
    partes.push({ tipo: 'texto', texto: p });
  }
  return partes;
}
