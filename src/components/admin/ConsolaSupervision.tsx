// =====================================================================
// CONSOLA DE SUPERVISIÓN (Zero Trust · Etapa 3)
// =====================================================================
// El "espejo virtual": lista quién está en línea y, al elegir a alguien,
// reproduce su pantalla en vivo con rrweb. Exclusiva del Superadmin (RLS +
// gate en AdminPanel).
//
// Flujo: al elegir a un empleado se pone `watch = true` en su fila. Eso le
// dice a SU cliente que empiece a grabar (ver grabador.ts); los lotes
// llegan por Realtime y alimentan un Replayer en modo vivo. Al soltarlo se
// pone `watch = false` y su cliente para y borra sus lotes.
// =====================================================================

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MonitorPlay, Smartphone, Monitor, RefreshCw, Radio } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { soloHora } from '../chat/formatoChat';

interface Presencia {
  user_id: string;
  email: string | null;
  ruta: string | null;
  entorno: string | null;
  last_seen: string;
  watch: boolean;
}

const ONLINE_MS = 40000;

export default function ConsolaSupervision() {
  const [gente, setGente] = useState<Presencia[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [estado, setEstado] = useState<'idle' | 'esperando' | 'vivo'>('idle');

  const lienzoRef = useRef<HTMLDivElement>(null);
  const replayerRef = useRef<any>(null);
  const iniciandoRef = useRef(false);
  const colaRef = useRef<any[]>([]);
  const canalEventosRef = useRef<any>(null);
  const selRef = useRef<string | null>(null);
  selRef.current = sel;

  // --------------------------- Presencia ---------------------------
  const cargar = useCallback(async () => {
    const { data } = await supabase
      .from('supervision_state')
      .select('user_id, email, ruta, entorno, last_seen, watch')
      .order('last_seen', { ascending: false });
    setGente((data as Presencia[]) || []);
  }, []);

  useEffect(() => {
    cargar();
    const canal = supabase
      .channel('supervision-presencia')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'supervision_state' }, () => cargar())
      .subscribe();
    const t = setInterval(cargar, 12000);
    return () => { supabase.removeChannel(canal); clearInterval(t); };
  }, [cargar]);

  const enLinea = (p: Presencia) => Date.now() - new Date(p.last_seen).getTime() < ONLINE_MS;

  // --------------------------- Escala del espejo ---------------------------
  const ajustarEscala = useCallback((w: number, h: number) => {
    const cont = lienzoRef.current;
    if (!cont || !w || !h) return;
    const escala = Math.min(1, cont.clientWidth / w);
    const wrap = cont.querySelector('.replayer-wrapper') as HTMLElement | null;
    if (wrap) {
      wrap.style.transform = `scale(${escala})`;
      wrap.style.transformOrigin = 'top left';
    }
    cont.style.height = `${Math.round(h * escala)}px`;
  }, []);

  // --------------------------- Reproductor ---------------------------
  const destruirReplayer = useCallback(() => {
    try { replayerRef.current?.pause?.(); } catch { /* nada */ }
    replayerRef.current = null;
    colaRef.current = [];
    if (lienzoRef.current) lienzoRef.current.innerHTML = '';
  }, []);

  const manejarLote = useCallback(async (lote: any[]) => {
    if (!Array.isArray(lote) || lote.length === 0) return;
    if (replayerRef.current) {
      lote.forEach(ev => replayerRef.current.addEvent(ev));
      return;
    }
    // Aún no hay reproductor: el primer lote trae la foto completa. Si ya
    // estamos creándolo, encolamos para no perder eventos.
    if (iniciandoRef.current) { colaRef.current.push(...lote); return; }
    iniciandoRef.current = true;
    try {
      const { Replayer } = await import('rrweb');
      if (!lienzoRef.current) { iniciandoRef.current = false; return; }
      lienzoRef.current.innerHTML = '';
      const r = new Replayer(lote, {
        root: lienzoRef.current,
        liveMode: true,
        mouseTail: false,
        speed: 1,
      });
      r.on('resize', (e: any) => ajustarEscala(e?.width, e?.height));
      r.startLive();
      replayerRef.current = r;
      // vacía lo que llegó mientras se creaba
      colaRef.current.forEach(ev => r.addEvent(ev));
      colaRef.current = [];
      setEstado('vivo');
    } catch {
      /* si rrweb no cargó, se queda en "esperando" */
    } finally {
      iniciandoRef.current = false;
    }
  }, [ajustarEscala]);

  const soltar = useCallback(async (userId: string | null) => {
    if (canalEventosRef.current) { try { supabase.removeChannel(canalEventosRef.current); } catch { /* nada */ } canalEventosRef.current = null; }
    destruirReplayer();
    if (userId) { try { await supabase.from('supervision_state').update({ watch: false }).eq('user_id', userId); } catch { /* nada */ } }
  }, [destruirReplayer]);

  const mirar = useCallback(async (userId: string) => {
    if (sel === userId) { await soltar(userId); setSel(null); setEstado('idle'); return; }
    await soltar(sel);
    setSel(userId);
    setEstado('esperando');
    try { await supabase.from('supervision_state').update({ watch: true }).eq('user_id', userId); } catch { /* nada */ }
    const canal = supabase
      .channel(`supervision-ev-${userId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'supervision_events', filter: `user_id=eq.${userId}` },
        (payload: any) => { if (selRef.current === userId) void manejarLote(payload?.new?.lote || []); })
      .subscribe();
    canalEventosRef.current = canal;
  }, [sel, soltar, manejarLote]);

  // Al desmontar, suelta a quien se esté mirando (para su grabación).
  useEffect(() => () => { void soltar(selRef.current); }, [soltar]);

  const seleccionado = gente.find(p => p.user_id === sel) || null;

  return (
    <div className="tv-stack">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-[var(--accent)]/12 text-[var(--accent)] flex items-center justify-center shrink-0">
            <MonitorPlay className="w-[18px] h-[18px]" />
          </div>
          <div>
            <h2 className="font-display font-bold text-[15px] text-[var(--text-primary)] leading-tight">Supervisión</h2>
            <p className="text-[11.5px] text-[var(--text-secondary)]">Espejo en vivo de la sesión del personal.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={cargar}
          className="w-8 h-8 rounded-lg flex items-center justify-center border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition"
          aria-label="Recargar"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-4">
        {/* Selector de personal conectado */}
        <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-surface)] overflow-hidden">
          <div className="px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-sunken)]">
            <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--text-muted)]">Conectados</span>
          </div>
          {gente.filter(enLinea).length === 0 ? (
            <p className="text-[12px] text-[var(--text-muted)] italic px-3 py-6 text-center">Nadie del personal en línea.</p>
          ) : (
            gente.filter(enLinea).map(p => {
              const esApk = p.entorno === 'apk';
              const activo = p.user_id === sel;
              return (
                <button
                  key={p.user_id}
                  type="button"
                  onClick={() => void mirar(p.user_id)}
                  className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 border-b border-[var(--border-color)]/50 last:border-b-0 transition ${
                    activo ? 'bg-[var(--accent)]/10' : 'hover:bg-[var(--bg-sunken)]'
                  }`}
                >
                  <span className="relative shrink-0">
                    <span className="w-8 h-8 rounded-full bg-[rgba(var(--accent-rgb),0.12)] text-[var(--accent)] flex items-center justify-center font-display font-bold text-[12px]">
                      {(p.email || '?').charAt(0).toUpperCase()}
                    </span>
                    <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[var(--ok)] border-2 border-[var(--bg-surface)]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-semibold text-[var(--text-primary)] truncate">{p.email || 'desconocido'}</span>
                    <span className="flex items-center gap-1 text-[10.5px] text-[var(--text-secondary)] truncate">
                      {esApk ? <Smartphone className="w-3 h-3 shrink-0" /> : <Monitor className="w-3 h-3 shrink-0" />}
                      <span className="truncate">{p.ruta || '—'}</span>
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* Espejo */}
        <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-base)] overflow-hidden min-h-[280px] flex flex-col">
          <div className="px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-surface)] flex items-center justify-between">
            <span className="text-[12px] font-semibold text-[var(--text-primary)] truncate">
              {seleccionado ? seleccionado.email : 'Elegí a alguien de la izquierda'}
            </span>
            {estado === 'vivo' && (
              <span className="flex items-center gap-1.5 text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-[var(--ok-soft)] text-[var(--ok)]">
                <Radio className="w-3 h-3 animate-pulse" /> En vivo
              </span>
            )}
            {estado === 'esperando' && (
              <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-[var(--bg-sunken)] text-[var(--text-muted)]">Conectando…</span>
            )}
          </div>

          {/* Lienzo del reproductor. Fondo oscuro neutro para que la
              pantalla replicada resalte sea cual sea el tema. */}
          <div className="flex-1 relative bg-[#0b0f0e] overflow-hidden">
            <div ref={lienzoRef} className="w-full" />
            {estado !== 'vivo' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6 pointer-events-none">
                <MonitorPlay className="w-9 h-9 text-white/20" />
                <p className="text-[12.5px] text-white/45">
                  {seleccionado ? 'Esperando la señal del dispositivo…' : 'El espejo aparece al elegir a alguien conectado.'}
                </p>
              </div>
            )}
          </div>

          {seleccionado && (
            <div className="px-3 py-2 border-t border-[var(--border-color)] bg-[var(--bg-surface)] flex items-center justify-between text-[11px] text-[var(--text-secondary)]">
              <span className="truncate">{seleccionado.ruta || '—'}</span>
              <span className="font-mono tabular-nums shrink-0">visto {soloHora(seleccionado.last_seen)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
