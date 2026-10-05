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
  Package, Receipt, Wrench, TriangleAlert, Ban, ChevronRight, ShieldAlert, Wallet, MapPin,
  Paperclip, Square, RotateCcw, Pencil, Link2, Code2, FileText,
  Mic, Zap, Scale, Brain, ChevronDown, Lightbulb, Check, Bot, ThumbsUp, ThumbsDown, MessageCircleQuestion,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
const MapaModal = React.lazy(() => import('../ui/MapaModal'));
const CerebroJarvis = React.lazy(() => import('./CerebroJarvis'));
import { supabase, SUPABASE_URL, SUPABASE_KEY } from '../../supabaseClient';
import { cabeceraClientInfo } from '../../utils/dispositivo';
import { useToast, useConfirm } from '../ui/Overlays';
import { esSuperadmin } from '../../utils/roles';
import type { User } from '../../types';
import { TarjetaAccion, TarjetaIr, GraficoComparado, ChipMemoria, tarjetasVivas } from './JarvisPiezas';
import type { Grafico } from './JarvisPiezas';
import { grabarNotaDeVoz, puedeGrabarVoz } from '../../utils/grabadorVoz';
import type { GrabacionEnCurso } from '../../utils/grabadorVoz';
import { aparatoActual } from '../../seguridad/killSwitch';

/** Abre un módulo del panel en su pestaña (lo da AdminPanel). */
const AbrirModuloCtx = React.createContext<((m: string) => void) | undefined>(undefined);
const VerCerebroCtx = React.createContext<(() => void) | undefined>(undefined);

interface Conversacion { id: string; titulo: string; actualizado_en: string }
/** Una consulta al sistema que hizo la IA (la tarjeta encima de la respuesta). */
interface Panel { columnas: string[]; filas: (string | number | null)[][]; puntos?: ({ lat: number; lon: number; etiqueta: string } | null)[] }
interface Consulta {
  modulo: string; desc: string; filas: string; detalle: string; sinPermiso?: boolean; panel?: Panel;
  /** Jarvis: «accion» es una propuesta (tarjeta con confirmar); «navegar», un botón para abrir un módulo. */
  tipo?: 'accion' | 'navegar' | 'memoria' | 'cerebro'; id?: string; destino?: string; grafico?: Grafico;
}
type Perfil = 'rapido' | 'equilibrado' | 'profundo';
type Persona = 'jarvis' | 'arquitecto';
interface Mensaje {
  id: string; rol: 'user' | 'assistant'; texto: string;
  fuentes?: { titulo: string; url: string }[];
  consultas?: Consulta[];
  tokens_in?: number; tokens_out?: number; proveedor?: string | null; modelo?: string | null; busco?: boolean;
  pendiente?: boolean;
  /** Mientras la respuesta llega en vivo: «Consultando inventario…». */
  estado?: string;
  /** Vistas previas de las fotos que se mandaron en esta sesión. */
  vistas?: { nombre: string; tipo: string; url?: string }[];
  /** Jarvis: velocidad, modo y cuánto tardó la respuesta. */
  perfil?: Perfil | null; persona?: string | null; ms?: number | null;
  /** 👍 = 1, 👎 = -1. */
  valoracion?: number | null;
  /** Jarvis subió la velocidad porque la pregunta pedía análisis. */
  escalado?: boolean;
  /** Segundos de la nota de voz, si el mensaje se dictó (solo en vivo). */
  porVoz?: number;
}
interface Adjunto { nombre: string; tipo: string; datos: string; vista?: string }
interface Cupo {
  usados: number; limite: number | null; disponibles: number | null; tokensHoy: number;
  equipo: { gemini: number; groq: number; cupoGemini: number; cupoGroq: number };
  busqueda: boolean; respaldo: boolean; groqConfigurado: boolean;
  modulos?: string[]; consultasHoy?: number;
  busquedaWeb?: boolean; busquedasMes?: number; cupoBusquedas?: number;
  capacidades?: { enlaces: boolean; codigo: boolean; archivos: boolean };
  /** Solo superadmin: qué velocidades tienen cupo y si Jarvis puede preparar acciones. */
  perfiles?: Record<Perfil, boolean>; acciones?: boolean;
}
type Modulos = Record<'inventario' | 'facturacion' | 'taller' | 'errores' | 'seguridad' | 'finanzas' | 'internet' | 'enlaces' | 'archivos' | 'codigo' | 'acciones' | 'chat_directo' | 'taller_directo' | 'inventario_directo', boolean>;
type Tono = 'formal' | 'tico_moderado' | 'tico_suelto';
interface Ajustes { limite_diario: number; busqueda: boolean; respaldo: boolean; acceso: 'personal' | 'gestion' | 'super'; modulos?: Modulos; tono?: Tono }

const MODULOS: { id: keyof Modulos; nombre: string; desc: string; icono: LucideIcon; soloSuper?: boolean }[] = [
  { id: 'inventario', nombre: 'Inventario', desc: 'Existencias, precios, por agotarse', icono: Package },
  { id: 'facturacion', nombre: 'Facturación', desc: 'Totales y facturas sin datos de clientes', icono: Receipt },
  { id: 'taller', nombre: 'Taller', desc: 'Órdenes por estado y días', icono: Wrench },
  { id: 'errores', nombre: 'Errores del sistema', desc: 'Fallos de correo, pagos, Hacienda y bitácora', icono: TriangleAlert, soloSuper: true },
  { id: 'seguridad', nombre: 'Ciberseguridad', desc: 'Ingresos, visitantes, bloqueos y ubicaciones', icono: ShieldAlert, soloSuper: true },
  { id: 'finanzas', nombre: 'Finanzas', desc: 'Ventas, costos, margen neto e IVA', icono: Wallet, soloSuper: true },
];
/** Capacidades de asistente (como ChatGPT o Claude), para todo el personal. */
const CAPACIDADES: { id: keyof Modulos; nombre: string; desc: string; icono: LucideIcon }[] = [
  { id: 'internet', nombre: 'Búsqueda en internet', desc: 'En tiempo real, con fuentes (Tavily)', icono: Globe },
  { id: 'enlaces', nombre: 'Leer enlaces', desc: 'Abre las páginas que se peguen', icono: Link2 },
  { id: 'archivos', nombre: 'Fotos y PDF', desc: 'Hasta 3 por mensaje', icono: Paperclip },
  { id: 'codigo', nombre: 'Cálculos con código', desc: 'Resultados exactos', icono: Code2 },
];
/** Velocidades de Jarvis (tiempos medidos con la clave gratis). */
const PERFILES: { id: Perfil; nombre: string; desc: string; modelo: string; t: string; icono: LucideIcon }[] = [
  { id: 'rapido', nombre: 'Rápido', desc: 'Órdenes y datos directos. Las cuentas las hacen las consultas del sistema.', modelo: 'Flash-Lite · sin razonar', t: '~0,5 s', icono: Zap },
  { id: 'equilibrado', nombre: 'Equilibrado', desc: 'Análisis con varios datos y comparaciones.', modelo: 'Flash-Lite · razona', t: '~2 s', icono: Scale },
  { id: 'profundo', nombre: 'Profundo', desc: 'Decisiones, auditorías y modo Arquitecto.', modelo: 'Flash 3.8 · razona a fondo', t: '3–15 s', icono: Brain },
];
const PERSONAS: { id: Persona; nombre: string; desc: string; icono: LucideIcon }[] = [
  { id: 'jarvis', nombre: 'Jarvis', desc: 'Consulta y opera el panel. Antes de cambiar algo te muestra una tarjeta y espera tu confirmación.', icono: Sparkles },
  { id: 'arquitecto', nombre: 'Arquitecto', desc: 'Evalúa ideas y cambios futuros y te deja el requerimiento listo para programar. No ejecuta nada.', icono: Lightbulb },
];
const ONDA = Array.from({ length: 22 }, (_, n) => `-${((n * 0.137) % 1).toFixed(2)}s`);
const segundos = (ms?: number | null) => (ms ? `${(ms / 1000).toFixed(1).replace('.', ',')} s` : '');
const reloj = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
/** Recuerda la velocidad y el modo elegidos (comodidad de este aparato). */
const leerPref = <T extends string>(k: string, def: T, validos: readonly string[]): T => {
  try { const v = localStorage.getItem(k); return v && validos.includes(v) ? v as T : def; } catch { return def; }
};
const guardarPref = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };
/**
 * Carril privado de Jarvis: cédulas, correos y teléfonos que escriba el
 * superadmin se sacan del texto ANTES de mandarlo. La IA (Google) solo ve
 * marcas como [CÉDULA·1]; los datos van aparte y solo los usan las tarjetas.
 */
function separarPrivados(t: string, previos: Record<string, string>): { texto: string; privados: Record<string, string> } {
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
const aBase64 = (b: Blob) => new Promise<string>((ok, mal) => {
  const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => mal(r.error); r.readAsDataURL(b);
});
const ICONO_MODULO: Record<string, LucideIcon> = { Inventario: Package, 'Facturación': Receipt, Taller: Wrench, 'Errores del sistema': TriangleAlert, Ciberseguridad: ShieldAlert, Finanzas: Wallet, Internet: Globe, Enlace: Link2, 'Código': Code2 };

/** Foto → JPEG de hasta 1600 px (≈200–400 KB): en datos móviles mandar la
 *  foto original de 4 MB tardaba y no mejoraba lo que la IA ve. */
async function prepararArchivo(f: File): Promise<Adjunto | null> {
  const aBase64 = (b: Blob) => new Promise<string>((ok, mal) => {
    const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => mal(r.error); r.readAsDataURL(b);
  });
  // Documentos de texto (txt, csv, md, json…): la IA los lee como texto.
  if (/^text\//.test(f.type) || /\.(txt|csv|md|json|log|tsv)$/i.test(f.name) || f.type === 'application/json') {
    if (f.size > 1024 * 1024) throw new Error(`«${f.name}» pesa más de 1 MB (para textos largos, mejor un PDF).`);
    return { nombre: f.name, tipo: 'text/plain', datos: await aBase64(f) };
  }
  if (/\.(docx?|xlsx?|pptx?)$/i.test(f.name)) throw new Error(`«${f.name}» es de Office: guardalo como PDF y adjuntalo.`);
  if (f.type === 'application/pdf') {
    if (f.size > 5 * 1024 * 1024) throw new Error(`«${f.name}» pesa más de 5 MB.`);
    return { nombre: f.name, tipo: f.type, datos: await aBase64(f) };
  }
  if (!f.type.startsWith('image/')) return null;
  try {
    const img = await createImageBitmap(f);
    const k = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    const blob: Blob = await new Promise((ok, mal) => c.toBlob(b => (b ? ok(b) : mal(new Error('sin imagen'))), 'image/jpeg', 0.82));
    return { nombre: f.name.replace(/\.[^.]+$/, '') + '.jpg', tipo: 'image/jpeg', datos: await aBase64(blob), vista: URL.createObjectURL(blob) };
  } catch {
    if (f.size > 5 * 1024 * 1024) throw new Error(`«${f.name}» pesa más de 5 MB.`);
    return { nombre: f.name, tipo: f.type, datos: await aBase64(f), vista: URL.createObjectURL(f) };
  }
}

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
const COLUMNAS_BASE = 'id,rol,texto,fuentes,consultas,tokens_in,tokens_out,proveedor,modelo,busco';
// perfil/persona/ms llegaron con Jarvis; si la base todavía no los tiene,
// se cae a las columnas de siempre en vez de no mostrar nada.
let COLUMNAS_MSG = `${COLUMNAS_BASE},perfil,persona,ms,valoracion`;
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
  const leer = () => supabase.from('ia_mensajes').select(COLUMNAS_MSG).eq('conversacion_id', id).order('creado_en', { ascending: true });
  const p = Promise.resolve(leer()).then(async r => {
    if (r.error && COLUMNAS_MSG !== COLUMNAS_BASE && /column|columna/i.test(r.error.message)) { COLUMNAS_MSG = COLUMNAS_BASE; return await leer(); }
    return r;
  }).then(({ data, error }) => {
    if (error) return null;
    const ms = (data as unknown as Mensaje[]) || [];
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
  { t: 'Ingresos', d: '¿Quién entró hoy al sistema?', p: '¿Quién entró hoy al sistema y hubo intentos fallidos?', modulo: 'seguridad' },
  { t: 'Finanzas', d: '¿Cómo va el margen este mes?', p: '¿Cuánto vendimos este mes y cuál es el margen neto?', modulo: 'finanzas' },
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

/** Detalle completo de una consulta del superadmin (carril de pantalla:
 *  esto NO pasó por la IA). Muestra 20 filas y el resto bajo demanda. */
function TablaPanel({ panel }: { panel: Panel }) {
  const [todas, setTodas] = useState(false);
  const [mapa, setMapa] = useState<{ lat: number; lon: number; etiqueta: string } | null>(null);
  const filas = todas ? panel.filas : panel.filas.slice(0, 20);
  const conMapa = !!panel.puntos?.some(Boolean);
  if (!panel.filas.length) return <p className="ai-panel-vacio">Sin registros en este período.</p>;
  return (
    <div className="ai-panel-det">
      <div className="ai-tabla ai-tabla-fichas">
        <table>
          <thead><tr>{panel.columnas.map(c => <th key={c}>{c}</th>)}{conMapa && <th aria-label="Mapa" />}</tr></thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={i}>
                {f.map((v, j) => <td key={j} data-col={panel.columnas[j]}>{v ?? '—'}</td>)}
                {conMapa && (
                  <td className="ai-td-mapa">{panel.puntos?.[i] && (
                    <button type="button" className="ai-mapa-btn" aria-label="Ver en el mapa" onClick={() => setMapa(panel.puntos![i]!)}><MapPin className="w-4 h-4" /></button>
                  )}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {panel.filas.length > 20 && (
        <button type="button" className="ai-ver-mas" onClick={() => setTodas(v => !v)}>
          {todas ? 'Ver menos' : `Ver ${panel.filas.length - 20} más`}
        </button>
      )}
      {mapa && (
        <React.Suspense fallback={null}>
          <MapaModal abierto onClose={() => setMapa(null)} lat={mapa.lat} lon={mapa.lon} etiqueta={mapa.etiqueta} titulo="Ubicación" />
        </React.Suspense>
      )}
    </div>
  );
}

// Internet, enlaces y código no tocan datos del negocio: la etiqueta de
// privacidad ahí confundiría.
const SIN_ETIQUETA = new Set(['Internet', 'Enlace', 'Código']);

function TarjetaConsulta({ c }: { c: Consulta }) {
  const Icono = c.sinPermiso ? Ban : (ICONO_MODULO[c.modulo] || Package);
  // Lo del superadmin (con panel) se abre solo: es justo lo que pidió ver.
  return (
    <details className="ai-herr" data-no={c.sinPermiso || undefined} open={!!c.panel || undefined}>
      <summary>
        <span className="ai-herr-ic"><Icono className="w-4 h-4" /></span>
        <span className="ai-herr-t"><b>{c.modulo}</b> · {c.desc}</span>
        {!c.sinPermiso && !SIN_ETIQUETA.has(c.modulo) && (c.panel
          ? <span className="ai-herr-chip" data-tipo="privado"><Lock className="w-3 h-3" />detalle solo en tu pantalla</span>
          : <span className="ai-herr-chip"><ShieldCheck className="w-3 h-3" />sin datos de clientes</span>)}
        {c.filas !== '—' && <small>{c.filas}</small>}
        {(c.detalle || c.panel) && <ChevronRight className="ai-herr-chev w-4 h-4" />}
      </summary>
      {c.panel ? <TablaPanel panel={c.panel} /> : c.detalle && <pre>{c.detalle}</pre>}
    </details>
  );
}

/** Un mensaje del historial. Memoizado: escribir en la caja (que cambia el
 *  estado del módulo en cada letra) ya no vuelve a formatear todo el
 *  historial, que en un teléfono de gama de entrada se notaba. */
const Burbuja = React.memo(function Burbuja({ m, onCopiar, onRegenerar, onEditar, onValorar }: { m: Mensaje; onCopiar: (t: string) => void; onRegenerar?: () => void; onEditar?: () => void; onValorar?: (id: string, v: number | null, nota?: string) => void }) {
  const [nota, setNota] = useState<string | null>(null);
  if (m.rol === 'user') {
    const adj = m.vistas || (m.fuentes || []).filter(f => f.url?.startsWith('adjunto:')).map(f => ({ nombre: f.titulo, tipo: f.url.slice(8) }));
    return (
      <div className="ai-yo-g">
        {!!adj.length && (
          <div className="ai-yo-adj">
            {adj.map((a, i) => (a as any).url && a.tipo.startsWith('image/')
              ? <img key={i} src={(a as any).url} alt={a.nombre} />
              : <span key={i}>{a.tipo === 'application/pdf' ? <FileText className="w-4 h-4" /> : <Paperclip className="w-4 h-4" />}{a.nombre}</span>)}
          </div>
        )}
        <div className="ai-yo">{m.texto}</div>
        {(() => {
          const voz = m.porVoz || Number((m.fuentes || []).find(f => f.url?.startsWith('voz:'))?.url.slice(4)) || 0;
          return voz ? <span className="ai-yo-voz"><Mic className="w-3.5 h-3.5" />Por voz · {reloj(voz)}</span> : null;
        })()}
        {onEditar && <button type="button" className="ai-editar" onClick={onEditar}><Pencil className="w-3.5 h-3.5" />Editar</button>}
      </div>
    );
  }
  const enVivo = m.id === BORRADOR;
  // Lecturas arriba (como siempre); lo de Jarvis —gráficos, abrir un
  // módulo y acciones por confirmar— después del texto, que lo explica.
  const lecturas = (m.consultas || []).filter(c => !c.tipo);
  const memorias = (m.consultas || []).filter(c => c.tipo === 'memoria');
  const cerebros = (m.consultas || []).filter(c => c.tipo === 'cerebro');
  const valorable = !!onValorar && !!m.persona && /^[0-9a-f-]{36}$/i.test(m.id);
  const graficos = lecturas.filter(c => c.grafico);
  const irs = (m.consultas || []).filter(c => c.tipo === 'navegar' && c.destino);
  const acciones = (m.consultas || []).filter(c => c.tipo === 'accion' && c.id);
  const perfil = PERFILES.find(p => p.id === m.perfil);
  const esRequerimiento = m.persona === 'arquitecto' && /REQUERIMIENTO:/.test(m.texto);
  return (
    <div className="ai-ia" aria-live={enVivo ? 'polite' : undefined}>
      {!!lecturas.length && <div className="ai-herrs">{lecturas.map((c, i) => <React.Fragment key={i}><TarjetaConsulta c={c} /></React.Fragment>)}</div>}
      {m.texto
        ? <div className="ai-tx"><Formato texto={m.texto} />{enVivo && <span className="ai-cursor" />}</div>
        : enVivo && <div className="ai-buscando"><span className="ai-puntos"><i /><i /><i /></span>{m.estado || 'Pensando…'}</div>}
      {graficos.map((c, i) => <React.Fragment key={`g${i}`}><GraficoComparado g={c.grafico!} /></React.Fragment>)}
      {irs.map((c, i) => <React.Fragment key={`n${i}`}><IrModulo titulo={c.desc} destino={c.destino!} /></React.Fragment>)}
      {acciones.map(c => <React.Fragment key={c.id}><TarjetaAccion id={c.id!} /></React.Fragment>)}
      {memorias.map((c, i) => <React.Fragment key={`m${i}`}><ChipMemoria id={c.id} texto={c.desc} estado={c.filas} detalle={c.detalle} /></React.Fragment>)}
      {cerebros.map((c, i) => <React.Fragment key={`c${i}`}><ChipCerebro texto={c.desc} aprendido={c.filas === 'aprendido'} /></React.Fragment>)}
      {esRequerimiento && !enVivo && (
        <div className="ai-graf-pie" style={{ padding: 0 }}>
          <button type="button" className="ai-chip" onClick={() => onCopiar(m.texto)}><Copy className="w-4 h-4" />Copiar como prompt</button>
        </div>
      )}
      {!!m.fuentes?.length && (
        <div className="ai-fuentes">
          {m.fuentes.map((f, i) => (
            <a key={i} href={f.url} target="_blank" rel="noopener noreferrer"><b>{i + 1}</b>{f.titulo || 'Fuente'}</a>
          ))}
        </div>
      )}
      {!enVivo && <div className="ai-pie">
        <button type="button" aria-label="Copiar respuesta" onClick={() => onCopiar(m.texto)}><Copy className="w-4 h-4" /></button>
        {onRegenerar && <button type="button" aria-label="Regenerar respuesta" onClick={onRegenerar}><RotateCcw className="w-4 h-4" /></button>}
        {valorable && <>
          <button type="button" aria-label="Me gustó" aria-pressed={m.valoracion === 1} data-on={m.valoracion === 1 || undefined} onClick={() => { setNota(null); onValorar!(m.id, m.valoracion === 1 ? null : 1); }}><ThumbsUp className="w-4 h-4" /></button>
          <button type="button" aria-label="No me gustó" aria-pressed={m.valoracion === -1} data-on={m.valoracion === -1 || undefined} onClick={() => { if (m.valoracion === -1) { onValorar!(m.id, null); setNota(null); } else { onValorar!(m.id, -1); setNota(''); } }}><ThumbsDown className="w-4 h-4" /></button>
        </>}
        <span className="ai-tok">↑ <i>{k(m.tokens_in || 0)}</i> · ↓ <i>{k(m.tokens_out || 0)}</i> tokens</span>
        {perfil ? (
          <span className="ai-modo-tag"><perfil.icono className="w-3.5 h-3.5" />{m.persona === 'arquitecto' ? 'Arquitecto · ' : ''}{perfil.nombre}{m.escalado ? ' (subió solo)' : ''} · {nombreModelo(m.modelo || (m.proveedor === 'groq' ? 'groq' : null))}{m.ms ? ` · ${segundos(m.ms)}` : ''}{m.busco ? ' · buscó en internet' : ''}{lecturas.length ? ` · consultó ${lecturas.length} ${lecturas.length === 1 ? 'vez' : 'veces'}` : ''}</span>
        ) : (
          <span>{nombreModelo(m.modelo || (m.proveedor === 'groq' ? 'groq' : null))}{m.busco ? ' · buscó en internet' : ''}{m.consultas?.length ? ` · consultó ${m.consultas.length} ${m.consultas.length === 1 ? 'vez' : 'veces'}` : ''}</span>
        )}
      </div>}
      {nota !== null && (
        <form className="ai-nota-val" onSubmit={e => { e.preventDefault(); onValorar!(m.id, -1, nota.trim() || undefined); setNota(null); }}>
          <input className="glass-input rounded-lg px-3 py-2 text-[13px]" value={nota} onChange={e => setNota(e.target.value)} maxLength={200} placeholder="¿Qué no te gustó? Jarvis lo evita en adelante" aria-label="Qué no te gustó" autoFocus />
          <button type="submit" className="ai-chip">Enviar</button>
          <button type="button" className="ai-chip" onClick={() => setNota(null)}>Omitir</button>
        </form>
      )}
    </div>
  );
});
const BORRADOR = 'borrador-en-vivo';
/** «Aprendí: iPhone · iPhone 15» o «Usé lo que sé de: …», con atajo al cerebro. */
function ChipCerebro({ texto, aprendido }: { texto: string; aprendido: boolean }) {
  const ver = React.useContext(VerCerebroCtx);
  return (
    <div className="ai-mem" data-cerebro={aprendido ? 'aprendido' : 'usado'}>
      <span className="ai-herr-ic"><Brain className="w-4 h-4" /></span>
      <span className="ai-mem-tx"><b>{aprendido ? 'Aprendí' : 'Usé lo que sé de'}</b>{texto}</span>
      {ver && <button type="button" className="ai-chip" onClick={ver}>Ver en el cerebro</button>}
    </div>
  );
}
function IrModulo({ titulo, destino }: { titulo: string; destino: string }) {
  const abrir = React.useContext(AbrirModuloCtx);
  return <TarjetaIr titulo={titulo} destino={destino} onAbrir={abrir} />;
}

/**
 * Manda el mensaje y lee la respuesta EN VIVO (eventos SSE de la función).
 * `functions.invoke` no lee flujos, así que se usa fetch con la sesión.
 * Si algo de eso no está disponible, cae al modo de siempre (JSON).
 */
async function enviarEnVivo(cuerpo: Record<string, unknown>, onEvento: (evento: string, datos: any) => void, signal?: AbortSignal): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!SUPABASE_URL || !session?.access_token || typeof ReadableStream === 'undefined') {
    const { data, error } = await supabase.functions.invoke('asistente-ia', { body: cuerpo });
    if (error && (error as any).context?.json) { try { return await (error as any).context.json(); } catch { /* sin cuerpo */ } }
    return data;
  }
  const r = await fetch(`${SUPABASE_URL}/functions/v1/asistente-ia`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_KEY, 'Content-Type': 'application/json', 'X-Client-Info': cabeceraClientInfo() },
    body: JSON.stringify({ ...cuerpo, envivo: true }),
    signal,
  });
  if (!(r.headers.get('content-type') || '').includes('text/event-stream') || !r.body) {
    try { return await r.json(); } catch { return null; }
  }
  const lector = r.body.pipeThrough(new TextDecoderStream()).getReader();
  let resto = '', final: any = null;
  for (;;) {
    const { value, done } = await lector.read();
    if (done) break;
    resto += value;
    let i;
    while ((i = resto.indexOf('\n\n')) >= 0) {
      const bloque = resto.slice(0, i); resto = resto.slice(i + 2);
      const evento = /^event: (.*)$/m.exec(bloque)?.[1] || 'message';
      const dato = /^data: (.*)$/m.exec(bloque)?.[1];
      if (!dato) continue;
      let d: any; try { d = JSON.parse(dato); } catch { continue; }
      if (evento === 'fin' || evento === 'error') final = d; else onEvento(evento, d);
    }
  }
  return final;
}
const ListaMensajes = React.memo(function ListaMensajes({ mensajes, onCopiar, onRegenerar, onEditar, onValorar }: { mensajes: Mensaje[]; onCopiar: (t: string) => void; onRegenerar?: () => void; onEditar?: () => void; onValorar?: (id: string, v: number | null, nota?: string) => void }) {
  // Regenerar y editar solo aplican al último intercambio (como en Claude).
  const ultIA = mensajes.length - 1, ultYo = mensajes[ultIA]?.rol === 'assistant' ? ultIA - 1 : -1;
  return <>{mensajes.map((m, i) => (
    <React.Fragment key={m.id}>
      <Burbuja m={m} onCopiar={onCopiar} onValorar={onValorar} onRegenerar={i === ultIA && m.rol === 'assistant' ? onRegenerar : undefined} onEditar={i === ultYo ? onEditar : undefined} />
    </React.Fragment>
  ))}</>;
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
      {cupo?.busquedaWeb && (
        <div className="ai-mini">
          <span><span>Búsquedas del mes (internet)</span><b className="tabular-nums">{cupo.busquedasMes ?? 0} / {cupo.cupoBusquedas ?? 1000}</b></span>
          <div className="ai-bt"><i style={{ width: `${Math.min(100, Math.round((cupo.busquedasMes ?? 0) / (cupo.cupoBusquedas || 1000) * 100))}%` }} /></div>
        </div>
      )}
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
          <div className="ai-kv"><span>Módulos que puede leer</span><b className="tabular-nums">{cupo.modulos.filter(m => m !== 'internet').length}</b></div>
        </>
      )}
      <p className="ai-prov">Gratis con Gemini de Google{cupo?.respaldo && cupo.groqConfigurado ? ' y Groq de respaldo' : ''}. Las consultas al sistema se hacen con tus permisos y quedan en la bitácora.</p>
    </>
  );
}

const SUGERENCIAS_JARVIS = [
  { t: 'Ventas', d: 'Esta semana contra la anterior', p: 'Compará las ventas de esta semana con las de la semana pasada.' },
  { t: 'Sesiones', d: '¿Quién tiene sesión abierta?', p: '¿Quién del personal tiene sesión abierta ahora y desde qué equipo?' },
  { t: 'Seguridad', d: 'Intentos fallidos de hoy', p: '¿Hubo intentos de ingreso fallidos hoy? ¿Desde dónde?' },
  { t: 'Responder', d: 'Escribirle a un cliente', p: 'Respondele al último chat que ya le contesto en un momento.' },
];
const SUGERENCIAS_ARQ = [
  { t: 'Evaluar', d: 'Una idea para la tienda', p: 'Quiero que los clientes puedan apartar un producto 24 horas pagando una parte. ¿Qué implicaría?' },
  { t: 'Requerimiento', d: 'Listo para programar', p: 'Escribime el requerimiento para avisarle al cliente por WhatsApp cuando su reparación esté lista.' },
  { t: 'Revisar', d: 'Un flujo del panel', p: '¿Qué mejorarías del flujo de cobro en el mostrador?' },
  { t: 'Priorizar', d: 'Qué hacer primero', p: 'De estas ideas, ¿cuál conviene hacer primero y por qué?: ' },
];

function AsistenteIA({ currentUser, onAbrirModulo, pedirVoz = 0 }: { currentUser: User | null; onAbrirModulo?: (m: string) => void; pedirVoz?: number }) {
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
  // El cupo se recuerda en esta sesión: al abrir, Jarvis aparece de una con
  // sus controles y se actualiza por detrás (antes esperaba al servidor).
  const claveCupo = `tv_ia_cupo:${currentUser?.id || 'anon'}`;
  const [cupo, setCupoEstado] = useState<Cupo | null>(() => { try { return JSON.parse(sessionStorage.getItem(claveCupo) || 'null'); } catch { return null; } });
  const setCupo = useCallback((c: Cupo | null) => { setCupoEstado(c); try { if (c) sessionStorage.setItem(claveCupo, JSON.stringify(c)); } catch { /* nada */ } }, [claveCupo]);
  const [texto, setTexto] = useState('');
  // El globo FUERZA la búsqueda en internet para el próximo mensaje; sin él,
  // la IA decide sola cuándo buscar.
  const [buscar, setBuscar] = useState(false);
  const [adjuntos, setAdjuntos] = useState<Adjunto[]>([]);
  const [editando, setEditando] = useState(false);
  const cortar = useRef<AbortController | null>(null);
  const archivoRef = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [cargandoConv, setCargandoConv] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: 'respaldo' | 'error'; texto: string } | null>(null);
  const [vista, setVista] = useState<'chat' | 'ajustes' | 'cerebro'>('chat');
  const [cajon, setCajon] = useState<null | 'historial' | 'cupo'>(null);
  const finRef = useRef<HTMLDivElement>(null);
  const cajaRef = useRef<HTMLTextAreaElement>(null);
  // Jarvis (solo superadmin): con quién habla, a qué velocidad y la voz.
  const [persona, setPersonaEstado] = useState<Persona>(() => leerPref<Persona>('tv_jarvis_persona', 'jarvis', ['jarvis', 'arquitecto']));
  const [perfil, setPerfilEstado] = useState<Perfil>(() => leerPref<Perfil>('tv_jarvis_perfil', 'rapido', ['rapido', 'equilibrado', 'profundo']));
  const setPersona = (p: Persona) => { setPersonaEstado(p); guardarPref('tv_jarvis_persona', p); };
  const setPerfil = (p: Perfil) => { setPerfilEstado(p); guardarPref('tv_jarvis_perfil', p); };
  const [menu, setMenu] = useState<null | 'persona' | 'vel' | 'mas'>(null);
  const [voz, setVoz] = useState<null | 'grabando' | 'transcribiendo'>(null);
  const [segVoz, setSegVoz] = useState(0);
  const grabacion = useRef<GrabacionEnCurso | null>(null);
  const inicioVoz = useRef(0);
  // Jarvis se enciende solo cuando el servidor ya lo tiene (la función
  // nueva informa las velocidades en el cupo); antes, todo queda como siempre.
  const jarvis = soySuper && !!cupo?.perfiles;
  const conVoz = jarvis && puedeGrabarVoz();
  const privadosRef = useRef<Record<string, string>>({});
  useEffect(() => { privadosRef.current = {}; }, [activa]);
  const valorar = useCallback((id: string, v: number | null, nota?: string) => {
    setMensajes(prev => prev.map(m => (m.id === id ? { ...m, valoracion: v } : m)));
    void supabase.functions.invoke('asistente-ia', { body: { accion: 'valorar', id, valor: v, nota } }).then(({ data }) => {
      if (!data?.ok) toast.error('No se pudo guardar la valoración.');
      else if (v === -1 && nota) toast.success('Anotado: Jarvis lo va a evitar.');
    });
  }, [toast]);
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
  }, [setCupo]);
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
  const busquedaPermitida = !!cupo?.busquedaWeb;
  const archivosPermitidos = cupo?.capacidades?.archivos !== false;
  const ultimoModelo = [...mensajes].reverse().find(m => m.rol === 'assistant')?.modelo;
  const sugerencias = SUGERENCIAS.filter(s => !s.modulo || cupo?.modulos?.includes(s.modulo)).slice(0, 4);

  const nueva = () => { setActiva(null); setMensajes([]); setAviso(null); setCajon(null); setVista('chat'); setTimeout(() => cajaRef.current?.focus(), 50); };

  const enviar = async (contenido?: string, opciones: { regenerar?: boolean; porVoz?: number; audio?: { datos: string; tipo: string } } = {}) => {
    const crudo = opciones.audio ? '' : (contenido ?? texto).trim();
    // Jarvis: los datos personales se quedan en este aparato (ver separarPrivados).
    const sep = jarvis ? separarPrivados(crudo, privadosRef.current) : { texto: crudo, privados: {} };
    if (jarvis) privadosRef.current = sep.privados;
    // Por voz, el texto lo pone el servidor al transcribir (un solo viaje).
    const t = opciones.audio ? '🎤 …' : sep.texto;
    if (!t || enviando || agotado) return;
    // Editar el último mensaje = regenerar con el texto nuevo.
    const regenerar = opciones.regenerar || editando;
    const mios = regenerar ? [] : adjuntos;
    if (!opciones.audio) setTexto('');
    setAdjuntos([]);
    setEditando(false);
    setAviso(null);
    setEnviando(true);
    const antes = mensajes;
    setMensajes(prev => {
      let base = prev;
      if (regenerar) {
        // Se quitan de la vista la última respuesta y la pregunta.
        base = [...prev];
        if (base[base.length - 1]?.rol === 'assistant') base.pop();
        if (base[base.length - 1]?.rol === 'user') base.pop();
      }
      return [...base, { id: `tmp-${Date.now()}`, rol: 'user', texto: t, pendiente: true, porVoz: opciones.porVoz, vistas: mios.map(a => ({ nombre: a.nombre, tipo: a.tipo, url: a.vista })) }];
    });
    const control = new AbortController();
    cortar.current = control;
    // El borrador de la respuesta se actualiza a lo sumo una vez por cuadro
    // (requestAnimationFrame): en un teléfono de gama de entrada, repintar
    // en cada trozo de texto se notaba.
    const borrador: Mensaje = { id: BORRADOR, rol: 'assistant', texto: '', consultas: [], estado: opciones.audio ? 'Escuchando lo que dijiste…' : 'Pensando…' };
    let programado = 0;
    const pintar = () => {
      programado = 0;
      setMensajes(prev => [...prev.filter(m => m.id !== BORRADOR), { ...borrador, consultas: [...(borrador.consultas || [])] }]);
    };
    const pedirPintar = () => { if (!programado) programado = requestAnimationFrame(pintar); };
    pintar();
    // Ids propios del pedido: si se corta la conexión, la respuesta se
    // recupera de la base por su id; si se toca «Detener», se descarta.
    const nuevoId = () => (crypto as any).randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16); });
    const idPregunta = nuevoId(), idRespuesta = nuevoId();
    pedidoActual.current = { idPregunta, idRespuesta };
    let convDelPedido: string | null = activa;
    const recuperar = () => {
      // La conexión se cortó: el servidor igual termina y guarda. Se busca
      // la respuesta por su id durante un minuto.
      if (!convDelPedido) return false;
      const conv = convDelPedido;
      setAviso({ tipo: 'respaldo', texto: 'Se cortó la conexión. Recuperando la respuesta…' });
      let intentos = 0;
      const buscar = async () => {
        intentos++;
        enVuelo.delete(conv);
        const ms = await leerMensajes(conv);
        if (ms?.some(m => m.id === idRespuesta)) {
          if (!activa) { recienCreada.current = conv; setActiva(conv); }
          setMensajes(ms);
          setAviso(null);
          void cargarConvs();
          return;
        }
        if (intentos < 15) setTimeout(() => void buscar(), 4000);
        else setAviso({ tipo: 'error', texto: 'No se pudo recuperar la respuesta. Abrí la conversación de nuevo en un rato.' });
      };
      setTimeout(() => void buscar(), 2500);
      return true;
    };
    try {
      const res = await enviarEnVivo(
        {
          accion: 'enviar', texto: opciones.audio ? '' : t, conversacionId: activa, idPregunta, idRespuesta, buscar: buscar && busquedaPermitida, regenerar, adjuntos: mios.map(a => ({ nombre: a.nombre, tipo: a.tipo, datos: a.datos })),
          // Jarvis: el aparato propio va para que nunca proponga bloquearse a sí mismo.
          ...(jarvis ? { persona, perfil, porVoz: opciones.porVoz || undefined, privados: sep.privados, ...(opciones.audio ? { audio: opciones.audio.datos, tipoAudio: opciones.audio.tipo } : {}), yo: { device: aparatoActual().huella, modelo: aparatoActual().modelo } } : {}),
        },
        (evento, d) => {
          if (evento === 'inicio') {
            if (d.conversacionId) convDelPedido = d.conversacionId;
            // Por voz: aquí llega lo que se entendió, para mostrarlo ya.
            if (d.pregunta) setMensajes(prev => prev.map(m => (m.pendiente && m.rol === 'user' ? { ...m, texto: d.pregunta } : m)));
            // Lo dictado también pasa por el carril privado (en el servidor): se guardan sus marcas.
            if (d.privados && typeof d.privados === 'object') privadosRef.current = { ...privadosRef.current, ...d.privados };
            return;
          }
          if (evento === 'texto') { borrador.texto += d.delta || ''; borrador.estado = undefined; }
          else if (evento === 'estado') borrador.estado = d.texto;
          else if (evento === 'consulta') borrador.consultas = [...(borrador.consultas || []), d];
          else if (evento === 'modelo') borrador.modelo = d.modelo;
          else if (evento === 'reinicio') { borrador.texto = ''; borrador.consultas = []; borrador.estado = 'Cambiando a otro modelo…'; }
          else if (evento === 'propuesta') {
            // La tarjeta se pinta ya con lo que llegó; después se relee de la base.
            tarjetasVivas.set(d.id, { id: d.id, estado: d.estado, vence_en: d.venceEn, tarjeta: d.tarjeta });
            borrador.consultas = [...(borrador.consultas || []), { tipo: 'accion', id: d.id, modulo: d.tarjeta?.modulo || 'Jarvis', desc: d.tarjeta?.titulo || 'Acción', filas: 'propuesta', detalle: '' }];
          }
          else if (evento === 'navegar' || evento === 'memoria') borrador.consultas = [...(borrador.consultas || []), d];
          else if (evento === 'cerebro') borrador.consultas = [...(borrador.consultas || []).filter(c => !(c.tipo === 'cerebro' && c.filas === d.filas)), d];
          else return;
          pedirPintar();
        },
        control.signal,
      );
      if (programado) cancelAnimationFrame(programado);
      if (!res && !control.signal.aborted && recuperar()) {
        setMensajes(prev => prev.filter(m => m.id !== BORRADOR).map(m => (m.pendiente ? { ...m, pendiente: false } : m)));
        return;
      }
      if (!res?.ok) {
        if (res?.cupo) setCupo(res.cupo);
        setMensajes(prev => prev.filter(m => !m.pendiente && m.id !== BORRADOR));
        setTexto(crudo);
        setAviso({ tipo: 'error', texto: res?.error || 'No se pudo enviar. Revisa la conexión e intenta de nuevo.' });
        return;
      }
      setMensajes(prev => [...prev.filter(m => m.id !== BORRADOR).map(m => (m.pendiente ? { ...m, pendiente: false, ...(res.pregunta ? { texto: res.pregunta } : {}) } : m)), { id: `a-${Date.now()}`, ...res.mensaje }]);
      setCupo(res.cupo);
      if (res.respaldo) setAviso({ tipo: 'respaldo', texto: 'Google llegó a su límite por ahora; respondió el respaldo (Groq).' });
      setBuscar(false);
      if (!activa || res.nueva) { recienCreada.current = res.conversacionId; setActiva(res.conversacionId); }
      void cargarConvs();
    } catch (e: any) {
      if (programado) cancelAnimationFrame(programado);
      if (control.signal.aborted) {
        // Detenido: la conversación vuelve a como estaba y el texto a la caja.
        setMensajes(antes);
        setTexto(t);
        setAviso({ tipo: 'respaldo', texto: 'Respuesta detenida.' });
      } else if (recuperar()) {
        setMensajes(prev => prev.filter(m => m.id !== BORRADOR).map(m => (m.pendiente ? { ...m, pendiente: false } : m)));
      } else {
        setMensajes(prev => prev.filter(m => !m.pendiente && m.id !== BORRADOR));
        setTexto(crudo);
        setAviso({ tipo: 'error', texto: 'No se pudo enviar. Revisa la conexión e intenta de nuevo.' });
      }
    } finally {
      cortar.current = null;
      setEnviando(false);
    }
  };
  // «Detener» corta y además le avisa al servidor que no guarde: un corte de
  // conexión, en cambio, sí se guarda (y se recupera al volver).
  const pedidoActual = useRef<{ idPregunta: string; idRespuesta: string } | null>(null);
  const detener = () => {
    cortar.current?.abort();
    const p = pedidoActual.current;
    if (p) void supabase.functions.invoke('asistente-ia', { body: { accion: 'descartar', ...p } });
  };

  // ------------------------------ VOZ ------------------------------
  // Se graba con la misma grabadora de las notas de voz del chat (funciona
  // en la APK), se transcribe en el servidor y se manda como mensaje.
  const empezarVoz = async () => {
    if (voz || enviando) return;
    setMenu(null);
    try {
      grabacion.current = await grabarNotaDeVoz();
      inicioVoz.current = Date.now();
      setSegVoz(0);
      setVoz('grabando');
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo usar el micrófono.');
    }
  };
  const cancelarVoz = () => { grabacion.current?.cancelar(); grabacion.current = null; setVoz(null); };
  const terminarVoz = async () => {
    const g = grabacion.current;
    if (!g) return;
    grabacion.current = null;
    const seg = Math.max(1, Math.round((Date.now() - inicioVoz.current) / 1000));
    setVoz('transcribiendo');
    try {
      const blob = await g.detener();
      if (blob.size < 600) { toast.error('No se escuchó nada. Probá de nuevo más cerca del micrófono.'); return; }
      const audio = await aBase64(blob);
      // Un solo viaje: el audio va con el mensaje y el servidor lo
      // transcribe y responde de una vez.
      setVoz(null);
      void enviarRef.current('', { porVoz: seg, audio: { datos: audio, tipo: blob.type || 'audio/webm' } });
    } catch {
      toast.error('No se pudo leer el audio. Probá de nuevo.');
    } finally {
      setVoz(v => (v === 'transcribiendo' ? null : v));
    }
  };
  const terminarVozRef = useRef(terminarVoz);
  terminarVozRef.current = terminarVoz;
  useEffect(() => {
    if (voz !== 'grabando') return;
    const t = setInterval(() => {
      const s = Math.floor((Date.now() - inicioVoz.current) / 1000);
      setSegVoz(s);
      if (s >= 175) void terminarVozRef.current();
    }, 250);
    return () => clearInterval(t);
  }, [voz]);
  // «Hablar» desde el widget: se empieza a escuchar en cuanto Jarvis está listo.
  const vozAtendida = useRef(0);
  useEffect(() => {
    if (!pedirVoz || pedirVoz === vozAtendida.current || !conVoz || voz || enviando) return;
    vozAtendida.current = pedirVoz;
    void empezarVoz();
  }, [pedirVoz, conVoz]); // eslint-disable-line react-hooks/exhaustive-deps
  // Al salir del módulo, el micrófono se suelta.
  useEffect(() => () => { grabacion.current?.cancelar(); }, []);

  // Los menús se cierran al tocar afuera o con Escape.
  useEffect(() => {
    if (!menu) return;
    const fuera = (e: PointerEvent) => { if (!(e.target as Element)?.closest?.('.ai-pop,[data-menu-btn]')) setMenu(null); };
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    document.addEventListener('pointerdown', fuera);
    document.addEventListener('keydown', tecla);
    return () => { document.removeEventListener('pointerdown', fuera); document.removeEventListener('keydown', tecla); };
  }, [menu]);

  const ultimaPregunta = [...mensajes].reverse().find(m => m.rol === 'user')?.texto || '';
  const regenerarUltima = useCallback(() => { if (ultimaPregunta) void enviarRef.current(ultimaPregunta, { regenerar: true }); }, [ultimaPregunta]);
  const editarUltima = useCallback(() => { setTexto(ultimaPregunta); setEditando(true); setTimeout(() => cajaRef.current?.focus(), 30); }, [ultimaPregunta]);
  const enviarRef = useRef(enviar);
  enviarRef.current = enviar;

  const alElegirArchivos = async (lista: FileList | null) => {
    if (!lista) return;
    const libres = 3 - adjuntos.length;
    const nuevos: Adjunto[] = [];
    for (const f of Array.from(lista).slice(0, libres)) {
      try { const a = await prepararArchivo(f); if (a) nuevos.push(a); else toast.error(`«${f.name}» no es una foto, un PDF ni un texto.`); }
      catch (e: any) { toast.error(e?.message || 'No se pudo leer el archivo.'); }
    }
    if (lista.length > libres) toast.error('Máximo 3 archivos por mensaje.');
    setAdjuntos(prev => [...prev, ...nuevos]);
    if (archivoRef.current) archivoRef.current.value = '';
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

  const perfilActual = PERFILES.find(p => p.id === perfil) || PERFILES[1];
  const verCerebro = () => setVista('cerebro');
  return (
    <AbrirModuloCtx.Provider value={onAbrirModulo}>
    <VerCerebroCtx.Provider value={jarvis ? verCerebro : undefined}>
    <div className="ai-root" id="view-asistente">
      <aside className="ai-lado">{listaConvs}</aside>

      <section className="ai-panel">
        <header className="ai-ch">
          {vista !== 'chat' ? (
            <>
              <button type="button" className="ai-menu ai-atras" aria-label="Volver al chat" title="Volver al chat" onClick={() => setVista('chat')}><ArrowLeft className="w-5 h-5" /></button>
              <b className="ai-titulo">{vista === 'cerebro' ? 'Cerebro de Jarvis' : 'Ajustes del asistente'}</b>
            </>
          ) : (
            <>
              <button type="button" className="ai-menu" aria-label="Conversaciones" onClick={() => setCajon('historial')}><Menu className="w-5 h-5" /></button>
              {jarvis ? (
                <button type="button" className="ai-modelo ai-persona" data-p={persona === 'arquitecto' ? 'arquitecto' : 'operador'} data-menu-btn
                  aria-haspopup="menu" aria-expanded={menu === 'persona'} aria-label={`Modo: ${persona === 'arquitecto' ? 'Arquitecto' : 'Jarvis'}`}
                  onClick={() => setMenu(m => (m === 'persona' ? null : 'persona'))}>
                  <span className="ai-dot">{persona === 'arquitecto' ? <Lightbulb className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}</span>
                  <span className="ai-mn">{persona === 'arquitecto' ? 'Arquitecto' : 'Jarvis'}</span>
                  <span className="ai-chev"><ChevronDown className="w-4 h-4" /></span>
                </button>
              ) : <span className="ai-modelo" title={`Responde: ${nombreModelo(ultimoModelo)}`}><span className="ai-dot"><MessageCircleQuestion className="w-3.5 h-3.5" /></span><span className="ai-mn">{soySuper ? 'Jarvis' : 'Asistencia de IA'}</span></span>}
            </>
          )}
          <span className="ai-sp" />
          <button type="button" className="ai-cupo-pill" onClick={() => setCajon('cupo')} aria-label="Cupo de hoy">
            <BarChart3 className="w-4 h-4" />
            {cupo?.disponibles === null || !cupo ? <><b>{cupo?.usados ?? 0}</b><span className="ai-lbl"> hoy</span></> : <><b>{cupo.disponibles}</b><span className="ai-lbl"> disponibles</span></>}
          </button>
          {jarvis && vista === 'chat' && (
            <button type="button" className="ai-chip ai-ajustes-btn" onClick={() => setVista('cerebro')} aria-label="Cerebro de Jarvis" title="Cerebro de Jarvis"><Brain className="w-[18px] h-[18px]" /><span className="ai-lbl">Cerebro</span></button>
          )}
          {soySuper && vista === 'chat' && (
            <button type="button" className="ai-chip ai-ajustes-btn" onClick={() => setVista('ajustes')} aria-label="Ajustes" title="Ajustes"><Settings className="w-[18px] h-[18px]" /><span className="ai-lbl">Ajustes</span></button>
          )}
        </header>

        {vista === 'cerebro' && jarvis ? <div className="ai-ajustes"><React.Suspense fallback={null}><CerebroJarvis onPreguntar={t => { setVista('chat'); void enviar(t); }} /></React.Suspense></div> : vista === 'ajustes' && soySuper ? <AjustesIA onCambio={cargarCupo} cupo={cupo} /> : (
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
                  <span className="ai-logo">{jarvis && persona === 'arquitecto' ? <Lightbulb className="w-7 h-7" /> : <Sparkles className="w-7 h-7" />}</span>
                  <h3>{jarvis ? (persona === 'arquitecto' ? '¿Qué idea evaluamos?' : '¿Qué hacemos hoy?') : '¿En qué te ayudo?'}</h3>
                  <p>{jarvis
                    ? (persona === 'arquitecto'
                      ? 'Contame una idea o un cambio. Te digo qué implica en el sistema y te dejo el requerimiento listo para programar. No ejecuto nada.'
                      : `Preguntá por cualquier módulo o dame una orden: «respondele a Laura que ya está lista», «pasá la orden TKT-104 a Lista», «bloqueá el modelo…». Lo delicado te lo muestro en una tarjeta para confirmar.${conVoz ? ' También por voz.' : ''}`)
                    : <>{conSistema ? 'Preguntá por el inventario, las ventas o el taller, o pedí ayuda para redactar.' : 'Preguntas, redactar, explicar o resumir.'} No escribás cédulas, teléfonos ni datos de clientes.</>}</p>
                  <div className="ai-sug">
                    {(jarvis ? (persona === 'arquitecto' ? SUGERENCIAS_ARQ : SUGERENCIAS_JARVIS) : sugerencias).map(s => (
                      <button key={s.t} type="button" onClick={() => { setTexto(s.p); cajaRef.current?.focus(); }}><b>{s.t}</b>{s.d}</button>
                    ))}
                  </div>
                </div>
              ) : <ListaMensajes mensajes={mensajes} onCopiar={copiar} onValorar={jarvis ? valorar : undefined} onRegenerar={enviando ? undefined : regenerarUltima} onEditar={enviando ? undefined : editarUltima} />}
              <div ref={finRef} />
            </div>

            <div className="ai-red" data-burbuja-encima>
              {editando && (
                <div className="ai-editando"><Pencil className="w-3.5 h-3.5" /><span>Editando tu último mensaje</span>
                  <button type="button" onClick={() => { setEditando(false); setTexto(''); }}>Cancelar</button></div>
              )}
              <div className="ai-caja" data-grabando={voz === 'grabando' || undefined} data-transcribiendo={voz === 'transcribiendo' || undefined}>
                {!!adjuntos.length && (
                  <div className="ai-adj">
                    {adjuntos.map((a, i) => (
                      <span key={i}>
                        {a.vista ? <img src={a.vista} alt="" /> : <FileText className="w-4 h-4" />}
                        <em>{a.nombre}</em>
                        <button type="button" aria-label={`Quitar ${a.nombre}`} onClick={() => setAdjuntos(prev => prev.filter((_, j) => j !== i))}><X className="w-3.5 h-3.5" /></button>
                      </span>
                    ))}
                  </div>
                )}
                <textarea
                  ref={cajaRef}
                  value={texto}
                  onChange={e => setTexto(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer: fine)').matches) { e.preventDefault(); void enviar(); } }}
                  placeholder={agotado ? 'Cupo agotado hasta la medianoche' : jarvis ? (persona === 'arquitecto' ? 'Contale la idea al Arquitecto…' : 'Pedile algo a Jarvis…') : 'Preguntá lo que necesités…'}
                  disabled={agotado}
                  rows={1}
                  aria-label="Mensaje para el asistente"
                />
                {voz && (
                  <div className="ai-escucha" aria-live="polite">
                    {voz === 'grabando' ? (
                      <>
                        <span className="ai-rec" />
                        <span>Escuchando…</span>
                        <span className="ai-onda" aria-hidden="true">{ONDA.map((d, i) => <i key={i} style={{ animationDelay: d }} />)}</span>
                        <span className="ai-reloj">{reloj(segVoz)}</span>
                        <button type="button" className="ai-ib" onClick={cancelarVoz} aria-label="Descartar grabación" title="Descartar grabación"><X className="w-4 h-4" /></button>
                      </>
                    ) : (
                      <><span className="ai-giro" aria-hidden="true" /><span>Transcribiendo…</span></>
                    )}
                  </div>
                )}
                <input ref={archivoRef} type="file" accept="image/*,application/pdf,text/plain,text/csv,text/markdown,application/json,.txt,.csv,.md,.json,.tsv,.log,.doc,.docx,.xls,.xlsx" multiple hidden onChange={e => void alElegirArchivos(e.target.files)} />
                <div className="ai-bot">
                  {jarvis && !editando && (archivosPermitidos || busquedaPermitida) && (
                    <button type="button" className="ai-ib" data-menu-btn data-on={buscar || undefined} aria-haspopup="menu" aria-expanded={menu === 'mas'}
                      aria-label="Adjuntar o buscar en internet" title="Adjuntar o buscar en internet" disabled={!!voz}
                      onClick={() => setMenu(m => (m === 'mas' ? null : 'mas'))}>
                      <Plus className="w-[18px] h-[18px]" />
                    </button>
                  )}
                  {conVoz && (
                    <button type="button" className="ai-ib" data-grabando={voz === 'grabando' || undefined} disabled={enviando || agotado || voz === 'transcribiendo'}
                      aria-label={voz === 'grabando' ? 'Terminar y enviar' : 'Dictar por voz'} title={voz === 'grabando' ? 'Terminar y enviar' : 'Dictar por voz'}
                      onClick={() => void (voz === 'grabando' ? terminarVoz() : empezarVoz())}>
                      <Mic className="w-[18px] h-[18px]" />
                    </button>
                  )}
                  {!jarvis && archivosPermitidos && !editando && (
                    <>
                      <button type="button" className="ai-ib" onClick={() => archivoRef.current?.click()} disabled={adjuntos.length >= 3} aria-label="Adjuntar foto o documento" title="Adjuntar foto o documento">
                        <Paperclip className="w-[18px] h-[18px]" />
                      </button>
                    </>
                  )}
                  {!jarvis && busquedaPermitida && (
                    <button type="button" className="ai-ib" data-on={buscar || undefined} onClick={() => setBuscar(v => !v)}
                      aria-pressed={buscar} aria-label="Buscar en internet" title={buscar ? 'Va a buscar en internet' : 'Buscar en internet (la IA también busca sola cuando hace falta)'}>
                      <Globe className="w-[18px] h-[18px]" />
                    </button>
                  )}
                  <span className="ai-sp" />
                  {jarvis ? (
                    <button type="button" className="ai-vel" data-menu-btn aria-haspopup="menu" aria-expanded={menu === 'vel'} aria-label={`Velocidad: ${perfilActual.nombre}`}
                      onClick={() => setMenu(m => (m === 'vel' ? null : 'vel'))}>
                      <span className="ai-vel-ic"><perfilActual.icono className="w-4 h-4" /></span>
                      <span className="ai-vel-tx">{perfilActual.nombre}</span>
                      <span className="ai-chev"><ChevronDown className="w-4 h-4" /></span>
                    </button>
                  ) : (
                    <span className="ai-cont" title="Tokens estimados de tu texto · contexto usado de la conversación">
                      ≈ <b>{estimarTokens(texto)}</b><span className="ai-lbl"> tokens</span>
                      <span className="ai-barra"><i style={{ width: `${Math.min(100, Math.max(tokensConv ? 2 : 0, tokensConv / CONTEXTO * 100))}%` }} /></span>
                      {(tokensConv / CONTEXTO * 100).toFixed(tokensConv ? 1 : 0)}%
                    </span>
                  )}
                  {voz === 'grabando' ? (
                    <button type="button" className="ai-env" onClick={() => void terminarVoz()} aria-label="Terminar y enviar"><ArrowUp className="w-5 h-5" /></button>
                  ) : enviando ? (
                    <button type="button" className="ai-env" data-detener onClick={detener} aria-label="Detener"><Square className="w-4 h-4" fill="currentColor" /></button>
                  ) : (
                    <button type="button" className="ai-env" disabled={!texto.trim() || agotado || !!voz} onClick={() => void enviar()} aria-label="Enviar">
                      <ArrowUp className="w-5 h-5" />
                    </button>
                  )}
                </div>
              </div>
              <p className="ai-nota">{jarvis && persona === 'jarvis'
                ? 'Jarvis hace lo que le pedís; cobros, bloqueos y cierres de sesión los confirmás vos. No puede tocar el código del sistema.'
                : 'No escribás ni adjuntés cédulas ni documentos de clientes. La IA puede equivocarse: verificá lo importante.'}</p>
              {jarvis && menu === 'vel' && (
                <div className="ai-pop tv-chat-pop ai-vel-menu" role="menu" aria-label="Velocidad de Jarvis">
                  <div className="ai-pop-t">Velocidad</div>
                  {PERFILES.map(p => (
                    <button key={p.id} type="button" className="ai-pop-op" role="menuitemradio" aria-checked={perfil === p.id} onClick={() => { setPerfil(p.id); setMenu(null); }}>
                      <span className="ai-pop-ic"><p.icono className="w-[18px] h-[18px]" /></span>
                      <span className="ai-pop-tx"><b>{p.nombre}</b><span>{p.desc}</span><em>{p.modelo}</em></span>
                      <span className="ai-pop-der"><span>{p.t}</span>{p.id === 'profundo' && cupo?.perfiles?.profundo === false && <span className="ai-pop-aviso">cupo bajo</span>}<span className="ai-pop-ok"><Check className="w-4 h-4" /></span></span>
                    </button>
                  ))}
                  <p className="ai-pop-pie">Tiempos medidos con la clave gratis. Si Flash 3.8 se queda sin cupo, Profundo sigue con Flash-Lite a fondo y el pie de la respuesta lo dice.</p>
                </div>
              )}
              {jarvis && menu === 'mas' && (
                <div className="ai-pop tv-chat-pop ai-mas-menu" role="menu" aria-label="Adjuntar o buscar">
                  {archivosPermitidos && (
                    <button type="button" className="ai-mas-op" role="menuitem" disabled={adjuntos.length >= 3} onClick={() => { setMenu(null); archivoRef.current?.click(); }}>
                      <span className="ai-pop-ic"><Paperclip className="w-4 h-4" /></span><span>Adjuntar foto o documento<small>{adjuntos.length >= 3 ? 'Ya hay 3 en este mensaje' : 'Fotos, PDF, txt, csv · hasta 3'}</small></span>
                    </button>
                  )}
                  {busquedaPermitida && (
                    <button type="button" className="ai-mas-op" role="menuitemcheckbox" aria-checked={buscar} onClick={() => { setBuscar(v => !v); setMenu(null); }}>
                      <span className="ai-pop-ic"><Globe className="w-4 h-4" /></span><span>Buscar en internet<small>{buscar ? 'Activado para la próxima respuesta' : 'La próxima respuesta busca primero'}</small></span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </>
        )}
        {jarvis && menu === 'persona' && vista === 'chat' && (
          <div className="ai-pop tv-chat-pop ai-persona-menu" role="menu" aria-label="Modo de Jarvis">
            <div className="ai-pop-t">Con quién hablás</div>
            {PERSONAS.map(p => (
              <button key={p.id} type="button" className="ai-pop-op" role="menuitemradio" aria-checked={persona === p.id} onClick={() => { setPersona(p.id); setMenu(null); }}>
                <span className="ai-pop-ic"><p.icono className="w-[18px] h-[18px]" /></span>
                <span className="ai-pop-tx"><b>{p.nombre}</b><span>{p.desc}</span></span>
                <span className="ai-pop-der"><span className="ai-pop-ok"><Check className="w-4 h-4" /></span></span>
              </button>
            ))}
          </div>
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
    </VerCerebroCtx.Provider>
    </AbrirModuloCtx.Provider>
  );
}

function AjustesIA({ onCambio, cupo }: { onCambio: () => void; cupo: Cupo | null }) {
  const toast = useToast();
  const [aj, setAj] = useState<Ajustes | null>(null);
  const [uso, setUso] = useState<{ email: string; mensajes: number; tokens: number; es_super: boolean }[]>([]);
  const [limite, setLimite] = useState('60');
  const [consultasHoy, setConsultasHoy] = useState<{ modulo: string; consultas: number }[]>([]);

  useEffect(() => {
    // '*': así no falla si la columna `tono` todavía no existe.
    void supabase.from('ia_ajustes').select('*').eq('id', 1).maybeSingle()
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
  const modulos: Modulos = { inventario: true, facturacion: true, taller: true, errores: true, seguridad: true, finanzas: true, internet: true, enlaces: true, archivos: true, codigo: true, acciones: true, chat_directo: true, taller_directo: true, inventario_directo: true, ...(aj.modulos || {}) };
  const maxConsultas = Math.max(1, ...consultasHoy.map(c => c.consultas));
  return (
    <div className="ai-ajustes">
      <div className="ai-aj">
        <h4>Capacidades <small>gratis</small></h4>
        {CAPACIDADES.map(m => (
          <div key={m.id} className="ai-modu">
            <span className="ai-modu-ic"><m.icono className="w-4 h-4" /></span>
            <span className="ai-modu-t"><b>{m.nombre}</b><span>{m.id === 'internet'
              ? (cupo?.busquedaWeb || !modulos.internet ? `${m.desc} · ${cupo?.busquedasMes ?? 0} de ${cupo?.cupoBusquedas ?? 1000} este mes` : 'Falta la clave TAVILY_API_KEY en los secretos de Supabase')
              : m.desc}</span></span>
            <button type="button" role="switch" aria-checked={modulos[m.id]} className="ai-sw" data-on={modulos[m.id] || undefined}
              onClick={() => void guardar({ modulos: { ...modulos, [m.id]: !modulos[m.id] } })} aria-label={m.nombre} />
          </div>
        ))}
      </div>
      {cupo?.perfiles && <div className="ai-aj">
        <h4>Jarvis <small>solo superadmin</small></h4>
        <div className="ai-modu">
          <span className="ai-modu-ic"><Bot className="w-4 h-4" /></span>
          <span className="ai-modu-t"><b>Acciones con confirmación</b><span>Prepara bloqueos, desbloqueos y cierres de sesión; nada se ejecuta sin tu «Confirmar». Nunca toca el código.</span></span>
          <button type="button" role="switch" aria-checked={modulos.acciones} className="ai-sw" data-on={modulos.acciones || undefined}
            onClick={() => void guardar({ modulos: { ...modulos, acciones: !modulos.acciones } })} aria-label="Acciones de Jarvis" />
        </div>
        {([['chat_directo', 'Responder chats sin preguntar', 'Si hay un solo chat que coincide, lo envía de una (se puede borrar por 10 min).'],
          ['taller_directo', 'Mover órdenes del taller sin preguntar', 'Si hay una sola orden, la mueve de una; entregar o cancelar siempre se confirma.'],
          ['inventario_directo', 'Cambiar existencias y precios sin preguntar', 'Bajar un precio a menos de la mitad o dejar algo en 0 siempre se confirma.']] as const).map(([k, n, d]) => (
          <div key={k} className="ai-modu">
            <span className="ai-modu-ic"><Zap className="w-4 h-4" /></span>
            <span className="ai-modu-t"><b>{n}</b><span>{d}</span></span>
            <button type="button" role="switch" aria-checked={modulos[k]} className="ai-sw" data-on={modulos[k] || undefined}
              onClick={() => void guardar({ modulos: { ...modulos, [k]: !modulos[k] } })} aria-label={n} />
          </div>
        ))}
        <div className="ai-campo">
          <span>Tono de Jarvis</span>
          <span className="ai-seg">
            {([['formal', 'Formal'], ['tico_moderado', 'Tico moderado'], ['tico_suelto', 'Tico suelto']] as const).map(([v, l]) => (
              <button key={v} type="button" data-on={(aj.tono || 'tico_moderado') === v || undefined} onClick={() => void guardar({ tono: v })}>{l}</button>
            ))}
          </span>
        </div>
      </div>}
      {cupo?.perfiles && <MemoriaJarvis />}
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

/** Lo que Jarvis recuerda del dueño: se ve, se agrega y se borra aquí. */
function MemoriaJarvis() {
  const toast = useToast();
  const [items, setItems] = useState<{ id: string; texto: string; tipo: string }[] | null>(null);
  const [nuevo, setNuevo] = useState('');
  const [sinTabla, setSinTabla] = useState(false);
  const cargar = useCallback(async () => {
    const { data, error } = await supabase.from('jarvis_memoria').select('id,texto,tipo').order('creada_en', { ascending: false }).limit(100);
    if (error) { setSinTabla(true); setItems([]); return; }
    setItems((data as any[]) || []);
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  const agregar = async () => {
    const t = nuevo.trim();
    if (t.length < 3) return;
    if (/\b\d{8,12}\b|\d{4}[-\s]\d{4}|@/.test(t)) { toast.error('Eso parece un dato personal: la memoria no guarda cédulas, teléfonos ni correos.'); return; }
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('jarvis_memoria').insert({ user_id: user?.id, texto: t.slice(0, 300), tipo: 'preferencia', origen: 'manual' });
    if (error) { toast.error('No se pudo guardar: ' + error.message); return; }
    setNuevo(''); void cargar();
  };
  const borrar = async (id: string) => {
    const { error } = await supabase.from('jarvis_memoria').delete().eq('id', id);
    if (error) { toast.error('No se pudo borrar.'); return; }
    setItems(prev => (prev || []).filter(i => i.id !== id));
  };
  const TIPO: Record<string, string> = { preferencia: 'Preferencia', negocio: 'Negocio', forma_de_hablar: 'Forma de hablar' };
  return (
    <div className="ai-aj">
      <h4>Memoria de Jarvis <small>sin datos de clientes · viaja a Google</small></h4>
      {sinTabla ? <p className="ai-prov" style={{ margin: 14 }}>Se activa cuando se aplique la migración de memoria.</p> : (
        <>
          {items === null && <p className="ai-prov" style={{ margin: 14 }}>Cargando…</p>}
          {items?.length === 0 && <p className="ai-prov" style={{ margin: 14 }}>Todavía no recuerda nada. Decile «recordá que…» o agregalo aquí.</p>}
          {items?.map(i => (
            <div key={i.id} className="ai-modu">
              <span className="ai-modu-ic"><Brain className="w-4 h-4" /></span>
              <span className="ai-modu-t"><b>{i.texto}</b><span>{TIPO[i.tipo] || i.tipo}</span></span>
              <button type="button" className="ai-borrar" aria-label="Olvidar" title="Olvidar" onClick={() => void borrar(i.id)}><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
          <form className="ai-campo" onSubmit={e => { e.preventDefault(); void agregar(); }}>
            <input className="glass-input rounded-lg px-3 py-2 text-[13px]" style={{ flex: 1, minWidth: 0 }} value={nuevo} onChange={e => setNuevo(e.target.value)} maxLength={300} placeholder="Ej.: los resúmenes en tres líneas" aria-label="Algo para que Jarvis recuerde" />
            <button type="submit" className="ai-chip" disabled={nuevo.trim().length < 3}>Agregar</button>
          </form>
        </>
      )}
    </div>
  );
}

export default React.memo(AsistenteIA);
