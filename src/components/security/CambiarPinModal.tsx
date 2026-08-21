import React, { useMemo, useState } from 'react';
import { ShieldAlert, CheckCircle2 } from 'lucide-react';
import { Modal, useToast } from '../ui/Overlays';
import { Btn, Field } from '../admin/AdminKit';
import { cambiarTokenSeguridad } from '../../utils/securityPin';

interface Props {
  open: boolean;
  onClose: () => void;
}

const soloDigitos = (v: string) => v.replace(/\D/g, '').slice(0, 4);

/**
 * Cambiar el token de seguridad de 4 dígitos ya configurado.
 *
 * ÚNICAMENTE se monta desde AdminShell.tsx cuando el correo de la sesión
 * es exactamente el del administrador supremo (ver `esAdminSupremo` en
 * securityPin.ts) — ese es el filtro de frontend. La regla real vive en
 * el servidor: `change_security_pin()` exige el código anterior correcto
 * Y que la cuenta sea la del correo supremo (vía `set_security_pin`, al
 * que llama internamente), así que aunque alguien forzara este modal a
 * abrirse sin ser el admin supremo, la base de datos igual lo rechaza.
 *
 * FLUJO ESTRICTO, tal como se pidió:
 *   1) Código Anterior.
 *   2) Nuevo Código.
 *   3) Confirmar Nuevo Código.
 *   4) "Guardar" queda deshabilitado hasta que 2 y 3 coincidan Y los tres
 *      campos tengan 4 dígitos — no alcanza con que el par nuevo calce
 *      si el código anterior está vacío o incompleto.
 *   5) Al guardar con éxito, los tres campos se limpian de inmediato y
 *      se muestra una confirmación explícita de que se actualizó.
 */
export default function CambiarPinModal({ open, onClose }: Props) {
  const toast = useToast();
  const [pinActual, setPinActual] = useState('');
  const [pinNuevo, setPinNuevo] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actualizado, setActualizado] = useState(false);

  const limpiarCampos = () => {
    setPinActual(''); setPinNuevo(''); setConfirmacion(''); setError(null);
  };

  const cerrarYLimpiar = () => {
    onClose();
    setTimeout(() => { limpiarCampos(); setActualizado(false); }, 200);
  };

  // El botón "Guardar" depende de esto, no de la validación al enviar:
  // debe estar deshabilitado ANTES de intentar, no solo rechazar después.
  const puedeGuardar = useMemo(() => (
    pinActual.length === 4 &&
    pinNuevo.length === 4 &&
    confirmacion.length === 4 &&
    pinNuevo === confirmacion
  ), [pinActual, pinNuevo, confirmacion]);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!puedeGuardar) return;
    setError(null);
    setGuardando(true);
    try {
      const resultado = await cambiarTokenSeguridad(pinActual, pinNuevo);
      if (resultado.ok) {
        toast.success(resultado.mensaje);
        // Limpieza inmediata de los tres campos, y confirmación visible
        // aparte del toast (que desaparece solo): es lo que se pidió
        // explícitamente para que quede claro que sí se guardó.
        limpiarCampos();
        setActualizado(true);
      } else {
        setError(resultado.mensaje);
        toast.error(resultado.mensaje);
      }
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal open={open} onClose={cerrarYLimpiar} title="Cambiar código de seguridad" size="sm">
      <form onSubmit={enviar} className="space-y-4">
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
          <ShieldAlert className="w-5 h-5 flex-shrink-0 text-amber-500" />
          <p className="text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
            Debe confirmar el código actual antes de fijar uno nuevo. Solo el administrador supremo puede hacer este cambio.
          </p>
        </div>

        {actualizado && (
          <div className="flex items-start gap-3 rounded-xl border border-[var(--ok)]/40 bg-[var(--ok-soft)] p-3">
            <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-[var(--ok)]" />
            <p className="text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
              Código actualizado correctamente.
            </p>
          </div>
        )}

        <Field label="Código anterior">
          <input
            className="tv-input font-mono text-center text-lg tracking-[0.5em]"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            value={pinActual}
            onChange={e => { setPinActual(soloDigitos(e.target.value)); setActualizado(false); }}
            placeholder="••••"
            autoFocus
          />
        </Field>
        <Field label="Nuevo código">
          <input
            className="tv-input font-mono text-center text-lg tracking-[0.5em]"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            value={pinNuevo}
            onChange={e => { setPinNuevo(soloDigitos(e.target.value)); setActualizado(false); }}
            placeholder="••••"
          />
        </Field>
        <Field label="Confirmar nuevo código">
          <input
            className="tv-input font-mono text-center text-lg tracking-[0.5em]"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            value={confirmacion}
            onChange={e => { setConfirmacion(soloDigitos(e.target.value)); setActualizado(false); }}
            placeholder="••••"
          />
        </Field>
        {pinNuevo.length === 4 && confirmacion.length === 4 && pinNuevo !== confirmacion && (
          <p className="text-[12.5px] font-semibold text-[#E5484D]">Los dos códigos nuevos no coinciden.</p>
        )}

        {error && <p className="text-[12.5px] font-semibold text-[#E5484D]">{error}</p>}

        <Btn type="submit" variant="primary" disabled={!puedeGuardar || guardando} className="w-full justify-center">
          {guardando ? 'Guardando…' : 'Guardar'}
        </Btn>
      </form>
    </Modal>
  );
}
