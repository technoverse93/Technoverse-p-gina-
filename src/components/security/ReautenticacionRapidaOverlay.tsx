import React, { useEffect, useRef, useState } from 'react';
import { ShieldCheck, Fingerprint, RotateCw, LogOut } from 'lucide-react';
import { Modal } from '../ui/Overlays';
import { Btn } from '../admin/AdminKit';
import { soportaBiometria, entrarConBiometria } from '../../utils/biometria';

interface Props {
  email: string;
  /**
   * Recibe la identidad que acaba de abrir la huella (`userId`/`email` de
   * `ResultadoBiometria`). El candado de ausencia breve la ignora —ya tenía
   * `currentUser` puesto de antes—, pero el candado de ARRANQUE EN FRÍO
   * (App.tsx) la necesita para poblar `currentUser` desde cero: en ese caso
   * no había ningún usuario en memoria al montarse este componente.
   */
  onDesbloqueado: (resultado: { userId?: string; email?: string }) => void;
  /** Mismo efecto que "Cerrar sesión": cierre real y vuelta a la tienda pública. */
  onFalloTotal: () => void;
}

/**
 * Candado de re-autenticación tras una ausencia (ver App.tsx: en la APK,
 * CUALQUIER ausencia; en la web, una breve).
 *
 * A propósito NO es una pantalla nueva ni una redirección: se monta
 * FLOTANDO encima de lo que ya estaba en pantalla, sin que App.tsx toque
 * `currentUser`, `currentView` ni desmonte nada. Es justo esa ausencia de
 * desmontaje la que preserva "lo que el administrador estaba haciendo" —
 * un cobro a medio llenar, por ejemplo.
 *
 * ÚNICAMENTE huella/Face ID, sin respaldo de contraseña (orden explícita).
 *
 * ---------------------------------------------------------------------
 * FALLO CORREGIDO — "la sesión se cerraba sola"
 * ---------------------------------------------------------------------
 * Antes, CUALQUIER desenlace que no fuera "aprobada" —cancelado, sensor
 * ocupado, un parpadeo del lector, el diálogo del sistema que no llegó a
 * abrir— llamaba a `onFalloTotal()` de una vez: cierre real de sesión,
 * sin reintento ni aviso. Con la sesión perpetua (App.tsx), CUALQUIER
 * regreso a la APK pasa por este candado, así que un solo tropiezo del
 * sensor —algo normal y frecuente en el uso real— bastaba para perder la
 * sesión por completo. Eso es lo que se reportó como "caída inesperada".
 *
 * Ahora un intento fallido NO cierra nada solo: se ofrece "Reintentar"
 * (vuelve a pedir huella) y, aparte, "Cerrar sesión" como ACCIÓN EXPLÍCITA
 * de la persona. La sesión solo termina si alguien la cierra a propósito
 * —tocando ese botón o desde el menú de cuenta—, nunca por un fallo
 * transitorio de hardware. La seguridad no baja: sigue sin haber ningún
 * camino que no sea la huella real para entrar.
 */
export default function ReautenticacionRapidaOverlay({ email, onDesbloqueado, onFalloTotal }: Props) {
  const [estado, setEstado] = useState<'verificando' | 'fallo' | 'sin-biometria'>('verificando');
  const enCurso = useRef(false);

  const intentar = () => {
    if (enCurso.current) return;
    enCurso.current = true;
    setEstado('verificando');

    let vigente = true;
    (async () => {
      const disponible = await soportaBiometria();
      if (!vigente) return;
      if (!disponible) {
        // Sin sensor/huella configurada en este aparato: no hay nada que
        // reintentar, pero tampoco se cierra sola — la persona decide.
        setEstado('sin-biometria');
        enCurso.current = false;
        return;
      }
      const resultado = await entrarConBiometria(email);
      if (!vigente) return;
      if (resultado.ok) {
        onDesbloqueado({ userId: resultado.userId, email: resultado.email });
      } else {
        setEstado('fallo');
      }
      enCurso.current = false;
    })();

    return () => { vigente = false; };
  };

  useEffect(() => {
    intentar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fallido = estado === 'fallo' || estado === 'sin-biometria';

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
          <Fingerprint className={`w-10 h-10 ${fallido ? 'text-[var(--tv-warn,#c9862c)]' : 'text-[var(--accent)] animate-pulse'}`} />
          <span className="text-[12.5px] font-semibold text-center">
            {estado === 'verificando' && 'Esperando huella o Face ID…'}
            {estado === 'fallo' && 'No se pudo verificar. Puede deberse a un tropiezo del sensor — intente de nuevo.'}
            {estado === 'sin-biometria' && 'Este aparato no tiene la huella disponible ahora mismo.'}
          </span>
        </div>

        {fallido && (
          <div className="flex gap-2">
            <Btn variant="primary" icon={RotateCw} onClick={intentar} className="flex-1">
              Reintentar
            </Btn>
            <Btn variant="danger" icon={LogOut} onClick={onFalloTotal} className="flex-1">
              Cerrar sesión
            </Btn>
          </div>
        )}
      </div>
    </Modal>
  );
}
