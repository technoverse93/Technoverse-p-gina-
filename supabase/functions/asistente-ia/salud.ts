// =====================================================================
// SALUD DE JARVIS — ¿está respondiendo bien?
// =====================================================================
// Cada respuesta deja una fila en `jarvis_eventos`:
//   · quién respondió y cuánto tardó (en empezar a escribir y en terminar);
//   · qué IAs fallaron antes y por qué;
//   · si el revisor la aprobó o la corrigió.
// Todos los días a las 6:45 a. m. se prueba cada IA y cada herramienta con
// un pedido mínimo. Si algo se cayó, Jarvis avisa, y el resumen de la
// mañana lo menciona. El panel (Ajustes → Salud de Jarvis) lo resume todo.
// Ver supabase/migracion_jarvis_salud.sql.
// =====================================================================

type Db = any;

export type Evento = {
  user_id?: string | null; tipo: 'respuesta' | 'sin_servicio' | 'error' | 'prueba'; componente?: string | null;
  modo?: string | null; perfil?: string | null; proveedor?: string | null; modelo?: string | null; ok: boolean;
  ms?: number | null; primer_ms?: number | null; ia_ms?: number | null; revision?: string | null; revisor?: string | null;
  fallos?: string[]; herramientas?: string[]; tokens?: number | null; detalle?: string | null;
};
/** Una prueba: `componente` es «ia:groq», «ia:principal», «internet», «paginas», «vectores» o «base». */
export type Prueba = { componente: string; modelo?: string; ok: boolean; ms: number; detalle: string };

const FALTA = /does not exist|relation|schema cache|could not find/i;
const NOMBRES: Record<string, string> = {
  'ia:principal': 'IA principal', 'ia:gemini': 'Gemini', 'ia:groq': 'Groq', 'ia:cerebras': 'Cerebras', 'ia:openrouter': 'OpenRouter',
  'ia:sambanova': 'SambaNova', 'ia:nvidia': 'NVIDIA', 'ia:mistral': 'Mistral', 'ia:cloudflare': 'Cloudflare', 'ia:huggingface': 'Hugging Face',
  'ia:gemma': 'Gemma', 'ia:cerebro': 'Su cerebro (sin IA)', 'ia:local': 'Servidor propio',
  internet: 'Búsqueda en internet', paginas: 'Entrar a páginas', vectores: 'Memoria por ideas', base: 'Datos del negocio',
};
export const nombreComponente = (c: string) => NOMBRES[c] || c.replace(/^ia:/, '');

const diaCR = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica' }).format(d);
const mediana = (xs: number[]) => { const s = xs.filter(n => n > 0).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
/** «Cerebras · gpt-oss-120b: 429 …» → «cerebras»; «Gemini flash-latest: …» → «gemini». */
const quienFallo = (f: string) => {
  const q = f.slice(0, Math.max(0, f.indexOf(': ')) || f.length);
  return (q.includes(' · ') ? q.split(' · ')[0] : q.split(' ')[0]).toLowerCase().replace(/[^a-z]/g, '');
};
const porQue = (f: string) => (f.indexOf(': ') >= 0 ? f.slice(f.indexOf(': ') + 2) : f).trim().slice(0, 140);

/** Anota uno o varios eventos. Nunca frena ni rompe una respuesta. */
export async function registrar(admin: Db, ev: Evento | Evento[]): Promise<void> {
  try {
    const filas = (Array.isArray(ev) ? ev : [ev]).map(e => ({
      ...e,
      fallos: [...new Set(e.fallos || [])].slice(0, 12).map(f => String(f).slice(0, 200)),
      herramientas: [...new Set(e.herramientas || [])].slice(0, 12),
      detalle: e.detalle ? String(e.detalle).slice(0, 500) : null,
    }));
    if (!filas.length) return;
    const { error } = await admin.from('jarvis_eventos').insert(filas);
    if (error && !FALTA.test(error.message)) console.log(`salud: no se anotó: ${error.message}`);
  } catch { /* la salud nunca frena a Jarvis */ }
}

export const eventoDePrueba = (p: Prueba): Evento => ({ tipo: 'prueba', componente: p.componente, modelo: p.modelo || null, ok: p.ok, ms: p.ms, detalle: p.detalle });

/** El informe del panel: últimas 24 h, cada IA (7 días), las pruebas y lo último que falló. */
export async function informe(admin: Db): Promise<Record<string, unknown>> {
  const hace7 = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [ev, pr] = await Promise.all([
    admin.from('jarvis_eventos').select('creado_en,tipo,proveedor,modelo,ok,ms,primer_ms,ia_ms,revision,revisor,fallos,detalle')
      .neq('tipo', 'prueba').gte('creado_en', hace7).order('creado_en', { ascending: false }).limit(3000),
    admin.from('jarvis_eventos').select('creado_en,componente,modelo,ok,ms,detalle').eq('tipo', 'prueba').order('creado_en', { ascending: false }).limit(120),
  ]);
  if (ev.error) return FALTA.test(ev.error.message) ? { ok: true, falta: true } : { ok: false, error: ev.error.message };
  const filas = (ev.data || []) as any[];
  const corte = Date.now() - 86_400_000;
  const de24 = filas.filter(f => new Date(f.creado_en).getTime() >= corte);
  const bien24 = de24.filter(f => f.tipo === 'respuesta');
  const revisadas = bien24.filter(f => f.revision);
  const hoy = {
    total: de24.length, bien: bien24.length,
    sinServicio: de24.filter(f => f.tipo === 'sin_servicio').length, errores: de24.filter(f => f.tipo === 'error').length,
    empieza: mediana(bien24.map(f => Number(f.primer_ms || 0))), termina: mediana(bien24.map(f => Number(f.ms || 0))),
    revisadas: revisadas.length, corregidas: revisadas.filter(f => f.revision === 'corregida').length,
    conTropiezos: bien24.filter(f => (f.fallos || []).length).length,
  };

  // La última prueba de cada cosa.
  const ultima = new Map<string, any>();
  for (const p of (pr.data || []) as any[]) if (!ultima.has(p.componente)) ultima.set(p.componente, p);
  const prueba = (c: string) => { const p = ultima.get(c); return p ? { ok: !!p.ok, ms: p.ms, detalle: p.detalle, modelo: p.modelo, cuando: p.creado_en } : null; };

  // Cada IA en 7 días: cuántas respondió, cuántas veces falló y por qué.
  type Ia = { id: string; respondio: number; fallos: number; ms: number[]; ultimoError: string; ultimoErrorEn: string };
  const ias = new Map<string, Ia>();
  const de = (id: string) => { let x = ias.get(id); if (!x) { x = { id, respondio: 0, fallos: 0, ms: [], ultimoError: '', ultimoErrorEn: '' }; ias.set(id, x); } return x; };
  for (const f of filas) {
    if (f.tipo === 'respuesta' && f.proveedor) { const x = de(String(f.proveedor)); x.respondio++; if (f.ia_ms) x.ms.push(Number(f.ia_ms)); }
    for (const fa of (f.fallos || []) as string[]) {
      const id = quienFallo(fa); if (!id) continue;
      const x = de(id); x.fallos++;
      if (!x.ultimoError) { x.ultimoError = porQue(fa); x.ultimoErrorEn = f.creado_en; }
    }
  }
  for (const c of ultima.keys()) if (c.startsWith('ia:')) de(c.slice(3));
  const listaIas = [...ias.values()].map(x => ({
    id: x.id, nombre: nombreComponente(`ia:${x.id}`), respondio: x.respondio, fallos: x.fallos, ms: mediana(x.ms),
    ultimoError: x.ultimoError, ultimoErrorEn: x.ultimoErrorEn || null, prueba: prueba(`ia:${x.id}`),
  })).sort((a, b) => b.respondio - a.respondio || b.fallos - a.fallos || a.nombre.localeCompare(b.nombre));

  const herramientas = ['internet', 'paginas', 'vectores', 'base'].map(c => ({ id: c, nombre: nombreComponente(c), prueba: prueba(c) })).filter(h => h.prueba);

  // Los 7 días: respuestas bien y mal.
  const dias: { dia: string; bien: number; mal: number }[] = [];
  for (let i = 6; i >= 0; i--) dias.push({ dia: diaCR(new Date(Date.now() - i * 86_400_000)), bien: 0, mal: 0 });
  for (const f of filas) { const d = dias.find(x => x.dia === diaCR(new Date(f.creado_en))); if (d) { if (f.tipo === 'respuesta') d.bien++; else d.mal++; } }

  const problemas = filas.filter(f => f.tipo !== 'respuesta').slice(0, 8).map(f => ({
    cuando: f.creado_en, tipo: f.tipo,
    texto: f.tipo === 'error' ? `Error: ${String(f.detalle || 'desconocido').slice(0, 160)}` : (f.fallos || []).length ? `Ninguna IA respondió · ${(f.fallos as string[]).slice(0, 3).join(' · ')}` : 'Ninguna IA respondió',
  }));

  const pruebasMal = [...ultima.values()].filter(p => !p.ok);
  const iasProbadas = [...ultima.values()].filter(p => String(p.componente).startsWith('ia:'));
  const pct = hoy.total ? hoy.bien / hoy.total : 1;
  const estado = (hoy.total >= 3 && pct < 0.8) || (iasProbadas.length && iasProbadas.every(p => !p.ok)) || pruebasMal.some(p => p.componente === 'base')
    ? 'mal' : pruebasMal.length || hoy.sinServicio || hoy.errores ? 'atencion' : 'bien';
  const fechas = [...ultima.values()].map(p => String(p.creado_en)).sort();
  return { ok: true, estado, hoy, ias: listaIas, herramientas, dias, problemas, ultimaPrueba: fechas[fechas.length - 1] || null };
}

/** Una línea para el resumen de la mañana («Salud de Jarvis: …»). */
export async function lineaSalud(admin: Db): Promise<string> {
  const r = await informe(admin).catch(() => null) as any;
  if (!r?.ok || r.falta) return '';
  const ias = (r.ias || []).filter((x: any) => x.prueba);
  const malas = [...ias.filter((x: any) => !x.prueba.ok).map((x: any) => x.nombre), ...(r.herramientas || []).filter((h: any) => !h.prueba.ok).map((h: any) => h.nombre)];
  return `Salud de Jarvis: ${r.hoy.bien} respuesta${r.hoy.bien === 1 ? '' : 's'} en 24 h`
    + (r.hoy.sinServicio ? `, ${r.hoy.sinServicio} sin servicio` : '')
    + (ias.length ? `; en la prueba de hoy ${ias.length - ias.filter((x: any) => !x.prueba.ok).length} de ${ias.length} IAs respondieron` : '')
    + (malas.length ? `; fallan: ${malas.join(', ')}` : '; todo funciona') + '.';
}

/** Los avisos que deja la prueba diaria (uno por día, con lo que falló). */
export function avisosDePrueba(pruebas: Prueba[], dia = diaCR()): { tipo: string; clave: string; titulo: string; cuerpo: string; nivel: 'info' | 'atencion' | 'urgente' }[] {
  const malas = pruebas.filter(p => !p.ok);
  if (!malas.length) return [];
  const ias = pruebas.filter(p => p.componente.startsWith('ia:'));
  const iasMal = ias.filter(p => !p.ok);
  const otras = malas.filter(p => !p.componente.startsWith('ia:'));
  const nivel = (ias.length && iasMal.length === ias.length) || otras.some(p => p.componente === 'base') ? 'urgente'
    : otras.length || iasMal.length * 2 >= ias.length ? 'atencion' : 'info';
  const titulo = ias.length && iasMal.length === ias.length ? 'Ninguna IA respondió en la prueba de hoy'
    : `Falla${malas.length === 1 ? '' : 'n'}: ${malas.map(p => nombreComponente(p.componente)).join(', ')}`;
  const cuerpo = malas.map(p => `${nombreComponente(p.componente)}${p.modelo ? ` (${String(p.modelo).split('/').pop()})` : ''}: ${p.detalle}`).join(' · ')
    + (iasMal.length && iasMal.length < ias.length ? ` · Las otras ${ias.length - iasMal.length} IAs responden, así que sigo funcionando.` : '')
    + (malas.some(p => /401|403|clave|key/i.test(p.detalle)) ? ' Revisá la clave en Supabase → Edge Functions → Secrets.' : '');
  return [{ tipo: 'salud', clave: `salud:${dia}`, titulo: titulo.slice(0, 110), cuerpo, nivel }];
}
