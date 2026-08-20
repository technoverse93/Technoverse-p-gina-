import React, { useEffect, useRef, useState } from 'react';
import { ShieldCheck, Fingerprint } from 'lucide-react';
import { Modal } from '../ui/Overlays';
import { soportaBiometria, entrarConBiometria } from '../../utils/biometria';

interface Props {
  email: string;
  onDesbloqueado: () => void;
  /** Mismo efecto que una ausencia larga (> 2 minutos): cierre real de sesión y vuelta a la tienda pública. */
  onFalloTotal: () => void;
}

/**
 * Candado de re-autenticación para una AUSENCIA BREVE (≤ 2 minutos, ver
 * `UMBRAL_REINGRESO_RAPIDO_MS` en appLock.ts).
 *
 * A propósito NO es una pantalla nueva ni una redirección: se monta
 * FLOTANDO encima de lo que ya estaba en pantalla, sin que App.tsx
 * toque `currentUser`, `currentView` ni desmonte nada. Es justo esa
 * ausencia de desmontaje la que preserva "lo que el administrador
 * estaba haciendo" — un cobro a medio llenar, por ejemplo.
 *
 * ÚNICAMENTE huella/Face ID, sin respaldo de contraseña (orden
 * explícita) — un solo intento, automático al montarse:
 *   · Aprobada  → onDesbloqueado(): el candado desaparece, la pantalla
 *     de abajo sigue exactamente igual porque nunca se desmontó.
 *   · Rechazada, cancelada, o el aparato no tiene biometría disponible
 *     → onFalloTotal(): el mismo efecto que una ausencia larga —cierre
 *     real de sesión y vuelta a la tienda pública, hay que iniciar
 *     sesión desde cero. Nada de reintentos ni de una contraseña de
 *     respaldo aquí.
 *
 * Para una ausencia larga (> 2 minutos) esto ni se monta: App.tsx toma
 * directo el camino de siempre.
 */
export default function ReautenticacionRapidaOverlay({ email, onDesbloqueado, onFalloTotal }: Props) {
  const [verificando, setVerificando] = useState(true);
  const yaIntento = useRef(false);

  useEffect(() => {
    if (yaIntento.current) return;
    yaIntento.current = true;

    let vigente = true;
    (async () => {
      const disponible = await soportaBiometria();
      if (!vigente) return;
      if (!disponible) {
        onFalloTotal();
        return;
      }
      const resultado = await entrarConBiometria(email);
      if (!vigente) return;
      if (resultado.ok) {
        onDesbloqueado();
      } else {
        onFalloTotal();
      }
      setVerificando(false);
    })();

    return () => { vigente = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Modal open onClose={() => {}} closeOnBackdrop={false} hideClose title="Confirme su identidad" size="sm">
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-3">
          <ShieldCheck className="w-5 h-5 flex-shrink-0 text-[var(--accent)]" />
          <p className="text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
            La aplicación estuvo en segundo plano. Confirme con su huella o Face ID que sigue siendo{' '}
            <strong className="text-[var(--text-primary)]">{email}</strong> para continuar exactamente donde se quedó.
          </p>
        </div>

        <div className="flex flex-col items-center justify-center gap-3 py-4 text-[var(--text-secondary)]">
          <Fingerprint className={`w-10 h-10 text-[var(--accent)] ${verificando ? 'animate-pulse' : ''}`} />
          <span className="text-[12.5px] font-semibold">
            {verificando ? 'Esperando huella o Face ID…' : 'Cerrando sesión…'}
          </span>
        </div>
      </div>
    </Modal>
  );
}
