// =====================================================================
// CARRIL PRIVADO en el servidor — lo mismo que hace el panel con el texto
// =====================================================================
// FALLO CORREGIDO: lo dictado por VOZ se transcribe aquí, en el servidor,
// y no pasaba por el separador del panel. La cédula y el correo le
// llegaban crudos a la IA, y la tarjeta de cobro los metía todos juntos en
// «Cliente» («Javier Chinchilla 119590373 chinchilla…») con «Número» vacío.
// Ahora lo dictado se normaliza («arroba» → @, dígitos sueltos juntos) y se
// separa en marcas [CÉDULA·1], [CORREO·1], [TEL·1] igual que lo escrito.
// =====================================================================

/** Lo dictado a su forma escrita: correos y números sin espacios. */
export function normalizarDictado(t: string): string {
  let s = t;
  // «1 1 9 5 9 0 3 7 3» / «1-1959-0373» → 119590373 (8 a 12 dígitos).
  s = s.replace(/\b\d(?:[\s.-]?\d){7,11}\b/g, m => m.replace(/[\s.-]/g, ''));
  // «juan punto perez arroba gmail punto com» → juan.perez@gmail.com
  s = s.replace(/\s*\b(arroba)\b\s*/gi, '@');
  s = s.replace(/\s+@|@\s+/g, '@');
  for (let i = 0; i < 3; i++) s = s.replace(/(@[\w.-]+?)\s*(?:\bpunto\b|\.)\s*(com|net|org|cr|es|co|edu|go|ac|fi|info|io|me)\b/gi, '$1.$2');
  s = s.replace(/([\w.-]+)\s+(?:punto)\s+([\w.-]+@)/gi, '$1.$2');
  s = s.replace(/([\w.-]+)\s+gui[oó]n bajo\s+([\w.-]+@)/gi, '$1_$2');
  return s;
}

/** Saca correos, cédulas y teléfonos del texto y deja marcas en su lugar. */
export function separarPrivados(t: string, previos: Record<string, string>): { texto: string; privados: Record<string, string> } {
  const privados = { ...previos };
  const cuenta: Record<string, number> = {};
  for (const k of Object.keys(previos)) { const [p, n] = k.split('·'); cuenta[p] = Math.max(cuenta[p] || 0, Number(n) || 0); }
  const marcar = (pref: string, valor: string) => {
    const ya = Object.entries(privados).find(([k, v]) => k.startsWith(pref) && v === valor);
    if (ya) return `[${ya[0]}]`;
    cuenta[pref] = (cuenta[pref] || 0) + 1;
    const k = `${pref}·${cuenta[pref]}`; privados[k] = valor; return `[${k}]`;
  };
  const texto = t
    .replace(/[^\s@\[\]]+@[^\s@]+\.[a-z]{2,}/gi, m => marcar('CORREO', m.replace(/[.,;:]+$/, '').toLowerCase()))
    .replace(/\b\d-?\d{4}-?\d{4}\b|\b\d{9,12}\b/g, m => marcar('CÉDULA', m.replace(/\D/g, '')))
    .replace(/(?:\+?506[\s-]?)?\b[2-8]\d{3}[\s-]?\d{4}\b/g, m => marcar('TEL', m.replace(/\D/g, '').slice(-8)));
  return { texto, privados };
}

/** Las marcas de vuelta a su valor (para mostrarle a la persona lo que dijo). */
export function restaurarPrivados(t: string, privados: Record<string, string>): string {
  return t.replace(/\[([A-ZÉ]+·\d+)\]/g, (m, k) => privados[k] ?? m);
}
