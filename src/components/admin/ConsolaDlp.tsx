// =====================================================================
// CONSOLA DE CAPTURAS · DLP (Zero Trust · Etapa 4)
// =====================================================================
// La matriz de la lista blanca, tal como se aprobó en la maqueta: una
// regla base DENY ALL bien visible arriba, y debajo una fila por cuenta
// del personal con dos interruptores —Web y APK—.
//
// Exclusiva del Superadmin, con triple candado: la entrada de menú se
// oculta, el render se bloquea en AdminPanel con esAdminSupremo(), y —lo
// único que de verdad manda— tanto la RLS de la tabla como las funciones
// dlp_listar/dlp_fijar vuelven a comprobarlo en el servidor.
//
// Apagar AMBAS capas equivale a revocar: la función borra la fila y la
// cuenta vuelve a la regla base. Por eso no hay botón de "quitar".
// =====================================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Monitor, Smartphone, RefreshCw, ShieldAlert, TriangleAlert } from 'lucide-react';
import { supabase } from '../../supabaseClient';

interface FilaDlp {
  user_id: string;
  email: string | null;
  rol: string;
  allow_web: boolean;
  allow_apk: boolean;
}

/** Interruptor accesible. Refleja el estado real, no el optimista. */
function Interruptor({
  activo, alCambiar, ocupado, etiqueta,
}: {
  activo: boolean;
  alCambiar: () => void;
  ocupado: boolean;
  etiqueta: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={activo}
      aria-label={etiqueta}
      disabled={ocupado}
      onClick={alCambiar}
      className={`relative w-[40px] h-[23px] rounded-full border transition-colors shrink-0 disabled:opacity-50 ${
        activo
          ? 'bg-[var(--accent)] border-[var(--accent)]'
          : 'bg-[var(--bg-sunken)] border-[var(--border-color)]'
      }`}
    >
      <span
        className={`absolute top-[2px] w-[17px] h-[17px] rounded-full transition-all ${
          activo ? 'left-[20px] bg-white' : 'left-[2px] bg-[var(--text-muted)]'
        }`}
      />
    </button>
  );
}

export default function ConsolaDlp() {
  const [filas, setFilas] = useState<FilaDlp[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState<string | null>(null);
  const montado = useRef(true);

  useEffect(() => {
    montado.current = true;
    return () => { montado.current = false; };
  }, []);

  const cargar = useCallback(async () => {
    setCargando(true);
    const { data, error } = await supabase.rpc('dlp_listar');
    if (!montado.current) return;
    if (error) setError(error.message);
    else { setError(null); setFilas((data as FilaDlp[]) || []); }
    setCargando(false);
  }, []);

  useEffect(() => {
    void cargar();
    // Si otra sesión del Superadmin cambia un permiso, esta se entera.
    const canal = supabase
      .channel('dlp-whitelist-consola')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dlp_whitelist' }, () => {
        void cargar();
      })
      .subscribe();
    return () => { supabase.removeChannel(canal); };
  }, [cargar]);

  const fijar = async (fila: FilaDlp, web: boolean, apk: boolean) => {
    setGuardando(fila.user_id);
    // Optimista: el interruptor responde al instante y Realtime confirma.
    setFilas(prev => prev.map(f =>
      f.user_id === fila.user_id ? { ...f, allow_web: web, allow_apk: apk } : f
    ));
    const { error } = await supabase.rpc('dlp_fijar', {
      p_user_id: fila.user_id, p_web: web, p_apk: apk,
    });
    if (!montado.current) return;
    setGuardando(null);
    if (error) { setError(error.message); void cargar(); }
    else setError(null);
  };

  const autorizados = useMemo(
    () => filas.filter(f => f.allow_web || f.allow_apk).length,
    [filas]
  );

  const estadoDe = (f: FilaDlp) => {
    if (f.allow_web && f.allow_apk) return { texto: 'Permitido · Web + APK', ok: true };
    if (f.allow_web) return { texto: 'Permitido · solo Web', ok: true };
    if (f.allow_apk) return { texto: 'Permitido · solo APK', ok: true };
    return { texto: 'Bloqueado', ok: false };
  };

  return (
    <div className="tv-stack">
      {/* Encabezado */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-[var(--accent)]/12 text-[var(--accent)] flex items-center justify-center shrink-0">
            <Camera className="w-[18px] h-[18px]" />
          </div>
          <div>
            <h2 className="font-display font-bold text-[15px] text-[var(--text-primary)] leading-tight">Capturas de pantalla</h2>
            <p className="text-[11.5px] text-[var(--text-secondary)]">Quién puede capturar, y en qué capa.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-[var(--text-secondary)]">
            <b className="text-[var(--text-primary)]">{autorizados}</b> con permiso
          </span>
          <button
            type="button"
            onClick={() => void cargar()}
            className="w-8 h-8 rounded-lg flex items-center justify-center border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition"
            aria-label="Recargar"
          >
            <RefreshCw className={`w-4 h-4 ${cargando ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Regla base */}
      <div className="flex items-center gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] px-4 py-3">
        <span className="text-[10.5px] font-bold uppercase tracking-[0.08em] px-2 py-1 rounded-md shrink-0"
              style={{ color: '#e5484d', background: 'rgba(229,72,77,0.12)' }}>
          Deny all
        </span>
        <span className="text-[12.5px] text-[var(--text-secondary)] min-w-0">
          Nadie puede capturar. Abajo, las excepciones que autorizás.
        </span>
      </div>

      {error && (
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-4 text-[13px] text-[var(--text-secondary)]">
          No se pudo aplicar el cambio. Detalle: {error}
        </div>
      )}

      {/* ---------- Escritorio: matriz ---------- */}
      <div className="hidden md:block rounded-2xl border border-[var(--border-color)] bg-[var(--bg-surface)] overflow-hidden">
        <div className="grid grid-cols-[1fr_100px_100px_170px] gap-3 px-4 py-2.5 bg-[var(--bg-sunken)] border-b border-[var(--border-color)]">
          {['Cuenta', 'Web', 'APK', 'Estado'].map(h => (
            <span key={h} className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--text-muted)]">{h}</span>
          ))}
        </div>
        {filas.map(f => {
          const est = estadoDe(f);
          return (
            <div key={f.user_id}
                 className="grid grid-cols-[1fr_100px_100px_170px] gap-3 items-center px-4 py-3 border-b border-[var(--border-color)]/60 last:border-b-0">
              <div className="min-w-0">
                <div className="text-[13px] font-mono text-[var(--text-primary)] truncate">{f.email || 'sin correo'}</div>
                <div className="text-[11px] text-[var(--text-muted)] capitalize">{f.rol}</div>
              </div>
              <Interruptor
                activo={f.allow_web}
                ocupado={guardando === f.user_id}
                etiqueta={`Permitir capturas en web a ${f.email}`}
                alCambiar={() => void fijar(f, !f.allow_web, f.allow_apk)}
              />
              <Interruptor
                activo={f.allow_apk}
                ocupado={guardando === f.user_id}
                etiqueta={`Permitir capturas en APK a ${f.email}`}
                alCambiar={() => void fijar(f, f.allow_web, !f.allow_apk)}
              />
              <span className="text-[11px] font-bold px-2.5 py-1 rounded-full w-fit"
                    style={est.ok
                      ? { color: 'var(--ok)', background: 'var(--ok-soft)' }
                      : { color: '#e5484d', background: 'rgba(229,72,77,0.12)' }}>
                {est.texto}
              </span>
            </div>
          );
        })}
      </div>

      {/* ---------- Móvil: tarjetas ---------- */}
      <div className="md:hidden flex flex-col gap-2">
        {filas.map(f => {
          const est = estadoDe(f);
          return (
            <div key={f.user_id} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[12.5px] font-mono text-[var(--text-primary)] truncate">{f.email || 'sin correo'}</div>
                  <div className="text-[11px] text-[var(--text-muted)] capitalize">{f.rol}</div>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
                      style={est.ok
                        ? { color: 'var(--ok)', background: 'var(--ok-soft)' }
                        : { color: '#e5484d', background: 'rgba(229,72,77,0.12)' }}>
                  {est.ok ? 'Permitido' : 'Bloqueado'}
                </span>
              </div>
              <div className="mt-3 pt-3 border-t border-[var(--border-color)]/60 flex flex-col gap-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-[12.5px] text-[var(--text-secondary)]">
                    <Monitor className="w-4 h-4 text-[var(--text-muted)]" /> Web
                  </span>
                  <Interruptor
                    activo={f.allow_web}
                    ocupado={guardando === f.user_id}
                    etiqueta={`Permitir capturas en web a ${f.email}`}
                    alCambiar={() => void fijar(f, !f.allow_web, f.allow_apk)}
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-[12.5px] text-[var(--text-secondary)]">
                    <Smartphone className="w-4 h-4 text-[var(--text-muted)]" /> APK
                  </span>
                  <Interruptor
                    activo={f.allow_apk}
                    ocupado={guardando === f.user_id}
                    etiqueta={`Permitir capturas en APK a ${f.email}`}
                    alCambiar={() => void fijar(f, f.allow_web, !f.allow_apk)}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {!error && !cargando && filas.length === 0 && (
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-8 text-center text-[13px] text-[var(--text-muted)]">
          No hay cuentas de personal para administrar.
        </div>
      )}

      {/* Honestidad técnica: lo que esto sí y no logra. */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-4 flex gap-3"
           style={{ borderLeft: '2px solid #e5a23d' }}>
        <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" style={{ color: '#e5a23d' }} />
        <div className="text-[12.5px] text-[var(--text-secondary)] leading-relaxed min-w-0">
          <b className="text-[var(--text-primary)]">En la APK</b> el bloqueo es real: lo aplica Android sobre la ventana
          y también tapa la vista previa del conmutador de apps.{' '}
          <b className="text-[var(--text-primary)]">En la web</b>, en cambio, esto <b>disuade</b> pero no <b>impide</b>:
          se bloquea la impresión, se pisa el portapapeles del PrintScreen y se tapa la pantalla al perder el foco,
          pero una foto con otro teléfono siempre es posible. No conviene tratarlo como blindaje total.
        </div>
      </div>

      <div className="flex items-start gap-2.5 text-[11.5px] text-[var(--text-muted)] px-1">
        <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>
          Apagar las dos capas revoca el permiso por completo y devuelve la cuenta a la regla base.
          Tu propia cuenta no aparece restringida: administrás la lista, así que nunca te escudás a vos mismo.
        </span>
      </div>
    </div>
  );
}
