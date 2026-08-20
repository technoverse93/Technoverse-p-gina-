import React, { useState } from 'react';
import { ShieldCheck, KeyRound } from 'lucide-react';
import { Modal, useToast } from '../ui/Overlays';
import { Btn, Field } from '../admin/AdminKit';
import { verificarTokenSeguridad, cambiarContrasenaConToken } from '../../utils/securityPin';

interface Props {
  open: boolean;
  onClose: () => void;
}

const soloDigitos = (v: string) => v.replace(/\D/g, '').slice(0, 4);

/**
 * Cambio de contraseña con el token de 4 dígitos como seguro maestro.
 *
 * ÚNICA vía de cambio de contraseña de la cuenta propia en todo el
 * sistema — vive solo en el menú plegable de la cuenta (AdminShell.tsx),
 * a propósito. Dos pasos, cada uno con su propia verificación:
 *
 *   1) Token de 4 dígitos — se comprueba contra el servidor ANTES de
 *      mostrar el formulario de la contraseña nueva. Un token incorrecto
 *      no deja avanzar ni un paso.
 *   2) Contraseña nueva (+ confirmación) — solo se envía después de que
 *      el paso 1 ya quedó validado en el servidor.
 */
export default function CambiarContrasenaModal({ open, onClose }: Props) {
  const toast = useToast();
  const [paso, setPaso] = useState<'token' | 'contrasena'>('token');
  const [pin, setPin] = useState('');
  const [verificando, setVerificando] = useState(false);
  const [errorPin, setErrorPin] = useState<string | null>(null);

  const [nueva, setNueva] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [errorContrasena, setErrorContrasena] = useState<string | null>(null);

  const cerrarYLimpiar = () => {
    onClose();
    // Se limpia SIEMPRE al cerrar, se haya completado o no: un token o
    // una contraseña a medio escribir no deben sobrevivir a la siguiente
    // apertura del modal.
    setTimeout(() => {
      setPaso('token'); setPin(''); setErrorPin('');
      setNueva(''); setConfirmacion(''); setErrorContrasena('');
    }, 200);
  };

  const verificarPin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorPin(null);
    if (pin.length !== 4) { setErrorPin('El token debe tener 4 dígitos.'); return; }
    setVerificando(true);
    try {
      const resultado = await verificarTokenSeguridad(pin);
      if (resultado.ok) setPaso('contrasena');
      else setErrorPin(resultado.mensaje);
    } finally {
      setVerificando(false);
    }
  };

  const cambiarContrasena = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorContrasena(null);
    if (nueva.length < 8) { setErrorContrasena('La nueva contraseña debe tener al menos 8 caracteres.'); return; }
    if (nueva !== confirmacion) { setErrorContrasena('Las dos contraseñas no coinciden.'); return; }

    setGuardando(true);
    try {
      // Se vuelve a pedir el token al servidor en este paso (no se
      // reutiliza el "sí" del paso 1): así el seguro maestro cubre el
      // cambio de contraseña en sí, no solo el acceso al formulario.
      const resultado = await cambiarContrasenaConToken(pin, nueva);
      if (resultado.ok) {
        toast.success(resultado.mensaje);
        cerrarYLimpiar();
      } else {
        setErrorContrasena(resultado.mensaje);
      }
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal open={open} onClose={cerrarYLimpiar} title="Cambiar contraseña" size="sm">
      {paso === 'token' ? (
        <form onSubmit={verificarPin} className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-3">
            <ShieldCheck className="w-5 h-5 flex-shrink-0 text-[var(--accent)]" />
            <p className="text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
              Ingrese su token de seguridad de 4 dígitos para continuar.
            </p>
          </div>
          <Field label="Token de seguridad">
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
          {errorPin && <p className="text-[12.5px] font-semibold text-[#E5484D]">{errorPin}</p>}
          <Btn type="submit" variant="primary" disabled={verificando} className="w-full justify-center">
            {verificando ? 'Verificando…' : 'Verificar token'}
          </Btn>
        </form>
      ) : (
        <form onSubmit={cambiarContrasena} className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-[var(--ok)]/40 bg-[var(--ok-soft)] p-3">
            <KeyRound className="w-5 h-5 flex-shrink-0 text-[var(--ok)]" />
            <p className="text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
              Token verificado. Escriba la nueva contraseña.
            </p>
          </div>
          <Field label="Nueva contraseña" hint="Mínimo 8 caracteres.">
            <input
              className="tv-input font-mono"
              type="password"
              autoComplete="new-password"
              value={nueva}
              onChange={e => setNueva(e.target.value)}
              autoFocus
            />
          </Field>
          <Field label="Confirmar contraseña">
            <input
              className="tv-input font-mono"
              type="password"
              autoComplete="new-password"
              value={confirmacion}
              onChange={e => setConfirmacion(e.target.value)}
            />
          </Field>
          {errorContrasena && <p className="text-[12.5px] font-semibold text-[#E5484D]">{errorContrasena}</p>}
          <Btn type="submit" variant="primary" disabled={guardando} className="w-full justify-center">
            {guardando ? 'Guardando…' : 'Cambiar contraseña'}
          </Btn>
        </form>
      )}
    </Modal>
  );
}
