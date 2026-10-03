// =====================================================================
// ASISTENTE IA — chat de consulta del personal (IA gratuita)
// =====================================================================
// Diseño aprobado: chat al centro, conversaciones propias a la izquierda y
// el cupo del día a la derecha. En tablet el historial pasa a un cajón; en
// teléfono también el cupo (una píldora arriba lo abre).
//
// Todo lo que habla con la IA pasa por la Edge Function `asistente-ia`,
// que guarda la conversación y lleva el cupo. Desde aquí solo se LEEN las
// conversaciones propias (la base no deja leer las ajenas a nadie).
// =====================================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Sparkles, Plus, Lock, Globe, ArrowUp, Copy, Settings, Menu, BarChart3, Trash2, X, Clock, Info, ShieldCheck, ArrowLeft,
  Package, Receipt, Wrench, TriangleAlert, Ban, ChevronRight,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { useToast, useConfirm } from '../ui/Overlays';
import { esSuperadmin } from '../../utils/roles';
import type { User } from '../../types';

interface Conversacion { id: string; titulo: string; actualizado_en: string }
/** Una consulta al sistema que hizo la IA (la tarjeta encima de la respuesta). */
interface Consulta { modulo: string; desc: string; filas: string; detalle: string; sinPermiso?: boolean }
interface Mensaje {
  id: string; rol: 'user' | 'assistant'; texto: string;
  fuentes?: { titulo: string; url: string }[];
  consultas?: Consulta[];
  tokens_in?: number; tokens_out?: number; proveedor?: string | null; modelo?: string | null; busco?: boolean;
  pendiente?: boolean;
}
interface Cupo {
  usados: number; limite: number | null; disponibles: number | null; tokensHoy: number;
  equipo: { gemini: number; groq: number; cupoGemini: number; cupoGroq: number };
  busqueda: boolean; respaldo: boolean; groqConfigurado: boolean;
  modulos?: string[]; consultasHoy?: number;
}
type Modulos = Record<'inventario' | 'facturacion' | 'taller' | 'errores', boolean>;
interface Ajustes { limite_diario: number; busqueda: boolean; respaldo: boolean; acceso: 'personal' | 'gestion' | 'super'; modulos?: Modulos }

const MODULOS: { id: keyof Modulos; nombre: string; desc: string; icono: LucideIcon; soloSuper?: boolean }[] = [
  { id: 'inventario', nombre: 'Inventario', desc: 'Existencias, precios, por agotarse', icono: Package },
  { id: 'facturacion', nombre: 'Facturación', desc: 'Totales y facturas sin datos de clientes', icono: Receipt },
  { id: 'taller', nombre: 'Taller', desc: 'Órdenes por estado y días', icono: Wrench },
  { id: 'errores', nombre: 'Errores del sistema', desc: 'Fallos de correo, pagos, Hacienda y bitácora', icono: TriangleAlert, soloSuper: true },
];
const ICONO_MODULO: Record<string, LucideIcon> = { Inventario: Package, 'Facturación': Receipt, Taller: Wrench, 'Errores del sistema': TriangleAlert };

/** «gemini-3.8-flash» → «Gemini 3.8 Flash». */
function nombreModelo(m?: string | null): string {
  if (!m) return 'Gemini Flash';
  if (/llama|groq/i.test(m)) return 'Groq (respaldo)';
  return m.replace(/-latest$/, '').split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// ---------------------------------------------------------------------
// CACHÉ DE CONVERSACIONES
// ---------------------------------------------------------------------
// La base responde en ~50 ms, pero en el teléfono cada lectura son dos
// viajes de red (la verificación CORS y la lectura) y en datos móviles eso
// suma casi un segundo en el que la pantalla no cambiaba. Así que lo que ya
// se leyó se guarda: al abrir una conversación conocida aparece AL INSTANTE
// y se actualiza por detrás. Vive en memoria y en sessionStorage (se borra
// al cerrar la app; nunca en localStorage, porque son conversaciones
// privadas en un teléfono que puede ser compartido).
const COLUMNAS_MSG = 'id,rol,texto,fuentes,consultas,tokens_in,tokens_out,proveedor,modelo,busco';
const CLAVE_CACHE = 'tv_ia_cache';
const MAX_EN_CACHE = 12;
const cache = new Map<string, Mensaje[]>();
const enVuelo = new Map<string, Promise<Mensaje[] | null>>();
// La caché es de UNA cuenta: si en el mismo teléfono entra otra persona,
// se vacía antes de mostrar nada (si no, vería conversaciones ajenas).
let dueñoCache: string | null = null;
const claveCache = () => `${CLAVE_CACHE}:${dueñoCache}`;
function prepararCache(uid: string) {
  if (dueñoCache === uid) return;
  dueñoCache = uid;
  cache.clear();
  enVuelo.clear();
  try {
    const guardado = JSON.parse(sessionStorage.getItem(claveCache()) || '[]') as [string, Mensaje[]][];
    for (const [id, ms] of guardado) cache.set(id, ms);
  } catch { /* sin almacenamiento o dato viejo: se empieza vacío */ }
}
function persistir() {
  try { sessionStorage.setItem(claveCache(), JSON.stringify([...cache.entries()])); } catch { /* lleno o bloqueado */ }
}
function guardarEnCache(id: string, ms: Mensaje[]) {
  cache.delete(id);
  cache.set(id, ms.filter(m => !m.pendiente));
  while (cache.size > MAX_EN_CACHE) cache.delete(cache.keys().next().value as string);
  persistir();
}
function quitarDeCache(id: string) {
  cache.delete(id);
  persistir();
}
/** Lee los mensajes de una conversación; si ya hay una lectura en curso, la reutiliza. */
function leerMensajes(id: string): Promise<Mensaje[] | null> {
  const ya = enVuelo.get(id);
  if (ya) return ya;
  const p = Promise.resolve(
    supabase.from('ia_mensajes').select(COLUMNAS_MSG).eq('conversacion_id', id).order('creado_en', { ascending: true }),
  ).then(({ data, error }) => {
    if (error) return null;
    const ms = (data as Mensaje[]) || [];
    guardarEnCache(id, ms);
    return ms;
  }).finally(() => enVuelo.delete(id));
  enVuelo.set(id, p);
  return p;
}

const CLAVE_ACTIVA = 'tv_ia_conversacion';
const leerActiva = () => { try { return sessionStorage.getItem(`${CLAVE_ACTIVA}:${dueñoCache}`); } catch { return null; } };
const guardarActiva = (id: string | null) => {
  try { const k = `${CLAVE_ACTIVA}:${dueñoCache}`; if (id) sessionStorage.setItem(k, id); else sessionStorage.removeItem(k); } catch { /* sin almacenamiento */ }
};

/** Contexto de Gemini Flash: un millón de tokens. */
const CONTEXTO = 1_000_000;
const estimarTokens = (t: string) => (t.trim() ? Math.ceil(t.trim().length / 4) : 0);
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));
const SUGERENCIAS = [
  { t: 'Inventario', d: '¿Qué productos están por agotarse?', p: '¿Qué productos están por agotarse?', modulo: 'inventario' },
  { t: 'Ventas', d: '¿Cuánto se facturó esta semana?', p: '¿Cuánto se facturó esta semana y por qué medio de pago?', modulo: 'facturacion' },
  { t: 'Taller', d: '¿Qué órdenes llevan más de 5 días?', p: '¿Qué órdenes del taller llevan más de 5 días?', modulo: 'taller' },
  { t: 'Explicar', d: 'Un término o un error del celular', p: '¿Qué significa que un celular tenga eSIM y cómo se activa?' },
  { t: 'Redactar', d: 'Mensajes para clientes o redes', p: 'Escribime un mensaje corto y amable para avisar que llegaron accesorios nuevos.' },
  { t: 'Resumir', d: 'Un texto largo que pegués', p: 'Resumime en tres puntos este texto: ' },
];

function diaDe(iso: string): string {
  const d = new Date(iso), hoy = new Date(), ayer = new Date();
  ayer.setDate(hoy.getDate() - 1);
  if (d.toDateString() === hoy.toDateString()) return 'Hoy';
  if (d.toDateString() === ayer.toDateString()) return 'Ayer';
  return d.toLocaleDateString('es-CR', { day: 'numeric', month: 'long' });
}

/** Texto con formato simple (negrita, código, listas), sin HTML crudo. */
function Formato({ texto }: { texto: string }) {
  const bloques = texto.split(/```/);
  return (
    <>
      {bloques.map((b, i) => {
        if (i % 2 === 1) {
          const cuerpo = b.replace(/^[a-zA-Z0-9_-]*\n/, '');
          return <pre key={i} className="ai-pre">{cuerpo.replace(/\n$/, '')}</pre>;
        }
        const lineas = b.split('\n');
        const out: React.ReactNode[] = [];
        let lista: { orden: boolean; items: string[] } | null = null;
        const cerrar = () => {
          if (!lista) return;
          const Tag = lista.orden ? 'ol' : 'ul';
          out.push(<Tag key={`l${out.length}`}>{lista.items.map((it, j) => <li key={j}><Linea t={it} /></li>)}</Tag>);
          lista = null;
        };
        let tabla: string[][] | null = null;
        const cerrarTabla = () => {
          if (!tabla) return;
          const [cab, ...cuerpo] = tabla;
          out.push(
            <div key={`t${out.length}`} className="ai-tabla">
              <table>
                <thead><tr>{cab.map((c, k) => <th key={k}><Linea t={c} /></th>)}</tr></thead>
                <tbody>{cuerpo.map((f, r) => <tr key={r}>{f.map((c, k) => <td key={k}><Linea t={c} /></td>)}</tr>)}</tbody>
              </table>
            </div>,
          );
          tabla = null;
        };
        lineas.forEach((l, j) => {
          // Tablas en markdown: «| a | b |». La fila «|---|---|» se salta.
          if (/^\s*\|.*\|\s*$/.test(l)) {
            cerrar();
            if (/^\s*\|[\s:|-]+\|\s*$/.test(l)) return;
            const celdas = l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
            (tabla ||= []).push(celdas);
            return;
          }
          cerrarTabla();
          const vineta = l.match(/^\s*[-*•]\s+(.*)/);
          const num = l.match(/^\s*\d+[.)]\s+(.*)/);
          if (vineta || num) {
            const orden = !!num;
            if (!lista || lista.orden !== orden) { cerrar(); lista = { orden, items: [] }; }
            lista.items.push((vineta || num)![1]);
            return;
          }
          cerrar();
          const h = l.match(/^#{1,4}\s+(.*)/);
          if (h) { out.push(<p key={j} className="ai-h"><Linea t={h[1]} /></p>); return; }
          if (l.trim()) out.push(<p key={j}><Linea t={l} /></p>);
        });
        cerrar();
        cerrarTabla();
        return <React.Fragment key={i}>{out}</React.Fragment>;
      })}
    </>
  );
}
function Linea({ t }: { t: string }) {
  const partes = t.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {partes.map((p, i) =>
        p.startsWith('**') && p.endsWith('**') && p.length > 4 ? <strong key={i}>{p.slice(2, -2)}</strong>
          : p.startsWith('`') && p.endsWith('`') && p.length > 2 ? <code key={i}>{p.slice(1, -1)}</code>
            : <React.Fragment key={i}>{p}</React.Fragment>)}
    </>
  );
}

function TarjetaConsulta({ c }: { c: Consulta }) {
  const Icono = c.sinPermiso ? Ban : (ICONO_MODULO[c.modulo] || Package);
  return (
    <details className="ai-herr" data-no={c.sinPermiso || undefined}>
      <summary>
        <span className="ai-herr-ic"><Icono className="w-4 h-4" /></span>
        <span className="ai-herr-t"><b>{c.modulo}</b> · {c.desc}</span>
        {!c.sinPermiso && <span className="ai-herr-chip"><ShieldCheck className="w-3 h-3" />sin datos de clientes</span>}
        {c.filas !== '—' && <small>{c.filas}</small>}
        {c.detalle && <ChevronRight className="ai-herr-chev w-4 h-4" />}
      </summary>
      {c.detalle && <pre>{c.detalle}</pre>}
    </details>
  );
}

/** Un mensaje del historial. Memoizado: escribir en la caja (que cambia el
 *  estado del módulo en cada letra) ya no vuelve a formatear todo el
 *  historial, que en un teléfono de gama de entrada se notaba. */
const Burbuja = React.memo(function Burbuja({ m, onCopiar }: { m: Mensaje; onCopiar: (t: string) => void }) {
  if (m.rol === 'user') return <div className="ai-yo">{m.texto}</div>;
  return (
    <div className="ai-ia">
      {!!m.consultas?.length && <div className="ai-herrs">{m.consultas.map((c, i) => <React.Fragment key={i}><TarjetaConsulta c={c} /></React.Fragment>)}</div>}
      <div className="ai-tx"><Formato texto={m.texto} /></div>
      {!!m.fuentes?.length && (
        <div className="ai-fuentes">
          {m.fuentes.map((f, i) => (
            <a key={i} href={f.url} target="_blank" rel="noopener noreferrer"><b>{i + 1}</b>{f.titulo || 'Fuente'}</a>
          ))}
        </div>
      )}
      <div className="ai-pie">
        <button type="button" aria-label="Copiar respuesta" onClick={() => onCopiar(m.texto)}><Copy className="w-4 h-4" /></button>
        <span className="ai-tok">↑ <i>{k(m.tokens_in || 0)}</i> · ↓ <i>{k(m.tokens_out || 0)}</i> tokens</span>
        <span>{nombreModelo(m.modelo || (m.proveedor === 'groq' ? 'groq' : null))}{m.busco ? ' · con búsqueda' : ''}{m.consultas?.length ? ` · consultó ${m.consultas.length} ${m.consultas.length === 1 ? 'vez' : 'veces'}` : ''}</span>
      </div>
    </div>
  );
});
const ListaMensajes = React.memo(function ListaMensajes({ mensajes, onCopiar }: { mensajes: Mensaje[]; onCopiar: (t: string) => void }) {
  return <>{mensajes.map(m => <React.Fragment key={m.id}><Burbuja m={m} onCopiar={onCopiar} /></React.Fragment>)}</>;
});

function AnilloCupo({ cupo }: { cupo: Cupo | null }) {
  const r = 26, c = 2 * Math.PI * r;
  const sinLimite = !cupo || cupo.limite === null;
  const disp = cupo?.disponibles ?? 0;
  const frac = sinLimite ? 1 : Math.max(0, Math.min(1, disp / (cupo!.limite || 1)));
  const color = sinLimite ? 'var(--accent)' : disp === 0 ? 'var(--tv-danger)' : frac < 0.25 ? 'var(--tv-warn)' : 'var(--accent)';
  return (
    <div className="ai-anillo">
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--border-color)" strokeWidth="7" />
        <circle cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={`${(c * frac).toFixed(1)} ${c.toFixed(1)}`} transform="rotate(-90 32 32)" />
      </svg>
      <div>
        {sinLimite
          ? <><div className="ai-v">{cupo?.usados ?? 0}</div><div className="ai-k">mensajes hoy · sin límite</div></>
          : <><div className="ai-v tabular-nums">{disp} <span>de {cupo!.limite}</span></div><div className="ai-k">mensajes tuyos disponibles</div></>}
      </div>
    </div>
  );
}

function PanelCupo({ cupo, tokensConv }: { cupo: Cupo | null; tokensConv: number }) {
  const eq = cupo?.equipo;
  const pctG = eq ? Math.min(100, Math.round((eq.gemini / eq.cupoGemini) * 100)) : 0;
  const pctR = eq ? Math.min(100, Math.round((eq.groq / eq.cupoGroq) * 100)) : 0;
  return (
    <>
      <AnilloCupo cupo={cupo} />
      <div className="ai-mini" data-alto={pctG >= 80 || undefined}>
        <span><span>Cupo del equipo (Google)</span><b className="tabular-nums">{eq?.gemini ?? 0} / {eq?.cupoGemini ?? '—'}</b></span>
        <div className="ai-bt"><i style={{ width: `${pctG}%` }} /></div>
      </div>
      {cupo?.respaldo && cupo.groqConfigurado && (
        <div className="ai-mini">
          <span><span>Respaldo (Groq)</span><b className="tabular-nums">{eq?.groq ?? 0} / {eq?.cupoGroq ?? '—'}</b></span>
          <div className="ai-bt"><i style={{ width: `${pctR}%` }} /></div>
        </div>
      )}
      <div className="ai-kv"><span>Tokens de esta conversación</span><b className="tabular-nums">{tokensConv.toLocaleString('es-CR')}</b></div>
      <div className="ai-kv"><span>Contexto usado</span><b className="tabular-nums">{(tokensConv / CONTEXTO * 100).toFixed(tokensConv ? 1 : 0)} %</b></div>
      <div className="ai-kv"><span>Tus tokens hoy</span><b className="tabular-nums">{(cupo?.tokensHoy ?? 0).toLocaleString('es-CR')}</b></div>
      {cupo?.modulos && (
        <>
          <div className="ai-kv"><span>Consultas al sistema hoy</span><b className="tabular-nums">{cupo.consultasHoy ?? 0}</b></div>
          <div className="ai-kv"><span>Módulos que puede leer</span><b className="tabular-nums">{cupo.modulos.length}</b></div>
        </>
      )}
      <p className="ai-prov">Gratis con Gemini de Google{cupo?.respaldo && cupo.groqConfigurado ? ' y Groq de respaldo' : ''}. Las consultas al sistema se hacen con tus permisos y quedan en la bitácora.</p>
    </>
  );
}

function AsistenteIA({ currentUser }: { currentUser: User | null }) {
  const toast = useToast();
  const confirm = useConfirm();
  const soySuper = esSuperadmin(currentUser?.role);
  // Antes de leer nada guardado: la caché tiene que ser de esta cuenta.
  prepararCache(currentUser?.id || currentUser?.email || 'anon');

  const [convs, setConvs] = useState<Conversacion[]>([]);
  // La conversación abierta sobrevive a cambiar de pestaña (el módulo se
  // desmonta al salir); se recuerda solo en esta sesión del navegador.
  const [activa, setActivaEstado] = useState<string | null>(leerActiva);
  const setActiva = useCallback((id: string | null) => { guardarActiva(id); setActivaEstado(id); }, []);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [cupo, setCupo] = useState<Cupo | null>(null);
  const [texto, setTexto] = useState('');
  const [buscar, setBuscar] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [cargandoConv, setCargandoConv] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: 'respaldo' | 'error'; texto: string } | null>(null);
  const [vista, setVista] = useState<'chat' | 'ajustes'>('chat');
  const [cajon, setCajon] = useState<null | 'historial' | 'cupo'>(null);
  const finRef = useRef<HTMLDivElement>(null);
  const cajaRef = useRef<HTMLTextAreaElement>(null);
  // La conversación que acaba de crear el primer envío ya está en pantalla;
  // no se vuelve a leer de la base (parpadearía).
  const recienCreada = useRef<string | null>(null);

  const cargarConvs = useCallback(async () => {
    const { data } = await supabase.from('ia_conversaciones').select('id,titulo,actualizado_en').order('actualizado_en', { ascending: false }).limit(60);
    const lista = (data as Conversacion[]) || [];
    setConvs(lista);
    // Precarga en segundo plano de las más recientes: abrirlas es instantáneo.
    lista.slice(0, 3).forEach(c => { if (!cache.has(c.id)) void leerMensajes(c.id); });
  }, []);
  const cargarCupo = useCallback(async () => {
    const { data } = await supabase.functions.invoke('asistente-ia', { body: { accion: 'cupo' } });
    if (data?.ok) setCupo(data.cupo);
  }, []);
  useEffect(() => { void cargarConvs(); void cargarCupo(); }, [cargarConvs, cargarCupo]);

  useEffect(() => {
    if (!activa) { setMensajes([]); setCargandoConv(false); return; }
    if (recienCreada.current === activa) { recienCreada.current = null; return; }
    let vivo = true;
    const enCache = cache.get(activa);
    // Conocida: se pinta ya y se refresca por detrás. Nueva: esqueleto (no
    // el saludo ni la conversación anterior) hasta que llegue.
    setMensajes(enCache || []);
    setCargandoConv(!enCache);
    void leerMensajes(activa).then(ms => {
      if (!vivo) return;
      setCargandoConv(false);
      if (ms) setMensajes(ms);
    });
    return () => { vivo = false; };
  }, [activa]);

  // Lo que se ve de la conversación activa se guarda en caché al cambiar.
  useEffect(() => {
    if (activa && !cargandoConv && mensajes.length && !mensajes.some(m => m.pendiente)) guardarEnCache(activa, mensajes);
  }, [activa, mensajes, cargandoConv]);

  useEffect(() => { finRef.current?.scrollIntoView({ block: 'end' }); }, [mensajes.length, enviando]);

  // La caja crece con el texto hasta un tope, como en la app de Claude.
  useEffect(() => {
    const el = cajaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [texto]);

  const tokensConv = useMemo(() => mensajes.reduce((a, m) => a + (m.tokens_in || 0) + (m.tokens_out || 0), 0), [mensajes]);
  const agotado = !!cupo && cupo.disponibles === 0;
  // Con consultas al sistema, la búsqueda en Google no se usa (no se
  // combinan, y el plan gratis no la incluye).
  const conSistema = !!cupo?.modulos?.length;
  const busquedaPermitida = cupo ? cupo.busqueda && !conSistema : false;
  const ultimoModelo = [...mensajes].reverse().find(m => m.rol === 'assistant')?.modelo;
  const sugerencias = SUGERENCIAS.filter(s => !s.modulo || cupo?.modulos?.includes(s.modulo)).slice(0, 4);

  const nueva = () => { setActiva(null); setMensajes([]); setAviso(null); setCajon(null); setVista('chat'); setTimeout(() => cajaRef.current?.focus(), 50); };

  const enviar = async (contenido?: string) => {
    const t = (contenido ?? texto).trim();
    if (!t || enviando || agotado) return;
    setTexto('');
    setAviso(null);
    setEnviando(true);
    setMensajes(prev => [...prev, { id: `tmp-${Date.now()}`, rol: 'user', texto: t, pendiente: true }]);
    try {
      const { data, error } = await supabase.functions.invoke('asistente-ia', {
        body: { accion: 'enviar', texto: t, conversacionId: activa, buscar: buscar && busquedaPermitida },
      });
      // Los errores con cuerpo (límite, sin servicio) llegan como `error`
      // del cliente; el detalle útil viene en el contexto de la respuesta.
      let res = data;
      if (error && (error as any).context?.json) {
        try { res = await (error as any).context.json(); } catch { /* sin cuerpo */ }
      }
      if (!res?.ok) {
        if (res?.cupo) setCupo(res.cupo);
        setMensajes(prev => prev.filter(m => !m.pendiente));
        setTexto(t);
        setAviso({ tipo: 'error', texto: res?.error || 'No se pudo enviar. Revisa la conexión e intenta de nuevo.' });
        return;
      }
      setMensajes(prev => [...prev.map(m => (m.pendiente ? { ...m, pendiente: false } : m)), { id: `a-${Date.now()}`, ...res.mensaje }]);
      setCupo(res.cupo);
      if (res.respaldo) setAviso({ tipo: 'respaldo', texto: 'Google llegó a su límite por ahora; respondió el respaldo (Groq), sin búsqueda en internet.' });
      else if (res.sinBusqueda) {
        // Se avisa una sola vez y se apaga el globo, para no repetir el
        // aviso en cada mensaje.
        setBuscar(false);
        setAviso({ tipo: 'respaldo', texto: 'La búsqueda en Google no está incluida en el plan gratis; respondió sin buscar en internet.' });
      }
      if (!activa || res.nueva) { recienCreada.current = res.conversacionId; setActiva(res.conversacionId); }
      void cargarConvs();
    } catch (e: any) {
      setMensajes(prev => prev.filter(m => !m.pendiente));
      setTexto(t);
      setAviso({ tipo: 'error', texto: 'No se pudo enviar. Revisa la conexión e intenta de nuevo.' });
    } finally {
      setEnviando(false);
    }
  };

  const borrarConv = async (c: Conversacion) => {
    const ok = await confirm({ title: 'Borrar conversación', message: `Se borra «${c.titulo}» con todos sus mensajes. No se puede deshacer.`, confirmText: 'Borrar' });
    if (!ok) return;
    const { error } = await supabase.from('ia_conversaciones').delete().eq('id', c.id);
    if (error) { toast.error('No se pudo borrar: ' + error.message); return; }
    quitarDeCache(c.id);
    if (activa === c.id) nueva();
    void cargarConvs();
  };

  const copiar = useCallback(async (t: string) => {
    try { await navigator.clipboard.writeText(t); toast.success('Copiado.'); } catch { toast.error('No se pudo copiar.'); }
  }, [toast]);

  const listaConvs = (
    <>
      <div className="ai-lh"><b>Tus conversaciones</b><Lock className="w-4 h-4" aria-label="Privadas" /></div>
      <button type="button" className="ai-nuevo" onClick={nueva}><Plus className="w-4 h-4" />Conversación nueva</button>
      <div className="ai-hl">
        {convs.length === 0 && <p className="ai-vacio-l">Todavía no hay conversaciones.</p>}
        {convs.map((c, i) => {
          const dia = diaDe(c.actualizado_en);
          const nuevoDia = i === 0 || diaDe(convs[i - 1].actualizado_en) !== dia;
          return (
            <React.Fragment key={c.id}>
              {nuevoDia && <div className="ai-hk">{dia}</div>}
              <div className="ai-hi" data-on={activa === c.id || undefined}>
                <button type="button"
                  onPointerDown={() => { if (!cache.has(c.id)) void leerMensajes(c.id); }}
                  onClick={() => { setActiva(c.id); setVista('chat'); setCajon(null); setAviso(null); }}>{c.titulo}</button>
                <button type="button" className="ai-borrar" aria-label="Borrar conversación" onClick={() => void borrarConv(c)}><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </React.Fragment>
          );
        })}
      </div>
      <div className="ai-priv"><ShieldCheck className="w-4 h-4 shrink-0" /><span>Solo vos ves tus conversaciones.</span></div>
    </>
  );

  return (
    <div className="ai-root" id="view-asistente">
      <aside className="ai-lado">{listaConvs}</aside>

      <section className="ai-panel">
        <header className="ai-ch">
          <button type="button" className="ai-menu" aria-label="Conversaciones" onClick={() => setCajon('historial')}><Menu className="w-5 h-5" /></button>
          {vista === 'ajustes'
            ? <button type="button" className="ai-chip" onClick={() => setVista('chat')}><ArrowLeft className="w-4 h-4" />Volver al chat</button>
            : <span className="ai-modelo"><span className="ai-dot"><Sparkles className="w-3.5 h-3.5" /></span>{nombreModelo(ultimoModelo)}</span>}
          <span className="ai-sp" />
          <button type="button" className="ai-cupo-pill" onClick={() => setCajon('cupo')}>
            <BarChart3 className="w-3.5 h-3.5" />
            {cupo?.disponibles === null || !cupo ? <><b>{cupo?.usados ?? 0}</b> hoy</> : <><b>{cupo.disponibles}</b><span className="ai-lbl"> disponibles</span></>}
          </button>
          {soySuper && vista === 'chat' && (
            <button type="button" className="ai-chip" onClick={() => setVista('ajustes')} aria-label="Ajustes"><Settings className="w-4 h-4" /><span className="ai-lbl">Ajustes</span></button>
          )}
        </header>

        {vista === 'ajustes' && soySuper ? <AjustesIA onCambio={cargarCupo} /> : (
          <>
            {aviso && (
              <div className="ai-aviso" data-tipo={aviso.tipo}>
                <Info className="w-4 h-4 shrink-0" /><span>{aviso.texto}</span>
                <button type="button" aria-label="Cerrar aviso" onClick={() => setAviso(null)}><X className="w-4 h-4" /></button>
              </div>
            )}
            <div className="ai-msgs">
              {cargandoConv ? (
                <div className="ai-esqueleto" aria-label="Cargando conversación"><i /><i /><i /></div>
              ) : agotado && mensajes.length === 0 ? (
                <div className="ai-agotado">
                  <span className="ai-logo" data-t="ba"><Clock className="w-7 h-7" /></span>
                  <h3>Se usó todo el cupo de hoy</h3>
                  <p>Usaste tus {cupo?.limite} mensajes del día. El cupo se renueva a la medianoche. Si es urgente, pedile al superadmin que lo amplíe.</p>
                </div>
              ) : mensajes.length === 0 ? (
                <div className="ai-hola">
                  <span className="ai-logo"><Sparkles className="w-7 h-7" /></span>
                  <h3>¿En qué te ayudo?</h3>
                  <p>{conSistema ? 'Preguntá por el inventario, las ventas o el taller, o pedí ayuda para redactar.' : 'Preguntas, redactar, explicar o resumir.'} No escribás cédulas, teléfonos ni datos de clientes.</p>
                  <div className="ai-sug">
                    {sugerencias.map(s => (
                      <button key={s.t} type="button" onClick={() => { setTexto(s.p); cajaRef.current?.focus(); }}><b>{s.t}</b>{s.d}</button>
                    ))}
                  </div>
                </div>
              ) : <ListaMensajes mensajes={mensajes} onCopiar={copiar} />}
              {enviando && (
                <div className="ai-ia"><div className="ai-buscando"><span className="ai-puntos"><i /><i /><i /></span>{buscar && busquedaPermitida ? 'Pensando y buscando en Google…' : conSistema ? 'Pensando y consultando el sistema…' : 'Pensando…'}</div></div>
              )}
              <div ref={finRef} />
            </div>

            <div className="ai-red">
              <div className="ai-caja">
                <textarea
                  ref={cajaRef}
                  value={texto}
                  onChange={e => setTexto(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer: fine)').matches) { e.preventDefault(); void enviar(); } }}
                  placeholder={agotado ? 'Cupo agotado hasta la medianoche' : 'Preguntá lo que necesités…'}
                  disabled={agotado}
                  rows={1}
                  aria-label="Mensaje para el asistente"
                />
                <div className="ai-bot">
                  {busquedaPermitida && (
                    <button type="button" className="ai-ib" data-on={buscar || undefined} onClick={() => setBuscar(v => !v)}
                      aria-pressed={buscar} title={buscar ? 'Búsqueda en internet encendida' : 'Búsqueda en internet apagada'}>
                      <Globe className="w-[18px] h-[18px]" />
                    </button>
                  )}
                  <span className="ai-sp" />
                  <span className="ai-cont" title="Tokens estimados de tu texto · contexto usado de la conversación">
                    ≈ <b>{estimarTokens(texto)}</b> tokens
                    <span className="ai-barra"><i style={{ width: `${Math.min(100, Math.max(tokensConv ? 2 : 0, tokensConv / CONTEXTO * 100))}%` }} /></span>
                    {(tokensConv / CONTEXTO * 100).toFixed(tokensConv ? 1 : 0)}%
                  </span>
                  <button type="button" className="ai-env" disabled={!texto.trim() || enviando || agotado} onClick={() => void enviar()} aria-label="Enviar">
                    <ArrowUp className="w-5 h-5" />
                  </button>
                </div>
              </div>
              <p className="ai-nota">{conSistema ? 'Lee el sistema sin datos de clientes. ' : ''}No escribás datos personales de clientes. La IA puede equivocarse: verificá lo importante.</p>
            </div>
          </>
        )}
      </section>

      <aside className="ai-tele">
        <div className="ai-th"><b>Disponible hoy</b><small>se renueva a las 00:00</small></div>
        <PanelCupo cupo={cupo} tokensConv={tokensConv} />
      </aside>

      {cajon && (
        <div className="ai-scrim" onClick={() => setCajon(null)}>
          {cajon === 'historial' ? (
            <div className="ai-cajon" onClick={e => e.stopPropagation()}>{listaConvs}</div>
          ) : (
            <div className="ai-hoja" onClick={e => e.stopPropagation()}>
              <div className="ai-agarre" />
              <div className="ai-th"><b>Disponible hoy</b><small>se renueva a las 00:00</small></div>
              <PanelCupo cupo={cupo} tokensConv={tokensConv} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AjustesIA({ onCambio }: { onCambio: () => void }) {
  const toast = useToast();
  const [aj, setAj] = useState<Ajustes | null>(null);
  const [uso, setUso] = useState<{ email: string; mensajes: number; tokens: number; es_super: boolean }[]>([]);
  const [limite, setLimite] = useState('60');
  const [consultasHoy, setConsultasHoy] = useState<{ modulo: string; consultas: number }[]>([]);

  useEffect(() => {
    void supabase.from('ia_ajustes').select('limite_diario,busqueda,respaldo,acceso,modulos').eq('id', 1).maybeSingle()
      .then(({ data }) => { if (data) { setAj(data as Ajustes); setLimite(String((data as Ajustes).limite_diario)); } });
    void supabase.rpc('ia_uso_de_hoy').then(({ data }) => setUso((data as any[]) || []));
    void supabase.rpc('ia_consultas_de_hoy').then(({ data }) => setConsultasHoy((data as any[]) || []));
  }, []);

  const guardar = async (cambio: Partial<Ajustes>) => {
    if (!aj) return;
    const nuevo = { ...aj, ...cambio };
    setAj(nuevo);
    const { error } = await supabase.from('ia_ajustes').update({ ...cambio, actualizado_en: new Date().toISOString() }).eq('id', 1);
    if (error) { toast.error('No se pudo guardar: ' + error.message); setAj(aj); return; }
    toast.success('Guardado.');
    onCambio();
  };

  if (!aj) return <div className="ai-ajustes"><p className="ai-prov">Cargando ajustes…</p></div>;
  const tope = aj.limite_diario;
  const modulos: Modulos = { inventario: true, facturacion: true, taller: true, errores: true, ...(aj.modulos || {}) };
  const maxConsultas = Math.max(1, ...consultasHoy.map(c => c.consultas));
  return (
    <div className="ai-ajustes">
      <div className="ai-aj">
        <h4>Datos del sistema <small>solo lectura · sin datos de clientes</small></h4>
        {MODULOS.map(m => (
          <div key={m.id} className="ai-modu">
            <span className="ai-modu-ic"><m.icono className="w-4 h-4" /></span>
            <span className="ai-modu-t"><b>{m.nombre}{m.soloSuper && <em> · solo superadmin</em>}</b><span>{m.desc}</span></span>
            <button type="button" role="switch" aria-checked={modulos[m.id]} className="ai-sw" data-on={modulos[m.id] || undefined}
              onClick={() => void guardar({ modulos: { ...modulos, [m.id]: !modulos[m.id] } })} aria-label={`Consultar ${m.nombre}`} />
          </div>
        ))}
      </div>
      <div className="ai-aj">
        <h4>Límites <small>se aplican desde ya</small></h4>
        <div className="ai-campo">
          <span>Mensajes por persona al día</span>
          <span className="ai-num-g">
            <input type="number" min={1} max={2000} value={limite} onChange={e => setLimite(e.target.value)} aria-label="Mensajes por persona al día" />
            <button type="button" disabled={Number(limite) === tope || !(Number(limite) >= 1 && Number(limite) <= 2000)}
              onClick={() => void guardar({ limite_diario: Math.round(Number(limite)) })}>Guardar</button>
          </span>
        </div>
        <div className="ai-campo">
          <span>Usar el respaldo (Groq) cuando Google se agote</span>
          <button type="button" role="switch" aria-checked={aj.respaldo} className="ai-sw" data-on={aj.respaldo || undefined} onClick={() => void guardar({ respaldo: !aj.respaldo })} aria-label="Usar respaldo" />
        </div>
        <div className="ai-campo">
          <span>Quién puede usarlo</span>
          <span className="ai-seg">
            {([['personal', 'Todo el personal'], ['gestion', 'Admins'], ['super', 'Solo yo']] as const).map(([v, l]) => (
              <button key={v} type="button" data-on={aj.acceso === v || undefined} onClick={() => void guardar({ acceso: v })}>{l}</button>
            ))}
          </span>
        </div>
      </div>
      {consultasHoy.length > 0 && (
        <div className="ai-aj">
          <h4>Consultas de hoy <small>qué módulo, no qué se preguntó</small></h4>
          {consultasHoy.map(c => (
            <div key={c.modulo} className="ai-per">
              <b>{MODULOS.find(m => m.id === c.modulo)?.nombre || c.modulo}</b>
              <div className="ai-bt"><i style={{ width: `${Math.round(c.consultas / maxConsultas * 100)}%` }} /></div>
              <small className="tabular-nums">{c.consultas}</small>
            </div>
          ))}
        </div>
      )}
      <div className="ai-aj">
        <h4>Uso de hoy <small>sin leer conversaciones</small></h4>
        {uso.length === 0 && <p className="ai-prov" style={{ margin: 14 }}>Nadie lo ha usado hoy.</p>}
        {uso.map(u => (
          <div key={u.email} className="ai-per">
            <b>{u.email}{u.es_super ? ' (vos)' : ''}</b>
            <div className="ai-bt"><i style={{ width: `${u.es_super ? Math.min(100, u.mensajes) : Math.min(100, Math.round(u.mensajes / tope * 100))}%`, ...(u.mensajes >= tope && !u.es_super ? { background: 'var(--tv-danger)' } : {}) }} /></div>
            <small className="tabular-nums">{u.mensajes}{u.es_super ? '' : ` / ${tope}`}</small>
          </div>
        ))}
      </div>
      <p className="ai-prov">Las claves de Google y Groq viven como secretos en el servidor; nadie del personal las ve.</p>
    </div>
  );
}

export default React.memo(AsistenteIA);
