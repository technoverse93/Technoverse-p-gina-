// =====================================================================
// CONSOLA DE INGRESOS (Zero Trust · Etapa 2)
// =====================================================================
// Feed en vivo de cada autenticación exitosa. Exclusiva del Superadmin:
// el render se bloquea en AdminPanel con esAdminSupremo(), y la RLS de la
// tabla solo deja LEER al superadmin, así que aunque alguien forzara el
// render, no vería una sola fila.
//
// El "en vivo" es Realtime puro (postgres_changes): cada INSERT nuevo se
// inyecta arriba sin recargar. La RLS también aplica al canal, así que
// solo la sesión del superadmin recibe los eventos.
// =====================================================================

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ShieldCheck, Smartphone, Monitor, RefreshCw } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { etiquetaDeDia, soloHora } from '../chat/formatoChat';

interface Ingreso {
  id: string;
  email: string;
  entorno: 'web' | 'apk';
  dispositivo: string | null;
  created_at: string;
}

const TANDA = 100;

export default function ConsolaIngresos() {
  const [ingresos, setIngresos] = useState<Ingreso[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const montado = useRef(true);

  useEffect(() => {
    montado.current = true;
    return () => { montado.current = false; };
  }, []);

  const cargar = async () => {
    setCargando(true);
    const { data, error } = await supabase
      .from('security_login_events')
      .select('id, email, entorno, dispositivo, created_at')
      .order('created_at', { ascending: false })
      .limit(TANDA);
    if (!montado.current) return;
    if (error) setError(error.message);
    else { setError(null); setIngresos((data as Ingreso[]) || []); }
    setCargando(false);
  };

  useEffect(() => {
    cargar();
    // Realtime: cada ingreso nuevo entra arriba sin recargar. El canal
    // respeta la RLS, así que solo el superadmin recibe estas filas.
    const canal = supabase
      .channel('security-login-events')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'security_login_events' },
        payload => {
          if (!montado.current) return;
          const fila = payload.new as Ingreso;
          setIngresos(prev => prev.some(i => i.id === fila.id) ? prev : [fila, ...prev].slice(0, TANDA));
        })
      .subscribe();
    return () => { supabase.removeChannel(canal); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hoy = useMemo(() => {
    const etHoy = etiquetaDeDia(new Date().toISOString());
    return ingresos.filter(i => etiquetaDeDia(i.created_at) === etHoy).length;
  }, [ingresos]);

  // Agrupa por día para separadores, como el chat.
  const grupos = useMemo(() => {
    const out: { dia: string; filas: Ingreso[] }[] = [];
    for (const i of ingresos) {
      const dia = etiquetaDeDia(i.created_at);
      const ultimo = out[out.length - 1];
      if (ultimo && ultimo.dia === dia) ultimo.filas.push(i);
      else out.push({ dia, filas: [i] });
    }
    return out;
  }, [ingresos]);

  return (
    <div className="tv-stack">
      {/* Encabezado + resumen */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-[var(--accent)]/12 text-[var(--accent)] flex items-center justify-center shrink-0">
            <ShieldCheck className="w-[18px] h-[18px]" />
          </div>
          <div>
            <h2 className="font-display font-bold text-[15px] text-[var(--text-primary)] leading-tight">Ingresos</h2>
            <p className="text-[11.5px] text-[var(--text-secondary)]">Cada autenticación exitosa, en vivo.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full bg-[var(--ok-soft)] text-[var(--ok)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--ok)] animate-pulse" /> En vivo
          </span>
          <span className="text-[11px] font-mono text-[var(--text-secondary)]">
            <b className="text-[var(--text-primary)]">{hoy}</b> hoy
          </span>
          <button
            type="button"
            onClick={cargar}
            className="w-8 h-8 rounded-lg flex items-center justify-center border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition"
            aria-label="Recargar"
          >
            <RefreshCw className={`w-4 h-4 ${cargando ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-4 text-[13px] text-[var(--text-secondary)]">
          No se pudo cargar la auditoría. Detalle: {error}
        </div>
      )}

      {!error && !cargando && ingresos.length === 0 && (
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-8 text-center text-[13px] text-[var(--text-muted)]">
          Todavía no hay ingresos registrados. Aparecerán aquí en cuanto alguien inicie sesión.
        </div>
      )}

      {/* Feed */}
      <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-surface)] overflow-hidden">
        {grupos.map(grupo => (
          <div key={grupo.dia}>
            <div className="px-4 py-2 bg-[var(--bg-sunken)] border-b border-[var(--border-color)]">
              <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--text-muted)]">{grupo.dia}</span>
            </div>
            {grupo.filas.map(i => {
              const esApk = i.entorno === 'apk';
              const inicial = (i.email || '?').charAt(0).toUpperCase();
              return (
                <div key={i.id} className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border-color)]/60 last:border-b-0">
                  <div className="w-9 h-9 rounded-full bg-[rgba(var(--accent-rgb),0.12)] text-[var(--accent)] flex items-center justify-center shrink-0 font-display font-bold text-[13px]">
                    {inicial}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-[var(--text-primary)] truncate">{i.email || 'desconocido'}</div>
                    <div className="flex items-center gap-1.5 text-[11.5px] text-[var(--text-secondary)] truncate">
                      {esApk
                        ? <Smartphone className="w-3.5 h-3.5 shrink-0 text-[var(--text-muted)]" />
                        : <Monitor className="w-3.5 h-3.5 shrink-0 text-[var(--text-muted)]" />}
                      <span className="truncate">{i.dispositivo || (esApk ? 'APK' : 'Web')}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[12px] font-mono tabular-nums text-[var(--text-primary)]">{soloHora(i.created_at)}</div>
                    <span className={`text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                      esApk ? 'bg-[var(--accent)]/10 text-[var(--accent)]' : 'bg-[var(--bg-sunken)] text-[var(--text-muted)]'
                    }`}>{esApk ? 'APK' : 'Web'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
