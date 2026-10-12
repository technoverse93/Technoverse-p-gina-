// =====================================================================
// EL CEREBRO DE JAVIER, SIN INTERNET
// =====================================================================
// Pedido del dueño (2026-10-12): «que pueda funcionar fuera de línea, con lo
// que ya buscó, lo que ya aprendió y lo que ya se corrigió». El teléfono se
// lleva una copia de lo que Javier sabe (respuestas aprendidas, datos del
// negocio y de su propio código) y, si no hay conexión, contesta con eso.
//
// Lo honesto: sin internet Javier no PIENSA nada nuevo (las IAs están del
// otro lado); devuelve lo que ya sabe, buscando lo más parecido a la pregunta.
// Se actualiza solo cada vez que Javier abre con internet (como mucho cada
// 6 horas). Nada de clientes: el cerebro nunca guarda datos personales.
// =====================================================================

import { supabase } from '../supabaseClient';

type Nota = { tipo: string; tema: string; texto: string; fuente: string | null };
type Copia = { notas: Nota[]; generado: string; bajado: number };

const CLAVE = 'tv_cerebro_offline';
const CADA_MS = 6 * 3600_000;

function leer(): Copia | null {
  try { const c = JSON.parse(localStorage.getItem(CLAVE) || 'null'); return c && Array.isArray(c.notas) ? c : null; } catch { return null; }
}

/** ¿Cuántas cosas sabe sin internet y de cuándo es la copia? */
export function estadoCopia(): { notas: number; bajado: number | null } {
  const c = leer();
  return { notas: c?.notas.length || 0, bajado: c?.bajado || null };
}

/** Baja (o renueva) la copia del cerebro. Silencioso: si falla, queda la que había. */
export async function actualizarCopia(forzar = false): Promise<boolean> {
  const c = leer();
  if (!forzar && c && Date.now() - c.bajado < CADA_MS) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  try {
    const { data, error } = await supabase.functions.invoke('asistente-ia', { body: { accion: 'cerebro_offline', max: 800 } });
    if (error || !data?.ok || !Array.isArray(data.notas)) return false;
    const copia: Copia = { notas: data.notas, generado: String(data.generado || ''), bajado: Date.now() };
    localStorage.setItem(CLAVE, JSON.stringify(copia));
    return true;
  } catch { return false; }
}

const VACIAS = new Set(['el', 'la', 'los', 'las', 'de', 'del', 'que', 'en', 'un', 'una', 'unos', 'unas', 'por', 'para', 'con', 'como', 'se', 'al', 'lo', 'es', 'no', 'mi', 'tu', 'su', 'me', 'te', 'le', 'y', 'o', 'a', 'cual', 'donde', 'esta', 'este', 'esto', 'eso', 'hay', 'tengo', 'tiene', 'decime', 'dime', 'javier', 'phill', 'oye', 'hola', 'porfa', 'favor', 'sobre', 'cuál', 'qué', 'cómo', 'mas', 'más']);
const plano = (t: string) => t.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
const palabras = (t: string) => plano(t).split(/[^a-z0-9ñ]+/).filter(w => w.length >= 3 && !VACIAS.has(w));
const raiz = (w: string) => (w.length > 5 ? w.slice(0, w.length - 2) : w);

/**
 * La respuesta sin internet: la respuesta aprendida más parecida o, si no hay, los datos que
 * más tienen que ver. Null si no sabe nada de eso.
 */
export function responderSinConexion(pregunta: string): string | null {
  const c = leer();
  const qs = [...new Set(palabras(pregunta).map(raiz))];
  if (!c?.notas.length || !qs.length) return null;
  // Cuántas notas tienen cada palabra (las raras pesan más).
  const df = new Map<string, number>();
  const textos = c.notas.map(n => plano(`${n.tema} ${n.texto}`));
  for (const q of qs) df.set(q, textos.filter(t => t.includes(q)).length);
  const N = c.notas.length;
  const puntuadas = c.notas.map((n, i) => {
    const tema = plano(n.tema), todo = textos[i];
    let puntos = 0, cubre = 0;
    for (const q of qs) {
      const peso = Math.log(1 + N / (1 + (df.get(q) || 0)));
      if (tema.includes(q)) { puntos += peso * 2; cubre++; } else if (todo.includes(q)) { puntos += peso; cubre++; }
    }
    return { n, puntos: puntos * (n.tipo === 'respuesta' ? 1.4 : 1), cubre: cubre / qs.length };
  }).filter(x => x.puntos > 0).sort((a, b) => b.puntos - a.puntos);
  const mejor = puntuadas[0];
  if (!mejor) return null;
  if (mejor.n.tipo === 'respuesta' && mejor.cubre >= 0.6) {
    return `${mejor.n.texto}\n\n_Sin conexión: te lo digo de mi cerebro (lo que ya sabía)._`;
  }
  const datos = puntuadas.filter(x => x.cubre >= 0.5).slice(0, 3);
  if (!datos.length) return null;
  return `Sin conexión, esto es lo que tengo en mi cerebro sobre eso:\n${datos.map(d => `- ${d.n.texto}`).join('\n')}\n\n_Cuando vuelva internet lo puedo revisar a fondo._`;
}
