// =====================================================================
// CEREBRO DE JARVIS — lo que sabe, como una red neuronal en 3D
// =====================================================================
// Cada neurona es algo REAL que Jarvis aprendió (tabla jarvis_nodos) y cada
// sinapsis, cómo se relaciona (jarvis_enlaces). Las ramas salen del núcleo
// hacia afuera, como un estallido:
//
//   Technoverse → Dispositivos electrónicos → iPhone → iPhone 15 Pro
//                                              ├─ Inventario · iPhone
//                                              ├─ Taller · iPhone
//                                              └─ Internet · iPhone
//
// Con el dedo: arrastrar gira el cerebro (con inercia), pellizcar acerca y
// tocar una neurona la trae al frente y abre lo que sabe (resumen, fuente,
// conexiones) con «Preguntar», «Corregir» y «Olvidar». Lo usado en los
// últimos dos días lleva pulsos que viajan por sus sinapsis; lo aprendido
// hoy brilla más. Hay buscador, filtros, «Lo último que aprendió», la
// curva de crecimiento y una vista en lista (teclado y lector de pantalla).
//
// Motor 3D propio sobre Canvas 2D, sin librerías: proyección en
// perspectiva, profundidad con niebla, brillo pre-dibujado por color.
// Pensado para el Galaxy A12: ≤30 cps en equipos de ≤4 GB, se duerme
// cuando no hay nada que animar o la pantalla no se ve, y respeta
// «reducir movimiento» (sin giro automático ni pulsos).
// =====================================================================

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { Brain, RefreshCw, Search, Plus, Minus, LocateFixed, Orbit, ListTree, X, Pencil, Trash2, ExternalLink, MessageCircleQuestion, GraduationCap, ChevronRight, Play, Pause, Sparkles } from 'lucide-react';
import { supabase } from '../../supabaseClient';

type Tipo = 'raiz' | 'dominio' | 'modulo' | 'tema' | 'dato' | 'fuente' | 'recuerdo';
type Fila = { id: string; clave: string; etiqueta: string; tipo: Tipo; resumen: string | null; fuente: string | null; url: string | null; usos: number; ultimo_uso: string | null; creado_en: string; actualizado_en: string };
type Enlace = { id: string; origen: string; destino: string; relacion: string; peso: number };
type Grupo = 'centro' | 'temas' | 'datos' | 'internet' | 'vos';
type Red = { porId: Map<string, Fila>; vecinos: Map<string, { id: string; relacion: string; sale: boolean }[]>; prof: Map<string, number>; padre: Map<string, string>; hijos: Map<string, string[]>; maxP: number; raiz?: Fila };

const GRUPOS: { id: Grupo; nombre: string }[] = [
  { id: 'centro', nombre: 'Negocio' },
  { id: 'temas', nombre: 'Temas' },
  { id: 'datos', nombre: 'Inventario y taller' },
  { id: 'internet', nombre: 'Internet' },
  { id: 'vos', nombre: 'Sobre vos' },
];
const NOMBRE_TIPO: Record<Tipo, string> = { raiz: 'Núcleo', dominio: 'Rama', modulo: 'Módulo', tema: 'Tema', dato: 'Dato del negocio', fuente: 'De internet', recuerdo: 'Recuerdo' };
const NOMBRE_FUENTE: Record<string, string> = { internet: 'internet', inventario: 'inventario', taller: 'taller', vos: 'vos', jarvis: 'Jarvis' };

function grupoDe(n: Fila): Grupo {
  if (n.tipo === 'recuerdo' || n.clave === 'dom:dueno') return 'vos';
  if (n.tipo === 'fuente' || n.clave === 'dom:internet') return 'internet';
  if (n.tipo === 'dato') return 'datos';
  if (n.tipo === 'tema' || n.clave.startsWith('dom:rama:')) return 'temas';
  return 'centro';
}
const reciente = (f: string | null, h = 24) => !!f && Date.now() - new Date(f).getTime() < h * 3600_000;
const fecha = (f: string | null) => f ? new Date(f).toLocaleDateString('es-CR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const dominioDe = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const sinTildes = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const sinPrefijo = (t: string) => t.replace(/^(Inventario|Taller|Internet) · /, '');
function haceCuanto(f: string): string {
  const m = Math.max(1, Math.round((Date.now() - new Date(f).getTime()) / 60_000));
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60); if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24); return d === 1 ? 'ayer' : `hace ${d} días`;
}
/** Número estable por texto (cada neurona cae siempre en el mismo lugar). */
function hash(t: string): number { let h = 2166136261; for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296; }

export default function CerebroJarvis({ onPreguntar }: { onPreguntar?: (texto: string) => void }) {
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [enlaces, setEnlaces] = useState<Enlace[]>([]);
  const [error, setError] = useState<'sin_tablas' | 'red' | null>(null);
  const [cargando, setCargando] = useState(false);
  const [vista, setVista] = useState<'3d' | 'lista'>(() => { try { return localStorage.getItem('tv_cerebro_vista') === 'lista' ? 'lista' : '3d'; } catch { return '3d'; } });
  const [ocultos, setOcultos] = useState<Set<Grupo>>(new Set());
  const [buscar, setBuscar] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [ensenar, setEnsenar] = useState('');
  const enfocarRef = useRef<(id: string) => void>(() => {});
  const detalleRef = useRef<HTMLDivElement>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    const [n, e] = await Promise.all([
      supabase.from('jarvis_nodos').select('id,clave,etiqueta,tipo,resumen,fuente,url,usos,ultimo_uso,creado_en,actualizado_en').order('actualizado_en', { ascending: false }).limit(800),
      supabase.from('jarvis_enlaces').select('id,origen,destino,relacion,peso').limit(2500),
    ]);
    setCargando(false);
    if (n.error) { setError(/does not exist|relation|schema cache|could not find/i.test(n.error.message) ? 'sin_tablas' : 'red'); return; }
    setError(null);
    setFilas((n.data || []) as Fila[]);
    setEnlaces((e.data || []) as Enlace[]);
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  useEffect(() => { try { localStorage.setItem('tv_cerebro_vista', vista); } catch { /* nada */ } }, [vista]);

  // Árbol desde el núcleo (recorrido sin dirección): profundidad, padre e hijos.
  const red = useMemo<Red>(() => {
    const lista = filas || [];
    const porId = new Map(lista.map(f => [f.id, f]));
    const vecinos = new Map<string, { id: string; relacion: string; sale: boolean }[]>();
    const de = (id: string) => { let l = vecinos.get(id); if (!l) { l = []; vecinos.set(id, l); } return l; };
    for (const e of enlaces) {
      if (!porId.has(e.origen) || !porId.has(e.destino)) continue;
      de(e.origen).push({ id: e.destino, relacion: e.relacion, sale: true });
      de(e.destino).push({ id: e.origen, relacion: e.relacion, sale: false });
    }
    const prof = new Map<string, number>();
    const padre = new Map<string, string>();
    const hijos = new Map<string, string[]>();
    const raiz = lista.find(f => f.tipo === 'raiz');
    if (raiz) {
      prof.set(raiz.id, 0);
      const cola = [raiz.id];
      while (cola.length) {
        const id = cola.shift()!;
        // Primero los enlaces que salen: así el árbol sigue las ramas.
        const vs = [...(vecinos.get(id) || [])].sort((a, b) => Number(b.sale) - Number(a.sale));
        for (const v of vs) if (!prof.has(v.id)) {
          prof.set(v.id, prof.get(id)! + 1); padre.set(v.id, id); cola.push(v.id);
          let l = hijos.get(id); if (!l) { l = []; hijos.set(id, l); } l.push(v.id);
        }
      }
    }
    return { porId, vecinos, prof, padre, hijos, maxP: Math.max(1, ...prof.values()), raiz };
  }, [filas, enlaces]);

  const seleccion = sel ? red.porId.get(sel) || null : null;
  const resultados = useMemo(() => {
    const q = sinTildes(buscar.trim());
    if (q.length < 2 || !filas) return [];
    return filas.filter(f => sinTildes(f.etiqueta).includes(q) || sinTildes(f.resumen || '').includes(q)).slice(0, 6);
  }, [buscar, filas]);
  const ultimos = useMemo(() => (filas || []).filter(f => f.tipo !== 'raiz' && f.tipo !== 'dominio' && f.tipo !== 'modulo')
    .sort((a, b) => b.creado_en.localeCompare(a.creado_en)).slice(0, 8), [filas]);
  // Crecimiento: ideas nuevas por día en las últimas dos semanas.
  const curva = useMemo(() => {
    const dias = Array.from({ length: 14 }, () => 0);
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    for (const f of filas || []) {
      const d = Math.floor((hoy.getTime() - new Date(f.creado_en).setHours(0, 0, 0, 0)) / 86400_000);
      if (d >= 0 && d < 14) dias[13 - d]++;
    }
    return dias;
  }, [filas]);
  const semana = curva.slice(7).reduce((a, b) => a + b, 0);

  const elegir = (id: string, bajar = false) => {
    setSel(id); setBuscar('');
    // Si estaba escondido por un filtro, se vuelve a mostrar.
    const f = red.porId.get(id);
    if (f && ocultos.has(grupoDe(f))) setOcultos(o => { const n = new Set(o); n.delete(grupoDe(f)); return n; });
    if (vista === '3d') enfocarRef.current(id);
    if (bajar) setTimeout(() => detalleRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 60);
  };
  const pedir = (texto: string) => { if (onPreguntar && texto.trim()) onPreguntar(texto.trim()); };

  if (error === 'sin_tablas') {
    return (
      <div className="jv-cerebro">
        <div className="jv-cerebro-vacio-caja">
          <span className="jv-cb-logo"><Brain className="w-6 h-6" aria-hidden /></span>
          <b>El cerebro todavía no está instalado</b>
          <p>Falta correr «migracion_jarvis_cerebro.sql» en Supabase. Mientras tanto Jarvis responde normal, solo que no guarda lo que aprende.</p>
          <button type="button" className="ai-chip" onClick={() => void cargar()}><RefreshCw className="w-4 h-4" />Volver a revisar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="jv-cerebro">
      {/* Resumen: cuánto sabe y cómo viene creciendo */}
      <div className="jv-cb-resumen">
        <div className="jv-cb-cifra"><b>{filas?.length ?? '—'}</b><span>ideas</span></div>
        <div className="jv-cb-cifra"><b>{filas ? enlaces.length : '—'}</b><span>conexiones</span></div>
        <div className="jv-cb-cifra jv-cb-crece">
          <b>{filas ? `+${semana}` : '—'}</b><span>esta semana</span>
          <Curva valores={curva} />
        </div>
        <button type="button" className="jv-cerebro-ic" aria-label="Actualizar" title="Actualizar" onClick={() => void cargar()} disabled={cargando}>
          <RefreshCw className={`w-4 h-4 ${cargando ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {onPreguntar && (
        <form className="jv-cerebro-ensenar" onSubmit={e => { e.preventDefault(); if (ensenar.trim().length >= 2) { pedir(`Aprendé todo sobre ${ensenar.trim()}`); setEnsenar(''); } }}>
          <GraduationCap className="w-4 h-4 shrink-0" aria-hidden />
          <input value={ensenar} onChange={e => setEnsenar(e.target.value)} placeholder="Enseñale un tema: «baterías de iPhone»" aria-label="Tema para que Jarvis aprenda" maxLength={80} enterKeyHint="send" />
          <button type="submit" className="ai-chip" disabled={ensenar.trim().length < 2}>Aprender</button>
        </form>
      )}

      <div className="jv-cerebro-barra">
        <label className="jv-cerebro-buscar">
          <Search className="w-4 h-4 shrink-0" aria-hidden />
          <input value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="Buscar en el cerebro" aria-label="Buscar en el cerebro" enterKeyHint="search"
            onKeyDown={e => { if (e.key === 'Enter' && resultados[0]) { e.preventDefault(); elegir(resultados[0].id); } }} />
          {buscar && <button type="button" className="jv-cerebro-ic" aria-label="Borrar búsqueda" onClick={() => setBuscar('')}><X className="w-4 h-4" /></button>}
        </label>
        <div className="jv-cerebro-vistas" role="group" aria-label="Cómo ver el cerebro">
          <button type="button" aria-pressed={vista === '3d'} onClick={() => setVista('3d')} aria-label="Ver en 3D" title="3D"><Orbit className="w-4 h-4" /></button>
          <button type="button" aria-pressed={vista === 'lista'} onClick={() => setVista('lista')} aria-label="Ver como lista" title="Lista"><ListTree className="w-4 h-4" /></button>
        </div>
      </div>
      {buscar.trim().length >= 2 && (
        resultados.length ? (
          <ul className="jv-cerebro-resultados" aria-label="Resultados">
            {resultados.map(r => (
              <li key={r.id}><button type="button" onClick={() => elegir(r.id)}>
                <i data-g={grupoDe(r)} aria-hidden /><span>{r.etiqueta}</span><small>{NOMBRE_TIPO[r.tipo]}</small>
              </button></li>
            ))}
          </ul>
        ) : (
          <p className="jv-cerebro-sinres">
            No sabe nada de «{buscar.trim().slice(0, 40)}» todavía.
            {onPreguntar && <button type="button" className="ai-chip" onClick={() => { pedir(`Aprendé todo sobre ${buscar.trim()}`); setBuscar(''); }}><GraduationCap className="w-4 h-4" />Que lo aprenda</button>}
          </p>
        )
      )}

      <div className="jv-cerebro-filtros" role="group" aria-label="Qué mostrar">
        {GRUPOS.map(g => (
          <button key={g.id} type="button" aria-pressed={!ocultos.has(g.id)} data-g={g.id}
            onClick={() => setOcultos(o => { const n = new Set(o); if (n.has(g.id)) n.delete(g.id); else n.add(g.id); return n; })}>
            <i aria-hidden />{g.nombre}
          </button>
        ))}
      </div>

      {filas === null ? (
        <div className="jv-cb-escena"><p className="jv-cerebro-vacio">{error === 'red' ? 'No se pudo leer el cerebro. Revisá la conexión.' : 'Despertando el cerebro…'}</p></div>
      ) : !filas.length ? (
        <div className="jv-cerebro-vacio-caja">
          <span className="jv-cb-logo"><Brain className="w-6 h-6" aria-hidden /></span>
          <b>Todavía está en blanco</b>
          <p>Cada tema que le pidas investigar, cada búsqueda en internet y cada «recordá…» aparece aquí como una neurona nueva.</p>
          {onPreguntar && <button type="button" className="ai-chip" onClick={() => pedir('Aprendé todo sobre iPhone')}><GraduationCap className="w-4 h-4" />Probar: aprender sobre iPhone</button>}
        </div>
      ) : vista === '3d' ? (
        <Escena3D filas={filas} enlaces={enlaces} red={red} ocultos={ocultos} sel={sel} onSel={setSel} enfocarRef={enfocarRef} />
      ) : (
        <Arbol red={red} filas={filas} ocultos={ocultos} sel={sel} onSel={setSel} />
      )}

      <div ref={detalleRef}>
        {seleccion ? (
          <Detalle n={seleccion} red={red} onSel={id => elegir(id)} onCerrar={() => setSel(null)} onPreguntar={onPreguntar ? pedir : undefined}
            onCambio={(id, cambios) => setFilas(fs => (fs || []).map(f => f.id === id ? { ...f, ...cambios } : f))}
            onBorrados={ids => { setSel(null); setFilas(fs => (fs || []).filter(f => !ids.includes(f.id))); setEnlaces(es => es.filter(e => !ids.includes(e.origen) && !ids.includes(e.destino))); }} />
        ) : !!ultimos.length && (
          <section className="jv-cb-ultimos" aria-label="Lo último que aprendió">
            <h4><Sparkles className="w-4 h-4" aria-hidden />Lo último que aprendió</h4>
            <ul>
              {ultimos.map(u => (
                <li key={u.id}><button type="button" onClick={() => elegir(u.id, true)}>
                  <i data-g={grupoDe(u)} aria-hidden />
                  <span>{u.etiqueta}</span>
                  <small>{haceCuanto(u.creado_en)}</small>
                </button></li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

/** Curva chiquita de crecimiento (14 días). */
function Curva({ valores }: { valores: number[] }) {
  const max = Math.max(1, ...valores);
  const pts = valores.map((v, i) => `${(i / (valores.length - 1)) * 100},${28 - (v / max) * 24}`).join(' ');
  return (
    <svg className="jv-cb-curva" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden>
      <polygon points={`0,30 ${pts} 100,30`} />
      <polyline points={pts} />
    </svg>
  );
}

// ---------------------------------------------------------------------
// ESCENA 3D (Canvas 2D con proyección en perspectiva)
// ---------------------------------------------------------------------
type V3 = { x: number; y: number; z: number };
type Neurona = { f: Fila; g: Grupo; p: V3; r: number; sx: number; sy: number; sz: number; e: number };

const RADIO_CAPA = [0, 1, 1.85, 2.6, 3.2, 3.7, 4.1];
const norm = (v: V3): V3 => { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; };
const cruz = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

/** Disposición en estallido: las ramas del núcleo se reparten por la
 *  esfera y cada una abre un cono con sus hijos, capa por capa. */
function disponer(filas: Fila[], red: Red): Map<string, V3> {
  const pos = new Map<string, V3>();
  const dir = new Map<string, V3>();
  const capa = (d: number) => RADIO_CAPA[Math.min(d, RADIO_CAPA.length - 1)] + Math.max(0, d - (RADIO_CAPA.length - 1)) * 0.4;
  if (red.raiz) {
    pos.set(red.raiz.id, { x: 0, y: 0, z: 0 });
    const primeros = red.hijos.get(red.raiz.id) || [];
    const n = primeros.length;
    primeros.forEach((id, i) => {
      // Esfera de Fibonacci: reparto parejo sin amontonar polos.
      const y = n === 1 ? 0 : 1 - 2 * (i + 0.5) / n, rr = Math.sqrt(1 - y * y), phi = i * 2.399963 + 0.6;
      dir.set(id, { x: Math.cos(phi) * rr, y: y * 0.85, z: Math.sin(phi) * rr });
    });
    const cola = [...primeros];
    while (cola.length) {
      const id = cola.shift()!;
      const v = norm(dir.get(id)!);
      const d = red.prof.get(id) || 1;
      pos.set(id, { x: v.x * capa(d), y: v.y * capa(d), z: v.z * capa(d) });
      const hs = red.hijos.get(id) || [];
      if (!hs.length) continue;
      const a = Math.abs(v.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
      const u = norm(cruz(v, a)), w = cruz(v, u);
      const k = hs.length;
      const cono = k === 1 ? 0.12 : Math.min(0.95, 0.22 + 0.11 * Math.sqrt(k)) / (1 + 0.3 * (d - 1));
      const giro = hash(id) * Math.PI * 2;
      hs.forEach((h, i) => {
        // Dos anillos si son muchos, para que no queden en fila.
        const t = k > 7 && i % 2 ? cono * 0.55 : cono;
        const al = giro + (2 * Math.PI * i) / k;
        dir.set(h, norm({
          x: v.x * Math.cos(t) + (u.x * Math.cos(al) + w.x * Math.sin(al)) * Math.sin(t),
          y: v.y * Math.cos(t) + (u.y * Math.cos(al) + w.y * Math.sin(al)) * Math.sin(t),
          z: v.z * Math.cos(t) + (u.z * Math.cos(al) + w.z * Math.sin(al)) * Math.sin(t),
        }));
        cola.push(h);
      });
    }
  }
  // Lo que no cuelga del núcleo flota en la capa de afuera.
  const sueltos = filas.filter(f => !pos.has(f.id));
  sueltos.forEach((f, i) => {
    const n = sueltos.length, y = 1 - 2 * (i + 0.5) / n, rr = Math.sqrt(1 - y * y), phi = i * 2.399963;
    const R = capa(red.maxP + 1);
    pos.set(f.id, { x: Math.cos(phi) * rr * R, y: y * R, z: Math.sin(phi) * rr * R });
  });
  // Todo dentro de una esfera de radio 1.
  let max = 0.001;
  for (const p of pos.values()) max = Math.max(max, Math.hypot(p.x, p.y, p.z));
  for (const [k, p] of pos) pos.set(k, { x: p.x / max, y: p.y / max, z: p.z / max });
  return pos;
}

const tamano = (f: Fila) => f.tipo === 'raiz' ? 15 : f.tipo === 'dominio' ? 9 : f.tipo === 'modulo' ? 7 : f.tipo === 'tema' ? 5.5 + Math.min(5, Math.sqrt(f.usos || 0) * 1.3) : 4;

/** Brillo pre-dibujado por color (dibujar un gradiente por neurona y por cuadro sería caro). */
function brillo(color: string): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  // El borde es el MISMO color con alfa 0: con 'transparent' (negro sin
  // alfa) el halo se ensuciaba de gris en el tema claro.
  x.fillStyle = color; const rgb = x.fillStyle.startsWith('#') ? x.fillStyle : '#0790a6';
  const n = parseInt(rgb.slice(1), 16), r = (n >> 16) & 255, gg = (n >> 8) & 255, b = n & 255;
  g.addColorStop(0, `rgba(${r},${gg},${b},1)`); g.addColorStop(0.25, `rgba(${r},${gg},${b},0.9)`); g.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  x.fillStyle = g; x.globalAlpha = 0.55; x.fillRect(0, 0, 64, 64);
  return c;
}

function Escena3D({ filas, enlaces, red, ocultos, sel, onSel, enfocarRef }: {
  filas: Fila[]; enlaces: Enlace[]; red: Red; ocultos: Set<Grupo>; sel: string | null; onSel: (id: string | null) => void;
  enfocarRef: MutableRefObject<(id: string) => void>;
}) {
  const cajaRef = useRef<HTMLDivElement>(null);
  const lienzoRef = useRef<HTMLCanvasElement>(null);
  const quieto = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const liviano = typeof navigator !== 'undefined' && ((navigator as any).deviceMemory ?? 8) <= 4;
  const [girando, setGirando] = useState(!quieto);
  const [ayuda, setAyuda] = useState(true);
  const est = useRef({
    neuronas: [] as Neurona[], porId: new Map<string, Neurona>(), sinapsis: [] as { a: Neurona; b: Neurona; peso: number; vivo: boolean; fase: number }[],
    polvo: [] as V3[], yaw: 0.6, pitch: -0.25, zoom: 1, vYaw: 0, vPitch: 0,
    meta: null as null | { yaw: number; pitch: number; zoom: number }, w: 300, h: 300, dpr: 1,
    sel: null as string | null, ocultos: new Set<Grupo>(), girar: !quieto, ultimoToque: 0, pulso: 0,
    ayuda: true, colores: {} as Record<Grupo, string>, brillos: {} as Record<Grupo, HTMLCanvasElement>, texto: '#111', fondo: '#fff', oscuro: false,
  });
  const rafRef = useRef(0);
  const onSelRef = useRef(onSel); onSelRef.current = onSel;

  // Colores del tema (se releen si cambia claro/oscuro).
  const leerColores = useCallback(() => {
    const c = lienzoRef.current; if (!c) return;
    const s = est.current, cs = getComputedStyle(c);
    for (const g of GRUPOS) { s.colores[g.id] = cs.getPropertyValue(`--jv-n-${g.id}`).trim() || '#0A8FA3'; s.brillos[g.id] = brillo(s.colores[g.id]); }
    s.texto = cs.getPropertyValue('--jv-esc-texto').trim() || '#111';
    s.fondo = cs.getPropertyValue('--jv-esc-halo').trim() || '#fff';
    s.oscuro = cs.getPropertyValue('--jv-esc-oscuro').trim() === '1';
  }, []);

  // Dibujo de un cuadro.
  const dibujar = useCallback(() => {
    const c = lienzoRef.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    const s = est.current;
    ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
    ctx.clearRect(0, 0, s.w, s.h);
    const cx = s.w / 2, cy = s.h / 2;
    const base = Math.min(s.w * 0.47, s.h * 0.42) * s.zoom;
    const cyw = Math.cos(s.yaw), syw = Math.sin(s.yaw), cp = Math.cos(s.pitch), sp = Math.sin(s.pitch);
    const D = 3.2;
    const proyectar = (p: V3, out: { sx: number; sy: number; sz: number; e: number }) => {
      const x1 = p.x * cyw + p.z * syw, z1 = -p.x * syw + p.z * cyw;
      const y2 = p.y * cp - z1 * sp, z2 = p.y * sp + z1 * cp;
      const e = D / (D + z2);
      out.sx = cx + x1 * e * base; out.sy = cy + y2 * e * base; out.sz = z2; out.e = e;
    };
    // Polvo de fondo (da profundidad al girar).
    const tmp = { sx: 0, sy: 0, sz: 0, e: 0 };
    ctx.fillStyle = s.texto;
    for (const p of s.polvo) {
      proyectar(p, tmp);
      ctx.globalAlpha = (s.oscuro ? 0.35 : 0.18) * (1 - (tmp.sz + 1.6) / 3.2);
      ctx.fillRect(tmp.sx, tmp.sy, 1.2, 1.2);
    }
    for (const n of s.neuronas) proyectar(n.p, n);
    const cerca = new Set<string>();
    if (s.sel) { cerca.add(s.sel); for (const v of red.vecinos.get(s.sel) || []) cerca.add(v.id); }
    const visible = (n: Neurona) => !s.ocultos.has(n.g) || n.f.id === s.sel;
    const niebla = (z: number) => Math.max(0.12, 1 - (z + 1) * 0.42);

    // Sinapsis: curvas suaves que se abren hacia afuera del núcleo.
    const nucleo = red.raiz ? s.porId.get(red.raiz.id) : undefined;
    ctx.lineCap = 'round';
    for (const l of s.sinapsis) {
      if (!visible(l.a) || !visible(l.b)) continue;
      const activa = !!s.sel && (l.a.f.id === s.sel || l.b.f.id === s.sel);
      const z = (l.a.sz + l.b.sz) / 2;
      ctx.globalAlpha = (s.sel ? (activa ? 0.95 : 0.06) : 0.34) * niebla(z);
      ctx.strokeStyle = s.colores[l.b.g];
      ctx.lineWidth = (activa ? 2 : 0.7 + Math.min(1.8, Math.log2(l.peso || 1) * 0.5)) * Math.min(1.4, (l.a.e + l.b.e) / 2);
      const mx = (l.a.sx + l.b.sx) / 2, my = (l.a.sy + l.b.sy) / 2;
      const ox = nucleo ? (mx - nucleo.sx) * 0.12 : 0, oy = nucleo ? (my - nucleo.sy) * 0.12 : 0;
      ctx.beginPath(); ctx.moveTo(l.a.sx, l.a.sy); ctx.quadraticCurveTo(mx + ox, my + oy, l.b.sx, l.b.sy); ctx.stroke();
      // Pulso que viaja por lo que se usó en los últimos dos días.
      if (l.vivo && !quieto) {
        const t = (s.pulso + l.fase) % 1, u = 1 - t;
        const px = u * u * l.a.sx + 2 * u * t * (mx + ox) + t * t * l.b.sx, py = u * u * l.a.sy + 2 * u * t * (my + oy) + t * t * l.b.sy;
        ctx.globalAlpha = (s.sel && !activa ? 0.15 : 1) * niebla(z);
        ctx.drawImage(s.brillos[l.b.g], px - 7, py - 7, 14, 14);
      }
    }
    // Neuronas, de atrás para adelante.
    const orden = s.neuronas.filter(visible).sort((a, b) => b.sz - a.sz);
    for (const n of orden) {
      const tenue = !!s.sel && !cerca.has(n.f.id);
      const a = niebla(n.sz) * (tenue ? 0.25 : 1);
      const r = n.r * n.e * Math.min(1.6, Math.max(0.75, s.zoom));
      const nuevo = reciente(n.f.creado_en);
      // Halo (no en lo atenuado: solo ensucia)
      if (!tenue) {
      ctx.globalAlpha = a * (nuevo ? 1 : 0.7) * (s.oscuro ? 1 : 0.75);
      if (s.oscuro) ctx.globalCompositeOperation = 'lighter';
      const hr = r * (n.f.tipo === 'raiz' ? 5 : nuevo ? 4.2 : 3);
      ctx.drawImage(s.brillos[n.g], n.sx - hr, n.sy - hr, hr * 2, hr * 2);
      ctx.globalCompositeOperation = 'source-over';
      }
      // Cuerpo
      ctx.globalAlpha = a;
      ctx.fillStyle = s.colores[n.g];
      ctx.beginPath(); ctx.arc(n.sx, n.sy, r, 0, Math.PI * 2); ctx.fill();
      // Brillo interior (luz desde arriba a la izquierda)
      ctx.globalAlpha = a * (s.oscuro ? 0.55 : 0.4);
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(n.sx - r * 0.3, n.sy - r * 0.32, r * 0.38, 0, Math.PI * 2); ctx.fill();
      if (n.f.id === s.sel) {
        ctx.globalAlpha = 1; ctx.strokeStyle = s.texto; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(n.sx, n.sy, r + 4, 0, Math.PI * 2); ctx.stroke();
      }
    }
    // Nombres: por importancia y de adelante para atrás; el que choca se omite.
    ctx.globalAlpha = 1; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.lineJoin = 'round';
    const ORDEN: Record<string, number> = { raiz: 0, dominio: 1, modulo: 2, tema: 3, recuerdo: 4, dato: 5, fuente: 5 };
    // Zonas ocupadas por los controles (abajo a la derecha) y la ayuda (arriba):
    // ningún nombre queda debajo de ellos.
    const puestos: number[][] = [[s.w - 56, s.h - 176, s.w, s.h], [0, 0, s.w, s.ayuda ? 44 : 0]];
    const candidatos = [...orden].sort((a, b) => Number(b.f.id === s.sel) - Number(a.f.id === s.sel) || ORDEN[a.f.tipo] - ORDEN[b.f.tipo] || a.sz - b.sz);
    for (const n of candidatos) {
      const ver = s.sel ? cerca.has(n.f.id) || n.f.tipo === 'raiz'
        : n.f.tipo === 'raiz' || n.f.tipo === 'dominio' || (n.f.tipo === 'modulo' && s.zoom > 0.9) || (n.f.tipo === 'tema' && n.sz < 0.15 && s.zoom > 1.1) || (s.zoom > 1.8 && n.sz < 0.3);
      if (!ver) continue;
      const fuerte = n.f.tipo === 'raiz' || n.f.tipo === 'dominio' || n.f.id === s.sel;
      ctx.font = `${fuerte ? 700 : 500} ${n.f.tipo === 'raiz' ? 13 : 11.5}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
      const et = n.f.etiqueta.length > 24 ? n.f.etiqueta.slice(0, 23) + '…' : n.f.etiqueta;
      const r = n.r * n.e * Math.min(1.6, Math.max(0.75, s.zoom));
      const y = n.sy + r + 4, ancho = ctx.measureText(et).width;
      const caja = [n.sx - ancho / 2 - 3, y - 1, n.sx + ancho / 2 + 3, y + 15];
      if (caja[0] < 2 || caja[2] > s.w - 2 || caja[3] > s.h - 2) { if (n.f.id !== s.sel) continue; }
      if (n.f.id !== s.sel && puestos.some(p => caja[0] < p[2] && caja[2] > p[0] && caja[1] < p[3] && caja[3] > p[1])) continue;
      puestos.push(caja);
      ctx.globalAlpha = Math.max(0.55, niebla(n.sz));
      ctx.strokeStyle = s.fondo; ctx.lineWidth = 4; ctx.strokeText(et, n.sx, y);
      ctx.fillStyle = s.texto; ctx.fillText(et, n.sx, y);
    }
    ctx.globalAlpha = 1;
  }, [red, quieto]);

  // Bucle de animación: solo corre mientras hay algo que mover.
  const despertar = useCallback(() => {
    if (rafRef.current) return;
    let previo = 0;
    const paso = (t: number) => {
      const s = est.current;
      const dt = previo ? Math.min(64, t - previo) : 16;
      if (previo && dt < (liviano ? 32 : 15)) { rafRef.current = requestAnimationFrame(paso); return; }
      previo = t;
      let mueve = false;
      if (s.meta) {
        // Viaje hacia la neurona elegida.
        const k = quieto ? 1 : Math.min(1, dt / 160);
        let dy = s.meta.yaw - s.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        s.yaw += dy * k; s.pitch += (s.meta.pitch - s.pitch) * k; s.zoom += (s.meta.zoom - s.zoom) * k;
        if (Math.abs(dy) < 0.002 && Math.abs(s.meta.pitch - s.pitch) < 0.002 && Math.abs(s.meta.zoom - s.zoom) < 0.003) s.meta = null;
        mueve = true;
      } else if (Math.abs(s.vYaw) > 0.0001 || Math.abs(s.vPitch) > 0.0001) {
        // Inercia después de soltar.
        s.yaw += s.vYaw * dt; s.pitch = Math.max(-1.35, Math.min(1.35, s.pitch + s.vPitch * dt));
        s.vYaw *= Math.pow(0.94, dt / 16); s.vPitch *= Math.pow(0.94, dt / 16);
        mueve = true;
      } else if (s.girar && !s.sel && Date.now() - s.ultimoToque > 2500) {
        s.yaw += 0.00012 * dt; mueve = true;
      }
      const pulsos = !quieto && s.sinapsis.some(l => l.vivo) && Date.now() - s.ultimoToque < 30_000;
      if (pulsos) { s.pulso = (s.pulso + dt * 0.00035) % 1; mueve = true; }
      if (document.hidden) mueve = false;
      dibujar();
      rafRef.current = mueve ? requestAnimationFrame(paso) : 0;
    };
    rafRef.current = requestAnimationFrame(paso);
  }, [dibujar, liviano, quieto]);
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);
  useEffect(() => {
    const vis = () => { if (!document.hidden) despertar(); };
    document.addEventListener('visibilitychange', vis);
    return () => document.removeEventListener('visibilitychange', vis);
  }, [despertar]);

  // Datos → neuronas y sinapsis (posiciones estables por rama).
  useEffect(() => {
    const s = est.current;
    const pos = disponer(filas, red);
    s.neuronas = filas.map(f => ({ f, g: grupoDe(f), p: pos.get(f.id)!, r: tamano(f), sx: 0, sy: 0, sz: 0, e: 1 }));
    s.porId = new Map(s.neuronas.map(n => [n.f.id, n]));
    s.sinapsis = enlaces.filter(e => s.porId.has(e.origen) && s.porId.has(e.destino)).map(e => {
      const b = s.porId.get(e.destino)!;
      return { a: s.porId.get(e.origen)!, b, peso: e.peso, vivo: reciente(b.f.ultimo_uso, 48), fase: hash(e.id) };
    });
    if (!s.polvo.length) s.polvo = Array.from({ length: liviano ? 50 : 90 }, (_, i) => {
      const u = hash(`p${i}`) * 2 - 1, phi = hash(`q${i}`) * Math.PI * 2, R = 1.25 + hash(`r${i}`) * 0.6, rr = Math.sqrt(1 - u * u);
      return { x: Math.cos(phi) * rr * R, y: u * R, z: Math.sin(phi) * rr * R };
    });
    s.ultimoToque = Date.now();
    despertar();
  }, [filas, enlaces, red, despertar, liviano]);

  useEffect(() => { const s = est.current; s.sel = sel; s.ocultos = ocultos; s.girar = girando; s.ultimoToque = Date.now(); despertar(); }, [sel, ocultos, girando, despertar]);

  // Tamaño, tema y gestos.
  useEffect(() => {
    const caja = cajaRef.current, c = lienzoRef.current;
    if (!caja || !c) return;
    const s = est.current;
    const medir = () => {
      const r = caja.getBoundingClientRect();
      s.dpr = Math.min(liviano ? 1.5 : 2, window.devicePixelRatio || 1);
      s.w = Math.max(160, r.width); s.h = Math.max(160, r.height);
      c.width = Math.round(s.w * s.dpr); c.height = Math.round(s.h * s.dpr);
      c.style.width = `${s.w}px`; c.style.height = `${s.h}px`;
      dibujar();
    };
    leerColores(); medir();
    const ro = new ResizeObserver(medir); ro.observe(caja);
    // Cambio de claro/oscuro: se releen los colores.
    const mo = new MutationObserver(() => { leerColores(); dibujar(); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });

    const punteros = new Map<number, { x: number; y: number }>();
    let inicio: { x: number; y: number; t: number } | null = null, movio = false, pellizco = 0, ultimo = { x: 0, y: 0, t: 0 };
    const tocar = () => { s.ultimoToque = Date.now(); s.ayuda = false; setAyuda(false); };
    const abajo = (e: PointerEvent) => {
      c.setPointerCapture?.(e.pointerId);
      punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
      s.vYaw = s.vPitch = 0; s.meta = null; tocar();
      if (punteros.size === 1) { inicio = { x: e.clientX, y: e.clientY, t: Date.now() }; movio = false; ultimo = { x: e.clientX, y: e.clientY, t: performance.now() }; }
      if (punteros.size === 2) { const [a, b] = [...punteros.values()]; pellizco = Math.hypot(a.x - b.x, a.y - b.y); movio = true; }
    };
    const mover = (e: PointerEvent) => {
      if (!punteros.has(e.pointerId)) return;
      const antes = punteros.get(e.pointerId)!;
      punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
      tocar();
      if (punteros.size === 2) {
        const [a, b] = [...punteros.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pellizco) s.zoom = Math.max(0.55, Math.min(3.2, s.zoom * d / pellizco));
        pellizco = d; dibujar(); return;
      }
      if (inicio && Math.hypot(e.clientX - inicio.x, e.clientY - inicio.y) > 6) movio = true;
      if (!movio) return;
      const dx = e.clientX - antes.x, dy = e.clientY - antes.y;
      s.yaw += dx * 0.009; s.pitch = Math.max(-1.35, Math.min(1.35, s.pitch + dy * 0.009));
      const now = performance.now(), dt = Math.max(1, now - ultimo.t);
      s.vYaw = (e.clientX - ultimo.x) * 0.009 / dt; s.vPitch = (e.clientY - ultimo.y) * 0.009 / dt;
      ultimo = { x: e.clientX, y: e.clientY, t: now };
      dibujar();
    };
    const arriba = (e: PointerEvent) => {
      if (!punteros.has(e.pointerId)) return;
      punteros.delete(e.pointerId);
      if (punteros.size === 0) {
        if (!movio && inicio) {
          // Toque: la neurona más cercana bajo el dedo (de adelante para atrás).
          const r = c.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
          let mejor: Neurona | null = null, dMin = Infinity;
          for (const n of s.neuronas) {
            if (s.ocultos.has(n.g) && n.f.id !== s.sel) continue;
            const rad = n.r * n.e * Math.min(1.6, Math.max(0.75, s.zoom)) + 14;
            const d = Math.hypot(n.sx - x, n.sy - y);
            // Lo de adelante (z más negativo) gana sobre lo que queda detrás.
            if (d < rad && d + n.sz * 8 < dMin) { dMin = d + n.sz * 8; mejor = n; }
          }
          onSelRef.current(mejor ? (mejor.f.id === s.sel ? null : mejor.f.id) : null);
          s.vYaw = s.vPitch = 0;
        } else if (Date.now() - (inicio?.t || 0) > 0 && performance.now() - ultimo.t > 80) { s.vYaw = s.vPitch = 0; }
        inicio = null; pellizco = 0;
        despertar();
      } else pellizco = 0;
    };
    const rueda = (e: WheelEvent) => { e.preventDefault(); tocar(); s.meta = null; s.zoom = Math.max(0.55, Math.min(3.2, s.zoom * Math.exp(-e.deltaY * 0.0015))); dibujar(); };
    const teclas = (e: KeyboardEvent) => {
      const paso = 0.18;
      if (e.key === 'ArrowLeft') s.yaw -= paso; else if (e.key === 'ArrowRight') s.yaw += paso;
      else if (e.key === 'ArrowUp') s.pitch = Math.max(-1.35, s.pitch - paso); else if (e.key === 'ArrowDown') s.pitch = Math.min(1.35, s.pitch + paso);
      else if (e.key === '+' || e.key === '=') s.zoom = Math.min(3.2, s.zoom * 1.2); else if (e.key === '-') s.zoom = Math.max(0.55, s.zoom / 1.2);
      else return;
      e.preventDefault(); tocar(); dibujar();
    };
    c.addEventListener('pointerdown', abajo);
    c.addEventListener('pointermove', mover);
    c.addEventListener('pointerup', arriba);
    c.addEventListener('pointercancel', arriba);
    c.addEventListener('wheel', rueda, { passive: false });
    c.addEventListener('keydown', teclas);

    enfocarRef.current = (id: string) => {
      const n = s.porId.get(id); if (!n) return;
      const { x, y, z } = n.p;
      // Girar para que quede al frente y al centro.
      // (x1 = 0 y z1 < 0 con el giro horizontal; y2 = 0 y z2 < 0 con el vertical)
      const nucleo = Math.hypot(x, y, z) < 0.01;
      // Un poco de costado: se ve la rama que la une al núcleo, sin taparlo.
      const yaw = nucleo ? s.yaw : Math.atan2(x, -z) + 0.22;
      const pitch = nucleo ? -0.25 : Math.max(-1.35, Math.min(1.35, Math.atan2(-y, Math.hypot(x, z))));
      s.meta = { yaw, pitch, zoom: Math.max(s.zoom, 1.35) };
      s.vYaw = s.vPitch = 0; tocar(); despertar();
    };
    return () => {
      ro.disconnect(); mo.disconnect();
      c.removeEventListener('pointerdown', abajo); c.removeEventListener('pointermove', mover);
      c.removeEventListener('pointerup', arriba); c.removeEventListener('pointercancel', arriba);
      c.removeEventListener('wheel', rueda); c.removeEventListener('keydown', teclas);
    };
  }, [dibujar, despertar, leerColores, enfocarRef, liviano]);

  // Al elegir desde la escena, también viaja hacia la neurona.
  useEffect(() => { if (sel) enfocarRef.current(sel); }, [sel, enfocarRef]);

  const acercar = (f: number) => { const s = est.current; s.meta = { yaw: s.yaw, pitch: s.pitch, zoom: Math.max(0.55, Math.min(3.2, s.zoom * f)) }; s.ultimoToque = Date.now(); despertar(); };
  const centrar = () => { const s = est.current; onSel(null); s.meta = { yaw: s.yaw, pitch: -0.25, zoom: 1 }; s.ultimoToque = Date.now(); despertar(); };

  return (
    <div className="jv-cb-escena" ref={cajaRef}>
      <canvas ref={lienzoRef} tabIndex={0} role="img"
        aria-label={`Cerebro en 3D: ${filas.length} ideas. Flechas para girar, + y − para acercar. La vista de lista permite recorrerlo con el teclado.`} />
      {ayuda && <p className="jv-cb-ayuda" aria-hidden>Arrastrá para girar · tocá una neurona</p>}
      <div className="jv-cb-controles">
        {!quieto && (
          <button type="button" aria-label={girando ? 'Detener el giro' : 'Girar solo'} title={girando ? 'Detener el giro' : 'Girar solo'} aria-pressed={girando} onClick={() => setGirando(g => !g)}>
            {girando ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
        )}
        <button type="button" aria-label="Acercar" title="Acercar" onClick={() => acercar(1.35)}><Plus className="w-4 h-4" /></button>
        <button type="button" aria-label="Alejar" title="Alejar" onClick={() => acercar(1 / 1.35)}><Minus className="w-4 h-4" /></button>
        <button type="button" aria-label="Ver todo" title="Ver todo" onClick={centrar}><LocateFixed className="w-4 h-4" /></button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// LA LISTA (árbol desplegable, accesible)
// ---------------------------------------------------------------------
function Arbol({ red, filas, ocultos, sel, onSel }: { red: Red; filas: Fila[]; ocultos: Set<Grupo>; sel: string | null; onSel: (id: string) => void }) {
  const hijos = useMemo(() => {
    const m = new Map<string, Fila[]>();
    for (const f of filas) {
      const p = red.padre.get(f.id);
      if (!p) continue;
      let l = m.get(p); if (!l) { l = []; m.set(p, l); }
      l.push(f);
    }
    for (const l of m.values()) l.sort((a, b) => (b.usos || 0) - (a.usos || 0) || a.etiqueta.localeCompare(b.etiqueta));
    return m;
  }, [red, filas]);
  const sueltos = filas.filter(f => !red.prof.has(f.id));
  // Abiertas al empezar: el centro y sus ramas directas.
  const [abiertos, setAbiertos] = useState<Set<string>>(() => new Set(filas.filter(f => (red.prof.get(f.id) ?? 9) < 2).map(f => f.id)));
  const alternar = (id: string) => setAbiertos(a => { const n = new Set(a); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  // Al elegir algo (desde el buscador o el detalle) se abre el camino hasta él.
  useEffect(() => {
    if (!sel) return;
    setAbiertos(a => { const n = new Set(a); let p = red.padre.get(sel); while (p) { n.add(p); p = red.padre.get(p); } return n; });
  }, [sel, red]);
  const rama = (f: Fila): ReactNode => {
    if (ocultos.has(grupoDe(f)) && f.tipo !== 'raiz') return null;
    const hs = hijos.get(f.id) || [];
    const abierto = abiertos.has(f.id);
    return (
      <li key={f.id}>
        <div className="jv-arbol-linea">
          {hs.length ? (
            <button type="button" className="jv-arbol-abrir" aria-expanded={abierto} aria-label={`${abierto ? 'Cerrar' : 'Abrir'} ${f.etiqueta}`} onClick={() => alternar(f.id)}>
              <ChevronRight className="w-4 h-4 jv-arbol-chev" aria-hidden />
            </button>
          ) : <span className="jv-arbol-abrir" aria-hidden />}
          <button type="button" className="jv-arbol-fila" aria-current={sel === f.id || undefined} onClick={() => onSel(f.id)}>
            <i data-g={grupoDe(f)} aria-hidden /><span>{f.etiqueta}</span>
            {reciente(f.creado_en) && <em>nuevo</em>}
            {!!hs.length && <small>{hs.length}</small>}
          </button>
        </div>
        {!!hs.length && abierto && <ul>{hs.map(h => rama(h))}</ul>}
      </li>
    );
  };
  return (
    <div className="jv-arbol">
      <ul aria-label="Lo que Jarvis sabe">
        {red.raiz && rama(red.raiz)}
        {sueltos.filter(f => f.tipo !== 'raiz').map(f => rama(f))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------
// DETALLE de un punto: lo que sabe, conexiones, corregir y olvidar
// ---------------------------------------------------------------------
function Detalle({ n, red, onSel, onCerrar, onPreguntar, onCambio, onBorrados }: {
  n: Fila; red: Red; onSel: (id: string) => void; onCerrar: () => void; onPreguntar?: (t: string) => void;
  onCambio: (id: string, c: Partial<Fila>) => void; onBorrados: (ids: string[]) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(n.resumen || '');
  const [borrar, setBorrar] = useState(false);
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => { setEditando(false); setBorrar(false); setAviso(''); setTexto(n.resumen || ''); }, [n.id, n.resumen]);
  const vecinos = (red.vecinos.get(n.id) || []).map(v => ({ ...v, f: red.porId.get(v.id)! })).filter(v => v.f);
  const fijo = n.tipo === 'raiz' || n.tipo === 'modulo' || ['dom:internet', 'dom:dueno', 'dom:negocio'].includes(n.clave);

  const guardar = async () => {
    setOcupado(true);
    const r = texto.replace(/\s+/g, ' ').trim().slice(0, 1500);
    const { error } = await supabase.from('jarvis_nodos').update({ resumen: r || null, fuente: 'vos', actualizado_en: new Date().toISOString() }).eq('id', n.id);
    setOcupado(false);
    if (error) { setAviso('No se pudo guardar. Revisá la conexión y probá de nuevo.'); return; }
    onCambio(n.id, { resumen: r || null, fuente: 'vos' }); setEditando(false); setAviso('Corregido. Jarvis va a usar esta versión.');
  };
  const olvidar = async () => {
    setOcupado(true);
    // Se va con lo que solo colgaba de este punto (sus datos y su búsqueda).
    const solos = vecinos.filter(v => (red.vecinos.get(v.id) || []).length === 1 && v.f.tipo !== 'raiz').map(v => v.id);
    const ids = [n.id, ...solos];
    const { error } = await supabase.from('jarvis_nodos').delete().in('id', ids);
    if (error) { setOcupado(false); setAviso('No se pudo olvidar. Revisá la conexión y probá de nuevo.'); return; }
    // Un recuerdo también sale de la memoria que usa al responder.
    if (n.tipo === 'recuerdo' && n.resumen) await supabase.from('jarvis_memoria').delete().eq('texto', n.resumen);
    onBorrados(ids);
  };

  return (
    <section className="jv-cerebro-detalle" aria-label={`Lo que sabe de ${n.etiqueta}`}>
      <div className="jv-det-cab">
        <i data-g={grupoDe(n)} aria-hidden />
        <div className="jv-det-tt">
          <b>{n.etiqueta}</b>
          <span>{NOMBRE_TIPO[n.tipo]}{n.fuente ? ` · lo sabe por ${NOMBRE_FUENTE[n.fuente] || n.fuente}` : ''}</span>
        </div>
        <button type="button" className="jv-cerebro-ic" aria-label="Cerrar detalle" title="Cerrar" onClick={onCerrar}><X className="w-4 h-4" /></button>
      </div>
      {editando ? (
        <textarea className="jv-det-edit" value={texto} onChange={e => setTexto(e.target.value)} rows={5} maxLength={1500} aria-label="Lo que Jarvis sabe de esto" autoFocus />
      ) : (
        <p className="jv-det-res">{n.resumen || (n.tipo === 'dominio' || n.tipo === 'raiz' || n.tipo === 'modulo' ? `Agrupa ${vecinos.length} conexión${vecinos.length === 1 ? '' : 'es'}.` : 'Sin resumen todavía.')}</p>
      )}
      {n.url && <a className="jv-det-url" href={n.url} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-3.5 h-3.5 shrink-0" /><span>{dominioDe(n.url)}</span></a>}
      {!!vecinos.length && (
        <div className="jv-det-con">
          <span>Conectado con</span>
          <div>
            {vecinos.slice(0, 14).map(v => (
              <button key={v.id} type="button" onClick={() => onSel(v.id)} title={v.relacion}>
                <i data-g={grupoDe(v.f)} aria-hidden /><span>{v.f.etiqueta}</span>
              </button>
            ))}
            {vecinos.length > 14 && <small>y {vecinos.length - 14} más</small>}
          </div>
        </div>
      )}
      <p className="jv-det-meta">Usado {n.usos || 0} {n.usos === 1 ? 'vez' : 'veces'} · último uso {fecha(n.ultimo_uso)} · aprendido {fecha(n.creado_en)}</p>
      {aviso && <p className="jv-det-aviso" role="status">{aviso}</p>}
      <div className="jv-det-acc">
        {editando ? (
          <>
            <button type="button" className="ai-chip" data-primario disabled={ocupado} onClick={() => void guardar()}>Guardar</button>
            <button type="button" className="ai-chip" disabled={ocupado} onClick={() => { setEditando(false); setTexto(n.resumen || ''); }}>Cancelar</button>
          </>
        ) : borrar ? (
          <>
            <span className="jv-det-preg">¿Olvidar «{n.etiqueta.slice(0, 30)}»?</span>
            <button type="button" className="ai-chip" data-peligro disabled={ocupado} onClick={() => void olvidar()}>Sí, olvidar</button>
            <button type="button" className="ai-chip" disabled={ocupado} onClick={() => setBorrar(false)}>No</button>
          </>
        ) : (
          <>
            {onPreguntar && n.tipo !== 'raiz' && <button type="button" className="ai-chip" onClick={() => onPreguntar(`¿Qué sabés de ${sinPrefijo(n.etiqueta)}?`)}><MessageCircleQuestion className="w-4 h-4" />Preguntar</button>}
            {n.tipo !== 'raiz' && <button type="button" className="ai-chip" onClick={() => setEditando(true)}><Pencil className="w-4 h-4" />Corregir</button>}
            {!fijo && <button type="button" className="ai-chip" onClick={() => setBorrar(true)}><Trash2 className="w-4 h-4" />Olvidar</button>}
          </>
        )}
      </div>
    </section>
  );
}
