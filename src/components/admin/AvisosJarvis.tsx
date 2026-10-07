// =====================================================================
// AVISOS DE JARVIS — lo que Jarvis te dijo sin que le preguntaras
// =====================================================================
// La campana de Jarvis: el resumen de la mañana arriba (con «Escuchar»), y
// después los avisos (chats esperando, existencias, seguridad, taller,
// ventas). Cada uno lleva al módulo que corresponde y se marca como leído.
// Llegan en vivo (src/mobile/avisosJarvis.ts).
// =====================================================================

import { useEffect, useMemo, useState } from 'react';
import { Bell, MessageSquare, Package, ShieldAlert, Wrench, TrendingDown, Sun, Volume2, ArrowUpRight, Check, RefreshCw } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { cargarAvisos, marcarLeidos, EVENTO_AVISO, type AvisoJarvis } from '../../mobile/avisosJarvis';
import { lector } from '../../utils/lectorVoz';

const ICONO: Record<string, LucideIcon> = { resumen: Sun, chat: MessageSquare, stock: Package, seguridad: ShieldAlert, taller: Wrench, ventas: TrendingDown };
const hace = (f: string) => {
  const m = Math.max(1, Math.round((Date.now() - new Date(f).getTime()) / 60_000));
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60); if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24); return d === 1 ? 'ayer' : `hace ${d} días`;
};

export default function AvisosJarvis({ onAbrir }: { onAbrir?: (modulo: string) => void }) {
  const [avisos, setAvisos] = useState<AvisoJarvis[] | null>(null);
  const [pidiendo, setPidiendo] = useState(false);
  const [error, setError] = useState('');
  const recargar = () => void cargarAvisos().then(setAvisos);
  useEffect(() => {
    recargar();
    const al = (e: Event) => { const a = (e as CustomEvent<AvisoJarvis>).detail; if (a) setAvisos(l => [a, ...(l || []).filter(x => x.id !== a.id)]); };
    window.addEventListener(EVENTO_AVISO, al);
    return () => window.removeEventListener(EVENTO_AVISO, al);
  }, []);
  const marcar = async (ids: string[]) => {
    await marcarLeidos(ids);
    const ahora = new Date().toISOString();
    setAvisos(l => (l || []).map(a => (ids.includes(a.id) ? { ...a, leido_en: ahora } : a)));
    window.dispatchEvent(new Event('jarvis-avisos-leidos'));
  };
  const resumenAhora = async () => {
    setPidiendo(true); setError('');
    const { data, error: e } = await supabase.functions.invoke('asistente-ia', { body: { accion: 'proactivo', tarea: 'resumen' } });
    setPidiendo(false);
    if (e || !data?.ok) { setError('No se pudo armar el resumen ahora. Probá de nuevo en un momento.'); return; }
    recargar();
  };
  const resumen = useMemo(() => (avisos || []).find(a => a.tipo === 'resumen') || null, [avisos]);
  const resto = useMemo(() => (avisos || []).filter(a => a !== resumen), [avisos, resumen]);
  const sinLeer = resto.filter(a => !a.leido_en);

  return (
    <div className="ai-ajustes jv-avisos">
      <div className="ai-aj">
        <h4>Resumen de la mañana <small>todos los días 7:00</small></h4>
        {resumen ? (
          <article className="jv-aviso" data-tipo="resumen" data-leido={resumen.leido_en ? '' : undefined}>
            <span className="jv-aviso-ic"><Sun className="w-4 h-4" /></span>
            <div className="jv-aviso-tx">
              <b>{resumen.titulo}</b>
              <p>{resumen.cuerpo}</p>
              <span className="jv-aviso-pie">{hace(resumen.creado_en)}</span>
              <div className="jv-aviso-botones">
                <button type="button" className="ai-chip" onClick={() => { void lector.hablar(resumen.cuerpo, `aviso-${resumen.id}`); if (!resumen.leido_en) void marcar([resumen.id]); }}><Volume2 className="w-4 h-4" />Escuchar</button>
                <button type="button" className="ai-chip" disabled={pidiendo} onClick={() => void resumenAhora()}><RefreshCw className="w-4 h-4" />{pidiendo ? 'Armando…' : 'Otro ahora'}</button>
              </div>
            </div>
          </article>
        ) : (
          <div className="jv-aviso-vacio">
            <p>Todavía no hay resumen de hoy. Llega solo a las 7:00, o pedilo ya.</p>
            <button type="button" className="ai-chip" disabled={pidiendo} onClick={() => void resumenAhora()}><Sun className="w-4 h-4" />{pidiendo ? 'Armando…' : 'Resumen ahora'}</button>
          </div>
        )}
        {error && <p className="ai-voz-error" role="alert">{error}</p>}
      </div>

      <div className="ai-aj">
        <h4>Avisos <small>Jarvis vigila cada 15 min</small></h4>
        {sinLeer.length > 1 && <button type="button" className="ai-chip jv-avisos-todos" onClick={() => void marcar(sinLeer.map(a => a.id))}><Check className="w-4 h-4" />Marcar todo como visto</button>}
        {avisos === null ? <div className="ai-esqueleto" aria-label="Cargando"><i /><i /></div>
          : !resto.length ? <p className="jv-aviso-vacio">Todo en orden: nada que avisar. Cuando un cliente espere, algo se agote o haya un ingreso raro, te aviso aquí y en el teléfono.</p>
            : resto.map(a => {
              const Ic = ICONO[a.tipo] || Bell;
              return (
                <article key={a.id} className="jv-aviso" data-nivel={a.nivel} data-leido={a.leido_en ? '' : undefined}>
                  <span className="jv-aviso-ic"><Ic className="w-4 h-4" /></span>
                  <div className="jv-aviso-tx">
                    <b>{a.titulo}</b>
                    <p>{a.cuerpo}</p>
                    <span className="jv-aviso-pie">{hace(a.creado_en)}{a.leido_en ? ' · visto' : ''}</span>
                    <div className="jv-aviso-botones">
                      {a.destino && onAbrir && <button type="button" className="ai-chip" onClick={() => { void marcar([a.id]); onAbrir(a.destino!); }}><ArrowUpRight className="w-4 h-4" />Ir</button>}
                      {!a.leido_en && <button type="button" className="ai-chip" onClick={() => void marcar([a.id])}><Check className="w-4 h-4" />Visto</button>}
                    </div>
                  </div>
                </article>
              );
            })}
      </div>
    </div>
  );
}
