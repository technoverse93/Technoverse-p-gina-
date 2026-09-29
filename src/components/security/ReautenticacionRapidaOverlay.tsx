import React, { useEffect, useRef, useState } from 'react';
import { ShieldCheck, Fingerprint, RotateCw, LogOut, KeyRound, Grid3x3 } from 'lucide-react';
import { Modal } from '../ui/Overlays';
import { Btn } from '../admin/AdminKit';
import {
  capacidadesDeDesbloqueo, entrarConBiometria, entrarConDesbloqueoLocal,
  CapacidadesDesbloqueo,
} from '../../utils/biometria';
import { esperaRestanteMs, longitudPinLocal } from '../../utils/desbloqueoLocal';
import TecladoPin from './TecladoPin';
import PatronLock from './PatronLock';

interface Props {
  email: string;
  /**
   * Recibe la identidad que acaba de abrir el cerrojo (`userId`/`email`). El
   * candado de ausencia breve la ignora —ya tenía `currentUser` puesto de
   * antes—, pero el de ARRANQUE EN FRÍO (App.tsx) la necesita para poblar
   * `currentUser` desde cero.
   */
  onDesbloqueado: (resultado: { userId?: string; email?: string }) => void;
  /** Mismo efecto que "Cerrar sesión": cierre real y vuelta a la tienda pública. */
  onFalloTotal: () => void;
  /**
   * Este aparato no tiene NINGÚN método para abrir el cerrojo: ni lector
   * biométrico disponible ni PIN/patrón configurado. Ver el bloque de abajo.
   */
  onSinMetodo: () => void;
}

type Modo = 'cargando' | 'biometria' | 'pin' | 'patron';

/**
 * Candado de re-autenticación: huella, PIN o patrón, el que ESTE aparato
 * pueda usar.
 *
 * A propósito NO es una pantalla nueva ni una redirección: se monta
 * FLOTANDO encima de lo que ya estaba en pantalla, sin desmontar nada, y
 * por eso preserva lo que la persona estuviera haciendo.
 *
 * ---------------------------------------------------------------------
 * FALLO CORREGIDO — el candado que exigía hardware que no existe
 * ---------------------------------------------------------------------
 * Antes este componente SOLO sabía pedir huella. En una tablet sin lector
 * (Redmi Pad SE) o en el navegador respondía "este aparato no tiene la
 * huella disponible" y no había nada más que hacer, salvo cerrar sesión:
 * imposible de usar.
 *
 * Ahora elige el método según lo que el aparato tiene, sin mostrar
 * errores de hardware que no existe:
 *
 *   · Hay lector biométrico  → se pide la huella. Si falla o se cancela,
 *     NO se cierra nada: se ofrece reintentar y, si hay PIN o patrón
 *     configurado, usarlo en su lugar.
 *   · No hay lector, pero hay PIN/patrón → se muestra directo.
 *   · No hay ninguno → `onSinMetodo`. Aquí el candado no tiene con qué
 *     abrirse, y encerrar a la persona sin salida (lo que pasaba) es
 *     peor que no ofrecerlo.
 *
 * La sesión solo termina si alguien toca "Cerrar sesión" a propósito,
 * nunca por un fallo del sensor ni por equivocarse de PIN.
 */
export default function ReautenticacionRapidaOverlay({ email, onDesbloqueado, onFalloTotal, onSinMetodo }: Props) {
  const [capacidades, setCapacidades] = useState<CapacidadesDesbloqueo | null>(null);
  const [modo, setModo] = useState<Modo>('cargando');
  const [fallo, setFallo] = useState<string | null>(null);
  const [verificando, setVerificando] = useState(false);
  const [pin, setPin] = useState('');
  const [esperaSeg, setEsperaSeg] = useState(0);
  const enCurso = useRef(false);
  const vigente = useRef(true);

  useEffect(() => {
    vigente.current = true;
    return () => { vigente.current = false; };
  }, []);

  // Cuenta regresiva del freno por intentos fallidos.
  useEffect(() => {
    const revisar = () => setEsperaSeg(Math.ceil(esperaRestanteMs() / 1000));
    revisar();
    const id = setInterval(revisar, 1000);
    return () => clearInterval(id);
  }, [modo]);

  const pedirHuella = async () => {
    if (enCurso.current) return;
    enCurso.current = true;
    setVerificando(true);
    setFallo(null);
    try {
      const resultado = await entrarConBiometria(email);
      if (!vigente.current) return;
      if (resultado.ok) {
        onDesbloqueado({ userId: resultado.userId, email: resultado.email });
      } else if (!resultado.cancelado) {
        setFallo(resultado.mensaje || 'No se pudo verificar. Puede deberse a un tropiezo del sensor — intente de nuevo.');
      }
      // Cancelado: no se regaña. Los botones de abajo siguen ahí.
    } finally {
      enCurso.current = false;
      if (vigente.current) setVerificando(false);
    }
  };

  // Decide el método al montarse.
  useEffect(() => {
    (async () => {
      const c = await capacidadesDeDesbloqueo();
      if (!vigente.current) return;
      setCapacidades(c);
      if (!c.hayAlguno) { onSinMetodo(); return; }
      if (c.biometria) { setModo('biometria'); void pedirHuella(); }
      else setModo(c.metodoLocal === 'patron' ? 'patron' : 'pin');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const probarSecreto = async (secreto: string) => {
    if (verificando) return;
    setVerificando(true);
    setFallo(null);
    try {
      const resultado = await entrarConDesbloqueoLocal(secreto, email);
      if (!vigente.current) return;
      if (resultado.ok) {
        onDesbloqueado({ userId: resultado.userId, email: resultado.email });
        return;
      }
      setFallo(resultado.mensaje || 'No se pudo verificar.');
      setPin('');
      setEsperaSeg(Math.ceil(esperaRestanteMs() / 1000));
    } finally {
      if (vigente.current) setVerificando(false);
    }
  };

  const conEspera = esperaSeg > 0;
  const localDisponible = capacidades?.metodoLocal ?? null;

  return (
    <Modal open onClose={() => {}} closeOnBackdrop={false} hideClose title="Confirme su identidad" size="sm">
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-3">
          <ShieldCheck className="w-5 h-5 flex-shrink-0 text-[var(--accent)]" />
          <p className="text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
            La aplicación estuvo en segundo plano. Confirme que sigue siendo{' '}
            <strong className="text-[var(--text-primary)]">{email || 'la cuenta de este aparato'}</strong>{' '}
            para continuar exactamente donde se quedó.
          </p>
        </div>

        {modo === 'cargando' && (
          <div className="flex items-center justify-center py-6 text-[12.5px] font-semibold text-[var(--text-secondary)]">
            Preparando…
          </div>
        )}

        {modo === 'biometria' && (
          <div className="flex flex-col items-center justify-center gap-3 py-4 text-[var(--text-secondary)]">
            <Fingerprint className={`w-10 h-10 ${fallo ? 'text-[var(--tv-warn,#c9862c)]' : 'text-[var(--accent)] animate-pulse'}`} />
            <span className="text-[12.5px] font-semibold text-center">
              {fallo || (verificando ? 'Esperando huella o Face ID…' : 'Toque «Reintentar» para usar la huella.')}
            </span>
          </div>
        )}

        {modo === 'pin' && (
          <div className="space-y-3">
            <TecladoPin
              valor={pin}
              onCambio={setPin}
              onCompleto={probarSecreto}
              longitud={longitudPinLocal()}
              disabled={verificando || conEspera}
              error={!!fallo}
            />
          </div>
        )}

        {modo === 'patron' && (
          <PatronLock onCompleto={probarSecreto} disabled={verificando || conEspera} error={!!fallo} />
        )}

        {(modo === 'pin' || modo === 'patron') && (fallo || conEspera) && (
          <p className="text-center text-[12.5px] font-semibold text-[#E5484D]" role="alert">
            {conEspera && !fallo ? `Espere ${esperaSeg} s para volver a intentar.` : fallo}
          </p>
        )}

        {modo !== 'cargando' && (
          <div className="flex flex-col gap-2">
            {modo === 'biometria' && (
              <Btn variant="primary" icon={RotateCw} onClick={pedirHuella} disabled={verificando} className="w-full justify-center">
                Reintentar
              </Btn>
            )}

            {/* Cambio de método: nunca se muestra uno que no esté configurado. */}
            {modo === 'biometria' && localDisponible && (
              <Btn
                variant="default"
                icon={localDisponible === 'pin' ? KeyRound : Grid3x3}
                onClick={() => { setFallo(null); setModo(localDisponible); }}
                className="w-full justify-center"
              >
                {localDisponible === 'pin' ? 'Usar mi PIN' : 'Usar mi patrón'}
              </Btn>
            )}
            {(modo === 'pin' || modo === 'patron') && capacidades?.biometria && (
              <Btn
                variant="default"
                icon={Fingerprint}
                onClick={() => { setFallo(null); setModo('biometria'); void pedirHuella(); }}
                className="w-full justify-center"
              >
                Usar la huella
              </Btn>
            )}

            <Btn variant="danger" icon={LogOut} onClick={onFalloTotal} className="w-full justify-center">
              Cerrar sesión
            </Btn>
          </div>
        )}
      </div>
    </Modal>
  );
}
