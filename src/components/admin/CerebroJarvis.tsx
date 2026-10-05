// =====================================================================
// CEREBRO DE JARVIS — constelaciones neuronales en 3D (diseño aprobado)
// =====================================================================
// Cada estrella es algo REAL que Jarvis aprendió (tabla jarvis_nodos) y
// cada fibra, cómo se relaciona (jarvis_enlaces). Las ramas salen del
// núcleo como constelaciones, cada una con su color:
//
//   Technoverse → Dispositivos electrónicos → iPhone → iPhone 15 Pro
//                                              ├─ Inventario · iPhone
//                                              ├─ Taller · iPhone
//                                              └─ Internet · iPhone
//
// Pantalla completa con cabecera de vidrio (volver, ruta, cifras), zoom a
// la derecha y una hoja abajo con tres pestañas:
//   · Explorar  — constelaciones → sus ideas → la ficha de una idea
//                 (qué sabe, fuente, conexiones; Preguntar/Corregir/Olvidar)
//   · Enseñar   — Jarvis aprende el tema SOLO (accion 'aprender' de la
//                 función), sin mandar al chat; nace la estrella con un anillo
//   · Actividad — ideas nuevas por día y lo último que aprendió
// Con el dedo: arrastrar gira (la cara de adelante sigue al dedo, con
// inercia), pellizcar acerca, tocar una constelación la trae al frente y
// tocar una estrella la marca en dorado y abre su ficha.
// =====================================================================

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Brain, RefreshCw, Search, Plus, Minus, LocateFixed, X, Pencil, Trash2, ExternalLink, MessageCircleQuestion, ArrowLeft } from 'lucide-react';
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

// Lo último que se bajó del cerebro, en memoria: al abrirlo se ve AL
// INSTANTE y se refresca por detrás (antes quedaba en blanco mientras
// bajaban hasta 800 ideas y 2500 conexiones). Jarvis lo precarga al abrirse.
let enMemoria: { filas: Fila[]; enlaces: Enlace[] } | null = null;
let bajando: Promise<{ filas: Fila[]; enlaces: Enlace[] } | { error: 'sin_tablas' | 'red' }> | null = null;
function bajarCerebro() {
  if (bajando) return bajando;
  bajando = (async () => {
    const [n, e] = await Promise.all([
      supabase.from('jarvis_nodos').select('id,clave,etiqueta,tipo,resumen,fuente,url,usos,ultimo_uso,creado_en,actualizado_en').order('actualizado_en', { ascending: false }).limit(800),
      supabase.from('jarvis_enlaces').select('id,origen,destino,relacion,peso').limit(2500),
    ]);
    if (n.error) return { error: /does not exist|relation|schema cache|could not find/i.test(n.error.message) ? 'sin_tablas' as const : 'red' as const };
    enMemoria = { filas: (n.data || []) as Fila[], enlaces: (e.data || []) as Enlace[] };
    return enMemoria;
  })().finally(() => { bajando = null; });
  return bajando;
}
/** Jarvis lo llama al abrirse: código y datos listos antes de tocar el cerebro. */
export function precargarCerebro(): void {
  if (!enMemoria) void bajarCerebro();
}


export default function CerebroJarvis({ onPreguntar, onVolver }: { onPreguntar?: (texto: string) => void; onVolver?: () => void }) {
  const [filas, setFilas] = useState<Fila[] | null>(() => enMemoria?.filas || null);
  const [enlaces, setEnlaces] = useState<Enlace[]>(() => enMemoria?.enlaces || []);
  const [error, setError] = useState<'sin_tablas' | 'red' | null>(null);
  const [cargando, setCargando] = useState(false);
  const [foco, setFoco] = useState<Grupo | null>(null);
  const [buscar, setBuscar] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [pestana, setPestana] = useState<'explorar' | 'ensenar' | 'actividad'>('explorar');
  const [ensenar, setEnsenar] = useState('');
  const [aprendiendo, setAprendiendo] = useState<{ estado: 'no' | 'si' | 'ok' | 'error'; texto: string }>({ estado: 'no', texto: '' });
  const [nuevo, setNuevo] = useState<string | null>(null);
  const camRef = useRef<Camara>({ enfocar: () => {}, grupo: () => {}, centrar: () => {}, acercar: () => {} });
  const hudRef = useRef<HTMLDivElement>(null);
  const hojaRef = useRef<HTMLDivElement>(null);
  const [margenes, setMargenes] = useState({ arriba: 110, abajo: 240 });

  const cargar = useCallback(async () => {
    setCargando(true);
    const r = await bajarCerebro();
    setCargando(false);
    if ('error' in r) { if (!enMemoria) setError(r.error); return null; }
    setError(null);
    // Si no cambió nada, no se rearma la escena (sin parpadeo).
    setFilas(prev => (prev && prev.length === r.filas.length && prev[0]?.actualizado_en === r.filas[0]?.actualizado_en ? prev : r.filas));
    setEnlaces(prev => (prev.length === r.enlaces.length ? prev : r.enlaces));
    return r;
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  // La escena se centra en el hueco que dejan la cabecera y la hoja.
  useEffect(() => {
    const medir = () => setMargenes({ arriba: (hudRef.current?.offsetHeight || 96) + 14, abajo: (hojaRef.current?.offsetHeight || 220) });
    medir();
    const ro = new ResizeObserver(medir);
    if (hudRef.current) ro.observe(hudRef.current);
    if (hojaRef.current) ro.observe(hojaRef.current);
    return () => ro.disconnect();
  }, [filas === null]);

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
  const porGrupo = useMemo(() => {
    const m = new Map<Grupo, Fila[]>();
    for (const f of filas || []) { if (f.tipo === 'raiz') continue; const g = grupoDe(f); let l = m.get(g); if (!l) { l = []; m.set(g, l); } l.push(f); }
    for (const l of m.values()) l.sort((a, b) => (b.usos || 0) - (a.usos || 0) || a.etiqueta.localeCompare(b.etiqueta));
    return m;
  }, [filas]);

  const elegir = (id: string) => {
    const f = red.porId.get(id); if (!f) return;
    if (f.tipo === 'raiz') { centrar(); return; }
    setSel(id); setBuscar(''); setPestana('explorar'); setFoco(grupoDe(f));
    camRef.current.enfocar(id);
  };
  const enfocarGrupo = (g: Grupo) => { setSel(null); setFoco(g); setPestana('explorar'); camRef.current.grupo(g); };
  const centrar = () => { setSel(null); setFoco(null); camRef.current.centrar(); };
  const pedir = (texto: string) => { if (onPreguntar && texto.trim()) onPreguntar(texto.trim()); };

  // «Enseñar»: Jarvis lo investiga y lo guarda él solo (sin ir al chat).
  const aprender = async (tema: string) => {
    const t = tema.trim();
    if (t.length < 2 || aprendiendo.estado === 'si') return;
    setAprendiendo({ estado: 'si', texto: t });
    const { data, error: e } = await supabase.functions.invoke('asistente-ia', { body: { accion: 'aprender', tema: t } });
    if (e || !data?.ok) {
      let msg = data?.error;
      if (!msg && (e as any)?.context?.json) { try { msg = (await (e as any).context.json())?.error; } catch { /* sin cuerpo */ } }
      setAprendiendo({ estado: 'error', texto: msg || 'No se pudo aprender ahora. Revisá la conexión y probá de nuevo.' });
      return;
    }
    setEnsenar('');
    const r = await cargar();
    const etiqueta = String(data.aprendidos?.[0] || t);
    const n = r?.filas.find(f => sinTildes(f.etiqueta) === sinTildes(etiqueta));
    setAprendiendo({ estado: 'ok', texto: `${etiqueta}${data.aprendidos?.length > 1 ? ` y ${data.aprendidos.length - 1} subtema${data.aprendidos.length === 2 ? '' : 's'}` : ''}. Quedó en ${String(data.guardado_en || 'tu cerebro').replace(/^Technoverse → /, '')}.` });
    if (n) {
      setNuevo(n.id); setFoco(grupoDe(n));
      setTimeout(() => camRef.current.enfocar(n.id), 120);
      setTimeout(() => setNuevo(id => (id === n.id ? null : id)), 7000);
    }
  };

  if (error === 'sin_tablas') {
    return (
      <div className="jv-cerebro jv-cerebro-solo">
        <div className="jv-cerebro-vacio-caja">
          <span className="jv-cb-logo"><Brain className="w-6 h-6" aria-hidden /></span>
          <b>El cerebro todavía no está instalado</b>
          <p>Falta correr «migracion_jarvis_cerebro.sql» en Supabase. Mientras tanto Jarvis responde normal, solo que no guarda lo que aprende.</p>
          <button type="button" className="ai-chip" onClick={() => void cargar()}><RefreshCw className="w-4 h-4" />Volver a revisar</button>
        </div>
      </div>
    );
  }

  const nombreGrupo = (g: Grupo) => GRUPOS.find(x => x.id === g)?.nombre || g;
  return (
    <div className="jv-cerebro">
      {filas === null ? (
        <div className="jv-cb-escena"><p className="jv-cerebro-vacio">{error === 'red' ? 'No se pudo leer el cerebro. Revisá la conexión.' : 'Despertando el cerebro…'}</p></div>
      ) : (
        <Escena3D filas={filas} enlaces={enlaces} red={red} foco={foco} sel={sel} nuevo={nuevo} margenes={margenes}
          onSel={id => (id ? elegir(id) : setSel(null))} onGrupo={enfocarGrupo} camRef={camRef} />
      )}

      {/* Cabecera de vidrio: volver, título con la ruta y centrar; las cifras. */}
      <div className="jv-cb-hud" ref={hudRef}>
        <div className="jv-cb-cab">
          {onVolver && <button type="button" className="jv-vidrio jv-cb-ib" aria-label="Volver al chat" title="Volver al chat" onClick={onVolver}><ArrowLeft className="w-[18px] h-[18px]" /></button>}
          <div className="jv-cb-tit">
            <b>Cerebro de Jarvis</b>
            <div className="jv-cb-ruta">
              <button type="button" onClick={centrar}>Technoverse</button>
              {foco && <> › <button type="button" onClick={() => enfocarGrupo(foco)}>{nombreGrupo(foco)}</button></>}
              {seleccion && <> › <span>{seleccion.etiqueta}</span></>}
            </div>
          </div>
          <button type="button" className="jv-vidrio jv-cb-ib" aria-label="Actualizar" title="Actualizar" onClick={() => void cargar()} disabled={cargando}>
            <RefreshCw className={`w-4 h-4 ${cargando ? 'animate-spin' : ''}`} />
          </button>
          <button type="button" className="jv-vidrio jv-cb-ib" aria-label="Ver el cerebro entero" title="Ver todo" onClick={centrar}><LocateFixed className="w-[18px] h-[18px]" /></button>
        </div>
        <div className="jv-cb-metr">
          <div className="jv-vidrio"><b>{filas?.length ?? '—'}</b><span>ideas</span></div>
          <div className="jv-vidrio"><b>{filas ? enlaces.length : '—'}</b><span>conexiones</span></div>
          <div className="jv-vidrio"><b>{filas ? `+${semana}` : '—'}</b><span>esta semana</span></div>
        </div>
      </div>

      {/* Hoja: Explorar, Enseñar, Actividad. */}
      <div className="jv-cb-hoja jv-vidrio" ref={hojaRef}>
        <div className="jv-cb-asa" aria-hidden="true" />
        <div className="jv-cb-seg" role="tablist" aria-label="Panel del cerebro">
          {([['explorar', 'Explorar'], ['ensenar', 'Enseñar'], ['actividad', 'Actividad']] as const).map(([id, t]) => (
            <button key={id} type="button" role="tab" aria-selected={pestana === id} onClick={() => setPestana(id)}>{t}</button>
          ))}
        </div>
        <div className="jv-cb-panel">
          {pestana === 'explorar' && (
            seleccion ? (
              <Detalle n={seleccion} red={red} onSel={elegir} onCerrar={() => setSel(null)} onPreguntar={onPreguntar ? pedir : undefined}
                onCambio={(id, cambios) => setFilas(fs => (fs || []).map(f => f.id === id ? { ...f, ...cambios } : f))}
                onBorrados={ids => { setSel(null); setFilas(fs => (fs || []).filter(f => !ids.includes(f.id))); setEnlaces(es => es.filter(e => !ids.includes(e.origen) && !ids.includes(e.destino))); }} />
            ) : (
              <>
                <label className="jv-cb-buscar">
                  <Search className="w-4 h-4 shrink-0" aria-hidden />
                  <input value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="Buscar en el cerebro" aria-label="Buscar en el cerebro" enterKeyHint="search"
                    onKeyDown={e => { if (e.key === 'Enter' && resultados[0]) { e.preventDefault(); elegir(resultados[0].id); } }} />
                  {buscar && <button type="button" aria-label="Borrar búsqueda" onClick={() => setBuscar('')}><X className="w-4 h-4" /></button>}
                </label>
                {buscar.trim().length >= 2 ? (
                  resultados.length ? resultados.map(r => (
                    <button key={r.id} type="button" className="jv-cb-fila" onClick={() => elegir(r.id)}>
                      <i className="jv-pt" data-g={grupoDe(r)} aria-hidden /><span>{r.etiqueta}</span><small>{NOMBRE_TIPO[r.tipo]}</small>
                    </button>
                  )) : (
                    <p className="jv-cb-nota">No sabe nada de «{buscar.trim().slice(0, 40)}» todavía.{' '}
                      <button type="button" className="jv-cb-link" onClick={() => { setPestana('ensenar'); void aprender(buscar); setBuscar(''); }}>Que lo aprenda</button></p>
                  )
                ) : foco ? (
                  (porGrupo.get(foco) || []).slice(0, 60).map(f => (
                    <button key={f.id} type="button" className="jv-cb-fila" onClick={() => elegir(f.id)}>
                      <i className="jv-pt" data-g={foco} aria-hidden /><span>{f.etiqueta}</span>
                      {reciente(f.creado_en) && <em>nuevo</em>}<small>{f.usos || 0} usos</small>
                    </button>
                  ))
                ) : !filas?.length ? (
                  <p className="jv-cb-nota">Todavía está en blanco. Cada tema que le enseñes, cada búsqueda en internet y cada «recordá…» aparece aquí como una estrella nueva.</p>
                ) : (
                  GRUPOS.filter(g => porGrupo.get(g.id)?.length).map(g => (
                    <button key={g.id} type="button" className="jv-cb-fila" onClick={() => enfocarGrupo(g.id)}>
                      <i className="jv-pt" data-g={g.id} aria-hidden /><span>{g.nombre}</span><small>{porGrupo.get(g.id)!.length} ideas</small>
                    </button>
                  ))
                )}
              </>
            )
          )}
          {pestana === 'ensenar' && (
            <>
              <form className="jv-cb-ensenar" onSubmit={e => { e.preventDefault(); void aprender(ensenar); }}>
                <input value={ensenar} onChange={e => setEnsenar(e.target.value)} placeholder="Un tema: cargadores GaN" aria-label="Tema para que Jarvis aprenda" maxLength={60} enterKeyHint="send" disabled={aprendiendo.estado === 'si'} />
                <button type="submit" className="jv-cb-pri" disabled={ensenar.trim().length < 2 || aprendiendo.estado === 'si'}>{aprendiendo.estado === 'si' ? <span className="ai-giro" aria-hidden="true" /> : 'Aprender'}</button>
              </form>
              <p className="jv-cb-log" role="status" data-estado={aprendiendo.estado}>
                {aprendiendo.estado === 'si' ? <>Investigando <b>{aprendiendo.texto}</b> en inventario, taller e internet…</>
                  : aprendiendo.estado === 'ok' ? <>Aprendí <b>{aprendiendo.texto}</b></>
                    : aprendiendo.estado === 'error' ? aprendiendo.texto
                      : 'Jarvis lo investiga en inventario, taller e internet y lo guarda solo. No hace falta ir al chat.'}
              </p>
            </>
          )}
          {pestana === 'actividad' && (
            <>
              <div className="jv-cb-barras" aria-label={`Ideas nuevas por día, últimos 14 días: ${curva.join(', ')}`}>
                {curva.map((v, i) => <i key={i} style={{ height: `${Math.max(6, (v / Math.max(1, ...curva)) * 100)}%` }} data-hoy={i === 13 || undefined} />)}
              </div>
              {ultimos.map(u => (
                <button key={u.id} type="button" className="jv-cb-fila" onClick={() => elegir(u.id)}>
                  <small className="jv-cb-cuando">{haceCuanto(u.creado_en)}</small><span>Aprendió <b>{u.etiqueta}</b></span>
                </button>
              ))}
              {!ultimos.length && <p className="jv-cb-nota">Todavía no aprendió nada nuevo.</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// ESCENA 3D — constelaciones neuronales (diseño aprobado)
// ---------------------------------------------------------------------
// Canvas 2D con proyección en perspectiva. Las sinapsis son fibras curvas
// (bezier cúbica con dos puntos de control estables) que se afinan como un
// axón; cada neurona tiene ramitas cortas (dendritas), halo y núcleo; por
// las fibras viajan señales. Lo elegido se pinta en dorado. Los colores
// salen del tema (--jv-*), así se ve bien en claro y en oscuro.
// Rendimiento (Galaxy A12): ≤30 cps en equipos de ≤4 GB, menos segmentos
// y sin ramitas en los temas; se duerme si no se ve; «reducir movimiento»
// deja todo quieto.
type V3 = { x: number; y: number; z: number };
type Neurona = { f: Fila; g: Grupo; p: V3; r: number; sx: number; sy: number; sz: number; e: number; ramas: { v: V3; l: number; giro: number }[] };
type Fibra = { a: Neurona; b: Neurona; c1: V3; c2: V3; eje: boolean; vivo: boolean; senal: boolean; fase: number };
type Camara = { enfocar: (id: string) => void; grupo: (g: Grupo) => void; centrar: () => void; acercar: (f: number) => void };
type Paleta = { g: Record<Grupo, string>; c1: string; c2: string; polvo: string; oro: string; tinta: string; borde: string; eje: string; oscuro: boolean; astro: string; ui: string };


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


const hexA = (h: string, a: number) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
  if (!m) return h;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};
const bez = (a: V3, c1: V3, c2: V3, b: V3, t: number): V3 => {
  const u = 1 - t, k0 = u * u * u, k1 = 3 * u * u * t, k2 = 3 * u * t * t, k3 = t * t * t;
  return { x: k0 * a.x + k1 * c1.x + k2 * c2.x + k3 * b.x, y: k0 * a.y + k1 * c1.y + k2 * c2.y + k3 * b.y, z: k0 * a.z + k1 * c1.z + k2 * c2.z + k3 * b.z };
};
const INICIO = { yaw: 0.5, pitch: -0.25, zoom: 1 };

function Escena3D({ filas, enlaces, red, foco, sel, nuevo, margenes, onSel, onGrupo, camRef }: {
  filas: Fila[]; enlaces: Enlace[]; red: Red; foco: Grupo | null; sel: string | null; nuevo: string | null;
  margenes: { arriba: number; abajo: number };
  onSel: (id: string | null) => void; onGrupo: (g: Grupo) => void; camRef: MutableRefObject<Camara>;
}) {
  const cajaRef = useRef<HTMLDivElement>(null);
  const lienzoRef = useRef<HTMLCanvasElement>(null);
  const quieto = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const liviano = typeof navigator !== 'undefined' && (((navigator as any).deviceMemory ?? 8) <= 4 || (navigator.hardwareConcurrency || 8) <= 4);
  const est = useRef({
    neuronas: [] as Neurona[], porId: new Map<string, Neurona>(), fibras: [] as Fibra[], polvo: [] as { p: V3; m: number }[],
    yaw: INICIO.yaw, pitch: INICIO.pitch, zoom: INICIO.zoom, vYaw: 0, vPitch: 0,
    meta: null as null | { yaw: number; pitch: number; zoom: number }, w: 300, h: 300, dpr: 1,
    sel: null as string | null, foco: null as Grupo | null, nuevo: null as string | null, ultimoToque: 0, visible: true,
    arriba: 110, abajo: 240, pal: null as Paleta | null,
  });
  const rafRef = useRef(0);
  const onSelRef = useRef(onSel); onSelRef.current = onSel;
  const onGrupoRef = useRef(onGrupo); onGrupoRef.current = onGrupo;

  // Colores del tema (se releen si cambia claro/oscuro).
  const leerPaleta = useCallback(() => {
    const c = lienzoRef.current; if (!c) return;
    const cs = getComputedStyle(c), v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
    est.current.pal = {
      g: { centro: v('--jv-n-centro', '#0C7A74'), temas: v('--jv-n-temas', '#3460C8'), datos: v('--jv-n-datos', '#B8641E'), internet: v('--jv-n-internet', '#7A4FD0'), vos: v('--jv-n-vos', '#C2416E') },
      c1: v('--jv-cielo-1', '#F7FBFB'), c2: v('--jv-cielo-2', '#D6E5E8'), polvo: v('--jv-polvo', '18,38,43'), oro: v('--jv-oro', '#A8761C'),
      tinta: v('--jv-tinta', '#12262B'), borde: v('--jv-borde-txt', 'rgba(255,255,255,.9)'), eje: v('--jv-eje', '#7B9096'),
      oscuro: v('--jv-oscuro', '0') === '1', astro: v('--jv-f-astro', 'Georgia, serif'), ui: v('--jv-f-ui', 'system-ui, sans-serif'),
    };
  }, []);

  const dibujar = useCallback((t: number) => {
    const c = lienzoRef.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    const s = est.current, P = s.pal; if (!P) return;
    ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
    // Cielo
    const g = ctx.createRadialGradient(s.w * 0.5, s.h * 0.4, 10, s.w * 0.5, s.h * 0.45, Math.max(s.w, s.h) * 0.9);
    g.addColorStop(0, P.c1); g.addColorStop(1, P.c2);
    ctx.fillStyle = g; ctx.fillRect(0, 0, s.w, s.h);

    const cx = s.w / 2, cy = s.arriba + (s.h - s.arriba - s.abajo) / 2;
    const base = Math.min(s.w * 0.44, Math.max(120, s.h - s.arriba - s.abajo) * 0.5) * s.zoom;
    const cyw = Math.cos(s.yaw), syw = Math.sin(s.yaw), cp = Math.cos(s.pitch), sp = Math.sin(s.pitch);
    const D = 3.2;
    const proy = (p: V3): [number, number, number, number] => {
      const x1 = p.x * cyw + p.z * syw, z1 = -p.x * syw + p.z * cyw;
      const y2 = p.y * cp - z1 * sp, z2 = p.y * sp + z1 * cp;
      const e = D / (D + z2);
      return [cx + x1 * e * base, cy + y2 * e * base, z2, e];
    };
    // Polvo de estrellas (da profundidad al girar).
    for (const d of s.polvo) {
      const [x, y, z] = proy(d.p);
      if (x < 0 || y < 0 || x > s.w || y > s.h) continue;
      ctx.fillStyle = `rgba(${P.polvo},${(0.08 + d.m * (P.oscuro ? 0.4 : 0.22)) * (z > 0 ? 0.55 : 1)})`;
      const k = d.m > 0.93 ? 1.7 : 1; ctx.fillRect(x, y, k, k);
    }
    for (const n of s.neuronas) { const q = proy(n.p); n.sx = q[0]; n.sy = q[1]; n.sz = q[2]; n.e = q[3]; }
    const vecinos = new Set<string>();
    if (s.sel) { vecinos.add(s.sel); for (const v of red.vecinos.get(s.sel) || []) vecinos.add(v.id); }
    const zoomR = Math.min(1.6, Math.max(0.75, s.zoom));

    // Fibras, de atrás para adelante.
    const N = s.fibras.length > 600 ? 4 : liviano ? 8 : 14;
    const orden = [...s.fibras].sort((p, q) => (q.a.sz + q.b.sz) - (p.a.sz + p.b.sz));
    ctx.lineCap = 'round';
    for (const l of orden) {
      const viva = !!s.sel && (l.a.f.id === s.sel || l.b.f.id === s.sel);
      const apagar = !!s.foco && l.a.g !== s.foco && l.b.g !== s.foco && !viva;
      const col = viva ? P.oro : l.eje ? P.eje : P.g[l.b.g];
      const z = (l.a.sz + l.b.sz) / 2, prof = Math.max(0.25, Math.min(1, 0.75 - z * 0.35));
      const alfa = (apagar ? 0.08 : viva ? 0.95 : s.sel ? 0.16 : l.eje ? 0.3 : 0.5) * prof;
      ctx.strokeStyle = hexA(col, alfa);
      let ant = [l.a.sx, l.a.sy, l.a.e];
      for (let i = 1; i <= N; i++) {
        const k = i / N, q = proy(bez(l.a.p, l.c1, l.c2, l.b.p, k));
        // Más gruesa en las puntas, fina al medio: como un axón.
        ctx.lineWidth = Math.min(viva ? 3.2 : 2.4, Math.max(0.5, (viva ? 1.7 : 1.2) * (0.35 + 0.65 * Math.pow(Math.abs(k - 0.5) * 2, 1.6)) * ant[2] * 1.4 * zoomR));
        ctx.beginPath(); ctx.moveTo(ant[0], ant[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
        ant = [q[0], q[1], q[3]];
      }
      // Señal que viaja por la fibra.
      if (!quieto && !apagar && (viva || l.vivo || (!liviano && l.senal))) {
        const k = ((t / (viva ? 1400 : 3200)) + l.fase) % 1, q = proy(bez(l.a.p, l.c1, l.c2, l.b.p, k));
        const r = 3.6 * q[3] * zoomR, hg = ctx.createRadialGradient(q[0], q[1], 0, q[0], q[1], r * 3);
        hg.addColorStop(0, hexA(viva ? P.oro : col, 0.95)); hg.addColorStop(1, hexA(col, 0));
        ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(q[0], q[1], r * 3, 0, 7); ctx.fill();
      }
    }

    // Neuronas, de atrás para adelante.
    const ns = [...s.neuronas].sort((a, b) => b.sz - a.sz);
    const etiquetas: { n: Neurona; r: number }[] = [];
    for (const n of ns) {
      const { sx: x, sy: y, sz: z, e } = n;
      if (x < -40 || y < -40 || x > s.w + 40 || y > s.h + 40) continue;
      const apagar = !!s.foco && n.g !== s.foco && n.f.id !== s.sel && n.f.tipo !== 'raiz';
      const tenue = apagar || (!!s.sel && !vecinos.has(n.f.id) && n.f.tipo !== 'raiz');
      const esSel = n.f.id === s.sel;
      const col = esSel ? P.oro : n.f.tipo === 'raiz' ? (P.oscuro ? '#FFFFFF' : P.tinta) : P.g[n.g];
      const prof = Math.max(0.35, Math.min(1, 0.8 - z * 0.3)), r = Math.max(1.6, n.r * 0.55 * e * zoomR);
      // Ramitas (dendritas): cortas, curvas, que se desvanecen.
      if (!(liviano && n.f.tipo === 'tema') && !tenue) for (const b of n.ramas) {
        const p1 = { x: n.p.x + b.v.x * b.l * 0.5 + b.giro * 0.03, y: n.p.y + b.v.y * b.l * 0.5, z: n.p.z + b.v.z * b.l * 0.5 - b.giro * 0.03 };
        const p2 = { x: n.p.x + b.v.x * b.l, y: n.p.y + b.v.y * b.l, z: n.p.z + b.v.z * b.l };
        const [x1, y1] = proy(p1), [x2, y2] = proy(p2);
        const gr = ctx.createLinearGradient(x, y, x2, y2); gr.addColorStop(0, hexA(col, 0.45 * prof)); gr.addColorStop(1, hexA(col, 0));
        ctx.strokeStyle = gr; ctx.lineWidth = Math.max(0.5, r * 0.35); ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x1, y1, x2, y2); ctx.stroke();
      }
      const hr = r * (n.f.tipo === 'raiz' ? 5 : n.f.tipo === 'dominio' ? 4.5 : n.f.tipo === 'tema' || n.f.tipo === 'modulo' ? 3.6 : 2.6);
      const halo = ctx.createRadialGradient(x, y, 0, x, y, hr);
      halo.addColorStop(0, hexA(col, (tenue ? 0.06 : P.oscuro ? 0.4 : 0.22) * prof)); halo.addColorStop(1, hexA(col, 0));
      ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(x, y, hr, 0, 7); ctx.fill();
      const nuc = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
      nuc.addColorStop(0, '#FFFFFF'); nuc.addColorStop(0.45, hexA(col, tenue ? 0.3 : 1)); nuc.addColorStop(1, hexA(col, tenue ? 0.15 : 0.8));
      ctx.fillStyle = nuc; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      if ((n.f.id === s.nuevo || esSel) && !quieto) {
        ctx.strokeStyle = hexA(P.oro, 0.85); ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(x, y, r + 6 + (n.f.id === s.nuevo ? Math.sin(t / 180) * 3 : 0), 0, 7); ctx.stroke();
      }
      if (!tenue || esSel) etiquetas.push({ n, r });
    }

    // Nombres: constelaciones (ramas) en versalitas arriba de la estrella;
    // temas al costado cuando se acerca o se elige. El que choca se omite.
    const puestos: number[][] = [];
    const PRIO: Record<string, number> = { raiz: 0, dominio: 1, modulo: 2, tema: 3, recuerdo: 4, dato: 5, fuente: 5 };
    etiquetas.sort((a, b) => Number(b.n.f.id === s.sel) - Number(a.n.f.id === s.sel) || PRIO[a.n.f.tipo] - PRIO[b.n.f.tipo] || a.n.sz - b.n.sz);
    ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'round';
    const conLetras = 'letterSpacing' in ctx;
    for (const { n, r } of etiquetas) {
      const grande = n.f.tipo === 'raiz' || n.f.tipo === 'dominio';
      const ver = grande || n.f.id === s.sel || n.f.id === s.nuevo || vecinos.has(n.f.id)
        || (n.f.tipo === 'modulo' && s.zoom > 0.95) || (s.zoom > 1.25 && n.sz < 0.2 && (!s.foco || n.g === s.foco));
      if (!ver) continue;
      let x: number, y: number, txt: string;
      if (grande) {
        ctx.font = `600 ${n.f.tipo === 'raiz' ? 13 : 12}px ${P.astro}`; ctx.textAlign = 'center';
        if (conLetras) (ctx as any).letterSpacing = '2px';
        txt = n.f.etiqueta.toUpperCase().slice(0, 26);
        const mw = ctx.measureText(txt).width / 2 + 6;
        x = Math.min(s.w - mw, Math.max(mw, n.sx)); y = n.sy - r - 10;
        const caja = [x - mw, y - 13, x + mw, y + 3];
        if (puestos.some(p => caja[0] < p[2] && caja[2] > p[0] && caja[1] < p[3] && caja[3] > p[1]) && n.f.id !== s.sel) { if (conLetras) (ctx as any).letterSpacing = '0px'; continue; }
        puestos.push(caja);
        ctx.lineWidth = 4; ctx.strokeStyle = P.borde; ctx.strokeText(txt, x, y);
        ctx.fillStyle = n.f.tipo === 'raiz' ? P.tinta : hexA(P.g[n.g], Math.max(0.75, Math.min(1, 0.8 - n.sz * 0.3)));
        if (!!s.foco && n.g !== s.foco && n.f.tipo !== 'raiz') ctx.fillStyle = hexA(P.g[n.g], 0.3);
        ctx.fillText(txt, x, y);
        if (conLetras) (ctx as any).letterSpacing = '0px';
      } else {
        ctx.font = `500 11.5px ${P.ui}`; ctx.textAlign = 'left';
        txt = n.f.etiqueta.length > 26 ? n.f.etiqueta.slice(0, 25) + '…' : n.f.etiqueta;
        const w = ctx.measureText(txt).width;
        x = n.sx + r + 6; y = n.sy + 4;
        if (x + w > s.w - 4) { ctx.textAlign = 'right'; x = n.sx - r - 6; }
        const caja = ctx.textAlign === 'right' ? [x - w, y - 11, x, y + 3] : [x, y - 11, x + w, y + 3];
        if (n.f.id !== s.sel && puestos.some(p => caja[0] < p[2] && caja[2] > p[0] && caja[1] < p[3] && caja[3] > p[1])) continue;
        puestos.push(caja);
        ctx.lineWidth = 4; ctx.strokeStyle = P.borde; ctx.strokeText(txt, x, y);
        ctx.fillStyle = n.f.id === s.sel ? P.oro : P.tinta; ctx.fillText(txt, x, y);
      }
    }
  }, [red, liviano, quieto]);

  // Bucle: corre mientras se ve; en equipos livianos a ~30 cps.
  const bucle = useCallback(() => {
    if (rafRef.current) return;
    let previo = 0;
    const paso = (t: number) => {
      const s = est.current;
      rafRef.current = 0;
      if (document.hidden || !s.visible) return;
      rafRef.current = requestAnimationFrame(paso);
      const dt = previo ? Math.min(64, t - previo) : 16;
      if (previo && dt < (liviano ? 32 : 14)) return;
      previo = t;
      if (s.meta) {
        // Viaje hacia lo elegido.
        const k = quieto ? 1 : Math.min(1, dt / 160);
        let dy = s.meta.yaw - s.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        s.yaw += dy * k; s.pitch += (s.meta.pitch - s.pitch) * k; s.zoom += (s.meta.zoom - s.zoom) * k;
        if (Math.abs(dy) < 0.002 && Math.abs(s.meta.pitch - s.pitch) < 0.002 && Math.abs(s.meta.zoom - s.zoom) < 0.003) s.meta = null;
      } else if (Math.abs(s.vYaw) > 0.00005 || Math.abs(s.vPitch) > 0.00005) {
        // Inercia después de soltar.
        s.yaw += s.vYaw * dt; s.pitch = Math.max(-1.3, Math.min(1.3, s.pitch + s.vPitch * dt));
        s.vYaw *= Math.pow(0.93, dt / 16); s.vPitch *= Math.pow(0.93, dt / 16);
      } else if (!quieto && !s.sel && !s.foco && Date.now() - s.ultimoToque > 2500) {
        s.yaw += 0.0001 * dt; // gira despacio sola
      } else if (quieto && !s.sel) {
        dibujar(t); cancelAnimationFrame(rafRef.current); rafRef.current = 0; return;
      }
      dibujar(t);
    };
    rafRef.current = requestAnimationFrame(paso);
  }, [dibujar, liviano, quieto]);
  useEffect(() => () => { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }, []);

  // Datos → neuronas y fibras (posiciones estables por rama).
  useEffect(() => {
    const s = est.current;
    const pos = disponer(filas, red);
    s.neuronas = filas.map(f => {
      const nr = f.tipo === 'tema' || f.tipo === 'dato' || f.tipo === 'fuente' ? 3 : 5;
      const ramas = Array.from({ length: nr }, (_, i) => ({
        v: norm({ x: hash(`${f.id}x${i}`) - 0.5, y: hash(`${f.id}y${i}`) - 0.5, z: hash(`${f.id}z${i}`) - 0.5 }),
        l: 0.05 + hash(`${f.id}l${i}`) * 0.07, giro: (hash(`${f.id}g${i}`) - 0.5) * 1.4,
      }));
      return { f, g: grupoDe(f), p: pos.get(f.id)!, r: tamano(f), sx: 0, sy: 0, sz: 0, e: 1, ramas };
    });
    s.porId = new Map(s.neuronas.map(n => [n.f.id, n]));
    s.fibras = enlaces.filter(e => s.porId.has(e.origen) && s.porId.has(e.destino)).map(e => {
      const a = s.porId.get(e.origen)!, b = s.porId.get(e.destino)!;
      const m = { x: (a.p.x + b.p.x) / 2, y: (a.p.y + b.p.y) / 2, z: (a.p.z + b.p.z) / 2 };
      const d = Math.hypot(b.p.x - a.p.x, b.p.y - a.p.y, b.p.z - a.p.z);
      const off = (k: string) => (hash(e.id + k) - 0.5) * d * 0.45;
      return {
        a, b, eje: a.f.tipo === 'raiz' || b.f.tipo === 'raiz',
        c1: { x: m.x + off('a'), y: m.y + off('b'), z: m.z + off('c') }, c2: { x: m.x + off('d'), y: m.y + off('e'), z: m.z + off('f') },
        vivo: reciente(b.f.ultimo_uso, 48) || reciente(a.f.ultimo_uso, 48), senal: hash(e.id + 's') < 0.33, fase: hash(e.id),
      };
    });
    if (!s.polvo.length) s.polvo = Array.from({ length: liviano ? 160 : 320 }, (_, i) => {
      const v = norm({ x: hash(`p${i}`) - 0.5, y: hash(`q${i}`) - 0.5, z: hash(`r${i}`) - 0.5 }), R = 1.9 + hash(`s${i}`) * 1.6;
      return { p: { x: v.x * R, y: v.y * R, z: v.z * R }, m: hash(`m${i}`) };
    });
    s.ultimoToque = Date.now();
    bucle();
  }, [filas, enlaces, red, bucle, liviano]);

  useEffect(() => { const s = est.current; s.sel = sel; s.foco = foco; s.nuevo = nuevo; s.ultimoToque = Date.now(); bucle(); }, [sel, foco, nuevo, bucle]);
  useEffect(() => { const s = est.current; s.arriba = margenes.arriba; s.abajo = margenes.abajo; bucle(); }, [margenes, bucle]);

  // Tamaño, tema, visibilidad y gestos.
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
      dibujar(performance.now());
    };
    leerPaleta(); medir();
    const ro = new ResizeObserver(medir); ro.observe(caja);
    const mo = new MutationObserver(() => { leerPaleta(); dibujar(performance.now()); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    const io = new IntersectionObserver(es => { s.visible = es[0]?.isIntersecting !== false; if (s.visible) bucle(); });
    io.observe(c);
    const vis = () => { if (!document.hidden) bucle(); };
    document.addEventListener('visibilitychange', vis);

    const punteros = new Map<number, { x: number; y: number }>();
    let inicio: { x: number; y: number } | null = null, movio = false, pellizco = 0, ultimo = { x: 0, y: 0, t: 0 };
    const tocar = () => { s.ultimoToque = Date.now(); };
    const abajo = (e: PointerEvent) => {
      c.setPointerCapture?.(e.pointerId);
      punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
      s.vYaw = s.vPitch = 0; s.meta = null; tocar();
      if (punteros.size === 1) { inicio = { x: e.clientX, y: e.clientY }; movio = false; ultimo = { x: e.clientX, y: e.clientY, t: performance.now() }; }
      if (punteros.size === 2) { const [a, b] = [...punteros.values()]; pellizco = Math.hypot(a.x - b.x, a.y - b.y); movio = true; }
      bucle();
    };
    const mover = (e: PointerEvent) => {
      if (!punteros.has(e.pointerId)) return;
      const antes = punteros.get(e.pointerId)!;
      punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
      tocar();
      if (punteros.size === 2) {
        const [a, b] = [...punteros.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pellizco) s.zoom = Math.max(0.5, Math.min(3, s.zoom * d / pellizco));
        pellizco = d; return;
      }
      if (inicio && Math.hypot(e.clientX - inicio.x, e.clientY - inicio.y) > 5) movio = true;
      if (!movio) return;
      const dx = e.clientX - antes.x, dy = e.clientY - antes.y;
      // La cara de adelante sigue al dedo.
      s.yaw -= dx * 0.008; s.pitch = Math.max(-1.3, Math.min(1.3, s.pitch + dy * 0.008));
      const now = performance.now(), dt = Math.max(8, now - ultimo.t);
      s.vYaw = -(e.clientX - ultimo.x) * 0.008 / dt; s.vPitch = (e.clientY - ultimo.y) * 0.008 / dt;
      ultimo = { x: e.clientX, y: e.clientY, t: now };
    };
    const arriba = (e: PointerEvent) => {
      if (!punteros.has(e.pointerId)) return;
      punteros.delete(e.pointerId);
      if (punteros.size === 0) {
        if (!movio && inicio) {
          // Toque: la estrella más cercana bajo el dedo (lo de adelante gana).
          const r = c.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
          let mejor: Neurona | null = null, dMin = 30;
          for (const n of s.neuronas) {
            const d = Math.hypot(n.sx - x, n.sy - y) + n.sz * 6;
            if (d < dMin) { dMin = d; mejor = n; }
          }
          s.vYaw = s.vPitch = 0;
          if (mejor?.f.tipo === 'dominio' && mejor.f.id !== s.sel) onGrupoRef.current(mejor.g);
          else onSelRef.current(mejor ? mejor.f.id : null);
        } else if (performance.now() - ultimo.t > 80) { s.vYaw = s.vPitch = 0; }
        inicio = null; pellizco = 0;
      } else pellizco = 0;
    };
    const rueda = (e: WheelEvent) => { e.preventDefault(); tocar(); s.meta = null; s.zoom = Math.max(0.5, Math.min(3, s.zoom * Math.exp(-e.deltaY * 0.0015))); bucle(); };
    const teclas = (e: KeyboardEvent) => {
      const paso = 0.18;
      if (e.key === 'ArrowLeft') s.yaw += paso; else if (e.key === 'ArrowRight') s.yaw -= paso;
      else if (e.key === 'ArrowUp') s.pitch = Math.max(-1.3, s.pitch - paso); else if (e.key === 'ArrowDown') s.pitch = Math.min(1.3, s.pitch + paso);
      else if (e.key === '+' || e.key === '=') s.zoom = Math.min(3, s.zoom * 1.2); else if (e.key === '-') s.zoom = Math.max(0.5, s.zoom / 1.2);
      else return;
      e.preventDefault(); tocar(); bucle();
    };
    c.addEventListener('pointerdown', abajo);
    c.addEventListener('pointermove', mover);
    c.addEventListener('pointerup', arriba);
    c.addEventListener('pointercancel', arriba);
    c.addEventListener('wheel', rueda, { passive: false });
    c.addEventListener('keydown', teclas);

    const mirar = (p: V3, zoom: number) => {
      const lejos = Math.hypot(p.x, p.y, p.z) < 0.01;
      s.meta = {
        yaw: lejos ? s.yaw : Math.atan2(p.x, -p.z),
        pitch: lejos ? INICIO.pitch : Math.max(-1.3, Math.min(1.3, Math.atan2(-p.y, Math.hypot(p.x, p.z)))),
        zoom,
      };
      s.vYaw = s.vPitch = 0; tocar(); bucle();
    };
    camRef.current = {
      enfocar: id => { const n = s.porId.get(id); if (n) mirar(n.p, Math.max(s.zoom, 1.35)); },
      grupo: g => {
        const ns = s.neuronas.filter(n => n.g === g && n.f.tipo !== 'raiz');
        if (!ns.length) return;
        const m = ns.reduce((a, n) => ({ x: a.x + n.p.x, y: a.y + n.p.y, z: a.z + n.p.z }), { x: 0, y: 0, z: 0 });
        mirar({ x: m.x / ns.length, y: m.y / ns.length, z: m.z / ns.length }, 1.15);
      },
      centrar: () => { s.meta = { ...INICIO, yaw: s.yaw }; s.vYaw = s.vPitch = 0; tocar(); bucle(); },
      acercar: f => { s.meta = { yaw: s.yaw, pitch: s.pitch, zoom: Math.max(0.5, Math.min(3, s.zoom * f)) }; tocar(); bucle(); },
    };
    return () => {
      ro.disconnect(); mo.disconnect(); io.disconnect();
      document.removeEventListener('visibilitychange', vis);
      c.removeEventListener('pointerdown', abajo); c.removeEventListener('pointermove', mover);
      c.removeEventListener('pointerup', arriba); c.removeEventListener('pointercancel', arriba);
      c.removeEventListener('wheel', rueda); c.removeEventListener('keydown', teclas);
    };
  }, [dibujar, bucle, leerPaleta, camRef, liviano]);

  return (
    <div className="jv-cb-escena" ref={cajaRef}>
      <canvas ref={lienzoRef} tabIndex={0} role="img"
        aria-label={`Cerebro en 3D: ${filas.length} ideas. Arrastrá para girar; flechas y + / − con el teclado. La pestaña Explorar las lista.`} />
      <div className="jv-cb-zoom">
        <button type="button" className="jv-vidrio jv-cb-ib" aria-label="Acercar" title="Acercar" onClick={() => camRef.current.acercar(1.25)}><Plus className="w-[18px] h-[18px]" /></button>
        <button type="button" className="jv-vidrio jv-cb-ib" aria-label="Alejar" title="Alejar" onClick={() => camRef.current.acercar(1 / 1.25)}><Minus className="w-[18px] h-[18px]" /></button>
      </div>
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
        <div className="jv-det-tt">
          <small>{NOMBRE_TIPO[n.tipo].toUpperCase()} · {(GRUPOS.find(g => g.id === grupoDe(n))?.nombre || '').toUpperCase()}</small>
          <b>{n.etiqueta}</b>
          {n.fuente && <span>Lo sabe por {NOMBRE_FUENTE[n.fuente] || n.fuente}</span>}
        </div>
        <button type="button" className="jv-cerebro-ic" aria-label="Cerrar ficha" title="Cerrar" onClick={onCerrar}><X className="w-4 h-4" /></button>
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
