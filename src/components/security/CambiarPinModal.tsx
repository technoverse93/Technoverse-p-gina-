import React, { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Modal, useToast } from '../ui/Overlays';
import { Btn, Field } from '../admin/AdminKit';
import { crearTokenSeguridad } from '../../utils/securityPin';

interface Props {
  open: boolean;
  onClose: () => void;
}

const soloDigitos = (v: string) => v.replace(/\D/g, '').slice(0, 4);

/**
 * Cambiar/restablecer el token de seguridad de 4 dígitos ya configurado.
 *
 * ÚNICAMENTE se monta desde AdminShell.tsx cuando el correo de la sesión
 * es exactamente el del administrador supremo (ver `esAdminSupremo` en
 * securityPin.ts) — ese es el filtro de frontend. Pero el filtro real
 * vive en el servidor: `set_security_pin()` rechaza el sobrescrito de un
 * token ya existente si `auth.users.email` no es ese correo exacto, así
 * que aunque alguien fuerce este modal a abrirse (o llame al RPC
 * directo) sin ser el admin supremo, la base de datos igual lo rechaza.
 */
export default function CambiarPinModal({ open, onClose }: Props) {
  const toast = useToast();
  const [pin, setPin] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cerrarYLimpiar = () => {
    onClose();
    setTimeout(() => { setPin(''); setConfirmacion(''); setError(null); }, 200);
  };

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (pin.length !== 4) { setError('El nuevo token debe tener exactamente 4 dígitos.'); return; }
    if (pin !== confirmacion) { setError('Los dos tokens no coinciden.'); return; }

    setGuardando(true);
    try {
      const resultado = await crearTokenSeguridad(pin);
      if (resultado.ok) {
        toast.success('Token de seguridad actualizado.');
        cerrarYLimpiar();
      } else {
        setError(resultado.mensaje);
      }
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal open={open} onClose={cerrarYLimpiar} title="Cambiar PIN de seguridad" size="sm">
      <form onSubmit={enviar} className="space-y-4">
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
          <ShieldAlert className="w-5 h-5 flex-shrink-0 text-amber-500" />
          <p className="text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
            Esto reemplaza el token de seguridad actual. Solo el administrador supremo puede hacer este cambio,
            y el token anterior deja de servir de inmediato.
          </p>
        </div>

        <Field label="Nuevo token de 4 dígitos">
          <input
            className="tv-input font-mono text-center text-lg tracking-[0.5em]"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            value={pin}
            onChange={e => setPin(soloDigitos(e.target.value))}
            placeholder="••••"
            autoFocus
          />
        </Field>
        <Field label="Confirme el nuevo token">
          <input
            className="tv-input font-mono text-center text-lg tracking-[0.5em]"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            value={confirmacion}
            onChange={e => setConfirmacion(soloDigitos(e.target.value))}
            placeholder="••••"
          />
        </Field>

        {error && <p className="text-[12.5px] font-semibold text-[#E5484D]">{error}</p>}

        <Btn type="submit" variant="primary" disabled={guardando} className="w-full justify-center">
          {guardando ? 'Guardando…' : 'Guardar nuevo PIN'}
        </Btn>
      </form>
    </Modal>
  );
}
