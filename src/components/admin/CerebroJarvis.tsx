// =====================================================================
// CEREBRO DE JARVIS — lo que sabe, como una red que se puede recorrer
// =====================================================================
// Cada punto es algo REAL que Jarvis aprendió (tabla jarvis_nodos) y cada
// línea, cómo se relaciona (jarvis_enlaces). Las ramas salen del centro:
//
//   Technoverse → Dispositivos electrónicos → iPhone → iPhone 15 Pro
//                                              ├─ Inventario · iPhone
//                                              ├─ Taller · iPhone
//                                              └─ Internet · iPhone
//
// Se usa con el dedo: arrastrar el fondo mueve la red, arrastrar un punto
// lo acomoda, pellizcar acerca y tocar un punto abre lo que sabe (resumen,
// fuente, enlace, conexiones) con «Corregir» y «Olvidar». Hay buscador,
// filtros por tipo y una vista en lista (accesible con teclado y lector
// de pantalla).
//
// Dibujo: d3-force acomoda la red en anillos según la distancia al centro;
// se pinta en Canvas (rápido en el A12), se detiene cuando se acomodó o
// la pestaña no se ve y respeta «reducir movimiento».
// =====================================================================

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { forceCollide, forceLink, forceManyBody, forceRadial, forceSimulation, forceX, forceY, type Simulation, type SimulationNodeDatum } from 'd3-force';
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import { select } from 'd3-selection';
import 'd3-transition'; // agrega .transition() a las selecciones (animar el acercamiento)
import { Brain, RefreshCw, Search, Plus, Minus, LocateFixed, Network, ListTree, X, Pencil, Trash2, ExternalLink, MessageCircleQuestion, GraduationCap, ChevronRight } from 'lucide-react';
import { supabase } from '../../supabaseClient';

type Tipo = 'raiz' | 'dominio' | 'modulo' | 'tema' | 'dato' | 'fuente' | 'recuerdo';
type Fila = { id: string; clave: string; etiqueta: string; tipo: Tipo; resumen: string | null; fuente: string | null; url: string | null; usos: number; ultimo_uso: string | null; creado_en: string; actualizado_en: string };
type Enlace = { id: string; origen: string; destino: string; relacion: string; peso: number };
type Grupo = 'centro' | 'temas' | 'datos' | 'internet' | 'vos';
type N = Fila & SimulationNodeDatum & { prof: number; r: number; grupo: Grupo };
type L = { source: N; target: N; relacion: string; peso: number };
type Red = { porId: Map<string, Fila>; vecinos: Map<string, { id: string; relacion: string; sale: boolean }[]>; prof: Map<string, number>; padre: Map<string, string>; maxP: number; raiz?: Fila; angulo: Map<string, number>; hojas: number };

const GRUPOS: { id: Grupo; nombre: string; color: string }[] = [
  { id: 'centro', nombre: 'Negocio', color: '--accent' },
  { id: 'temas', nombre: 'Temas', color: '--jv-actual' },
  { id: 'datos', nombre: 'Inventario y taller', color: '--ok' },
  { id: 'internet', nombre: 'Internet', color: '--tv-warn' },
  { id: 'vos', nombre: 'Sobre vos', color: '--jv-peligro' },
];
const NOMBRE_TIPO: Record<Tipo, string> = { raiz: 'Centro', dominio: 'Rama', modulo: 'Módulo', tema: 'Tema', dato: 'Dato del negocio', fuente: 'De internet', recuerdo: 'Recuerdo' };
const NOMBRE_FUENTE: Record<string, string> = { internet: 'internet', inventario: 'inventario', taller: 'taller', vos: 'vos', jarvis: 'Jarvis' };

function grupoDe(n: Fila): Grupo {
  if (n.tipo === 'recuerdo' || n.clave === 'dom:dueno') return 'vos';
  if (n.tipo === 'fuente' || n.clave === 'dom:internet') return 'internet';
  if (n.tipo === 'dato') return 'datos';
  if (n.tipo === 'tema' || n.clave.startsWith('dom:rama:')) return 'temas';
  return 'centro';
}
const radio = (n: Fila) => n.tipo === 'raiz' ? 15 : n.tipo === 'dominio' ? 10 : n.tipo === 'modulo' ? 8 : n.tipo === 'tema' ? 6 + Math.min(6, Math.sqrt(n.usos || 0) * 1.4) : 5;
const reciente = (f: string | null, h = 24) => !!f && Date.now() - new Date(f).getTime() < h * 3600_000;
const fecha = (f: string | null) => f ? new Date(f).toLocaleDateString('es-CR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const dominioDe = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const sinTildes = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const sinPrefijo = (t: string) => t.replace(/^(Inventario|Taller|Internet) · /, '');

/** Lee un color del tema (cambia entre claro y oscuro). */
function colorCSS(el: Element, v: string, resp: string) { return getComputedStyle(el).getPropertyValue(v).trim() || resp; }

export default function CerebroJarvis({ onPreguntar }: { onPreguntar?: (texto: string) => void }) {
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [enlaces, setEnlaces] = useState<Enlace[]>([]);
  const [error, setError] = useState<'sin_tablas' | 'red' | null>(null);
  const [cargando, setCargando] = useState(false);
  const [vista, setVista] = useState<'red' | 'lista'>(() => { try { return localStorage.getItem('tv_cerebro_vista') === 'lista' ? 'lista' : 'red'; } catch { return 'red'; } });
  const [ocultos, setOcultos] = useState<Set<Grupo>>(new Set());
  const [buscar, setBuscar] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [ensenar, setEnsenar] = useState('');

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

  // Profundidad desde el centro (recorrido sin dirección) y vecinos.
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
    const raiz = lista.find(f => f.tipo === 'raiz');
    if (raiz) {
      prof.set(raiz.id, 0);
      const cola = [raiz.id];
      while (cola.length) {
        const id = cola.shift()!;
        // Primero los enlaces que salen: así el árbol sigue las ramas.
        const vs = [...(vecinos.get(id) || [])].sort((a, b) => Number(b.sale) - Number(a.sale));
        for (const v of vs) if (!prof.has(v.id)) { prof.set(v.id, prof.get(id)! + 1); padre.set(v.id, id); cola.push(v.id); }
      }
    }
    const maxP = Math.max(1, ...prof.values());
    // Árbol radial: cada rama recibe un sector del círculo proporcional a lo
    // que tiene adentro, y sus hijos se reparten ese sector. Así las ramas
    // no se mezclan (Dispositivos → iPhone → iPhone 15 quedan en línea).
    const hijos = new Map<string, string[]>();
    for (const [h, p] of padre) { let l = hijos.get(p); if (!l) { l = []; hijos.set(p, l); } l.push(h); }
    const peso = new Map<string, number>();
    const medir = (id: string): number => { const hs = hijos.get(id) || []; const t = hs.length ? hs.reduce((a, h) => a + medir(h), 0) : 1; peso.set(id, t); return t; };
    const angulo = new Map<string, number>();
    const repartir = (id: string, a0: number, a1: number) => {
      angulo.set(id, (a0 + a1) / 2);
      const hs = hijos.get(id) || []; const total = hs.reduce((a, h) => a + (peso.get(h) || 1), 0);
      let a = a0;
      for (const h of hs) { const span = (a1 - a0) * (peso.get(h) || 1) / total; repartir(h, a, a + span); a += span; }
    };
    let hojas = 1;
    if (raiz) { hojas = medir(raiz.id); repartir(raiz.id, -Math.PI / 2, Math.PI * 1.5); }
    return { porId, vecinos, prof, padre, maxP, raiz, angulo, hojas };
  }, [filas, enlaces]);

  const seleccion = sel ? red.porId.get(sel) || null : null;
  const resultados = useMemo(() => {
    const q = sinTildes(buscar.trim());
    if (q.length < 2 || !filas) return [];
    return filas.filter(f => sinTildes(f.etiqueta).includes(q) || sinTildes(f.resumen || '').includes(q)).slice(0, 6);
  }, [buscar, filas]);

  const centrarRef = useRef<(id: string) => void>(() => {});
  const elegir = (id: string) => {
    setSel(id); setBuscar('');
    // Si estaba escondido por un filtro, se vuelve a mostrar.
    const f = red.porId.get(id);
    if (f && ocultos.has(grupoDe(f))) setOcultos(o => { const n = new Set(o); n.delete(grupoDe(f)); return n; });
    if (vista === 'red') centrarRef.current(id);
  };
  const pedir = (texto: string) => { if (onPreguntar && texto.trim()) onPreguntar(texto.trim()); };
  const nuevasHoy = (filas || []).filter(f => reciente(f.creado_en)).length;

  if (error === 'sin_tablas') {
    return (
      <div className="jv-cerebro">
        <div className="jv-cerebro-vacio-caja">
          <Brain className="w-6 h-6" aria-hidden />
          <b>El cerebro todavía no está instalado</b>
          <p>Falta correr «migracion_jarvis_cerebro.sql» en Supabase. Mientras tanto Jarvis responde normal, solo que no guarda lo que aprende.</p>
          <button type="button" className="ai-chip" onClick={() => void cargar()}><RefreshCw className="w-4 h-4" />Volver a revisar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="jv-cerebro">
      <div className="jv-cerebro-cab">
        <span className="ai-herr-ic"><Brain className="w-4 h-4" /></span>
        <div className="jv-cerebro-tt">
          <b>Lo que Jarvis sabe</b>
          <span>{filas ? <><b>{filas.length}</b> ideas · <b>{enlaces.length}</b> conexiones{nuevasHoy ? <> · <b>{nuevasHoy}</b> nuevas hoy</> : null}</> : 'Cargando…'}</span>
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
          <button type="button" aria-pressed={vista === 'red'} onClick={() => setVista('red')} aria-label="Ver como red" title="Red"><Network className="w-4 h-4" /></button>
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
        <div className="jv-cerebro-lienzo"><p className="jv-cerebro-vacio">{error === 'red' ? 'No se pudo leer el cerebro. Revisá la conexión.' : 'Cargando el cerebro…'}</p></div>
      ) : !filas.length ? (
        <div className="jv-cerebro-vacio-caja">
          <Brain className="w-6 h-6" aria-hidden />
          <b>Todavía está en blanco</b>
          <p>Cada tema que le pidas investigar, cada búsqueda en internet y cada «recordá…» aparece aquí como una rama nueva.</p>
          {onPreguntar && <button type="button" className="ai-chip" onClick={() => pedir('Aprendé todo sobre iPhone')}><GraduationCap className="w-4 h-4" />Probar: aprender sobre iPhone</button>}
        </div>
      ) : vista === 'red' ? (
        <Lienzo filas={filas} enlaces={enlaces} red={red} ocultos={ocultos} sel={sel} onSel={setSel} centrarRef={centrarRef} />
      ) : (
        <Arbol red={red} filas={filas} ocultos={ocultos} sel={sel} onSel={setSel} />
      )}

      {seleccion ? (
        <Detalle n={seleccion} red={red} onSel={elegir} onCerrar={() => setSel(null)} onPreguntar={onPreguntar ? pedir : undefined}
          onCambio={(id, cambios) => setFilas(fs => (fs || []).map(f => f.id === id ? { ...f, ...cambios } : f))}
          onBorrados={ids => { setSel(null); setFilas(fs => (fs || []).filter(f => !ids.includes(f.id))); setEnlaces(es => es.filter(e => !ids.includes(e.origen) && !ids.includes(e.destino))); }} />
      ) : !!filas?.length && (
        <p className="jv-cerebro-nota">{vista === 'red'
          ? 'Tocá un punto para ver lo que sabe. Arrastrá para moverte, pellizcá o usá + y − para acercar.'
          : 'Tocá una idea para ver lo que sabe; las flechas abren y cierran cada rama.'}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// LA RED (Canvas + d3-force + d3-zoom)
// ---------------------------------------------------------------------
function Lienzo({ filas, enlaces, red, ocultos, sel, onSel, centrarRef }: {
  filas: Fila[]; enlaces: Enlace[]; red: Red; ocultos: Set<Grupo>; sel: string | null; onSel: (id: string | null) => void;
  centrarRef: MutableRefObject<(id: string) => void>;
}) {
  const cajaRef = useRef<HTMLDivElement>(null);
  const lienzoRef = useRef<HTMLCanvasElement>(null);
  const estado = useRef({ nodos: [] as N[], links: [] as L[], t: zoomIdentity as ZoomTransform, w: 300, h: 300, sel: null as string | null, ocultos: new Set<Grupo>(), pulso: 0, ultimoToque: Date.now(), tocado: false });
  const simRef = useRef<Simulation<N, L> | null>(null);
  const zoomRef = useRef<ZoomBehavior<HTMLCanvasElement, unknown> | null>(null);
  const dibujarRef = useRef<() => void>(() => {});
  const ajustarRef = useRef<(animar?: boolean) => void>(() => {});
  const onSelRef = useRef(onSel); onSelRef.current = onSel;
  const [listo, setListo] = useState(false);
  const quieto = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const dibujar = useCallback(() => {
    const c = lienzoRef.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    const s = estado.current;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, s.w, s.h);
    const colores = {} as Record<Grupo, string>;
    for (const g of GRUPOS) colores[g.id] = colorCSS(c, g.color, '#008A9E');
    const borde = colorCSS(c, '--text-muted', '#999');
    const texto = colorCSS(c, '--text-primary', '#111');
    const fondo = colorCSS(c, '--bg-surface', '#fff');
    const k = s.t.k;
    ctx.save();
    ctx.translate(s.t.x, s.t.y);
    ctx.scale(k, k);
    const cerca = new Set<string>();
    if (s.sel) { cerca.add(s.sel); for (const v of red.vecinos.get(s.sel) || []) cerca.add(v.id); }
    const visible = (n: N) => !s.ocultos.has(n.grupo) || n.id === s.sel;
    // Líneas (y el pulso que viaja por lo usado en los últimos 2 días).
    for (const l of s.links) {
      if (!visible(l.source) || !visible(l.target)) continue;
      const activa = !!s.sel && (l.source.id === s.sel || l.target.id === s.sel);
      ctx.globalAlpha = s.sel ? (activa ? 0.9 : 0.1) : 0.4;
      ctx.strokeStyle = activa ? colores[l.target.grupo] : borde;
      ctx.lineWidth = (activa ? 2 : 0.8 + Math.min(2.4, Math.log2(l.peso || 1) * 0.6)) / Math.sqrt(k);
      ctx.beginPath(); ctx.moveTo(l.source.x!, l.source.y!); ctx.lineTo(l.target.x!, l.target.y!); ctx.stroke();
      if (!quieto && reciente(l.target.ultimo_uso, 48)) {
        const f = (s.pulso + (l.target.id.charCodeAt(0) % 10) / 10) % 1;
        ctx.globalAlpha = s.sel && !activa ? 0.12 : 0.9;
        ctx.fillStyle = colores[l.target.grupo];
        ctx.beginPath(); ctx.arc(l.source.x! + (l.target.x! - l.source.x!) * f, l.source.y! + (l.target.y! - l.source.y!) * f, 2.2 / Math.sqrt(k), 0, Math.PI * 2); ctx.fill();
      }
    }
    // Puntos; lo aprendido hoy lleva un halo.
    for (const n of s.nodos) {
      if (!visible(n)) continue;
      const tenue = !!s.sel && !cerca.has(n.id);
      if (!tenue && reciente(n.creado_en)) {
        ctx.globalAlpha = 0.25; ctx.fillStyle = colores[n.grupo];
        ctx.beginPath(); ctx.arc(n.x!, n.y!, n.r + 5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = tenue ? 0.2 : 1;
      ctx.fillStyle = colores[n.grupo];
      ctx.beginPath(); ctx.arc(n.x!, n.y!, n.r, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = (n.id === s.sel ? 3 : 1.5) / k; ctx.strokeStyle = n.id === s.sel ? texto : fondo; ctx.stroke();
    }
    // Nombres: siempre los grandes y lo seleccionado; el resto según el acercamiento.
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.lineJoin = 'round';
    // Los nombres no se montan: se ponen por importancia y el que choca con
    // uno ya puesto se omite (aparece al acercar o al tocar el punto).
    const ORDEN: Record<string, number> = { raiz: 0, dominio: 1, modulo: 2, tema: 3, recuerdo: 4, dato: 5, fuente: 5 };
    const puestos: [number, number, number, number][] = [];
    const porImportancia = [...s.nodos].sort((a, b) => Number(b.id === s.sel) - Number(a.id === s.sel) || ORDEN[a.tipo] - ORDEN[b.tipo] || (b.usos || 0) - (a.usos || 0));
    for (const n of porImportancia) {
      if (!visible(n)) continue;
      const mostrar = s.sel ? cerca.has(n.id) || n.tipo === 'raiz'
        : n.tipo === 'raiz' || n.tipo === 'dominio' || (n.tipo === 'modulo' && k > 0.8) || (n.tipo === 'tema' && k > 1.05) || k > 1.7;
      if (!mostrar) continue;
      const fuerte = n.tipo === 'raiz' || n.tipo === 'dominio' || n.id === s.sel;
      ctx.font = `${fuerte ? 700 : 500} ${(n.tipo === 'raiz' ? 13 : 11.5) / k}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
      const et = n.etiqueta.length > 26 ? n.etiqueta.slice(0, 25) + '…' : n.etiqueta;
      const y = n.y! + n.r + 3 / k;
      const ancho = ctx.measureText(et).width, alto = 14 / k;
      const caja: [number, number, number, number] = [n.x! - ancho / 2 - 2 / k, y, n.x! + ancho / 2 + 2 / k, y + alto];
      if (n.id !== s.sel && puestos.some(p => caja[0] < p[2] && caja[2] > p[0] && caja[1] < p[3] && caja[3] > p[1])) continue;
      puestos.push(caja);
      ctx.strokeStyle = fondo; ctx.lineWidth = 3.5 / k; ctx.strokeText(et, n.x!, y);
      ctx.fillStyle = texto; ctx.fillText(et, n.x!, y);
    }
    ctx.restore();
  }, [red, quieto]);
  dibujarRef.current = dibujar;

  // Simulación: se rearma cuando cambian los datos, conservando posiciones.
  useEffect(() => {
    const s = estado.current;
    const previas = new Map<string, N>(s.nodos.map(n => [n.id, n] as [string, N]));
    // Separación entre anillos: que las hojas del borde quepan sin encimarse.
    const anillo = Math.max(62, Math.min(140, (red.hojas * 26) / (2 * Math.PI * red.maxP)));
    const meta = (n: N) => { const a = red.angulo.get(n.id) ?? (n.id.charCodeAt(n.id.length - 1) % 12) * Math.PI / 6; const d = n.prof * anillo; return [Math.cos(a) * d, Math.sin(a) * d]; };
    const nodos: N[] = filas.map(f => {
      const p = previas.get(f.id);
      const prof = red.prof.get(f.id) ?? red.maxP + 1;
      const extra = { prof, r: radio(f), grupo: grupoDe(f) };
      if (p) return Object.assign(p, f, extra) as N;
      // Lo nuevo nace junto a su padre (si ya estaba dibujado).
      // Lo nuevo nace en su lugar de la rama.
      const a = red.angulo.get(f.id) ?? Math.random() * Math.PI * 2;
      return Object.assign({}, f, extra, { x: Math.cos(a) * prof * 60 + Math.random() * 4, y: Math.sin(a) * prof * 60 + Math.random() * 4 }) as N;
    });
    const porId = new Map(nodos.map(n => [n.id, n]));
    const links: L[] = enlaces.filter(e => porId.has(e.origen) && porId.has(e.destino))
      .map(e => ({ source: porId.get(e.origen)!, target: porId.get(e.destino)!, relacion: e.relacion, peso: e.peso }));
    for (const n of nodos) if (n.tipo === 'raiz') { n.fx = 0; n.fy = 0; }
    s.nodos = nodos; s.links = links;
    simRef.current?.stop();
    const sim = forceSimulation<N, L>(nodos)
      .force('link', forceLink<N, L>(links).distance(anillo).strength(0.08))
      .force('carga', forceManyBody<N>().strength(-30).distanceMax(120))
      .force('choque', forceCollide<N>(n => n.r + 9).iterations(2))
      .force('x', forceX<N>(n => meta(n)[0]).strength(0.35))
      .force('y', forceY<N>(n => meta(n)[1]).strength(0.35))
      .force('anillos', forceRadial<N>(n => n.prof * anillo, 0, 0).strength(0.15))
      .alphaDecay(0.04);
    let primera = previas.size === 0;
    if (quieto) { sim.stop(); sim.tick(180); dibujarRef.current(); if (primera) ajustarRef.current(false); }
    else {
      sim.on('tick', () => {
        dibujarRef.current();
        // Al acomodarse por primera vez, se encuadra todo (si no se tocó).
        if (primera && sim.alpha() < 0.2) { primera = false; if (!s.tocado) ajustarRef.current(true); }
      });
      sim.on('end', () => { if (!s.tocado) ajustarRef.current(true); });
    }
    simRef.current = sim;
    setListo(true);
    return () => { sim.stop(); };
  }, [filas, enlaces, red, quieto]);

  // Tamaño, acercamiento y toques.
  useEffect(() => {
    const caja = cajaRef.current, c = lienzoRef.current;
    if (!caja || !c) return;
    const s = estado.current;
    let medido = false;
    const medir = () => {
      const r = caja.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const antes = { w: s.w, h: s.h };
      s.w = Math.max(160, r.width); s.h = Math.max(160, r.height);
      c.width = Math.round(s.w * dpr); c.height = Math.round(s.h * dpr);
      c.style.width = `${s.w}px`; c.style.height = `${s.h}px`;
      // Si cambia el tamaño, el centro se mueve con él.
      if (medido && zoomRef.current) select(c).call(zoomRef.current.transform as any, s.t.translate((s.w - antes.w) / 2 / s.t.k, (s.h - antes.h) / 2 / s.t.k));
      medido = true;
      dibujarRef.current();
    };

    // Qué punto queda bajo el dedo (en coordenadas de la red).
    const bajo = (cx: number, cy: number): N | null => {
      const r = c.getBoundingClientRect();
      const [x, y] = s.t.invert([cx - r.left, cy - r.top]);
      let mejor: N | null = null, dMin = Infinity;
      for (const n of s.nodos) {
        if (s.ocultos.has(n.grupo) && n.id !== s.sel) continue;
        const d = Math.hypot(n.x! - x, n.y! - y);
        if (d < n.r + 14 / s.t.k && d < dMin) { dMin = d; mejor = n; }
      }
      return mejor;
    };
    // Arrastrar un punto lo acomoda; arrastrar el fondo mueve la red.
    let arrastre: { n: N; x0: number; y0: number; movio: boolean; id: number } | null = null;
    let tocoNodo = false;
    const abajo = (e: PointerEvent) => {
      s.ultimoToque = Date.now();
      const n = bajo(e.clientX, e.clientY);
      tocoNodo = !!n;
      arrastre = n ? { n, x0: e.clientX, y0: e.clientY, movio: false, id: e.pointerId } : null;
    };
    const mover = (e: PointerEvent) => {
      if (!arrastre || e.pointerId !== arrastre.id) return;
      if (!arrastre.movio && Math.hypot(e.clientX - arrastre.x0, e.clientY - arrastre.y0) < 6) return;
      arrastre.movio = true; s.tocado = true;
      const r = c.getBoundingClientRect();
      const [x, y] = s.t.invert([e.clientX - r.left, e.clientY - r.top]);
      arrastre.n.fx = x; arrastre.n.fy = y;
      if (quieto) { arrastre.n.x = x; arrastre.n.y = y; dibujarRef.current(); }
      else simRef.current?.alphaTarget(0.25).restart();
    };
    const arriba = (e: PointerEvent) => {
      if (!arrastre || e.pointerId !== arrastre.id) return;
      const n = arrastre.n;
      if (!arrastre.movio) onSelRef.current(n.id === s.sel ? null : n.id);
      else if (n.tipo !== 'raiz') { n.fx = null; n.fy = null; }
      simRef.current?.alphaTarget(0);
      arrastre = null;
    };
    // Toque en el fondo (sin arrastrar): quita la selección.
    let x0 = 0, y0 = 0;
    const bajoFondo = (e: PointerEvent) => { x0 = e.clientX; y0 = e.clientY; };
    const toque = (e: MouseEvent) => { if (!tocoNodo && Math.hypot(e.clientX - x0, e.clientY - y0) < 6) onSelRef.current(null); };
    c.addEventListener('pointerdown', abajo);
    c.addEventListener('pointerdown', bajoFondo);
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', arriba);
    window.addEventListener('pointercancel', arriba);
    c.addEventListener('click', toque);

    const z = d3zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.25, 4])
      // Si un dedo (o el ratón) empezó sobre un punto, mueve el punto, no la red.
      .filter((ev: any) => {
        if (ev.type === 'wheel') return true;
        if (ev.button) return false;
        const uno = ev.type === 'mousedown' || (ev.touches && ev.touches.length === 1);
        if (!uno) return true;
        const p = ev.touches ? ev.touches[0] : ev;
        return !bajo(p.clientX, p.clientY);
      })
      .on('zoom', ev => { s.t = ev.transform; s.ultimoToque = Date.now(); if (ev.sourceEvent) s.tocado = true; dibujarRef.current(); });
    zoomRef.current = z;
    medir();
    select(c).call(z).on('dblclick.zoom', null).call(z.transform as any, zoomIdentity.translate(s.w / 2, s.h / 2).scale(0.8));
    const ro = new ResizeObserver(medir); ro.observe(caja);

    // Encuadrar todo lo visible.
    ajustarRef.current = (animar = true) => {
      const vis = s.nodos.filter(n => n.x != null && (!s.ocultos.has(n.grupo)));
      if (!vis.length) return;
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (const n of vis) { x1 = Math.min(x1, n.x! - n.r); y1 = Math.min(y1, n.y! - n.r); x2 = Math.max(x2, n.x! + n.r); y2 = Math.max(y2, n.y! + n.r + 14); }
      const k = Math.max(0.25, Math.min(1.6, (s.w - 32) / Math.max(1, x2 - x1), (s.h - 32) / Math.max(1, y2 - y1)));
      const t = zoomIdentity.translate(s.w / 2, s.h / 2).scale(k).translate(-(x1 + x2) / 2, -(y1 + y2) / 2);
      select(c).transition().duration(animar && !quieto ? 450 : 0).call(z.transform as any, t);
    };
    centrarRef.current = (id: string) => {
      const n = s.nodos.find(x => x.id === id);
      if (!n || n.x == null) return;
      s.tocado = true;
      const k = Math.max(s.t.k, 1.3);
      select(c).transition().duration(quieto ? 0 : 450).call(z.transform as any, zoomIdentity.translate(s.w / 2, s.h / 2).scale(k).translate(-n.x!, -n.y!));
    };
    return () => {
      ro.disconnect();
      c.removeEventListener('pointerdown', abajo);
      c.removeEventListener('pointerdown', bajoFondo);
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', arriba);
      window.removeEventListener('pointercancel', arriba);
      c.removeEventListener('click', toque);
      select(c).on('.zoom', null);
    };
  }, [centrarRef, quieto]);

  useEffect(() => { estado.current.sel = sel; estado.current.ocultos = ocultos; dibujarRef.current(); }, [sel, ocultos]);

  // Pulsos: solo si se ve, sin «reducir movimiento» y hasta 20 s después del último toque.
  useEffect(() => {
    if (quieto || !listo || !filas.some(f => reciente(f.ultimo_uso, 48))) return;
    let id = 0, previo = 0;
    const paso = (t: number) => {
      id = requestAnimationFrame(paso);
      if (document.hidden || t - previo < 40 || Date.now() - estado.current.ultimoToque > 20_000) return;
      previo = t;
      estado.current.pulso = (estado.current.pulso + 0.012) % 1;
      // Mientras la red se acomoda, ella misma redibuja.
      if ((simRef.current?.alpha() ?? 0) < (simRef.current?.alphaMin() ?? 0.001)) dibujarRef.current();
    };
    id = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(id);
  }, [filas, listo, quieto]);

  const acercar = (f: number) => {
    const c = lienzoRef.current;
    estado.current.ultimoToque = Date.now();
    if (c && zoomRef.current) select(c).transition().duration(quieto ? 0 : 220).call(zoomRef.current.scaleBy as any, f);
  };

  return (
    <div className="jv-cerebro-lienzo" ref={cajaRef}>
      <canvas ref={lienzoRef} role="img" aria-label={`Red de lo que Jarvis sabe: ${filas.length} ideas. La vista de lista permite recorrerla con el teclado.`} />
      <div className="jv-cerebro-zoom">
        <button type="button" aria-label="Acercar" title="Acercar" onClick={() => acercar(1.4)}><Plus className="w-4 h-4" /></button>
        <button type="button" aria-label="Alejar" title="Alejar" onClick={() => acercar(1 / 1.4)}><Minus className="w-4 h-4" /></button>
        <button type="button" aria-label="Ver todo" title="Ver todo" onClick={() => ajustarRef.current(true)}><LocateFixed className="w-4 h-4" /></button>
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
