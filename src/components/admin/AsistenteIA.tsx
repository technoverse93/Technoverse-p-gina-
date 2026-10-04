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
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
const MapaModal = React.lazy(() => import('../ui/MapaModal'));
import { supabase, SUPABASE_URL, SUPABASE_KEY } from '../../supabaseClient';
import { cabeceraClientInfo } from '../../utils/dispositivo';
import { useToast, useConfirm } from '../ui/Overlays';
import { esSuperadmin } from '../../utils/roles';
import type { User } from '../../types';

interface Conversacion { id: string; titulo: string; actualizado_en: string }
/** Una consulta al sistema que hizo la IA (la tarjeta encima de la respuesta). */
interface Panel { columnas: string[]; filas: (string | number | null)[][]; puntos?: ({ lat: number; lon: number; etiqueta: string } | null)[] }
interface Consulta { modulo: string; desc: string; filas: string; detalle: string; sinPermiso?: boolean; panel?: Panel }
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
}
interface Adjunto { nombre: string; tipo: string; datos: string; vista?: string }
interface Cupo {
  usados: number; limite: number | null; disponibles: number | null; tokensHoy: number;
  equipo: { gemini: number; groq: number; cupoGemini: number; cupoGroq: number };
  busqueda: boolean; respaldo: boolean; groqConfigurado: boolean;
  modulos?: string[]; consultasHoy?: number;
  busquedaWeb?: boolean; busquedasMes?: number; cupoBusquedas?: number;
  capacidades?: { enlaces: boolean; codigo: boolean; archivos: boolean };
}
type Modulos = Record<'inventario' | 'facturacion' | 'taller' | 'errores' | 'seguridad' | 'finanzas' | 'internet' | 'enlaces' | 'archivos' | 'codigo', boolean>;
interface Ajustes { limite_diario: number; busqueda: boolean; respaldo: boolean; acceso: 'personal' | 'gestion' | 'super'; modulos?: Modulos }

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
const ICONO_MODULO: Record<string, LucideIcon> = { Inventario: Package, 'Facturación': Receipt, Taller: Wrench, 'Errores del sistema': TriangleAlert, Ciberseguridad: ShieldAlert, Finanzas: Wallet, Internet: Globe, Enlace: Link2, 'Código': Code2 };

/** Foto → JPEG de hasta 1600 px (≈200–400 KB): en datos móviles mandar la
 *  foto original de 4 MB tardaba y no mejoraba lo que la IA ve. */
async function prepararArchivo(f: File): Promise<Adjunto | null> {
  const aBase64 = (b: Blob) => new Promise<string>((ok, mal) => {
    const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => mal(r.error); r.readAsDataURL(b);
  });
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
const Burbuja = React.memo(function Burbuja({ m, onCopiar, onRegenerar, onEditar }: { m: Mensaje; onCopiar: (t: string) => void; onRegenerar?: () => void; onEditar?: () => void }) {
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
        {onEditar && <button type="button" className="ai-editar" onClick={onEditar}><Pencil className="w-3.5 h-3.5" />Editar</button>}
      </div>
    );
  }
  const enVivo = m.id === BORRADOR;
  return (
    <div className="ai-ia" aria-live={enVivo ? 'polite' : undefined}>
      {!!m.consultas?.length && <div className="ai-herrs">{m.consultas.map((c, i) => <React.Fragment key={i}><TarjetaConsulta c={c} /></React.Fragment>)}</div>}
      {m.texto
        ? <div className="ai-tx"><Formato texto={m.texto} />{enVivo && <span className="ai-cursor" />}</div>
        : enVivo && <div className="ai-buscando"><span className="ai-puntos"><i /><i /><i /></span>{m.estado || 'Pensando…'}</div>}
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
        <span className="ai-tok">↑ <i>{k(m.tokens_in || 0)}</i> · ↓ <i>{k(m.tokens_out || 0)}</i> tokens</span>
        <span>{nombreModelo(m.modelo || (m.proveedor === 'groq' ? 'groq' : null))}{m.busco ? ' · buscó en internet' : ''}{m.consultas?.length ? ` · consultó ${m.consultas.length} ${m.consultas.length === 1 ? 'vez' : 'veces'}` : ''}</span>
      </div>}
    </div>
  );
});
const BORRADOR = 'borrador-en-vivo';

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
const ListaMensajes = React.memo(function ListaMensajes({ mensajes, onCopiar, onRegenerar, onEditar }: { mensajes: Mensaje[]; onCopiar: (t: string) => void; onRegenerar?: () => void; onEditar?: () => void }) {
  // Regenerar y editar solo aplican al último intercambio (como en Claude).
  const ultIA = mensajes.length - 1, ultYo = mensajes[ultIA]?.rol === 'assistant' ? ultIA - 1 : -1;
  return <>{mensajes.map((m, i) => (
    <React.Fragment key={m.id}>
      <Burbuja m={m} onCopiar={onCopiar} onRegenerar={i === ultIA && m.rol === 'assistant' ? onRegenerar : undefined} onEditar={i === ultYo ? onEditar : undefined} />
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
  const busquedaPermitida = !!cupo?.busquedaWeb;
  const archivosPermitidos = cupo?.capacidades?.archivos !== false;
  const ultimoModelo = [...mensajes].reverse().find(m => m.rol === 'assistant')?.modelo;
  const sugerencias = SUGERENCIAS.filter(s => !s.modulo || cupo?.modulos?.includes(s.modulo)).slice(0, 4);

  const nueva = () => { setActiva(null); setMensajes([]); setAviso(null); setCajon(null); setVista('chat'); setTimeout(() => cajaRef.current?.focus(), 50); };

  const enviar = async (contenido?: string, opciones: { regenerar?: boolean } = {}) => {
    const t = (contenido ?? texto).trim();
    if (!t || enviando || agotado) return;
    // Editar el último mensaje = regenerar con el texto nuevo.
    const regenerar = opciones.regenerar || editando;
    const mios = regenerar ? [] : adjuntos;
    setTexto('');
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
      return [...base, { id: `tmp-${Date.now()}`, rol: 'user', texto: t, pendiente: true, vistas: mios.map(a => ({ nombre: a.nombre, tipo: a.tipo, url: a.vista })) }];
    });
    const control = new AbortController();
    cortar.current = control;
    // El borrador de la respuesta se actualiza a lo sumo una vez por cuadro
    // (requestAnimationFrame): en un teléfono de gama de entrada, repintar
    // en cada trozo de texto se notaba.
    const borrador: Mensaje = { id: BORRADOR, rol: 'assistant', texto: '', consultas: [], estado: 'Pensando…' };
    let programado = 0;
    const pintar = () => {
      programado = 0;
      setMensajes(prev => [...prev.filter(m => m.id !== BORRADOR), { ...borrador, consultas: [...(borrador.consultas || [])] }]);
    };
    const pedirPintar = () => { if (!programado) programado = requestAnimationFrame(pintar); };
    pintar();
    try {
      const res = await enviarEnVivo(
        { accion: 'enviar', texto: t, conversacionId: activa, buscar: buscar && busquedaPermitida, regenerar, adjuntos: mios.map(a => ({ nombre: a.nombre, tipo: a.tipo, datos: a.datos })) },
        (evento, d) => {
          if (evento === 'texto') { borrador.texto += d.delta || ''; borrador.estado = undefined; }
          else if (evento === 'estado') borrador.estado = d.texto;
          else if (evento === 'consulta') borrador.consultas = [...(borrador.consultas || []), d];
          else if (evento === 'modelo') borrador.modelo = d.modelo;
          else if (evento === 'reinicio') { borrador.texto = ''; borrador.consultas = []; borrador.estado = 'Cambiando a otro modelo…'; }
          else return;
          pedirPintar();
        },
        control.signal,
      );
      if (programado) cancelAnimationFrame(programado);
      if (!res?.ok) {
        if (res?.cupo) setCupo(res.cupo);
        setMensajes(prev => prev.filter(m => !m.pendiente && m.id !== BORRADOR));
        setTexto(t);
        setAviso({ tipo: 'error', texto: res?.error || 'No se pudo enviar. Revisa la conexión e intenta de nuevo.' });
        return;
      }
      setMensajes(prev => [...prev.filter(m => m.id !== BORRADOR).map(m => (m.pendiente ? { ...m, pendiente: false } : m)), { id: `a-${Date.now()}`, ...res.mensaje }]);
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
      } else {
        setMensajes(prev => prev.filter(m => !m.pendiente && m.id !== BORRADOR));
        setTexto(t);
        setAviso({ tipo: 'error', texto: 'No se pudo enviar. Revisa la conexión e intenta de nuevo.' });
      }
    } finally {
      cortar.current = null;
      setEnviando(false);
    }
  };
  const detener = () => cortar.current?.abort();

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
      try { const a = await prepararArchivo(f); if (a) nuevos.push(a); else toast.error(`«${f.name}» no es una foto ni un PDF.`); }
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

  return (
    <div className="ai-root" id="view-asistente">
      <aside className="ai-lado">{listaConvs}</aside>

      <section className="ai-panel">
        <header className="ai-ch">
          {vista === 'ajustes' ? (
            <>
              <button type="button" className="ai-menu ai-atras" aria-label="Volver al chat" title="Volver al chat" onClick={() => setVista('chat')}><ArrowLeft className="w-5 h-5" /></button>
              <b className="ai-titulo">Ajustes del asistente</b>
            </>
          ) : (
            <>
              <button type="button" className="ai-menu" aria-label="Conversaciones" onClick={() => setCajon('historial')}><Menu className="w-5 h-5" /></button>
              <span className="ai-modelo" title={nombreModelo(ultimoModelo)}><span className="ai-dot"><Sparkles className="w-3.5 h-3.5" /></span><span className="ai-mn">{nombreModelo(ultimoModelo).startsWith('Gemini ') ? <><span className="ai-lbl">Gemini </span>{nombreModelo(ultimoModelo).slice(7)}</> : nombreModelo(ultimoModelo)}</span></span>
            </>
          )}
          <span className="ai-sp" />
          <button type="button" className="ai-cupo-pill" onClick={() => setCajon('cupo')} aria-label="Cupo de hoy">
            <BarChart3 className="w-4 h-4" />
            {cupo?.disponibles === null || !cupo ? <><b>{cupo?.usados ?? 0}</b><span className="ai-lbl"> hoy</span></> : <><b>{cupo.disponibles}</b><span className="ai-lbl"> disponibles</span></>}
          </button>
          {soySuper && vista === 'chat' && (
            <button type="button" className="ai-chip ai-ajustes-btn" onClick={() => setVista('ajustes')} aria-label="Ajustes" title="Ajustes"><Settings className="w-[18px] h-[18px]" /><span className="ai-lbl">Ajustes</span></button>
          )}
        </header>

        {vista === 'ajustes' && soySuper ? <AjustesIA onCambio={cargarCupo} cupo={cupo} /> : (
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
              ) : <ListaMensajes mensajes={mensajes} onCopiar={copiar} onRegenerar={enviando ? undefined : regenerarUltima} onEditar={enviando ? undefined : editarUltima} />}
              <div ref={finRef} />
            </div>

            <div className="ai-red">
              {editando && (
                <div className="ai-editando"><Pencil className="w-3.5 h-3.5" /><span>Editando tu último mensaje</span>
                  <button type="button" onClick={() => { setEditando(false); setTexto(''); }}>Cancelar</button></div>
              )}
              <div className="ai-caja">
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
                  placeholder={agotado ? 'Cupo agotado hasta la medianoche' : 'Preguntá lo que necesités…'}
                  disabled={agotado}
                  rows={1}
                  aria-label="Mensaje para el asistente"
                />
                <div className="ai-bot">
                  {archivosPermitidos && !editando && (
                    <>
                      <input ref={archivoRef} type="file" accept="image/*,application/pdf" multiple hidden onChange={e => void alElegirArchivos(e.target.files)} />
                      <button type="button" className="ai-ib" onClick={() => archivoRef.current?.click()} disabled={adjuntos.length >= 3} aria-label="Adjuntar foto o PDF" title="Adjuntar foto o PDF">
                        <Paperclip className="w-[18px] h-[18px]" />
                      </button>
                    </>
                  )}
                  {busquedaPermitida && (
                    <button type="button" className="ai-ib" data-on={buscar || undefined} onClick={() => setBuscar(v => !v)}
                      aria-pressed={buscar} aria-label="Buscar en internet" title={buscar ? 'Va a buscar en internet' : 'Buscar en internet (la IA también busca sola cuando hace falta)'}>
                      <Globe className="w-[18px] h-[18px]" />
                    </button>
                  )}
                  <span className="ai-sp" />
                  <span className="ai-cont" title="Tokens estimados de tu texto · contexto usado de la conversación">
                    ≈ <b>{estimarTokens(texto)}</b><span className="ai-lbl"> tokens</span>
                    <span className="ai-barra"><i style={{ width: `${Math.min(100, Math.max(tokensConv ? 2 : 0, tokensConv / CONTEXTO * 100))}%` }} /></span>
                    {(tokensConv / CONTEXTO * 100).toFixed(tokensConv ? 1 : 0)}%
                  </span>
                  {enviando ? (
                    <button type="button" className="ai-env" data-detener onClick={detener} aria-label="Detener"><Square className="w-4 h-4" fill="currentColor" /></button>
                  ) : (
                    <button type="button" className="ai-env" disabled={!texto.trim() || agotado} onClick={() => void enviar()} aria-label="Enviar">
                      <ArrowUp className="w-5 h-5" />
                    </button>
                  )}
                </div>
              </div>
              <p className="ai-nota">No escribás ni adjuntés cédulas ni documentos de clientes. La IA puede equivocarse: verificá lo importante.</p>
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

function AjustesIA({ onCambio, cupo }: { onCambio: () => void; cupo: Cupo | null }) {
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
  const modulos: Modulos = { inventario: true, facturacion: true, taller: true, errores: true, seguridad: true, finanzas: true, internet: true, enlaces: true, archivos: true, codigo: true, ...(aj.modulos || {}) };
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
