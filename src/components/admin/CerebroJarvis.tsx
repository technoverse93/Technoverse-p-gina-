// =====================================================================
// CEREBRO DE JARVIS — lo que Jarvis sabe, dibujado como una red neuronal
// =====================================================================
// Cada neurona es algo REAL que Jarvis tiene o aprendió:
//   · Memoria      → un recuerdo de jarvis_memoria (lo que le pediste recordar)
//   · Lenguaje     → conversaciones contigo
//   · Aprendizaje  → tus 👍 / 👎 (de ahí saca el estilo que te gusta)
//   · Acciones     → órdenes que ejecutó (chats, taller, inventario, cobros…)
//   · Lóbulos de módulo → consultas que hizo a inventario, ventas, taller…
// Lo reciente brilla más y aparece creciendo; las «sinapsis» son líneas que
// se encienden con pulsos que viajan entre neuronas.
//
// Honestidad: Jarvis no se reentrena (eso pediría un modelo propio). Lo que
// crece es su memoria, lo que aprende de tus valoraciones y lo que usa; el
// dibujo crece exactamente con eso.
//
// Rendimiento (A12): Canvas 2D sin librerías, máximo ~260 neuronas, 30 cps
// en aparatos de ≤4 GB, se detiene si la pestaña no se ve y respeta
// «reducir movimiento».
// =====================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { Brain, RefreshCw } from 'lucide-react';
import { supabase } from '../../supabaseClient';

type Lobulo = { id: string; nombre: string; x: number; y: number; r: number; tono: string };
type Neurona = { x: number; y: number; r: number; lobulo: string; etiqueta: string; t: number; nueva: boolean };
type Datos = {
  recuerdos: { texto: string; tipo: string; creada_en: string }[];
  conversaciones: { titulo: string; actualizado_en: string }[];
  valoraciones: { valoracion: number; creado_en: string }[];
  acciones: { accion: string; estado: string; creada_en: string }[];
  consultas: Record<string, number>;
};

// Posiciones dentro de la silueta (0..1). Forma de cerebro visto de lado.
const LOBULOS: Lobulo[] = [
  { id: 'memoria', nombre: 'Memoria', x: 0.27, y: 0.36, r: 0.15, tono: '--tv-warn' },
  { id: 'lenguaje', nombre: 'Lenguaje', x: 0.45, y: 0.62, r: 0.15, tono: '--accent' },
  { id: 'acciones', nombre: 'Acciones', x: 0.56, y: 0.25, r: 0.13, tono: '--jv-peligro' },
  { id: 'inventario', nombre: 'Inventario', x: 0.70, y: 0.30, r: 0.10, tono: '--jv-actual' },
  { id: 'facturacion', nombre: 'Ventas', x: 0.80, y: 0.47, r: 0.09, tono: '--jv-actual' },
  { id: 'taller', nombre: 'Taller', x: 0.64, y: 0.50, r: 0.09, tono: '--jv-actual' },
  { id: 'seguridad', nombre: 'Seguridad', x: 0.33, y: 0.22, r: 0.09, tono: '--jv-actual' },
  { id: 'finanzas', nombre: 'Finanzas', x: 0.24, y: 0.58, r: 0.08, tono: '--jv-actual' },
  { id: 'aprendizaje', nombre: 'Aprendizaje', x: 0.76, y: 0.72, r: 0.10, tono: '--ok' },
];
const MAX = 260;

/** Número pseudoaleatorio estable por texto: cada neurona siempre cae en el mismo lugar. */
function semilla(texto: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i++) h = Math.imul(h ^ texto.charCodeAt(i), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

function construir(d: Datos) {
  const ahora = Date.now();
  const neuronas: Neurona[] = [];
  const poner = (lobulo: string, etiqueta: string, fecha: string | undefined, clave: string) => {
    const L = LOBULOS.find(l => l.id === lobulo)!;
    const azar = semilla(clave);
    const ang = azar() * Math.PI * 2, dist = Math.sqrt(azar()) * L.r;
    const t = fecha ? new Date(fecha).getTime() : 0;
    neuronas.push({ x: L.x + Math.cos(ang) * dist, y: L.y + Math.sin(ang) * dist * 0.8, r: 1.6 + azar() * 1.6, lobulo, etiqueta, t, nueva: ahora - t < 24 * 3600_000 });
  };
  // Cada lóbulo tiene una neurona «núcleo» aunque esté vacío: el cerebro nunca arranca en blanco.
  for (const L of LOBULOS) poner(L.id, L.nombre, undefined, `nucleo-${L.id}`);
  d.recuerdos.forEach((m, i) => poner('memoria', m.texto, m.creada_en, `m${i}${m.texto}`));
  d.conversaciones.slice(0, 70).forEach((c, i) => poner('lenguaje', c.titulo, c.actualizado_en, `c${i}${c.titulo}`));
  d.valoraciones.slice(0, 50).forEach((v, i) => poner('aprendizaje', v.valoracion > 0 ? 'Te gustó una respuesta' : 'Algo que no te gustó', v.creado_en, `v${i}${v.creado_en}`));
  const NOMBRE_ACC: Record<string, string> = { responder_chat: 'Respondió un chat', cambiar_estado_orden: 'Movió una orden', editar_producto: 'Ajustó inventario', preparar_cobro: 'Cobro', bloquear_acceso: 'Bloqueo', levantar_bloqueo: 'Desbloqueo', cerrar_sesiones: 'Cerró sesiones' };
  d.acciones.filter(a => a.estado === 'ejecutada').slice(0, 50).forEach((a, i) => poner('acciones', NOMBRE_ACC[a.accion] || a.accion, a.creada_en, `a${i}${a.creada_en}`));
  for (const [mod, n] of Object.entries(d.consultas)) {
    if (!LOBULOS.some(l => l.id === mod)) continue;
    for (let i = 0; i < Math.min(30, n); i++) poner(mod, `Consulta de ${LOBULOS.find(l => l.id === mod)!.nombre.toLowerCase()}`, undefined, `q${mod}${i}`);
  }
  const lista = neuronas.slice(0, MAX).sort((a, b) => a.t - b.t);
  // Sinapsis: cada neurona con sus 2 vecinas más cercanas de su lóbulo, y
  // cada núcleo con los núcleos vecinos (los «nervios» entre lóbulos).
  const sinapsis: [number, number][] = [];
  lista.forEach((n, i) => {
    const cerca = lista.map((m, j) => ({ j, d: (m.x - n.x) ** 2 + (m.y - n.y) ** 2, mismo: m.lobulo === n.lobulo }))
      .filter(o => o.j !== i && o.mismo).sort((a, b) => a.d - b.d).slice(0, 2);
    cerca.forEach(o => { if (o.j > i) sinapsis.push([i, o.j]); });
  });
  const nucleos = LOBULOS.map(l => lista.findIndex(n => n.etiqueta === l.nombre && n.lobulo === l.id)).filter(i => i >= 0);
  nucleos.forEach((a, i) => nucleos.slice(i + 1).forEach(b => {
    const d2 = (lista[a].x - lista[b].x) ** 2 + (lista[a].y - lista[b].y) ** 2;
    if (d2 < 0.12) sinapsis.push([a, b]);
  }));
  return { neuronas: lista, sinapsis };
}

export default function CerebroJarvis() {
  const lienzo = useRef<HTMLCanvasElement>(null);
  const caja = useRef<HTMLDivElement>(null);
  const [datos, setDatos] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(false);
  const [foco, setFoco] = useState<Neurona | null>(null);

  const cargar = async () => {
    setCargando(true);
    const vacio = { data: [] as any[] };
    const [rec, conv, val, acc, uso] = await Promise.all([
      supabase.from('jarvis_memoria').select('texto,tipo,creada_en').order('creada_en', { ascending: true }).limit(150).then(r => r, () => vacio),
      supabase.from('ia_conversaciones').select('titulo,actualizado_en').order('actualizado_en', { ascending: false }).limit(70).then(r => r, () => vacio),
      supabase.from('ia_mensajes').select('valoracion,creado_en').not('valoracion', 'is', null).order('creado_en', { ascending: false }).limit(50).then(r => r, () => vacio),
      supabase.from('ia_acciones').select('accion,estado,creada_en').order('creada_en', { ascending: false }).limit(80).then(r => r, () => vacio),
      supabase.from('ia_uso_diario').select('consultas').limit(120).then(r => r, () => vacio),
    ]);
    const consultas: Record<string, number> = {};
    for (const f of (uso.data || []) as any[]) for (const [k, n] of Object.entries(f?.consultas || {})) consultas[k] = (consultas[k] || 0) + Number(n || 0);
    setDatos({
      recuerdos: (rec.data as any[]) || [], conversaciones: (conv.data as any[]) || [],
      valoraciones: (val.data as any[]) || [], acciones: (acc.data as any[]) || [], consultas,
    });
    setCargando(false);
  };
  useEffect(() => { void cargar(); const t = setInterval(() => void cargar(), 60_000); return () => clearInterval(t); }, []);

  const red = useMemo(() => (datos ? construir(datos) : null), [datos]);
  const resumen = useMemo(() => datos && {
    recuerdos: datos.recuerdos.length, conversaciones: datos.conversaciones.length,
    acciones: datos.acciones.filter(a => a.estado === 'ejecutada').length,
    gustos: datos.valoraciones.filter(v => v.valoracion > 0).length,
    consultas: Object.values(datos.consultas).reduce((a: number, b) => a + Number(b), 0),
  }, [datos]);

  useEffect(() => {
    const cv = lienzo.current, cont = caja.current;
    if (!cv || !cont || !red) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const quieto = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const liviano = ((navigator as any).deviceMemory || 8) <= 4;
    const dpr = Math.min(window.devicePixelRatio || 1, liviano ? 1.5 : 2);
    const css = getComputedStyle(cont);
    const color = (v: string) => css.getPropertyValue(v).trim() || '#26A99E';
    const tonos = Object.fromEntries(LOBULOS.map(l => [l.id, color(l.tono)]));
    const tinta = color('--text-muted');
    let W = 0, H = 0;
    const medir = () => {
      W = cont.clientWidth; H = Math.max(200, cont.clientHeight);
      cv.width = W * dpr; cv.height = H * dpr; cv.style.width = `${W}px`; cv.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    medir();
    const ro = new ResizeObserver(medir); ro.observe(cont);
    const P = (n: Neurona) => [n.x * W, n.y * H] as const;
    // Pulsos: viajan por sinapsis al azar; en reposo, unos pocos.
    const pulsos = Array.from({ length: Math.min(40, red.sinapsis.length) }, (_, i) => ({ s: i % Math.max(1, red.sinapsis.length), t: Math.random() }));
    const inicio = performance.now();
    let cuadro = 0, ultimo = 0, vivo = true;
    const dibujar = (ahora: number) => {
      if (!vivo) return;
      cuadro = requestAnimationFrame(dibujar);
      if (document.hidden || (liviano && ahora - ultimo < 33)) return;
      ultimo = ahora;
      const crec = quieto ? 1 : Math.min(1, (ahora - inicio) / 2600);
      const visibles = Math.ceil(red.neuronas.length * crec);
      ctx.clearRect(0, 0, W, H);
      // Silueta del cerebro: dos lóbulos suaves.
      ctx.save();
      ctx.globalAlpha = 0.07; ctx.fillStyle = tonos.lenguaje;
      ctx.beginPath(); ctx.ellipse(W * 0.5, H * 0.45, W * 0.44, H * 0.38, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(W * 0.74, H * 0.74, W * 0.14, H * 0.12, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // Sinapsis.
      ctx.lineWidth = 0.8;
      for (const [a, b] of red.sinapsis) {
        if (a >= visibles || b >= visibles) continue;
        const [x1, y1] = P(red.neuronas[a]), [x2, y2] = P(red.neuronas[b]);
        ctx.strokeStyle = tonos[red.neuronas[a].lobulo]; ctx.globalAlpha = red.neuronas[a].nueva || red.neuronas[b].nueva ? 0.5 : 0.22;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }
      // Pulsos que viajan.
      if (!quieto) for (const p of pulsos) {
        p.t += 0.012; if (p.t > 1) { p.t = 0; p.s = Math.floor(Math.random() * red.sinapsis.length); }
        const sn = red.sinapsis[p.s]; if (!sn || sn[0] >= visibles || sn[1] >= visibles) continue;
        const [x1, y1] = P(red.neuronas[sn[0]]), [x2, y2] = P(red.neuronas[sn[1]]);
        ctx.globalAlpha = Math.sin(p.t * Math.PI); ctx.fillStyle = tonos[red.neuronas[sn[0]].lobulo];
        ctx.beginPath(); ctx.arc(x1 + (x2 - x1) * p.t, y1 + (y2 - y1) * p.t, 2.2, 0, Math.PI * 2); ctx.fill();
      }
      // Neuronas: las nuevas laten.
      for (let i = 0; i < visibles; i++) {
        const n = red.neuronas[i]; const [x, y] = P(n);
        const late = n.nueva && !quieto ? 1 + 0.35 * Math.sin(ahora / 300 + i) : 1;
        ctx.globalAlpha = n.nueva ? 0.95 : 0.75; ctx.fillStyle = tonos[n.lobulo];
        ctx.beginPath(); ctx.arc(x, y, n.r * late, 0, Math.PI * 2); ctx.fill();
        if (n.nueva) { ctx.globalAlpha = 0.18; ctx.beginPath(); ctx.arc(x, y, n.r * 3.2 * late, 0, Math.PI * 2); ctx.fill(); }
      }
      // Nombres de los lóbulos.
      ctx.globalAlpha = 0.9; ctx.fillStyle = tinta; ctx.font = '600 12px system-ui, sans-serif'; ctx.textAlign = 'center';
      for (const L of LOBULOS) ctx.fillText(L.nombre, L.x * W, L.y * H - L.r * H * 0.8 - 6);
      ctx.globalAlpha = 1;
    };
    cuadro = requestAnimationFrame(dibujar);
    const tocar = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top;
      let mejor: Neurona | null = null, d = 18 ** 2;
      for (const n of red.neuronas) { const [nx, ny] = P(n); const dd = (nx - x) ** 2 + (ny - y) ** 2; if (dd < d) { d = dd; mejor = n; } }
      setFoco(mejor);
    };
    cv.addEventListener('pointerdown', tocar);
    return () => { vivo = false; cancelAnimationFrame(cuadro); ro.disconnect(); cv.removeEventListener('pointerdown', tocar); };
  }, [red]);

  return (
    <div className="jv-cerebro">
      <div className="jv-cerebro-cab">
        <span className="ai-herr-ic"><Brain className="w-4 h-4" /></span>
        <div className="jv-cerebro-tt"><b>Cerebro de Jarvis</b><span>Crece con lo que recuerda, lo que usa y lo que le enseñás con 👍 / 👎.</span></div>
        <button type="button" className="ai-chip" onClick={() => void cargar()} disabled={cargando} aria-label="Actualizar"><RefreshCw className={`w-4 h-4 ${cargando ? 'animate-spin' : ''}`} /></button>
      </div>
      <div className="jv-cerebro-lienzo" ref={caja}>
        <canvas ref={lienzo} role="img" aria-label={resumen ? `Red neuronal de Jarvis: ${resumen.recuerdos} recuerdos, ${resumen.conversaciones} conversaciones, ${resumen.acciones} acciones, ${resumen.consultas} consultas.` : 'Cargando el cerebro de Jarvis'} />
        {!datos && <p className="jv-cerebro-vacio">Cargando…</p>}
      </div>
      {foco && <p className="jv-cerebro-foco"><b>{LOBULOS.find(l => l.id === foco.lobulo)?.nombre}</b> · {foco.etiqueta.length > 120 ? foco.etiqueta.slice(0, 117) + '…' : foco.etiqueta}</p>}
      {resumen && (
        <div className="jv-cerebro-cifras">
          <span><b>{resumen.recuerdos}</b> recuerdos</span>
          <span><b>{resumen.conversaciones}</b> conversaciones</span>
          <span><b>{resumen.acciones}</b> acciones hechas</span>
          <span><b>{resumen.consultas}</b> consultas</span>
          <span><b>{resumen.gustos}</b> 👍</span>
        </div>
      )}
      <p className="jv-cerebro-nota">Tocá una neurona para ver qué es. Lo de las últimas 24 horas late. Jarvis no se reentrena: crece su memoria y lo que aprende de vos, y cada neurona es uno de esos datos reales.</p>
    </div>
  );
}
