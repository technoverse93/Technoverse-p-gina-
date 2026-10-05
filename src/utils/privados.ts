// =====================================================================
// CARRIL PRIVADO DE JARVIS (lo usan AsistenteIA y el mini-widget)
// =====================================================================
/**
 * Carril privado de Jarvis: cédulas, correos y teléfonos que escriba el
 * superadmin se sacan del texto ANTES de mandarlo. La IA (Google) solo ve
 * marcas como [CÉDULA·1]; los datos van aparte y solo los usan las tarjetas.
 */
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
    .replace(/[^\s@\[\]]+@[^\s@]+\.[a-z]{2,}/gi, m => marcar('CORREO', m))
    .replace(/\b\d-?\d{4}-?\d{4}\b|\b\d{9,12}\b/g, m => marcar('CÉDULA', m.replace(/\D/g, '')))
    .replace(/(?:\+?506[\s-]?)?\b[2-8]\d{3}[\s-]?\d{4}\b/g, m => marcar('TEL', m.replace(/\D/g, '').slice(-8)));
  return { texto, privados };
}

/** Pone de vuelta los datos reales en lugar de las marcas ([CÉDULA·1]…). */
export function restaurarPrivados(t: string, privados: Record<string, string>): string {
  return t.replace(/\[([A-ZÉ]+·\d+)\]/g, (m, k: string) => privados[k] ?? m);
}
