// =====================================================================
// CEREBRO DE JARVIS — en 3D, con todo lo que sabe tocable y corregible
// =====================================================================
// Lo que se ve son los mismos datos que guarda el cerebro (jarvis_nodos y
// jarvis_enlaces), ordenados desde el núcleo:
//
//   Núcleo (Technoverse) → Rama (constelación) → Tema (estrella-neurona)
//                                               → Puntos (lo que cuelga)
//
// Tocar algo lo trae de frente (motor en ./cerebro/motor.ts) y abajo, en
// la hoja, dice lo que sabe y lo que cuelga de ello. Todo se corrige con
// texto: el nombre, «lo que sé», «qué guarda» cada rama y cada punto; se
// agregan puntos y temas, se mueven de rama o se olvidan, siempre con
// «Deshacer». La app puede cambiar y borrar; agregar y mover lo hace la
// función (accion 'cerebro'), que valida que todo sea del dueño.
// =====================================================================

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as TeclaEv, type ReactNode } from 'react';
import { ArrowLeft, Brain, LocateFixed, Minus, Pencil, Plus, RefreshCw, Search, X, ExternalLink, MessageCircleQuestion } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { limpiarExtracto, nombreHumano, sitioHumano } from '../../utils/nombresCerebro';
import { Motor, type ModeloM, type Toque } from './cerebro/motor';

type Tipo = 'raiz' | 'dominio' | 'modulo' | 'tema' | 'dato' | 'fuente' | 'recuerdo';
type Fila = {
  id: string; clave: string; etiqueta: string; tipo: Tipo; resumen: string | null; fuente: string | null; url: string | null;
  usos: number; ultimo_uso: string | null; creado_en: string; actualizado_en: string;
  /** Cómo se MUESTRA (lenguaje humano, sin URLs ni sintaxis de búsqueda). */
  nombre: string;
};
type Enlace = { id: string; origen: string; destino: string; relacion: string; peso: number };
type Rama = { id: string; nombre: string; color: string; guarda: string; nodo: Fila | null; temas: Fila[] };
type Arbol = {
  porId: Map<string, Fila>; raiz: Fila | null; ramas: Rama[];
  padre: Map<string, string>; hijos: Map<string, string[]>; prof: Map<string, number>; ramaDe: Map<string, string>;
  vecinos: Map<string, string[]>; modelo: ModeloM;
};
type Aviso = { texto: string; deshacer?: () => void } | null;

const COLS = 'id,clave,etiqueta,tipo,resumen,fuente,url,usos,ultimo_uso,creado_en,actualizado_en';
const COLOR_FIJO: Record<string, string> = { 'dom:negocio': '#7FD8CF', 'dom:internet': '#C3A3FF', 'dom:dueno': '#F49BB6' };
const PALETA = ['#8FB4FF', '#F0B37E', '#9EDB8C', '#F5D76E', '#7FC8F8', '#E79B6B'];
const GUARDA: Record<string, string> = {
  'dom:negocio': 'Cómo funciona Technoverse: los módulos del sistema y lo que consultó en cada uno.',
  'dom:internet': 'Lo que buscó en internet y vale la pena recordar, con el nombre del sitio de donde salió.',
  'dom:dueno': 'Lo que le pediste recordar: cómo te gusta trabajar y que te hablen.',
};
const FUENTE: Record<string, string> = { vos: 'Lo dijiste vos', internet: 'Internet', inventario: 'Inventario de la tienda', taller: 'Órdenes del taller', jarvis: 'Lo dedujo Jarvis' };
const FIJOS = new Set(['raiz', 'dom:internet', 'dom:dueno', 'dom:negocio']);

const sinTildes = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const fecha = (f: string | null) => (f ? new Date(f).toLocaleDateString('es-CR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
function haceCuanto(f: string): string {
  const m = Math.max(1, Math.round((Date.now() - new Date(f).getTime()) / 60_000));
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60); if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24); return d === 1 ? 'ayer' : `hace ${d} días`;
}
/** Lo que sabe, en limpio: sin direcciones, marcas de formato ni menús de páginas. */
function textoLimpio(n: Fila): string {
  const r = n.resumen || '';
  if (n.fuente === 'internet') { const t = r.split(' · ').map(x => limpiarExtracto(x.replace(/^[^.:]{1,40}:\s+/, ''), 400)).filter(Boolean).join(' '); return t.charAt(0).toUpperCase() + t.slice(1); }
  return r.replace(/https?:\/\/\S+/g, '').replace(/[*_`#>|]+/g, '').replace(/\s{2,}/g, ' ').trim();
}
const conNombre = (f: Omit<Fila, 'nombre'>): Fila => ({ ...f, nombre: nombreHumano(f.etiqueta, f.tipo, f.url) });

// Lo último que se bajó, en memoria: al abrir se ve AL INSTANTE y se
// refresca por detrás. Jarvis lo precarga al abrirse.
let enMemoria: { filas: Fila[]; enlaces: Enlace[] } | null = null;
let bajando: Promise<{ filas: Fila[]; enlaces: Enlace[] } | { error: 'sin_tablas' | 'red' }> | null = null;
function bajarCerebro() {
  if (bajando) return bajando;
  bajando = (async () => {
    const [n, e] = await Promise.all([
      supabase.from('jarvis_nodos').select(COLS).order('actualizado_en', { ascending: false }).limit(800),
      supabase.from('jarvis_enlaces').select('id,origen,destino,relacion,peso').limit(2500),
    ]);
    if (n.error) return { error: /does not exist|relation|schema cache|could not find/i.test(n.error.message) ? 'sin_tablas' as const : 'red' as const };
    enMemoria = { filas: ((n.data || []) as Omit<Fila, 'nombre'>[]).map(conNombre), enlaces: (e.data || []) as Enlace[] };
    return enMemoria;
  })().finally(() => { bajando = null; });
  return bajando;
}
/** Jarvis lo llama al abrirse: código y datos listos antes de tocar el cerebro. */
export function precargarCerebro(): void { if (!enMemoria) void bajarCerebro(); }

/** Ordena todo desde el núcleo: ramas, temas y lo que cuelga de cada uno. */
function armar(filas: Fila[], enlaces: Enlace[]): Arbol {
  const porId = new Map(filas.map(f => [f.id, f]));
  const vecinos = new Map<string, string[]>();
  const sale = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, k: string, v: string) => { let l = m.get(k); if (!l) { l = []; m.set(k, l); } l.push(v); };
  for (const e of enlaces) {
    if (!porId.has(e.origen) || !porId.has(e.destino)) continue;
    push(vecinos, e.origen, e.destino); push(vecinos, e.destino, e.origen); push(sale, e.origen, e.destino);
  }
  const raiz = filas.find(f => f.tipo === 'raiz') || null;
  const padre = new Map<string, string>(), hijos = new Map<string, string[]>(), prof = new Map<string, number>();
  if (raiz) {
    prof.set(raiz.id, 0);
    const cola = [raiz.id];
    while (cola.length) {
      const id = cola.shift()!;
      // Primero lo que sale (así el árbol sigue las ramas) y después lo demás.
      const salen = new Set(sale.get(id) || []);
      const vs = [...(vecinos.get(id) || [])].sort((a, b) => Number(salen.has(b)) - Number(salen.has(a)));
      for (const v of vs) if (!prof.has(v)) { prof.set(v, prof.get(id)! + 1); padre.set(v, id); push(hijos, id, v); cola.push(v); }
    }
  }
  // Ramas: lo que cuelga directo del núcleo. Lo suelto va a la rama que le toca.
  let extra = 0;
  const ramas: Rama[] = (raiz ? hijos.get(raiz.id) || [] : []).map(id => {
    const n = porId.get(id)!;
    const color = COLOR_FIJO[n.clave] || PALETA[extra++ % PALETA.length];
    return { id, nombre: n.nombre, color, guarda: textoLimpio(n) || GUARDA[n.clave] || `Lo que estudió a fondo sobre ${n.nombre.toLowerCase()}.`, nodo: n, temas: (hijos.get(id) || []).map(t => porId.get(t)!) };
  });
  const porClave = new Map(ramas.filter(r => r.nodo).map(r => [r.nodo!.clave, r]));
  const sueltos = filas.filter(f => !prof.has(f.id) && f.tipo !== 'raiz');
  if (sueltos.length) {
    let otros: Rama | null = null;
    for (const f of sueltos) {
      const clave = f.tipo === 'recuerdo' ? 'dom:dueno' : f.tipo === 'fuente' ? 'dom:internet' : f.tipo === 'modulo' || f.tipo === 'dato' ? 'dom:negocio' : '';
      let r = porClave.get(clave) || ramas.find(x => x.nodo?.clave.startsWith('dom:rama:')) || null;
      if (!r) { if (!otros) { otros = { id: 'otros', nombre: 'Sin ordenar', color: '#9AA5BD', guarda: 'Ideas que todavía no cuelgan de ninguna rama.', nodo: null, temas: [] }; ramas.push(otros); } r = otros; }
      r.temas.push(f); prof.set(f.id, 2); if (r.nodo) padre.set(f.id, r.id);
    }
  }
  const ramaDe = new Map<string, string>();
  for (const r of ramas) {
    ramaDe.set(r.id, r.id);
    const cola = [...r.temas.map(t => t.id)];
    while (cola.length) { const id = cola.pop()!; if (ramaDe.has(id)) continue; ramaDe.set(id, r.id); cola.push(...(hijos.get(id) || [])); }
  }
  // Para el 3D: cada tema con sus puntos; relaciones entre temas de ramas distintas.
  const temaDe = (id: string): string | null => { let x: string | undefined = id; while (x && (prof.get(x) ?? 9) > 2) x = padre.get(x); return x && prof.get(x) === 2 ? x : null; };
  const relaciones: [string, string][] = []; const vistas = new Set<string>();
  for (const e of enlaces) {
    if (padre.get(e.destino) === e.origen || padre.get(e.origen) === e.destino) continue;
    const a = temaDe(e.origen), b = temaDe(e.destino);
    if (!a || !b || a === b || ramaDe.get(a) === ramaDe.get(b)) continue;
    const k = a < b ? a + b : b + a; if (vistas.has(k)) continue; vistas.add(k); relaciones.push([a, b]);
  }
  const modelo: ModeloM = {
    ramas: ramas.map(r => ({ id: r.id, nombre: r.nombre, color: r.color, temas: r.temas.map(t => ({ id: t.id, nombre: t.nombre, usos: t.usos || 0, puntos: (hijos.get(t.id) || []).map(p => ({ id: p, nombre: porId.get(p)!.nombre })) })) })),
    relaciones,
  };
  return { porId, raiz, ramas, padre, hijos, prof, ramaDe, vecinos, modelo };
}

export default function CerebroJarvis({ onPreguntar, onVolver }: { onPreguntar?: (texto: string) => void; onVolver?: () => void }) {
  const [filas, setFilas] = useState<Fila[] | null>(() => enMemoria?.filas || null);
  const [enlaces, setEnlaces] = useState<Enlace[]>(() => enMemoria?.enlaces || []);
  const [error, setError] = useState<'sin_tablas' | 'red' | null>(null);
  const [cargando, setCargando] = useState(false);
  const [foco, setFoco] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [marcado, setMarcado] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState<string | null>(null);
  const [alto, setAlto] = useState(false);
  const [aviso, setAviso] = useState<Aviso>(null);
  const [abajo, setAbajo] = useState(300);
  // Lo que se está por olvidar: se oculta ya y se borra si no se deshace.
  const [ocultos, setOcultos] = useState<Set<string>>(() => new Set());
  const lienzoRef = useRef<HTMLCanvasElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const hojaRef = useRef<HTMLDivElement>(null);
  const motorRef = useRef<Motor | null>(null);
  const tocarRef = useRef<(t: Toque) => void>(() => {});
  const borrarRef = useRef<{ ids: string[]; t: number; recuerdos: string[] } | null>(null);
  const avisoT = useRef(0);

  const cargar = useCallback(async () => {
    setCargando(true);
    const r = await bajarCerebro();
    setCargando(false);
    if ('error' in r) { if (!enMemoria) setError(r.error); return null; }
    setError(null);
    setFilas(prev => (prev && prev.length === r.filas.length && prev[0]?.actualizado_en === r.filas[0]?.actualizado_en ? prev : r.filas));
    setEnlaces(prev => (prev.length === r.enlaces.length ? prev : r.enlaces));
    return r;
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  const visibles = useMemo(() => (filas || []).filter(f => !ocultos.has(f.id)), [filas, ocultos]);
  const arbol = useMemo(() => armar(visibles, enlaces), [visibles, enlaces]);
  // Lo que se ve queda en memoria para la próxima vez que se abra.
  useEffect(() => { if (filas) enMemoria = { filas, enlaces }; }, [filas, enlaces]);

  // Motor 3D: se crea una vez; los datos y la selección se le pasan.
  const hayLienzo = filas !== null;
  useEffect(() => {
    const cv = lienzoRef.current; if (!cv) return;
    const m = new Motor(cv, t => tocarRef.current(t));
    motorRef.current = m;
    const medir = () => { const ab = hojaRef.current?.offsetHeight || 300; setAbajo(ab); m.medir((hudRef.current?.offsetHeight || 60) + 18, ab); };
    const ro = new ResizeObserver(medir);
    ro.observe(cv); if (hojaRef.current) ro.observe(hojaRef.current); if (hudRef.current) ro.observe(hudRef.current);
    medir();
    return () => { ro.disconnect(); m.destruir(); motorRef.current = null; };
  }, [hayLienzo]);
  useEffect(() => { motorRef.current?.datos(arbol.modelo); }, [arbol, hayLienzo]);
  // El motor marca el TEMA (nivel 2) y, si se eligió algo más hondo, su punto.
  const temaDe = useCallback((id: string | null) => { let x = id; while (x && (arbol.prof.get(x) ?? 9) > 2) x = arbol.padre.get(x) || null; return x; }, [arbol]);
  const puntoDe = useCallback((id: string | null) => { let x = id; while (x && (arbol.prof.get(x) ?? 9) > 3) x = arbol.padre.get(x) || null; return x && arbol.prof.get(x) === 3 ? x : null; }, [arbol]);
  useEffect(() => {
    motorRef.current?.estado({ foco, sel: temaDe(sel), marcado: marcado || puntoDe(sel), nuevo });
  }, [foco, sel, marcado, nuevo, temaDe, puntoDe, hayLienzo]);

  // --------------------------- navegación ---------------------------
  const centrar = () => { setSel(null); setFoco(null); setMarcado(null); setAlto(false); };
  const verRama = (id: string) => { setSel(null); setMarcado(null); setFoco(id); setAlto(false); };
  const elegir = (id: string) => {
    const f = arbol.porId.get(id); if (!f) return;
    if (f.tipo === 'raiz') { centrar(); return; }
    if (arbol.prof.get(id) === 1) { verRama(id); return; }
    setFoco(arbol.ramaDe.get(id) || null); setSel(id); setMarcado(null);
  };
  tocarRef.current = t => {
    if (!t || t.tipo === 'nucleo') { centrar(); return; }
    if (t.tipo === 'rama') { verRama(t.id); return; }
    if (t.tipo === 'punto') { setMarcado(t.id); requestAnimationFrame(() => document.querySelector(`[data-punto="${t.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })); return; }
    elegir(t.id);
  };

  // ----------------------------- avisos -----------------------------
  const avisar = (texto: string, deshacer?: () => void) => {
    setAviso({ texto, deshacer });
    window.clearTimeout(avisoT.current);
    avisoT.current = window.setTimeout(() => setAviso(null), 5000);
  };

  // ----------------------------- cambios ----------------------------
  const ponerFila = (id: string, cambios: Partial<Fila>) => setFilas(fs => {
    return (fs || []).map(f => (f.id === id ? conNombre({ ...f, ...cambios }) : f));
  });
  const actualizar = async (n: Fila, cambios: Partial<Omit<Fila, 'nombre' | 'id'>>, ok: string) => {
    const antes: Partial<Fila> = {}; for (const k of Object.keys(cambios) as (keyof Fila)[]) (antes as Record<string, unknown>)[k] = n[k];
    ponerFila(n.id, cambios);
    const { error: e } = await supabase.from('jarvis_nodos').update({ ...cambios, actualizado_en: new Date().toISOString() }).eq('id', n.id);
    if (e) { ponerFila(n.id, antes); avisar('No se pudo guardar. Revisá la conexión.'); return; }
    avisar(ok, () => { ponerFila(n.id, antes); void supabase.from('jarvis_nodos').update(antes).eq('id', n.id); });
  };
  const funcion = async (op: string, datos: Record<string, unknown>) => {
    const { data, error: e } = await supabase.functions.invoke('asistente-ia', { body: { accion: 'cerebro', op, datos } });
    if (e || !data?.ok) {
      let msg = data?.error as string | undefined;
      const ctx = (e as { context?: Response } | null)?.context;
      if (!msg && ctx?.json) { try { msg = (await ctx.json())?.error; } catch { /* sin cuerpo */ } }
      avisar(msg || 'No se pudo guardar. Revisá la conexión.'); return null;
    }
    return data as { nodo?: Omit<Fila, 'nombre'>; enlace?: Enlace };
  };
  const agregar = async (op: 'punto' | 'tema', madre: string, texto: string) => {
    const r = await funcion(op, op === 'punto' ? { tema: madre, texto } : { rama: madre, texto });
    if (!r?.nodo) return;
    const nodo = conNombre(r.nodo);
    const fs = [...(filas || []).filter(f => f.id !== nodo.id), nodo];
    const es = r.enlace && !enlaces.some(x => x.id === r.enlace!.id) ? [...enlaces, r.enlace] : enlaces;
    setFilas(fs); setEnlaces(es);
    setNuevo(nodo.id); window.setTimeout(() => setNuevo(x => (x === nodo.id ? null : x)), 6000);
    if (op === 'tema') { setFoco(madre); setSel(nodo.id); } else setMarcado(nodo.id);
    avisar(op === 'punto' ? 'Punto agregado.' : 'Tema agregado.', () => olvidar([nodo.id], true));
  };
  const mover = async (n: Fila, hacia: string) => {
    const desde = arbol.padre.get(n.id) || null;
    const r = await funcion('mover', { nodo: n.id, desde, hacia });
    if (!r) return;
    const es = [...enlaces.filter(e => !(desde && ((e.origen === desde && e.destino === n.id) || (e.origen === n.id && e.destino === desde)))), ...(r.enlace ? [r.enlace] : [])];
    setEnlaces(es); setFoco(hacia);
    const destino = arbol.ramas.find(x => x.id === hacia)?.nombre || 'otra rama';
    avisar(`Movido a ${destino}.`, desde ? () => void mover(n, desde) : undefined);
  };
  /** Olvidar: se oculta ya; se borra de verdad si no se deshace en 5 s. */
  const confirmarBorrado = useCallback(async () => {
    const b = borrarRef.current; if (!b) return; borrarRef.current = null;
    await supabase.from('jarvis_nodos').delete().in('id', b.ids);
    // Un recuerdo también sale de la memoria que usa al responder.
    for (const r of b.recuerdos) await supabase.from('jarvis_memoria').delete().eq('texto', r);
    setFilas(fs => (fs || []).filter(f => !b.ids.includes(f.id)));
    setEnlaces(es => es.filter(e => !b.ids.includes(e.origen) && !b.ids.includes(e.destino)));
    setOcultos(o => { const n = new Set(o); b.ids.forEach(i => n.delete(i)); return n; });
  }, []);
  useEffect(() => () => { void confirmarBorrado(); }, [confirmarBorrado]);
  const olvidar = (ids: string[], silencioso = false) => {
    void confirmarBorrado();
    // Se va con lo que solo colgaba de esto (sus puntos y su búsqueda).
    const todo = new Set(ids);
    const cola = [...ids];
    while (cola.length) {
      const id = cola.pop()!;
      for (const h of arbol.hijos.get(id) || []) if (!todo.has(h) && (arbol.vecinos.get(h) || []).every(v => todo.has(v) || v === id)) { todo.add(h); cola.push(h); }
    }
    const lista = [...todo];
    const recuerdos = lista.map(i => arbol.porId.get(i)).filter(f => f?.tipo === 'recuerdo' && f.resumen).map(f => f!.resumen!);
    const primero = arbol.porId.get(ids[0]);
    borrarRef.current = { ids: lista, t: Date.now(), recuerdos };
    setOcultos(o => new Set([...o, ...lista]));
    if (sel && lista.includes(sel)) { const p = arbol.padre.get(sel); if (p && arbol.prof.get(p)! >= 2) setSel(p); else setSel(null); }
    if (marcado && lista.includes(marcado)) setMarcado(null);
    const deshacer = () => { borrarRef.current = null; setOcultos(o => { const n = new Set(o); lista.forEach(i => n.delete(i)); return n; }); };
    if (silencioso) { void confirmarBorrado(); return; }
    avisar(lista.length > 1 && ids.length === 1 ? `Olvidó «${primero?.nombre || ''}» y ${lista.length - 1} punto${lista.length === 2 ? '' : 's'}.` : ids.length > 1 ? `Olvidó ${ids.length} ideas.` : `Olvidó «${primero?.nombre || ''}».`, deshacer);
    window.setTimeout(() => { if (borrarRef.current?.ids === lista) void confirmarBorrado(); }, 5200);
  };

  // «Enseñar»: Jarvis lo investiga y lo guarda solo (sin ir al chat).
  const [aprendiendo, setAprendiendo] = useState<{ estado: 'no' | 'si' | 'ok' | 'error'; texto: string }>({ estado: 'no', texto: '' });
  const aprender = async (tema: string) => {
    const t = tema.trim(); if (t.length < 2 || aprendiendo.estado === 'si') return;
    setAprendiendo({ estado: 'si', texto: t });
    const { data, error: e } = await supabase.functions.invoke('asistente-ia', { body: { accion: 'aprender', tema: t } });
    if (e || !data?.ok) { setAprendiendo({ estado: 'error', texto: data?.error || 'No se pudo aprender ahora. Revisá la conexión y probá de nuevo.' }); return; }
    const r = await cargar();
    const etiqueta = String(data.aprendidos?.[0] || t);
    const n = r?.filas.find(f => sinTildes(f.etiqueta) === sinTildes(etiqueta) || sinTildes(f.nombre) === sinTildes(etiqueta));
    setAprendiendo({ estado: 'ok', texto: `${etiqueta}. Quedó en ${String(data.guardado_en || 'tu cerebro').replace(/^Technoverse → /, '')}.` });
    if (n) { setNuevo(n.id); window.setTimeout(() => { elegirRef.current(n.id); }, 60); window.setTimeout(() => setNuevo(x => (x === n.id ? null : x)), 7000); }
  };
  const elegirRef = useRef(elegir); elegirRef.current = elegir;

  // ----------------------------- vistas -----------------------------
  if (error === 'sin_tablas') {
    return (
      <div className="jv-cerebro jv-cb-solo">
        <div className="jv-cb-vacio">
          <span className="jv-cb-logo"><Brain className="w-6 h-6" aria-hidden /></span>
          <b>El cerebro todavía no está instalado</b>
          <p>Falta correr «migracion_jarvis_cerebro.sql» en Supabase. Mientras tanto Jarvis responde normal, solo que no guarda lo que aprende.</p>
          <button type="button" className="jv-btn" onClick={() => void cargar()}><RefreshCw className="w-4 h-4" />Volver a revisar</button>
        </div>
      </div>
    );
  }

  const nTemas = arbol.ramas.reduce((a, r) => a + r.temas.length, 0);
  const nPuntos = arbol.ramas.reduce((a, r) => a + r.temas.reduce((b, t) => b + (arbol.hijos.get(t.id)?.length || 0), 0), 0);
  const rama = foco ? arbol.ramas.find(r => r.id === foco) || null : null;
  const nodoSel = sel ? arbol.porId.get(sel) || null : null;

  return (
    <div className="jv-cerebro">
      <canvas ref={lienzoRef} className="jv-cb-lienzo" tabIndex={0} role="img" hidden={filas === null}
        aria-label={`Cerebro en 3D: ${arbol.ramas.length} ramas y ${nTemas} temas. Arrastrá para girar, dos dedos para acercar; con el teclado, flechas y + / −. Abajo está la lista.`} />
      {filas === null && <p className="jv-cb-espera">{error === 'red' ? 'No se pudo leer el cerebro. Revisá la conexión.' : 'Despertando el cerebro…'}</p>}

      <div className="jv-cb-hud" ref={hudRef}>
        {onVolver && <button type="button" className="jv-vidrio jv-cb-ib" aria-label="Volver al chat" title="Volver al chat" onClick={onVolver}><ArrowLeft className="w-[18px] h-[18px]" /></button>}
        <div className="jv-cb-tit">
          <b>Cerebro de Jarvis</b>
          <div className="jv-cb-ruta">
            {!foco ? <span>{arbol.ramas.length} ramas · {nTemas} temas · {nPuntos} puntos</span> : <>
              <button type="button" onClick={centrar}>Todo</button> ›{' '}
              {nodoSel ? <><button type="button" onClick={() => verRama(foco)}>{rama?.nombre}</button> › <span>{nodoSel.nombre}</span></> : <span>{rama?.nombre}</span>}
            </>}
          </div>
        </div>
        <button type="button" className="jv-vidrio jv-cb-ib" aria-label="Actualizar" title="Actualizar" onClick={() => void cargar()} disabled={cargando}><RefreshCw className={`w-4 h-4 ${cargando ? 'animate-spin' : ''}`} /></button>
        <button type="button" className="jv-vidrio jv-cb-ib" aria-label="Ver todo" title="Ver todo" onClick={centrar}><LocateFixed className="w-[18px] h-[18px]" /></button>
      </div>
      <div className="jv-cb-zoom">
        <button type="button" className="jv-vidrio jv-cb-ib" aria-label="Acercar" title="Acercar" onClick={() => motorRef.current?.zoom(1.35)}><Plus className="w-[18px] h-[18px]" /></button>
        <button type="button" className="jv-vidrio jv-cb-ib" aria-label="Alejar" title="Alejar" onClick={() => motorRef.current?.zoom(1 / 1.35)}><Minus className="w-[18px] h-[18px]" /></button>
      </div>

      <div className="jv-cb-hoja jv-vidrio" ref={hojaRef} data-alto={alto || undefined}>
        <button type="button" className="jv-cb-asa" aria-label={alto ? 'Achicar el panel' : 'Agrandar el panel'} onClick={() => setAlto(a => !a)}><i /></button>
        <div className="jv-cb-panel">
          {nodoSel ? (
            <VistaTema n={nodoSel} arbol={arbol} marcado={marcado} onElegir={elegir} onMarcar={setMarcado}
              onVolver={() => { const p = arbol.padre.get(nodoSel.id); if (p && (arbol.prof.get(p) ?? 0) >= 2) setSel(p); else if (foco) verRama(foco); else centrar(); }}
              onActualizar={actualizar} onAgregar={t => agregar('punto', nodoSel.id, t)} onMover={h => void mover(nodoSel, h)} onOlvidar={ids => olvidar(ids)}
              onPreguntar={onPreguntar} />
          ) : rama ? (
            <VistaRama r={rama} arbol={arbol} onCentrar={centrar} onElegir={elegir}
              onGuarda={t => rama.nodo && void actualizar(rama.nodo, { resumen: t }, 'Guardado.')}
              onAgregar={t => rama.nodo && void agregar('tema', rama.id, t)} onOlvidar={ids => olvidar(ids)} />
          ) : (
            <VistaNucleo arbol={arbol} filas={visibles} nTemas={nTemas} nPuntos={nPuntos} onRama={verRama} onElegir={elegir}
              aprendiendo={aprendiendo} onAprender={aprender} />
          )}
        </div>
      </div>
      {aviso && (
        <div className="jv-cb-aviso" role="status" style={{ bottom: abajo + 8 }}>
          <span>{aviso.texto}</span>
          {aviso.deshacer && <button type="button" onClick={() => { aviso.deshacer!(); setAviso(null); }}>Deshacer</button>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Piezas de la hoja
// ---------------------------------------------------------------------
function Bloque({ titulo, accion, children }: { titulo: string; accion?: ReactNode; children: ReactNode }) {
  return <section className="jv-cb-bloque"><div className="jv-cb-bcab"><div className="jv-cb-h4" role="heading" aria-level={4}>{titulo}</div>{accion}</div>{children}</section>;
}
/** Un texto que se corrige en el mismo lugar: Guardar / Cancelar. */
function Editable({ valor, multi, etiqueta, onGuardar, children }: { valor: string; multi?: boolean; etiqueta: string; onGuardar: (v: string) => void; children: (editar: () => void) => ReactNode }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(valor);
  if (!edit) return <>{children(() => { setV(valor); setEdit(true); })}</>;
  const guardar = () => { const t = v.replace(/\s+/g, ' ').trim(); if (t.length < 2) return; setEdit(false); if (t !== valor) onGuardar(t); };
  const teclas = (e: TeclaEv) => { if (e.key === 'Escape') setEdit(false); if (e.key === 'Enter' && (!multi || e.ctrlKey || e.metaKey)) { e.preventDefault(); guardar(); } };
  return (
    <div className="jv-cb-editor">
      {multi ? <textarea value={v} onChange={e => setV(e.target.value)} onKeyDown={teclas} aria-label={etiqueta} maxLength={1500} rows={4} autoFocus />
        : <input value={v} onChange={e => setV(e.target.value)} onKeyDown={teclas} aria-label={etiqueta} maxLength={300} autoFocus />}
      <div className="jv-cb-botones"><button type="button" className="jv-btn" onClick={() => setEdit(false)}>Cancelar</button><button type="button" className="jv-btn" data-pri onClick={guardar}>Guardar</button></div>
    </div>
  );
}
function Agregador({ ph, onAgregar, max = 300 }: { ph: string; onAgregar: (t: string) => Promise<void> | void; max?: number }) {
  const [v, setV] = useState(''); const [ocupado, setOcupado] = useState(false);
  const enviar = async (e: FormEvent) => { e.preventDefault(); const t = v.trim(); if (t.length < 2 || ocupado) return; setOcupado(true); await onAgregar(t); setOcupado(false); setV(''); };
  return (
    <form className="jv-cb-agregar" onSubmit={enviar}>
      <input value={v} onChange={e => setV(e.target.value)} placeholder={ph} aria-label={ph} maxLength={max} enterKeyHint="done" disabled={ocupado} />
      <button type="submit" className="jv-btn" data-pri disabled={v.trim().length < 2 || ocupado}>{ocupado ? <span className="ai-giro" aria-hidden="true" /> : 'Agregar'}</button>
    </form>
  );
}
const Punto = ({ color }: { color: string }) => <i className="jv-cb-pt" style={{ background: color, color }} aria-hidden />;

function VistaNucleo({ arbol, filas, nTemas, nPuntos, onRama, onElegir, aprendiendo, onAprender }: {
  arbol: Arbol; filas: Fila[]; nTemas: number; nPuntos: number; onRama: (id: string) => void; onElegir: (id: string) => void;
  aprendiendo: { estado: 'no' | 'si' | 'ok' | 'error'; texto: string }; onAprender: (t: string) => Promise<void>;
}) {
  const [q, setQ] = useState('');
  const res = useMemo(() => {
    const t = sinTildes(q.trim()); if (t.length < 2) return [];
    return filas.filter(f => f.tipo !== 'raiz' && (sinTildes(f.nombre).includes(t) || sinTildes(f.resumen || '').includes(t))).slice(0, 8);
  }, [q, filas]);
  const ultimos = useMemo(() => filas.filter(f => !['raiz', 'dominio', 'modulo'].includes(f.tipo)).sort((a, b) => b.creado_en.localeCompare(a.creado_en)).slice(0, 5), [filas]);
  const color = (id: string) => arbol.ramas.find(r => r.id === arbol.ramaDe.get(id))?.color || '#9AA5BD';
  return (
    <>
      <div className="jv-cb-kicker" style={{ color: 'var(--jv-tinta)' }}>Núcleo · Technoverse</div>
      <p className="jv-cb-texto">Todo lo que Jarvis sabe para ayudarte, ordenado en ramas. Tocá una para ver qué guarda.</p>
      <div className="jv-cb-cifras">{[[arbol.ramas.length, 'ramas'], [nTemas, 'temas'], [nPuntos, 'puntos']].map(([n, t]) => <div key={t}><b>{n}</b><span>{t}</span></div>)}</div>
      <label className="jv-cb-buscar">
        <Search className="w-4 h-4 shrink-0" aria-hidden />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar en el cerebro" aria-label="Buscar en el cerebro" enterKeyHint="search"
          onKeyDown={e => { if (e.key === 'Enter' && res[0]) { e.preventDefault(); onElegir(res[0].id); } }} />
        {q && <button type="button" aria-label="Borrar búsqueda" onClick={() => setQ('')}><X className="w-4 h-4" /></button>}
      </label>
      {q.trim().length >= 2 ? (
        res.length ? <div>{res.map(f => (
          <button key={f.id} type="button" className="jv-cb-fila" onClick={() => onElegir(f.id)}><Punto color={color(f.id)} /><div><b>{f.nombre}</b><em>{textoLimpio(f) || ' '}</em></div><small /></button>
        ))}</div> : <p className="jv-cb-meta">No sabe nada de «{q.trim().slice(0, 40)}» todavía. Enseñáselo abajo.</p>
      ) : (
        <Bloque titulo="Ramas">
          {arbol.ramas.length ? <div>{arbol.ramas.map(r => {
            const np = r.temas.reduce((a, t) => a + (arbol.hijos.get(t.id)?.length || 0), 0);
            return <button key={r.id} type="button" className="jv-cb-fila" onClick={() => onRama(r.id)}><Punto color={r.color} /><div><b>{r.nombre}</b><em>{r.guarda}</em></div><small>{r.temas.length} · {np}</small></button>;
          })}</div> : <p className="jv-cb-meta">Todavía está en blanco. Cada tema que le enseñes, cada búsqueda y cada «recordá…» aparece aquí como una estrella.</p>}
        </Bloque>
      )}
      <Bloque titulo="Enseñarle algo">
        <Agregador ph="Un tema: cargadores GaN de 65 W" max={60} onAgregar={onAprender} />
        <p className="jv-cb-meta" role="status" data-estado={aprendiendo.estado}>
          {aprendiendo.estado === 'si' ? <>Investigando <b>{aprendiendo.texto}</b> en inventario, taller e internet…</>
            : aprendiendo.estado === 'ok' ? <>Aprendí <b>{aprendiendo.texto}</b></>
              : aprendiendo.estado === 'error' ? aprendiendo.texto : 'Lo investiga en inventario, taller e internet y nace una estrella en la rama que corresponda.'}
        </p>
      </Bloque>
      {!!ultimos.length && (
        <Bloque titulo="Lo último">
          <div>{ultimos.map(u => <button key={u.id} type="button" className="jv-cb-fila" onClick={() => onElegir(u.id)}><Punto color={color(u.id)} /><div><em>Aprendió «{u.nombre}»</em></div><small>{haceCuanto(u.creado_en)}</small></button>)}</div>
        </Bloque>
      )}
    </>
  );
}

function VistaRama({ r, arbol, onCentrar, onElegir, onGuarda, onAgregar, onOlvidar }: {
  r: Rama; arbol: Arbol; onCentrar: () => void; onElegir: (id: string) => void; onGuarda: (t: string) => void; onAgregar: (t: string) => void; onOlvidar: (ids: string[]) => void;
}) {
  const [todos, setTodos] = useState(false);
  const [limpiar, setLimpiar] = useState(false);
  const np = r.temas.reduce((a, t) => a + (arbol.hijos.get(t.id)?.length || 0), 0);
  const temas = [...r.temas].sort((a, b) => (b.usos || 0) - (a.usos || 0) || a.nombre.localeCompare(b.nombre));
  // Limpieza rápida: búsquedas de internet que nunca se volvieron a usar.
  const sinUso = r.nodo?.clave === 'dom:internet' ? temas.filter(t => t.tipo === 'fuente' && (t.usos || 0) <= 1) : [];
  return (
    <>
      <button type="button" className="jv-cb-atras" onClick={onCentrar}>‹ Todo</button>
      <div className="jv-cb-kicker" style={{ color: r.color }}>Rama · {r.temas.length} temas · {np} puntos</div>
      <div className="jv-cb-titulo"><div className="jv-cb-h3" role="heading" aria-level={3}>{r.nombre}</div></div>
      <Editable valor={r.guarda} multi etiqueta="Qué guarda esta rama" onGuardar={onGuarda}>
        {editar => <Bloque titulo="Qué guarda" accion={r.nodo && <button type="button" className="jv-cb-lapiz" onClick={editar}>Corregir</button>}><p className="jv-cb-texto">{r.guarda}</p></Bloque>}
      </Editable>
      <Bloque titulo="Temas" accion={sinUso.length >= 2 ? <button type="button" className="jv-cb-lapiz" onClick={() => setLimpiar(true)}>Limpiar {sinUso.length} sin usar</button> : undefined}>
        {limpiar && (
          <div className="jv-cb-confirmar"><span>¿Olvidar {sinUso.length} búsquedas que no volvió a usar?</span>
            <div className="jv-cb-botones"><button type="button" className="jv-btn" onClick={() => setLimpiar(false)}>Cancelar</button><button type="button" className="jv-btn" data-mal onClick={() => { setLimpiar(false); onOlvidar(sinUso.map(t => t.id)); }}>Olvidar</button></div></div>
        )}
        <div>{(todos ? temas : temas.slice(0, 40)).map(t => (
          <button key={t.id} type="button" className="jv-cb-fila" onClick={() => onElegir(t.id)}><Punto color={r.color} /><div><b>{t.nombre}</b><em>{textoLimpio(t) || ' '}</em></div><small>{arbol.hijos.get(t.id)?.length || 0} pts</small></button>
        ))}</div>
        {!todos && temas.length > 40 && <button type="button" className="jv-cb-lapiz" onClick={() => setTodos(true)}>Ver los {temas.length - 40} restantes</button>}
        {!temas.length && <p className="jv-cb-meta">Todavía no tiene temas.</p>}
      </Bloque>
      {r.nodo && <Bloque titulo="Agregar un tema a esta rama"><Agregador ph="Nombre del tema" max={80} onAgregar={onAgregar} /></Bloque>}
    </>
  );
}

function VistaTema({ n, arbol, marcado, onElegir, onMarcar, onVolver, onActualizar, onAgregar, onMover, onOlvidar, onPreguntar }: {
  n: Fila; arbol: Arbol; marcado: string | null; onElegir: (id: string) => void; onMarcar: (id: string | null) => void; onVolver: () => void;
  onActualizar: (n: Fila, c: Partial<Omit<Fila, 'nombre' | 'id'>>, ok: string) => Promise<void>; onAgregar: (t: string) => Promise<void>;
  onMover: (rama: string) => void; onOlvidar: (ids: string[]) => void; onPreguntar?: (t: string) => void;
}) {
  const [confirmar, setConfirmar] = useState(false);
  useEffect(() => setConfirmar(false), [n.id]);
  const r = arbol.ramas.find(x => x.id === arbol.ramaDe.get(n.id));
  const padre = arbol.padre.get(n.id), madre = padre && (arbol.prof.get(padre) ?? 0) >= 2 ? arbol.porId.get(padre) : null;
  const puntos = (arbol.hijos.get(n.id) || []).map(id => arbol.porId.get(id)!).filter(Boolean);
  const hijosDe = new Set([...(arbol.hijos.get(n.id) || []), padre]);
  const vec = (arbol.vecinos.get(n.id) || []).filter(v => !hijosDe.has(v)).map(v => arbol.porId.get(v)!).filter(v => v && (arbol.prof.get(v.id) ?? 0) >= 2);
  const fijo = n.tipo === 'modulo' || FIJOS.has(n.clave);
  const sitio = n.url ? sitioHumano(n.url) : '';
  const lo = textoLimpio(n);
  const esNota = (p: Fila) => (p.resumen || '') === p.etiqueta;
  return (
    <>
      <button type="button" className="jv-cb-atras" onClick={onVolver}>‹ {madre?.nombre || r?.nombre || 'Todo'}</button>
      <div className="jv-cb-kicker" style={{ color: r?.color }}>{madre ? 'Punto' : 'Tema'} · {r?.nombre}</div>
      <Editable valor={n.etiqueta} etiqueta="Nombre" onGuardar={t => void onActualizar(n, esNota(n) ? { etiqueta: t, resumen: t } : { etiqueta: t }, 'Nombre cambiado.')}>
        {editar => <div className="jv-cb-titulo"><div className="jv-cb-h3" role="heading" aria-level={3}>{n.nombre}</div>{!fijo && <button type="button" className="jv-cb-lapiz" onClick={editar}>Renombrar</button>}</div>}
      </Editable>
      <div className="jv-cb-meta">Usado {n.usos || 0} {n.usos === 1 ? 'vez' : 'veces'} · {sitio || FUENTE[n.fuente || ''] || 'Jarvis'} · desde {fecha(n.creado_en)}</div>
      {!esNota(n) && (
        <Editable valor={lo || n.resumen || ''} multi etiqueta="Lo que Jarvis sabe de esto" onGuardar={t => void onActualizar(n, { resumen: t, fuente: 'vos' }, 'Corregido. Jarvis usa esto desde ya.')}>
          {editar => (
            <Bloque titulo="Lo que sé" accion={<button type="button" className="jv-cb-lapiz" onClick={editar}>Corregir</button>}>
              <p className="jv-cb-texto">{lo || 'Sin resumen todavía.'}</p>
              {n.url && <a className="jv-cb-fuente" href={n.url} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-3.5 h-3.5" />Abrir la fuente{sitio ? ` · ${sitio}` : ''}</a>}
            </Bloque>
          )}
        </Editable>
      )}
      <Bloque titulo={`Puntos (${puntos.length})`}>
        <div className="jv-cb-puntos">
          {puntos.map(p => (
            <Fragment key={p.id}><Editable valor={p.etiqueta} etiqueta="Texto del punto" onGuardar={t => void onActualizar(p, esNota(p) ? { etiqueta: t, resumen: t } : { etiqueta: t }, 'Punto corregido.')}>
              {editar => (
                <div className="jv-cb-punto" data-punto={p.id} data-marcado={p.id === marcado || undefined} onPointerEnter={() => onMarcar(p.id)}>
                  <i aria-hidden />
                  <button type="button" className="jv-cb-ptxt" onClick={() => (esNota(p) && !arbol.hijos.get(p.id)?.length ? onMarcar(p.id) : onElegir(p.id))} title={esNota(p) ? undefined : 'Abrir'}>
                    {p.nombre}{!esNota(p) && <small> ›</small>}
                  </button>
                  <button type="button" className="jv-cb-mini" aria-label={`Editar «${p.nombre}»`} title="Editar" onClick={editar}><Pencil className="w-3.5 h-3.5" /></button>
                  <button type="button" className="jv-cb-mini" aria-label={`Borrar «${p.nombre}»`} title="Borrar" onClick={() => onOlvidar([p.id])}><X className="w-3.5 h-3.5" /></button>
                </div>
              )}
            </Editable></Fragment>
          ))}
        </div>
        <Agregador ph="Agregar un punto" onAgregar={onAgregar} />
      </Bloque>
      {!!vec.length && (
        <Bloque titulo="Conectado con">
          <div className="jv-cb-chips">{vec.slice(0, 16).map(v => <button key={v.id} type="button" onClick={() => onElegir(v.id)}>{v.nombre}</button>)}</div>
        </Bloque>
      )}
      {confirmar ? (
        <div className="jv-cb-confirmar">
          <span>¿Olvidar «{n.nombre}»{puntos.length ? ` y sus ${puntos.length} puntos` : ''}? Jarvis deja de usarlo.</span>
          <div className="jv-cb-botones"><button type="button" className="jv-btn" onClick={() => setConfirmar(false)}>Cancelar</button><button type="button" className="jv-btn" data-mal onClick={() => onOlvidar([n.id])}>Olvidar</button></div>
        </div>
      ) : (
        <div className="jv-cb-acciones">
          {onPreguntar && <button type="button" className="jv-btn" onClick={() => onPreguntar(`¿Qué sabés de ${n.nombre}?`)}><MessageCircleQuestion className="w-4 h-4" />Preguntar</button>}
          {!fijo && !madre && (
            <select value="" aria-label="Mover a otra rama" onChange={e => e.target.value && onMover(e.target.value)}>
              <option value="">Mover a otra rama…</option>
              {arbol.ramas.filter(x => x.nodo && x.id !== r?.id).map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}
            </select>
          )}
          {!fijo && <button type="button" className="jv-btn" data-mal onClick={() => setConfirmar(true)}>Olvidar</button>}
        </div>
      )}
    </>
  );
}
