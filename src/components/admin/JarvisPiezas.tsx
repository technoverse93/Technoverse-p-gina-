// =====================================================================
// JARVIS — piezas del chat del superadmin
// =====================================================================
// · TarjetaAccion: propuesta → confirmar → hecha (y deshacer). La tarjeta
//   no manda la orden: confirma una propuesta que el servidor ya guardó.
// · TarjetaIr: botón para abrir un módulo del panel en una pestaña.
// · GraficoComparado: barras de este período contra el anterior.
// =====================================================================

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Ban, Unlock, LogOut, Timer, KeyRound, Undo2, CircleCheck, CircleX, Clock, ArrowUpRight, BarChart3, Table2, Lock } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { avisarCambioDeBloqueos, avisarCierreDeSesion } from '../../seguridad/killSwitch';

export type OpcionTarjeta =
  | { id: string; tipo: 'elegir'; etiqueta: string; valores: { valor: string; texto: string; ayuda?: string }[]; defecto: string }
  | { id: 'minutos'; tipo: 'duracion'; etiqueta: string; defecto: number | null }
  | { id: 'motivo'; tipo: 'texto'; etiqueta: string; defecto: string };
export interface DatosTarjeta {
  accion: string; modulo: string; icono: 'ban' | 'unlock' | 'log-out'; titulo: string; riesgo: 'reversible' | 'acceso';
  efecto: string; filas: { etiqueta: string; valor: string }[]; opciones: OpcionTarjeta[];
  boton: string; botonSiempre?: string; token: 'nunca' | 'para_siempre'; deshacible: boolean; nota?: string;
}
type Estado = 'propuesta' | 'ejecutando' | 'ejecutada' | 'fallida' | 'cancelada' | 'vencida' | 'deshecha';
interface Fila { id: string; estado: Estado; vence_en: string; tarjeta: DatosTarjeta; opciones?: Record<string, any> | null; resultado?: any; ejecutada_en?: string | null; deshacer_hasta?: string | null }

/** Lo que llegó en vivo (evento «propuesta») se guarda aquí para pintar al instante. */
export const tarjetasVivas = new Map<string, Fila>();

const DURACIONES: [number | null, string][] = [[30, '30 min'], [120, '2 horas'], [1440, '24 horas'], [null, 'Para siempre']];
const ICONO = { ban: Ban, unlock: Unlock, 'log-out': LogOut };
const hora = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' }) : '');

async function llamar(cuerpo: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('asistente-ia', { body: cuerpo });
  if (error && (error as any).context?.json) { try { return await (error as any).context.json(); } catch { /* sin cuerpo */ } }
  return data || { ok: false, error: 'Sin respuesta del servidor.' };
}

export function TarjetaAccion({ id }: { id: string }) {
  const [fila, setFila] = useState<Fila | null>(() => tarjetasVivas.get(id) || null);
  const [elegidas, setElegidas] = useState<Record<string, any>>({});
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [ahora, setAhora] = useState(() => Date.now());

  useEffect(() => {
    let vivo = true;
    void supabase.from('ia_acciones').select('id,estado,vence_en,tarjeta,opciones,resultado,ejecutada_en,deshacer_hasta').eq('id', id).maybeSingle()
      .then(({ data }) => { if (vivo && data) setFila(data as Fila); });
    return () => { vivo = false; };
  }, [id]);
  useEffect(() => {
    if (fila?.estado !== 'propuesta') return;
    const t = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [fila?.estado]);

  if (!fila) return <div className="ai-acc" data-estado="propuesta"><div className="ai-acc-cab"><span className="ai-acc-ic"><Clock className="w-[18px] h-[18px]" /></span><div className="ai-acc-tt"><small>Acción</small><b>Cargando…</b></div></div></div>;
  const t = fila.tarjeta;
  const valor = (o: OpcionTarjeta) => (o.id in elegidas ? elegidas[o.id] : o.defecto);
  const minutos = t.opciones.find(o => o.tipo === 'duracion') ? valor(t.opciones.find(o => o.tipo === 'duracion')!) : undefined;
  const pide = t.token === 'para_siempre' && minutos === null;
  const restante = Math.max(0, new Date(fila.vence_en).getTime() - ahora);
  const vencida = fila.estado === 'propuesta' && restante <= 0;
  const estado: Estado = vencida ? 'vencida' : fila.estado;
  const Icono = estado === 'ejecutada' ? CircleCheck : estado === 'deshecha' ? Undo2 : estado === 'cancelada' || estado === 'fallida' ? CircleX : estado === 'vencida' ? Clock : ICONO[t.icono] || Ban;

  const efectos = async (r: any) => {
    const e: string[] = r?.efectos || [];
    if (e.includes('avisar_bloqueos')) await avisarCambioDeBloqueos();
    if (e.includes('avisar_sesion')) await avisarCierreDeSesion();
  };
  const confirmar = async () => {
    setOcupado(true); setError(null);
    const opciones: Record<string, any> = {};
    for (const o of t.opciones) opciones[o.id] = valor(o);
    const r = await llamar({ accion: 'confirmar', id, opciones, token: pide ? token : undefined });
    setOcupado(false);
    if (!r?.ok) { setError(r?.error || 'No se pudo.'); if (r?.estado && r.estado !== 'propuesta') setFila(f => f && { ...f, estado: r.estado }); return; }
    await efectos(r.resultado);
    setFila(f => f && { ...f, estado: 'ejecutada', opciones: r.opciones, resultado: r.resultado, ejecutada_en: new Date().toISOString(), deshacer_hasta: r.deshacerHasta });
  };
  const cancelar = async () => {
    setOcupado(true); setError(null);
    const r = await llamar({ accion: 'cancelar', id });
    setOcupado(false);
    if (!r?.ok) { setError(r?.error || 'No se pudo.'); return; }
    setFila(f => f && { ...f, estado: 'cancelada' });
  };
  const deshacer = async () => {
    setOcupado(true); setError(null);
    const r = await llamar({ accion: 'deshacer', id });
    setOcupado(false);
    if (!r?.ok) { setError(r?.error || 'No se pudo deshacer.'); return; }
    await efectos(r.resultado);
    setFila(f => f && { ...f, estado: 'deshecha', resultado: { ...(f.resultado || {}), deshecho: r.resultado } });
  };

  const cejilla = estado === 'ejecutada' ? `Ejecutada · ${hora(fila.ejecutada_en)}` : estado === 'deshecha' ? 'Deshecha' : estado === 'cancelada' ? 'Cancelada' : estado === 'vencida' ? 'Vencida' : estado === 'fallida' ? 'Falló' : `Acción propuesta · ${t.modulo}`;
  const chip = estado === 'ejecutada' ? ['hecha', 'Hecho'] : estado === 'propuesta' || estado === 'ejecutando' ? [t.riesgo === 'acceso' ? 'acceso' : 'bajo', t.riesgo === 'acceso' ? 'Cambia el acceso' : 'Reversible'] : ['neutro', estado === 'deshecha' ? 'Revertido' : 'Sin cambios'];
  const puedeDeshacer = estado === 'ejecutada' && t.deshacible && !!fila.deshacer_hasta && new Date(fila.deshacer_hasta).getTime() > ahora;
  const textoFinal = estado === 'ejecutada' ? fila.resultado?.detalle : estado === 'deshecha' ? fila.resultado?.deshecho?.detalle || 'Se revirtió.'
    : estado === 'cancelada' ? 'No se hizo nada.' : estado === 'vencida' ? 'Venció sin confirmarse. No se hizo nada; pedímela de nuevo si hace falta.' : estado === 'fallida' ? (fila.resultado?.detalle || 'No se pudo ejecutar.') : null;
  const s = Math.ceil(restante / 1000);

  return (
    <div className="ai-acc" data-estado={estado === 'ejecutada' ? 'hecha' : estado} data-riesgo={t.riesgo === 'acceso' ? 'acceso' : 'bajo'}>
      <div className="ai-acc-cab">
        <span className="ai-acc-ic"><Icono className="w-[18px] h-[18px]" /></span>
        <div className="ai-acc-tt"><small>{cejilla}</small><b>{t.titulo}</b></div>
        <span className="ai-acc-chip" data-t={chip[0]}>{chip[1]}</span>
      </div>
      {(estado === 'propuesta' || estado === 'ejecutando') && (
        <>
          <dl className="ai-acc-dl">
            <div><dt>Qué pasa</dt><dd>{t.efecto}</dd></div>
            {t.filas.map(f => <div key={f.etiqueta}><dt>{f.etiqueta}</dt><dd>{f.valor}</dd></div>)}
            {t.opciones.map(o => (
              <div key={o.id}>
                <dt>{o.etiqueta}</dt>
                <dd>
                  {o.tipo === 'elegir' && (
                    <>
                      <div className="ai-acc-opc" role="group" aria-label={o.etiqueta}>
                        {o.valores.map(v => (
                          <button key={v.valor} type="button" className="ai-acc-dur" aria-pressed={valor(o) === v.valor} onClick={() => setElegidas(e => ({ ...e, [o.id]: v.valor }))}>{v.texto}</button>
                        ))}
                      </div>
                      {o.valores.find(v => v.valor === valor(o))?.ayuda && (
                        <span className="ai-acc-priv"><Lock className="w-3 h-3" />{o.valores.find(v => v.valor === valor(o))!.ayuda}</span>
                      )}
                    </>
                  )}
                  {o.tipo === 'duracion' && (
                    <div className="ai-acc-opc" role="group" aria-label="Duración">
                      {DURACIONES.map(([m, txt]) => (
                        <button key={String(m)} type="button" className="ai-acc-dur" aria-pressed={valor(o) === m} onClick={() => setElegidas(e => ({ ...e, minutos: m }))}>{txt}</button>
                      ))}
                    </div>
                  )}
                  {o.tipo === 'texto' && (
                    <input className="glass-input w-full rounded-lg px-3 py-2 text-[13px]" value={valor(o)} maxLength={120} aria-label={o.etiqueta}
                      onChange={e => setElegidas(x => ({ ...x, [o.id]: e.target.value }))} />
                  )}
                </dd>
              </div>
            ))}
          </dl>
          {pide && (
            <div className="ai-acc-token">
              <label htmlFor={`tok-${id}`}><KeyRound className="w-4 h-4" />Token de seguridad</label>
              <input id={`tok-${id}`} className="glass-input rounded-lg px-3 py-2 text-[13px]" type="password" inputMode="numeric" maxLength={4} autoComplete="off" placeholder="••••"
                value={token} onChange={e => setToken(e.target.value.replace(/\D/g, '').slice(0, 4))} />
              <span>«Para siempre» lo pide.</span>
            </div>
          )}
          {error && <p className="ai-acc-error" role="alert">{error}</p>}
          <div className="ai-acc-pie">
            <span className="ai-acc-meta"><Timer className="w-3.5 h-3.5" /><span className="jv-vence">Vence en {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}</span><span>· {t.nota || (t.deshacible ? 'Queda en la bitácora. Se puede deshacer.' : 'Queda en la bitácora.')}</span></span>
            <button type="button" className="ai-chip" onClick={() => void cancelar()} disabled={ocupado}>Cancelar</button>
            <button type="button" className="ai-acc-ok" data-tono={t.riesgo === 'acceso' ? 'peligro' : 'normal'} disabled={ocupado || (pide && token.length !== 4)} onClick={() => void confirmar()}>
              {ocupado ? <span className="ai-giro" aria-hidden="true" /> : React.createElement(ICONO[t.icono] || Ban, { className: 'w-4 h-4' })}
              <span>{ocupado ? 'Trabajando…' : pide && t.botonSiempre ? t.botonSiempre : t.boton}</span>
            </button>
          </div>
        </>
      )}
      {textoFinal && (
        <div className="ai-acc-hecho">
          <span>{textoFinal}</span>
          {puedeDeshacer && <button type="button" className="ai-chip" onClick={() => void deshacer()} disabled={ocupado}><Undo2 className="w-4 h-4" />Deshacer</button>}
          {error && <p className="ai-acc-error" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}

export function TarjetaIr({ titulo, destino, onAbrir }: { titulo: string; destino: string; onAbrir?: (m: string) => void }) {
  return (
    <div className="ai-ir">
      <span className="ai-herr-ic"><ArrowUpRight className="w-4 h-4" /></span>
      <span className="ai-ir-tx"><b>{titulo}</b>Se abre en una pestaña del panel.</span>
      <button type="button" className="tv-btn" data-variant="primary" onClick={() => onAbrir?.(destino)} disabled={!onAbrir}>
        <ArrowUpRight className="w-4 h-4" /><span className="tv-btn-label">Abrir pestaña</span>
      </button>
    </div>
  );
}

export interface Grafico { titulo: string; subtitulo: string; etiquetas: string[]; fechas: string[]; fechasAnt: string[]; series: { nombre: string; valores: number[] }[] }
const colones = (n: number) => '₡' + Math.round(n).toLocaleString('es-CR');
const pct = (a: number, b: number) => (b ? `${a >= b ? '+' : '−'}${Math.abs((a / b - 1) * 100).toFixed(0)} %` : '—');

/** Barras agrupadas: este período (acento) contra el anterior (gris de contexto). */
export function GraficoComparado({ g }: { g: Grafico }) {
  const lienzo = useRef<HTMLDivElement>(null);
  const [ancho, setAncho] = useState(300);
  const [foco, setFoco] = useState<number | null>(null);
  const [tabla, setTabla] = useState(false);
  useEffect(() => {
    const el = lienzo.current; if (!el) return;
    const medir = () => setAncho(Math.max(240, Math.floor(el.clientWidth - 12)));
    medir();
    const ro = new ResizeObserver(medir); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [act, ant] = [g.series[0]?.valores || [], g.series[1]?.valores || []];
  const n = act.length;
  const H = 196, m = { l: 60, r: 8, t: 24, b: 28 };
  const iw = ancho - m.l - m.r, ih = H - m.t - m.b;
  const maximo = Math.max(1, ...act, ...ant);
  const paso = maximo > 400000 ? Math.ceil(maximo / 4 / 100000) * 100000 : maximo > 40000 ? Math.ceil(maximo / 4 / 10000) * 10000 : Math.ceil(maximo / 4 / 1000) * 1000;
  const tope = paso * Math.ceil(maximo / paso);
  const y = (v: number) => m.t + ih - (v / tope) * ih;
  const banda = iw / Math.max(1, n), bw = Math.max(3, Math.min(16, (banda - 8) / 2));
  const imax = act.indexOf(Math.max(...act));
  const marcas = useMemo(() => { const r: number[] = []; for (let v = 0; v <= tope; v += paso) r.push(v); return r; }, [tope, paso]);
  const etiq = (v: number) => (v === 0 ? '0' : v >= 1000 ? `${Math.round(v / 1000)} mil` : String(v));
  const barra = (x: number, v: number, token: string) => {
    const top = y(v), base = m.t + ih, r = Math.min(4, bw / 2, base - top);
    return <path className="g-barra" d={`M${x},${base} L${x},${top + r} Q${x},${top} ${x + r},${top} L${x + bw - r},${top} Q${x + bw},${top} ${x + bw},${top + r} L${x + bw},${base} Z`} style={{ fill: `var(${token})` }} />;
  };
  const tA = act.reduce((t, v) => t + v, 0), tB = ant.reduce((t, v) => t + v, 0);
  return (
    <div className="ai-graf">
      <div className="ai-graf-cab"><span className="ai-herr-ic"><BarChart3 className="w-4 h-4" /></span><div className="ai-graf-tt"><b>{g.titulo}</b><span>{g.subtitulo}</span></div></div>
      <div className="ai-graf-ley">
        <span><i style={{ background: 'var(--jv-actual)' }} />{g.series[0]?.nombre} <b>{colones(tA)}</b></span>
        <span><i style={{ background: 'var(--jv-anterior)' }} />{g.series[1]?.nombre} <b>{colones(tB)}</b></span>
      </div>
      <div className="ai-graf-lienzo" ref={lienzo} data-foco={foco !== null || undefined} onPointerLeave={() => setFoco(null)}>
        <svg width={ancho} height={H} viewBox={`0 0 ${ancho} ${H}`} aria-hidden="true">
          {marcas.map(v => (
            <g key={v}>
              <line x1={m.l} x2={ancho - m.r} y1={Math.round(y(v)) + 0.5} y2={Math.round(y(v)) + 0.5} style={{ stroke: v === 0 ? 'var(--border-color)' : 'var(--border-soft)' }} strokeWidth={1} />
              <text x={m.l - 8} y={Math.round(y(v)) + 4} textAnchor="end" style={{ fill: 'var(--text-muted)', font: '500 12px var(--font-sans,system-ui)', fontVariantNumeric: 'tabular-nums' }}>{etiq(v)}</text>
            </g>
          ))}
          {act.map((v, i) => {
            const cx = m.l + i * banda + banda / 2;
            const mostrarEtiq = n <= 14 || i % Math.ceil(n / 10) === 0;
            return (
              <g key={i} className="g-dia" tabIndex={0} data-on={foco === i || undefined} onPointerEnter={() => setFoco(i)} onFocus={() => setFoco(i)} onClick={() => setFoco(i)}
                aria-label={`${g.fechas[i]}: ${colones(v)}; anterior ${colones(ant[i] || 0)}`}>
                <rect className="g-hit" x={m.l + i * banda + 1} y={m.t - 18} width={Math.max(1, banda - 2)} height={ih + 18} rx={6} style={{ fill: 'transparent' }} />
                {barra(cx - bw - 1, ant[i] || 0, '--jv-anterior')}
                {barra(cx + 1, v, '--jv-actual')}
                {mostrarEtiq && <text x={cx} y={H - 8} textAnchor="middle" style={{ fill: 'var(--text-muted)', font: '500 12px var(--font-sans,system-ui)' }}>{g.etiquetas[i]}</text>}
              </g>
            );
          })}
          {tA > 0 && <text x={m.l + imax * banda + banda / 2 + 1 + bw / 2} y={y(act[imax]) - 7} textAnchor="middle" style={{ fill: 'var(--text-secondary)', font: '600 12px var(--font-sans,system-ui)' }}>{etiq(act[imax])}</text>}
        </svg>
        {foco !== null && (
          <div className="ai-gtip" style={{ left: Math.max(4, Math.min(ancho - 176, m.l + foco * banda + banda / 2 - 84)), top: 0 }}>
            <strong>{g.fechas[foco]}</strong>
            <div><i style={{ background: 'var(--jv-actual)' }} />{g.series[0]?.nombre}<b>{colones(act[foco] || 0)}</b></div>
            <div><i style={{ background: 'var(--jv-anterior)' }} />{g.fechasAnt[foco]}<b>{colones(ant[foco] || 0)}</b></div>
            <div>Diferencia<b>{pct(act[foco] || 0, ant[foco] || 0)}</b></div>
          </div>
        )}
      </div>
      {tabla && (
        <div className="ai-graf-tabla">
          <div className="ai-tabla"><table>
            <thead><tr><th>Día</th><th>{g.series[0]?.nombre}</th><th>{g.series[1]?.nombre}</th><th>Dif.</th></tr></thead>
            <tbody>{act.map((v, i) => <tr key={i}><td>{g.fechas[i]}</td><td>{colones(v)}</td><td>{colones(ant[i] || 0)}</td><td>{pct(v, ant[i] || 0)}</td></tr>)}</tbody>
          </table></div>
        </div>
      )}
      <div className="ai-graf-pie">
        <button type="button" className="ai-chip" aria-expanded={tabla} onClick={() => setTabla(v => !v)}><Table2 className="w-4 h-4" />{tabla ? 'Ocultar tabla' : 'Ver tabla'}</button>
      </div>
    </div>
  );
}
