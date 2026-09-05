// =====================================================================
// KILL SWITCH · panel del Superadmin
// =====================================================================
// Bloquear a alguien y liberarlo, en el acto y sin que la otra punta
// recargue nada. Tres formas de bloquear:
//
//   · Cuenta (correo)  — esa persona, en cualquier aparato.
//   · Dirección IP     — esa conexión. La IP la lee el SERVIDOR de la
//                        cabecera del proxy, así que no se puede falsear
//                        desde el navegador.
//   · Modelo de aparato— todos los equipos de ese modelo a la vez.
//
// Al guardar o liberar se manda un aviso por el canal común `system_bans`
// y cada cliente reconsulta SU propio estado. El aviso va vacío: la lista
// de bloqueados nunca sale de aquí.
//
// Honestidad: la pantalla de bloqueo es una barrera de interfaz. Detiene
// el uso normal —que es el caso real— pero la barrera de verdad sigue
// siendo la RLS de cada tabla. Y el bloqueo por modelo se apoya en lo que
// declara el propio aparato, así que disuade sin ser infalsificable.
// =====================================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Ban, ShieldOff, RefreshCw, Mail, Globe, Smartphone, TriangleAlert } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { avisarCambioDeBloqueos } from '../../seguridad/killSwitch';

interface Bloqueo {
  id: number;
  tipo: 'email' | 'ip' | 'modelo';
  valor: string;
  motivo: string | null;
  hasta: string | null;
  activo: boolean;
  created_at: string;
}

const TIPOS: { id: Bloqueo['tipo']; etiqueta: string; pista: string; icono: typeof Mail }[] = [
  { id: 'email', etiqueta: 'Cuenta', pista: 'persona@correo.com', icono: Mail },
  { id: 'ip', etiqueta: 'Dirección IP', pista: '190.x.x.x', icono: Globe },
  { id: 'modelo', etiqueta: 'Modelo', pista: 'Honor Pad SE', icono: Smartphone },
];

/** Duraciones ofrecidas. `null` = para siempre. */
const DURACIONES: { etiqueta: string; minutos: number | null }[] = [
  { etiqueta: '30 min', minutos: 30 },
  { etiqueta: '2 horas', minutos: 120 },
  { etiqueta: '24 horas', minutos: 1440 },
  { etiqueta: 'Para siempre', minutos: null },
];

export default function ConsolaBloqueos() {
  const [lista, setLista] = useState<Bloqueo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const [tipo, setTipo] = useState<Bloqueo['tipo']>('email');
  const [valor, setValor] = useState('');
  const [motivo, setMotivo] = useState('');
  const [minutos, setMinutos] = useState<number | null>(30);

  const montado = useRef(true);
  useEffect(() => { montado.current = true; return () => { montado.current = false; }; }, []);

  const cargar = useCallback(async () => {
    setCargando(true);
    const { data, error } = await supabase
      .from('system_bans')
      .select('id, tipo, valor, motivo, hasta, activo, created_at')
      .eq('activo', true)
      .order('created_at', { ascending: false })
      .limit(200);
    if (!montado.current) return;
    if (error) setError(error.message);
    else { setError(null); setLista((data as Bloqueo[]) || []); }
    setCargando(false);
  }, []);

  useEffect(() => {
    void cargar();
    const canal = supabase
      .channel('system-bans-panel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'system_bans' }, () => void cargar())
      .subscribe();
    return () => { supabase.removeChannel(canal); };
  }, [cargar]);

  const bloquear = async () => {
    const limpio = valor.trim();
    if (!limpio) return;
    setGuardando(true);
    const hasta = minutos === null ? null : new Date(Date.now() + minutos * 60000).toISOString();
    const { error } = await supabase.from('system_bans').insert({
      tipo, valor: limpio, motivo: motivo.trim() || null, hasta,
    });
    if (!montado.current) return;
    setGuardando(false);
    if (error) { setError(error.message); return; }
    setError(null);
    setValor(''); setMotivo('');
    await cargar();
    // El golpe: todos reconsultan su estado en el acto.
    await avisarCambioDeBloqueos();
  };

  const liberar = async (b: Bloqueo) => {
    setGuardando(true);
    const { error } = await supabase.from('system_bans').update({ activo: false }).eq('id', b.id);
    if (!montado.current) return;
    setGuardando(false);
    if (error) { setError(error.message); return; }
    setError(null);
    await cargar();
    await avisarCambioDeBloqueos();
  };

  const porTipo = useMemo(() => {
    const m: Record<string, Bloqueo[]> = { email: [], ip: [], modelo: [] };
    for (const b of lista) (m[b.tipo] ||= []).push(b);
    return m;
  }, [lista]);

  const vigencia = (b: Bloqueo) => {
    if (!b.hasta) return 'Para siempre';
    const f = new Date(b.hasta);
    return `Hasta ${f.toLocaleDateString('es-CR')} ${f.toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' })}`;
  };

  return (
    <div className="tv-stack">
      {/* Encabezado */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
               style={{ background: 'rgba(229,72,77,0.12)', color: '#e5484d' }}>
            <Ban className="w-[18px] h-[18px]" />
          </div>
          <div>
            <h2 className="font-display font-bold text-[15px] text-[var(--text-primary)] leading-tight">Bloqueos</h2>
            <p className="text-[11.5px] text-[var(--text-secondary)]">Expulsión inmediata, sin que la otra punta recargue.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-[var(--text-secondary)]">
            <b className="text-[var(--text-primary)]">{lista.length}</b> activos
          </span>
          <button
            type="button" onClick={() => void cargar()}
            className="w-8 h-8 rounded-lg flex items-center justify-center border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition"
            aria-label="Recargar"
          >
            <RefreshCw className={`w-4 h-4 ${cargando ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Formulario de bloqueo */}
      <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-4 flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5">
          {TIPOS.map(t => {
            const Icono = t.icono;
            const sel = t.id === tipo;
            return (
              <button
                key={t.id} type="button" onClick={() => setTipo(t.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition ${
                  sel
                    ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                    : 'border-[var(--border-color)] bg-[var(--bg-sunken)] text-[var(--text-secondary)]'
                }`}
              >
                <Icono className="w-3.5 h-3.5" /> {t.etiqueta}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <input
            value={valor} onChange={e => setValor(e.target.value)}
            placeholder={TIPOS.find(t => t.id === tipo)!.pista}
            className="glass-input w-full rounded-lg px-3 py-2 text-[13px] font-mono"
          />
          <input
            value={motivo} onChange={e => setMotivo(e.target.value)}
            placeholder="Motivo (opcional)"
            className="glass-input w-full rounded-lg px-3 py-2 text-[13px]"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {DURACIONES.map(d => {
            const sel = d.minutos === minutos;
            return (
              <button
                key={d.etiqueta} type="button" onClick={() => setMinutos(d.minutos)}
                className={`px-2.5 py-1 rounded-lg text-[11.5px] font-semibold border transition ${
                  sel
                    ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                    : 'border-[var(--border-color)] bg-[var(--bg-sunken)] text-[var(--text-secondary)]'
                }`}
              >
                {d.etiqueta}
              </button>
            );
          })}
          <button
            type="button" onClick={() => void bloquear()}
            disabled={guardando || !valor.trim()}
            className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12.5px] font-bold text-white transition disabled:opacity-45"
            style={{ background: '#e5484d' }}
          >
            <Ban className="w-4 h-4" /> Bloquear ahora
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-4 text-[13px] text-[var(--text-secondary)]">
          No se pudo completar. Detalle: {error}
        </div>
      )}

      {/* Lista de bloqueos vigentes */}
      {lista.length === 0 && !cargando ? (
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-8 text-center text-[13px] text-[var(--text-muted)]">
          No hay nadie bloqueado.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {TIPOS.map(t => {
            const filas = porTipo[t.id] || [];
            if (filas.length === 0) return null;
            const Icono = t.icono;
            return (
              <div key={t.id} className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-surface)] overflow-hidden">
                <div className="px-4 py-2 bg-[var(--bg-sunken)] border-b border-[var(--border-color)] flex items-center gap-2">
                  <Icono className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                  <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--text-muted)]">{t.etiqueta}</span>
                </div>
                {filas.map(b => (
                  <div key={b.id} className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border-color)]/60 last:border-b-0">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-mono text-[var(--text-primary)] truncate">{b.valor}</div>
                      <div className="text-[11px] text-[var(--text-secondary)] truncate">
                        {vigencia(b)}{b.motivo ? ` · ${b.motivo}` : ''}
                      </div>
                    </div>
                    <button
                      type="button" onClick={() => void liberar(b)} disabled={guardando}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11.5px] font-semibold border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--ok)] hover:border-[var(--ok)] transition disabled:opacity-50 shrink-0"
                    >
                      <ShieldOff className="w-3.5 h-3.5" /> Liberar
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* Honestidad técnica */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-4 flex gap-3"
           style={{ borderLeft: '2px solid #e5a23d' }}>
        <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" style={{ color: '#e5a23d' }} />
        <div className="text-[12.5px] text-[var(--text-secondary)] leading-relaxed min-w-0">
          El bloqueo tapa la pantalla al instante y detiene el uso normal, que es el caso real.
          Pero es una barrera de <b className="text-[var(--text-primary)]">interfaz</b>: la de verdad sigue siendo
          la RLS de cada tabla, que ya niega los datos aunque alguien quitara la capa.
          El bloqueo por <b className="text-[var(--text-primary)]">modelo</b> se apoya en lo que declara el propio
          aparato, así que disuade sin ser infalsificable. La <b className="text-[var(--text-primary)]">IP</b> sí la
          lee el servidor, y esa no se puede falsear desde el navegador.
        </div>
      </div>
    </div>
  );
}
