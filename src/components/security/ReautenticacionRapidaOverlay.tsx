import React, { useEffect, useRef, useState } from 'react';
import { ShieldCheck, Fingerprint, LogOut } from 'lucide-react';
import { Modal } from '../ui/Overlays';
import { Btn, Field } from '../admin/AdminKit';
import { supabase } from '../../supabaseClient';
import { soportaBiometria, entrarConBiometria } from '../../utils/biometria';

interface Props {
  email: string;
  onDesbloqueado: () => void;
  onCerrarSesion: () => void;
}

/**
 * Candado de re-autenticación para una AUSENCIA BREVE (≤ 2 minutos, ver
 * `UMBRAL_REINGRESO_RAPIDO_MS` en appLock.ts).
 *
 * A propósito NO es una pantalla nueva ni una redirección: se monta
 * FLOTANDO encima de lo que ya estaba en pantalla, sin que App.tsx
 * toque `currentUser`, `currentView` ni desmonte nada. Es justo esa
 * ausencia de desmontaje la que preserva "lo que el administrador
 * estaba haciendo" — un cobro a medio llenar, por ejemplo — sin
 * necesidad de guardar y restaurar un borrador a mano: el estado de
 * React del componente de abajo nunca dejó de existir.
 *
 * Para una ausencia larga (> 2 minutos) esto ni se monta: App.tsx toma
 * el camino de siempre (cierre de sesión real + vuelta a la tienda).
 */
export default function ReautenticacionRapidaOverlay({ email, onDesbloqueado, onCerrarSesion }: Props) {
  const [hayBiometria, setHayBiometria] = useState(false);
  const [verificandoBiometria, setVerificandoBiometria] = useState(false);
  const [password, setPassword] = useState('');
  const [entrandoConClave, setEnviandoConClave] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const yaIntentoSolo = useRef(false);

  const intentarBiometria = async () => {
    setError(null);
    setVerificandoBiometria(true);
    try {
      const resultado = await entrarConBiometria(email);
      if (resultado.ok) {
        onDesbloqueado();
      } else if (!resultado.cancelado) {
        setError(resultado.mensaje || 'No se pudo verificar la huella.');
      }
    } finally {
      setVerificandoBiometria(false);
    }
  };

  useEffect(() => {
    let vigente = true;
    soportaBiometria().then(disponible => {
      if (!vigente) return;
      setHayBiometria(disponible);
      // Se pide sola apenas se puede, para que "bloquea la pantalla de
      // inmediato con el prompt biométrico" sea literal y no dependa de
      // que la persona toque un botón primero.
      if (disponible && !yaIntentoSolo.current) {
        yaIntentoSolo.current = true;
        void intentarBiometria();
      }
    });
    return () => { vigente = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const entrarConContrasena = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setError(null);
    setEnviandoConClave(true);
    try {
      const { error: errAuth } = await supabase.auth.signInWithPassword({ email, password });
      if (errAuth) {
        setError('Contraseña incorrecta.');
        return;
      }
      setPassword('');
      onDesbloqueado();
    } catch (e: any) {
      setError(e?.message || 'No se pudo verificar la contraseña.');
    } finally {
      setEnviandoConClave(false);
    }
  };

  return (
    <Modal open onClose={() => {}} closeOnBackdrop={false} hideClose title="Confirme su identidad" size="sm">
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-3">
          <ShieldCheck className="w-5 h-5 flex-shrink-0 text-[var(--accent)]" />
          <p className="text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
            La aplicación estuvo en segundo plano. Confirme que sigue siendo <strong className="text-[var(--text-primary)]">{email}</strong> para
            continuar exactamente donde se quedó — nada de lo que tenía en pantalla se perdió.
          </p>
        </div>

        {hayBiometria && (
          <Btn
            type="button"
            variant="primary"
            disabled={verificandoBiometria}
            onClick={intentarBiometria}
            className="w-full justify-center"
          >
            <Fingerprint className="w-4 h-4" />
            {verificandoBiometria ? 'Verificando…' : 'Usar Face ID o huella'}
          </Btn>
        )}

        <form onSubmit={entrarConContrasena} className="space-y-3">
          {hayBiometria && (
            <p className="text-center text-[11px] text-[var(--text-muted)]">o ingrese su contraseña</p>
          )}
          <Field label="Contraseña">
            <input
              type="password"
              className="tv-input"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
              autoFocus={!hayBiometria}
            />
          </Field>
          {error && <p className="text-[12.5px] font-semibold text-[#E5484D]">{error}</p>}
          <Btn type="submit" variant="default" disabled={entrandoConClave || !password} className="w-full justify-center">
            {entrandoConClave ? 'Verificando…' : 'Entrar con contraseña'}
          </Btn>
        </form>

        <button
          type="button"
          onClick={onCerrarSesion}
          className="w-full flex items-center justify-center gap-1.5 text-[11.5px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition"
        >
          <LogOut className="w-3.5 h-3.5" /> No soy yo — cerrar sesión
        </button>
      </div>
    </Modal>
  );
}
