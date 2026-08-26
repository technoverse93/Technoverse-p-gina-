import React, { useEffect, useState } from 'react';
import { Lock, CheckCircle2, ShieldAlert, RefreshCw } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { useToast } from './ui/Overlays';

type Estado = 'esperando' | 'listo' | 'invalido' | 'exito';

/**
 * El enlace de recuperación de Supabase reporta un enlace vencido o ya
 * usado como `error_description` — a veces en el hash (flujo implícito)
 * y a veces en la query string (flujo PKCE) — así que hay que revisar
 * los dos antes de asumir que el enlace es válido.
 */
function leerErrorDeUrl(): string | null {
  const fuentes = [window.location.hash.replace(/^#/, ''), window.location.search.replace(/^\?/, '')];
  for (const fuente of fuentes) {
    const desc = new URLSearchParams(fuente).get('error_description');
    if (desc) return desc.replace(/\+/g, ' ');
  }
  return null;
}

interface Props {
  onListo: () => void;
}

/**
 * Vista dedicada a la que apunta el enlace del correo de recuperación de
 * contraseña (ver `redirectTo` en la Edge Function admin-force-password-reset
 * y en enviarRestablecimientoContrasena). Antes ese enlace caía en la tienda
 * pública sin ninguna pantalla para fijar la contraseña nueva.
 *
 * supabase-js completa el enlace de recuperación solo, al inicializar el
 * cliente (`detectSessionInUrl`), y avisa con el evento `PASSWORD_RECOVERY`.
 * Puede que eso ya haya pasado antes de montar este componente, así que
 * primero se revisa si ya hay sesión y además se escucha el evento por si
 * el intercambio termina después.
 */
export default function ResetPasswordView({ onListo }: Props) {
  const toast = useToast();
  const [estado, setEstado] = useState<Estado>('esperando');
  const [errorUrl, setErrorUrl] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const desc = leerErrorDeUrl();
    if (desc) { setErrorUrl(desc); setEstado('invalido'); return; }

    let vigente = true;

    supabase.auth.getSession().then(({ data }) => {
      if (vigente && data.session) setEstado('listo');
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (!vigente) return;
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') setEstado('listo');
    });

    // Si en unos segundos no aparece ninguna sesión de recuperación, el
    // enlace no sirve — no tiene sentido dejar la pantalla esperando para
    // siempre.
    const limite = setTimeout(() => {
      setEstado(actual => (actual === 'esperando' ? 'invalido' : actual));
    }, 6000);

    return () => { vigente = false; sub.subscription.unsubscribe(); clearTimeout(limite); };
  }, []);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 6) { setError('La contraseña debe tener al menos 6 caracteres.'); return; }
    if (password !== confirmacion) { setError('Las dos contraseñas no coinciden.'); return; }
    setGuardando(true);
    try {
      const { error: updError } = await supabase.auth.updateUser({ password });
      if (updError) throw updError;
      toast.success('Contraseña actualizada correctamente.');
      setEstado('exito');
      await supabase.auth.signOut();
    } catch (err: any) {
      const msg = err?.message || 'No se pudo actualizar la contraseña.';
      setError(msg);
      toast.error(msg);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center p-4 bg-[var(--bg-base)]">
      <div className="relative max-w-md w-full glass-panel-strong rounded-3xl p-6 sm:p-8 shadow-sm space-y-6 text-[var(--text-primary)]">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 bg-gradient-to-tr from-[#3B82F6] to-blue-600 rounded-2xl flex items-center justify-center border border-white/40 shadow-sm mx-auto">
            <Lock className="w-5 h-5 text-white" />
          </div>
          <h2 className="text-lg font-extrabold tracking-tight font-display text-[var(--text-primary)]">
            Restablecer Contraseña
          </h2>
          <p className="text-[10px] text-[var(--text-primary)] uppercase font-bold tracking-wider">
            Technoverse - Portal Seguro de Cliente
          </p>
        </div>

        {estado === 'esperando' && (
          <div className="flex flex-col items-center gap-3 py-6 text-[var(--text-secondary)]">
            <RefreshCw className="w-6 h-6 animate-spin" />
            <p className="text-[12.5px]">Verificando el enlace de recuperación…</p>
          </div>
        )}

        {estado === 'invalido' && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl border border-[#E5484D]/40 bg-[#E5484D]/10 p-3">
              <ShieldAlert className="w-5 h-5 flex-shrink-0 text-[#E5484D]" />
              <p className="text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
                {errorUrl || 'Este enlace de recuperación ya no es válido: venció o ya se usó.'} Solicite un nuevo enlace desde la pantalla de inicio de sesión.
              </p>
            </div>
            <button
              type="button"
              onClick={onListo}
              className="w-full bg-[var(--brand-gold-mid)] hover:bg-[var(--brand-gold-dark)] text-[var(--accent-ink)] font-bold text-sm py-2.5 rounded-xl uppercase tracking-wider transition shadow-sm cursor-pointer"
            >
              Volver a la tienda
            </button>
          </div>
        )}

        {estado === 'listo' && (
          <form onSubmit={enviar} className="space-y-4">
            <div>
              <label className="block text-[9px] uppercase font-bold text-[var(--text-secondary)] mb-1 tracking-wider">Nueva contraseña</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                autoFocus
                className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)] focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl px-4 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none transition"
              />
            </div>
            <div>
              <label className="block text-[9px] uppercase font-bold text-[var(--text-secondary)] mb-1 tracking-wider">Confirmar nueva contraseña</label>
              <input
                type="password"
                required
                value={confirmacion}
                onChange={(e) => setConfirmacion(e.target.value)}
                placeholder="••••••••••••"
                className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)] focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl px-4 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none transition"
              />
            </div>
            {error && <p className="text-[12.5px] font-semibold text-[#E5484D]">{error}</p>}
            <button
              type="submit"
              disabled={guardando}
              className="w-full bg-[var(--brand-gold-mid)] hover:bg-[var(--brand-gold-dark)] text-[var(--accent-ink)] font-bold text-sm py-2.5 rounded-xl uppercase tracking-wider transition shadow-sm cursor-pointer disabled:opacity-60 disabled:cursor-wait"
            >
              {guardando ? 'Guardando…' : 'Guardar nueva contraseña'}
            </button>
          </form>
        )}

        {estado === 'exito' && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl border border-[var(--ok)]/40 bg-[var(--ok-soft)] p-3">
              <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-[var(--ok)]" />
              <p className="text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
                Contraseña actualizada correctamente. Ya puede iniciar sesión con su nueva contraseña.
              </p>
            </div>
            <button
              type="button"
              onClick={onListo}
              className="w-full bg-[var(--brand-gold-mid)] hover:bg-[var(--brand-gold-dark)] text-[var(--accent-ink)] font-bold text-sm py-2.5 rounded-xl uppercase tracking-wider transition shadow-sm cursor-pointer"
            >
              Ir a iniciar sesión
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
