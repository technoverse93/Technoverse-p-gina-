import React, { useEffect, useMemo, useState } from 'react';
import { KeyRound, Grid3x3, Fingerprint, ShieldCheck, ShieldOff } from 'lucide-react';
import { useToast } from '../ui/Overlays';
import { Btn, Field } from '../admin/AdminKit';
import PatronLock from './PatronLock';
import {
  MetodoDesbloqueo, metodoDesbloqueoLocal, configurarDesbloqueoLocal, quitarDesbloqueoLocal,
  motivoSecretoInvalido, PIN_MIN, PIN_MAX, PATRON_MIN_PUNTOS,
} from '../../utils/desbloqueoLocal';
import { soportaBiometria, biometriaYaActivada } from '../../utils/biometria';

interface Props {
  /** Correo de la cuenta con la sesión abierta: el PIN/patrón queda atado a ella. */
  email: string;
}

const soloDigitos = (v: string) => v.replace(/\D/g, '').slice(0, PIN_MAX);

/**
 * Configuración del PIN o patrón de ESTE aparato.
 *
 * Muestra de forma explícita con qué se está protegiendo el acceso —
 * Biometría, PIN, Patrón o nada—, que es la diferenciación que se pidió,
 * y cada método se guarda con un botón «Guardar» visible: nada depende de
 * pulsar Enter en el teclado.
 */
export default function ConfigurarDesbloqueoLocal({ email }: Props) {
  const toast = useToast();
  const [actual, setActual] = useState<MetodoDesbloqueo | null>(() => metodoDesbloqueoLocal());
  const [hayLector, setHayLector] = useState(false);
  const [huellaActiva, setHuellaActiva] = useState(false);
  const [metodo, setMetodo] = useState<MetodoDesbloqueo>('pin');
  const [editando, setEditando] = useState(false);

  const [pin, setPin] = useState('');
  const [pinConfirma, setPinConfirma] = useState('');
  const [patron, setPatron] = useState<string | null>(null);
  const [patronConfirma, setPatronConfirma] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vigente = true;
    soportaBiometria().then(v => { if (vigente) setHayLector(v); });
    biometriaYaActivada().then(v => { if (vigente) setHuellaActiva(v); });
    return () => { vigente = false; };
  }, []);

  const limpiar = () => {
    setPin(''); setPinConfirma(''); setPatron(null); setPatronConfirma(null); setError(null);
  };

  const puedeGuardar = useMemo(() => {
    if (metodo === 'pin') {
      return pin.length >= PIN_MIN && pinConfirma.length === pin.length && pin === pinConfirma;
    }
    return !!patron && !!patronConfirma && patron === patronConfirma;
  }, [metodo, pin, pinConfirma, patron, patronConfirma]);

  const guardar = async () => {
    setError(null);
    const secreto = metodo === 'pin' ? pin : (patron || '');
    const invalido = motivoSecretoInvalido(metodo, secreto);
    if (invalido) { setError(invalido); return; }
    if (!puedeGuardar) { setError('Los dos ingresos no coinciden.'); return; }

    setGuardando(true);
    try {
      const r = await configurarDesbloqueoLocal(metodo, secreto, email);
      if (r.ok) {
        toast.success(r.mensaje);
        setActual(metodoDesbloqueoLocal());
        setEditando(false);
        limpiar();
      } else {
        setError(r.mensaje);
        toast.error(r.mensaje);
      }
    } finally {
      setGuardando(false);
    }
  };

  const quitar = () => {
    quitarDesbloqueoLocal();
    setActual(null);
    limpiar();
    setEditando(false);
    toast.success('PIN o patrón retirado de este aparato.');
  };

  // Qué protege HOY el acceso a este aparato, dicho sin rodeos.
  const proteccion: { texto: string; activa: boolean } = (() => {
    const partes: string[] = [];
    if (huellaActiva) partes.push('Biometría');
    if (actual === 'pin') partes.push('PIN');
    if (actual === 'patron') partes.push('Patrón');
    return partes.length
      ? { texto: partes.join(' + '), activa: true }
      : { texto: 'Ninguno configurado', activa: false };
  })();

  const mostrandoFormulario = editando || !actual;

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-2xl p-4 space-y-4">
      <div className="flex items-start gap-3">
        {proteccion.activa
          ? <ShieldCheck className="w-5 h-5 flex-shrink-0 text-[var(--ok)]" />
          : <ShieldOff className="w-5 h-5 flex-shrink-0 text-[var(--tv-warn,#c9862c)]" />}
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-secondary)]">
            Protección de este aparato
          </p>
          <p className="text-sm font-semibold text-[var(--text-primary)]">{proteccion.texto}</p>
          <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-secondary)]">
            {hayLector
              ? 'Este aparato tiene lector biométrico. El PIN o patrón queda como respaldo cuando el lector falla.'
              : 'Este aparato no tiene lector biométrico disponible. Configure un PIN o un patrón para poder desbloquear la aplicación.'}
          </p>
        </div>
      </div>

      {!mostrandoFormulario && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-lg bg-[var(--bg-base)] px-3 py-2 text-xs font-bold text-[var(--text-primary)]">
            {actual === 'pin' ? <KeyRound className="w-4 h-4" /> : <Grid3x3 className="w-4 h-4" />}
            {actual === 'pin' ? 'PIN activo' : 'Patrón activo'}
          </span>
          <Btn onClick={() => { limpiar(); setMetodo(actual || 'pin'); setEditando(true); }}>Cambiar</Btn>
          <Btn variant="danger" onClick={quitar}>Quitar</Btn>
        </div>
      )}

      {mostrandoFormulario && (
        <form
          onSubmit={e => { e.preventDefault(); if (puedeGuardar && !guardando) void guardar(); }}
          className="space-y-4"
        >
          <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Método de desbloqueo">
            {(['pin', 'patron'] as MetodoDesbloqueo[]).map(m => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={metodo === m}
                onClick={() => { setMetodo(m); limpiar(); }}
                className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold transition ${
                  metodo === m
                    ? 'border-[var(--accent)] bg-[rgba(var(--accent-rgb),0.12)] text-[var(--text-primary)]'
                    : 'border-[var(--border-color)] text-[var(--text-secondary)]'
                }`}
              >
                {m === 'pin' ? <KeyRound className="w-4 h-4" /> : <Grid3x3 className="w-4 h-4" />}
                {m === 'pin' ? 'PIN numérico' : 'Patrón visual'}
              </button>
            ))}
          </div>

          {metodo === 'pin' ? (
            <>
              <Field label={`Nuevo PIN (${PIN_MIN} a ${PIN_MAX} dígitos)`}>
                <input
                  className="tv-input font-mono text-center text-lg tracking-[0.5em]"
                  type="password" inputMode="numeric" autoComplete="off"
                  maxLength={PIN_MAX} value={pin}
                  onChange={e => { setPin(soloDigitos(e.target.value)); setError(null); }}
                  placeholder="••••"
                />
              </Field>
              <Field label="Confirmar PIN">
                <input
                  className="tv-input font-mono text-center text-lg tracking-[0.5em]"
                  type="password" inputMode="numeric" autoComplete="off"
                  maxLength={PIN_MAX} value={pinConfirma}
                  onChange={e => { setPinConfirma(soloDigitos(e.target.value)); setError(null); }}
                  placeholder="••••"
                />
              </Field>
              {pinConfirma.length > 0 && pinConfirma.length === pin.length && pin !== pinConfirma && (
                <p className="text-[12.5px] font-semibold text-[#E5484D]">Los dos PIN no coinciden.</p>
              )}
            </>
          ) : (
            <div className="space-y-3">
              <p className="text-[12.5px] font-semibold text-[var(--text-primary)]">
                {!patron
                  ? `1. Dibuje su patrón (mínimo ${PATRON_MIN_PUNTOS} puntos)`
                  : !patronConfirma
                    ? '2. Dibújelo otra vez para confirmar'
                    : patron === patronConfirma ? 'Los dos patrones coinciden.' : 'Los patrones no coinciden.'}
              </p>
              <PatronLock
                error={!!patron && !!patronConfirma && patron !== patronConfirma}
                onCompleto={p => {
                  setError(null);
                  if (!patron) {
                    const invalido = motivoSecretoInvalido('patron', p);
                    if (invalido) setError(invalido); else setPatron(p);
                  } else {
                    setPatronConfirma(p);
                  }
                }}
              />
              {(patron || patronConfirma) && (
                <Btn type="button" onClick={() => { setPatron(null); setPatronConfirma(null); setError(null); }}>
                  Volver a dibujar
                </Btn>
              )}
            </div>
          )}

          {error && <p className="text-[12.5px] font-semibold text-[#E5484D]" role="alert">{error}</p>}

          <div className="flex gap-2">
            <Btn type="submit" variant="primary" disabled={!puedeGuardar || guardando} className="flex-1 justify-center">
              {guardando ? 'Guardando…' : 'Guardar'}
            </Btn>
            {actual && (
              <Btn type="button" onClick={() => { limpiar(); setEditando(false); }} className="justify-center">
                Cancelar
              </Btn>
            )}
          </div>
          {!puedeGuardar && (
            <p className="text-[11.5px] text-[var(--text-secondary)]">
              {metodo === 'pin'
                ? 'El botón se activa cuando el PIN y su confirmación son iguales.'
                : 'El botón se activa cuando dibuje el mismo patrón dos veces.'}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
