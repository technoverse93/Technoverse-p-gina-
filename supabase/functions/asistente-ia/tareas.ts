// =====================================================================
// TAREAS EN SEGUNDO PLANO — encargos que Phill hace solo
// =====================================================================
// «Investigá los precios de los cargadores y decime a cuánto conviene
// venderlos»: Phill lo deja como un ENCARGO (tabla jarvis_tareas, ver
// supabase/migracion_jarvis_tareas.sql), lo hace por su cuenta aunque la app
// esté cerrada y avisa al terminar (notificación + el resultado en el chat).
//
// CÓMO TRABAJA
//   1. Planifica: parte el encargo en 1 a 5 pasos concretos.
//   2. Hace cada paso con las consultas de solo lectura (inventario, ventas,
//      taller, internet…), con lo ya averiguado a la vista; el avance se guarda
//      después de cada paso, así si la función se corta otra pasada retoma.
//   3. Redacta el informe final y avisa.
// Arranca en el acto al pedirlo y una tarea programada (cada 2 min) retoma lo
// pendiente o lo que se cortó a medias (la «llave» bloqueada_hasta evita que
// dos pasadas trabajen lo mismo). En segundo plano NO se modifica nada.
//
// Este módulo es solo la orquestación: la IA se le pasa como `MotorTareas`
// (así se prueba sin red y no depende del resto de la función).
// =====================================================================

// deno-lint-ignore no-explicit-any
type Db = any;

export type EstadoTarea = 'pendiente' | 'corriendo' | 'lista' | 'error' | 'cancelada';
export interface PasoPlan { n: number; objetivo: string; estado: 'pendiente' | 'hecho' | 'fallo'; resultado?: string; ms?: number }
export interface Tarea {
  id: string; user_id: string; conversacion_id: string | null; titulo: string; instruccion: string;
  estado: EstadoTarea; plan: PasoPlan[]; resultado: string | null; error: string | null; intentos: number;
}

export interface MotorTareas {
  /** Parte el encargo en pasos. `null` si no se pudo (entonces el encargo entero es un solo paso). */
  planificar(instruccion: string): Promise<{ titulo?: string; pasos: string[] } | null>;
  /** Hace UN paso con las consultas de solo lectura. Devuelve lo averiguado, o `null` si no pudo. */
  correrPaso(objetivo: string, contexto: string, limiteMs: number, instruccion?: string): Promise<string | null>;
  /** El informe final para el dueño (markdown corto). `null` si no se pudo: se arma uno simple. */
  redactar(instruccion: string, pasos: PasoPlan[]): Promise<string | null>;
  /** Terminó (bien o mal): el mensaje en el chat, el aviso y la notificación. */
  terminado(t: Tarea, texto: string, ok: boolean): Promise<void>;
}

/** Cuánto trabaja una pasada (la tarea programada espera hasta 120 s). */
export const PRESUPUESTO_MS = 100_000;
/** Si queda menos que esto, no se empieza otro paso (se retoma en la pasada siguiente). */
export const MARGEN_PASO_MS = 40_000;
export const MAX_ACTIVAS = 3;
const LLAVE_MS = 3 * 60_000;
const MAX_PASOS = 5;
const MAX_INTENTOS = 3;

const iso = (ms: number) => new Date(ms).toISOString();
const faltaLaTabla = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (/PGRST205|42P01/.test(String(e.code)) || /does not exist|schema cache|could not find/i.test(String(e.message)));

/** Pasos limpios: texto corto, sin repetidos, hasta MAX_PASOS. */
export function pasosDe(crudos: unknown, instruccion: string): PasoPlan[] {
  const lista = (Array.isArray(crudos) ? crudos : []).map(x => String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, 400)).filter(x => x.length >= 8);
  const unicos = [...new Set(lista)].slice(0, MAX_PASOS);
  const pasos = unicos.length ? unicos : [instruccion.slice(0, 400)];
  return pasos.map((objetivo, i) => ({ n: i + 1, objetivo, estado: 'pendiente' as const }));
}

/** Si no se pudo redactar con IA: los resultados de cada paso, uno debajo del otro. */
export function informeSimple(titulo: string, pasos: PasoPlan[]): string {
  const hechos = pasos.filter(p => p.estado === 'hecho' && p.resultado);
  return [`**${titulo}**`, ...hechos.map(p => `**${p.n}. ${p.objetivo}**\n${p.resultado}`)].join('\n\n').slice(0, 20000);
}

// ------------------------------- crear -------------------------------
export type ResultadoCrear = { ok: true; id: string } | { ok: false; codigo: 'sin_tabla' | 'muchas' | 'error'; error: string };

export async function crearTarea(admin: Db, d: { user_id: string; conversacion_id: string | null; titulo: string; instruccion: string }): Promise<ResultadoCrear> {
  const { data: activas, error: e1 } = await admin.from('jarvis_tareas').select('id').eq('user_id', d.user_id).in('estado', ['pendiente', 'corriendo']).limit(MAX_ACTIVAS + 1);
  if (e1) return faltaLaTabla(e1)
    ? { ok: false, codigo: 'sin_tabla', error: 'Todavía no puedo trabajar en segundo plano: falta activar los encargos. El dueño tiene que correr supabase/migracion_jarvis_tareas.sql en el SQL Editor de Supabase.' }
    : { ok: false, codigo: 'error', error: 'No pude dejar el encargo ahora.' };
  if ((activas || []).length >= MAX_ACTIVAS) return { ok: false, codigo: 'muchas', error: `Ya tengo ${MAX_ACTIVAS} encargos en marcha. Esperemos a que termine alguno.` };
  const { data, error } = await admin.from('jarvis_tareas').insert({
    user_id: d.user_id, conversacion_id: d.conversacion_id, titulo: d.titulo.slice(0, 80), instruccion: d.instruccion.slice(0, 2000),
  }).select('id').single();
  if (error || !data?.id) return { ok: false, codigo: faltaLaTabla(error) ? 'sin_tabla' : 'error', error: 'No pude dejar el encargo ahora.' };
  return { ok: true, id: String(data.id) };
}

// ------------------------------ trabajar ------------------------------
async function tomar(admin: Db, ahora: number, soloId?: string): Promise<Tarea | null> {
  for (let intento = 0; intento < 3; intento++) {
    let q = admin.from('jarvis_tareas').select('*').eq('estado', 'pendiente').order('creada_en', { ascending: true }).limit(1);
    if (soloId) q = q.eq('id', soloId);
    const { data } = await q;
    const t = (data || [])[0];
    if (!t) return null;
    // Se queda con ella solo si nadie se la ganó (la actualización es condicional).
    const { data: mia } = await admin.from('jarvis_tareas')
      .update({ estado: 'corriendo', bloqueada_hasta: iso(ahora + LLAVE_MS), empezada_en: t.empezada_en || iso(ahora), actualizada_en: iso(ahora) })
      .eq('id', t.id).eq('estado', 'pendiente').select('*');
    if ((mia || []).length) return mia[0] as Tarea;
    if (soloId) return null;
  }
  return null;
}

/** Las que quedaron «corriendo» con la llave vencida: se retoman (o se dan por perdidas tras varios cortes). */
async function recuperar(admin: Db, ahora: number): Promise<number> {
  const { data } = await admin.from('jarvis_tareas').select('id,intentos').eq('estado', 'corriendo').lt('bloqueada_hasta', iso(ahora)).limit(20);
  let n = 0;
  for (const t of (data || []) as { id: string; intentos: number }[]) {
    const cambio = t.intentos + 1 >= MAX_INTENTOS
      ? { estado: 'error', error: 'Se cortó varias veces y no pude terminarlo.', terminada_en: iso(ahora), bloqueada_hasta: null, intentos: t.intentos + 1 }
      : { estado: 'pendiente', bloqueada_hasta: null, intentos: t.intentos + 1 };
    const { data: r } = await admin.from('jarvis_tareas').update({ ...cambio, actualizada_en: iso(ahora) }).eq('id', t.id).eq('estado', 'corriendo').lt('bloqueada_hasta', iso(ahora)).select('id');
    if ((r || []).length) n++;
  }
  return n;
}

async function trabajar(admin: Db, t: Tarea, motor: MotorTareas, hasta: number, reloj: () => number): Promise<'terminada' | 'sigue' | 'cancelada'> {
  const guardar = (cambio: Record<string, unknown>) => admin.from('jarvis_tareas').update({ ...cambio, actualizada_en: iso(reloj()) }).eq('id', t.id);
  const llave = () => ({ bloqueada_hasta: iso(reloj() + LLAVE_MS) });
  let titulo = t.titulo;
  let plan = Array.isArray(t.plan) ? t.plan : [];

  if (!plan.length) {
    const p = await motor.planificar(t.instruccion).catch(() => null);
    plan = pasosDe(p?.pasos, t.instruccion);
    if (p?.titulo && p.titulo.trim().length >= 3 && t.titulo.length < 3) titulo = p.titulo.trim().slice(0, 80);
    await guardar({ plan, titulo, ...llave() });
  }

  for (const paso of plan) {
    if (paso.estado !== 'pendiente') continue;
    // Poco tiempo: se guarda el avance y la pasada siguiente sigue desde acá.
    if (hasta - reloj() < MARGEN_PASO_MS) {
      await guardar({ plan, estado: 'pendiente', bloqueada_hasta: null });
      return 'sigue';
    }
    // ¿La cancelaron mientras tanto?
    const { data: actual } = await admin.from('jarvis_tareas').select('estado').eq('id', t.id).maybeSingle();
    if (actual?.estado === 'cancelada') return 'cancelada';
    const contexto = plan.filter(p => p.estado === 'hecho' && p.resultado).map(p => `PASO ${p.n} («${p.objetivo.slice(0, 120)}»):\n${String(p.resultado).slice(0, 1500)}`).join('\n\n').slice(-7000);
    const ini = reloj();
    // Un encargo de código (leer, preparar y proponer) necesita más aire que una consulta.
    const tope = /^\[CODIGO\]/.test(t.instruccion) ? 92_000 : 75_000;
    const r = await motor.correrPaso(paso.objetivo, contexto, Math.max(10_000, Math.min(tope, hasta - reloj() - 5_000)), t.instruccion).catch(() => null);
    paso.ms = reloj() - ini;
    if (r && r.trim().length >= 10) { paso.estado = 'hecho'; paso.resultado = r.trim().slice(0, 4000); }
    else { paso.estado = 'fallo'; paso.resultado = 'No pude completar este paso.'; }
    await guardar({ plan, ...llave() });
  }

  const hechos = plan.filter(p => p.estado === 'hecho');
  if (!hechos.length) {
    await guardar({ estado: 'error', error: 'Ningún paso pudo completarse.', terminada_en: iso(reloj()), bloqueada_hasta: null, plan });
    await motor.terminado({ ...t, titulo, plan }, `No pude terminar «${titulo}»: las consultas no respondieron. Probá pedírmelo de nuevo en un rato.`, false).catch(() => {});
    return 'terminada';
  }
  const informe = ((await motor.redactar(t.instruccion, plan).catch(() => null)) || '').trim() || informeSimple(titulo, plan);
  const final = informe.slice(0, 20000);
  await guardar({ estado: 'lista', resultado: final, terminada_en: iso(reloj()), bloqueada_hasta: null, plan });
  await motor.terminado({ ...t, titulo, plan }, final, true).catch(() => {});
  return 'terminada';
}

/**
 * Una pasada: retoma lo cortado y trabaja las tareas pendientes mientras haya tiempo.
 * `soloId`: arranque inmediato de UNA tarea recién pedida.
 */
export async function procesarTareas(admin: Db, motor: MotorTareas, op: { reloj?: () => number; soloId?: string } = {}): Promise<{ ok: boolean; recuperadas: number; trabajadas: number; terminadas: number; sinTabla?: boolean }> {
  const reloj = op.reloj ?? (() => Date.now());
  const hasta = reloj() + PRESUPUESTO_MS;
  const probe = await admin.from('jarvis_tareas').select('id').limit(1);
  if (probe.error) return { ok: false, recuperadas: 0, trabajadas: 0, terminadas: 0, ...(faltaLaTabla(probe.error) ? { sinTabla: true } : {}) };
  const recuperadas = op.soloId ? 0 : await recuperar(admin, reloj());
  let trabajadas = 0, terminadas = 0;
  while (hasta - reloj() > MARGEN_PASO_MS) {
    const t = await tomar(admin, reloj(), op.soloId);
    if (!t) break;
    trabajadas++;
    const fin = await trabajar(admin, t, motor, hasta, reloj).catch(async (e) => {
      console.log(`tarea ${t.id}: ${e instanceof Error ? e.message : e}`);
      await admin.from('jarvis_tareas').update({ estado: 'pendiente', bloqueada_hasta: null, actualizada_en: iso(reloj()) }).eq('id', t.id).eq('estado', 'corriendo');
      return 'sigue' as const;
    });
    if (fin === 'terminada') terminadas++;
    if (op.soloId) break;
  }
  return { ok: true, recuperadas, trabajadas, terminadas };
}

/** Las terminadas hace más de 30 días se borran (el resultado ya quedó en el chat). */
export async function purgarTareas(admin: Db, ahora = Date.now()): Promise<void> {
  await admin.from('jarvis_tareas').delete().in('estado', ['lista', 'error', 'cancelada']).lt('actualizada_en', iso(ahora - 30 * 86_400_000));
}
