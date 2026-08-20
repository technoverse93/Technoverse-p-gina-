import React, { useState } from 'react';
import { ShieldCheck, CheckCircle2 } from 'lucide-react';
import { Modal } from '../ui/Overlays';
import { Btn, Field } from '../admin/AdminKit';
import { useToast } from '../ui/Overlays';
import { crearTokenSeguridad } from '../../utils/securityPin';

interface Props {
  open: boolean;
  onCreado: () => void;
}

const soloDigitos = (v: string) => v.replace(/\D/g, '').slice(0, 4);

/**
 * Pantalla OBLIGATORIA de creación del token de seguridad de 4 dígitos.
 *
 * Sin `onClose` ni `closeOnBackdrop`: no hay forma de saltársela. Se
 * muestra la primera vez que una cuenta Administrador (Dueño) inicia
 * sesión sin tener el token configurado — ya sea porque es nueva, o
 * porque la cuenta existía desde antes de que este seguro existiera.
 *
 * Pide el PIN dos veces (crear + confirmar) porque no hay ninguna
 * pantalla de "olvidé mi token": si se escribe mal aquí y nadie lo nota,
 * el seguro maestro del cambio de contraseña queda inservible.
 *
 * Dos pasos, no uno: el guardado ("Guardar") y la entrada al panel
 * ("Ingresar al panel de admin") son dos acciones explícitas y
 * separadas. Antes `onCreado()` se llamaba solo al terminar de guardar,
 * sin ninguna confirmación visible de que el guardado en Supabase
 * realmente se completó — quien lo usaba no tenía forma de distinguir
 * "ya guardó" de "se quedó pensando", lo que reportaron como "no me deja
 * guardar el PIN". El paso 'listo' hace ese éxito explícito antes de
 * dejar avanzar.
 */
export default function CrearTokenModal({ open, onCreado }: Props) {
  const toast = useToast();
  const [paso, setPaso] = useState<'crear' | 'listo'>('crear');
  const [pin, setPin] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (pin.length !== 4) { setError('El token debe tener exactamente 4 dígitos.'); return; }
    if (pin !== confirmacion) { setError('Los dos tokens no coinciden.'); return; }

    setGuardando(true);
    try {
      const resultado = await crearTokenSeguridad(pin);
      if (resultado.ok) {
        toast.success('Token de seguridad creado. Lo va a necesitar para cambiar la contraseña.');
        setPaso('listo');
      } else {
        setError(resultado.mensaje);
      }
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal open={open} onClose={() => {}} closeOnBackdrop={false} hideClose title="Cree su token de seguridad" size="sm">
      {paso === 'crear' ? (
        <form onSubmit={enviar} className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-3">
            <ShieldCheck className="w-5 h-5 flex-shrink-0 text-[var(--accent)]" />
            <p className="text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
              Este PIN de 4 dígitos es el seguro maestro para cambiar la contraseña de esta cuenta.
              Sin él no se puede cambiar la contraseña desde el menú de la cuenta. Guárdelo en un lugar seguro:
              no hay forma de recuperarlo si se olvida, solo de restablecerlo con acceso directo a la base de datos.
            </p>
          </div>

          <Field label="Cree un token de 4 dígitos">
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
          <Field label="Confirme el token">
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

          <Btn type="submit" variant="primary" disabled={guardando} className="w-full justify-center text-[15px] py-3">
            {guardando ? 'Guardando…' : 'Guardar'}
          </Btn>
        </form>
      ) : (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-[var(--ok)]/40 bg-[var(--ok-soft)] p-3">
            <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-[var(--ok)]" />
            <p className="text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
              Token de seguridad guardado correctamente en Supabase. Ya lo puede usar la próxima vez
              que necesite cambiar la contraseña de esta cuenta.
            </p>
          </div>
          <Btn type="button" variant="primary" onClick={onCreado} className="w-full justify-center text-[15px] py-3">
            Ingresar al panel de admin
          </Btn>
        </div>
      )}
    </Modal>
  );
}
