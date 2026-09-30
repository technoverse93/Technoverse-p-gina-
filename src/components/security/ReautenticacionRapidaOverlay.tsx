import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Fingerprint } from 'lucide-react';
import { Z } from '../ui/Overlays';
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
 *
 * ---------------------------------------------------------------------
 * DISCRETO A PROPÓSITO
 * ---------------------------------------------------------------------
 * Antes era un diálogo con título, un párrafo explicando el segundo plano,
 * el correo, y una pila de botones. Se sentía como una alarma cada vez que
 * se volvía a la app. Ahora solo se difumina lo que hay detrás y se pide
 * la huella (o el PIN/patrón): un ícono, una línea corta y, abajo, enlaces
 * pequeños para cambiar de método o cerrar sesión. Los avisos de error
 * son de una línea; una cancelación no muestra nada.
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
        setFallo(avisoCorto(resultado.mensaje));
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
      setFallo(avisoCorto(resultado.mensaje, 'Incorrecto'));
      setPin('');
      setEsperaSeg(Math.ceil(esperaRestanteMs() / 1000));
    } finally {
      if (vigente.current) setVerificando(false);
    }
  };

  const conEspera = esperaSeg > 0;
  const localDisponible = capacidades?.metodoLocal ?? null;
  const usarHuella = () => { setFallo(null); setModo('biometria'); void pedirHuella(); };

  const enlace = 'text-[12.5px] font-semibold text-white/75 hover:text-white underline-offset-4 hover:underline disabled:opacity-50 px-2 py-1';

  return createPortal(
    <div
      className="fixed inset-0 flex flex-col items-center justify-center gap-5 px-6 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150"
      style={{ zIndex: Z.modal, paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      role="dialog"
      aria-modal="true"
      aria-label="Desbloquear"
    >
      {/* Solo se difumina lo que hay detrás: nada se desmonta. */}
      <div className="absolute inset-0 bg-slate-950/45 backdrop-blur-xl" aria-hidden="true" />

      <div className="relative flex flex-col items-center gap-4 w-full max-w-[300px]">
        {modo === 'biometria' && (
          <button
            type="button"
            onClick={pedirHuella}
            disabled={verificando}
            aria-label="Confirmar con la huella"
            className="w-20 h-20 rounded-full flex items-center justify-center bg-white/10 ring-1 ring-white/25 text-white transition active:scale-95"
          >
            <Fingerprint className={`w-10 h-10 ${verificando ? 'animate-pulse' : ''}`} />
          </button>
        )}

        {modo === 'pin' && (
          <div className="w-full rounded-2xl bg-[var(--bg-surface)] shadow-2xl p-4">
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
          <div className="w-full rounded-2xl bg-[var(--bg-surface)] shadow-2xl p-3">
            <PatronLock onCompleto={probarSecreto} disabled={verificando || conEspera} error={!!fallo} />
          </div>
        )}

        {modo !== 'cargando' && (
          <p className="min-h-[18px] text-center text-[13px] font-semibold text-white/90" role={fallo ? 'alert' : undefined}>
            {conEspera
              ? `Espere ${esperaSeg} s`
              : fallo || (modo === 'biometria' ? 'Confirme con su huella' : modo === 'pin' ? 'Ingrese su PIN' : 'Dibuje su patrón')}
          </p>
        )}
      </div>

      {modo !== 'cargando' && (
        <div className="relative flex flex-wrap items-center justify-center gap-x-3">
          {modo === 'biometria' && localDisponible && (
            <button type="button" className={enlace} onClick={() => { setFallo(null); setModo(localDisponible); }}>
              {localDisponible === 'pin' ? 'Usar PIN' : 'Usar patrón'}
            </button>
          )}
          {(modo === 'pin' || modo === 'patron') && capacidades?.biometria && (
            <button type="button" className={enlace} onClick={usarHuella}>Usar huella</button>
          )}
          <button type="button" className={enlace} onClick={onFalloTotal}>Cerrar sesión</button>
        </div>
      )}
    </div>,
    document.body,
  );
}

/**
 * Una línea, no un párrafo. Solo se conserva el texto largo cuando pide
 * algo que la persona tiene que hacer (entrar con la contraseña).
 */
function avisoCorto(mensaje: string | undefined, porDefecto = 'No se reconoció. Toque para reintentar'): string {
  if (mensaje && /contraseña/i.test(mensaje)) return 'Entre con su contraseña para continuar';
  if (mensaje && /demasiados intentos/i.test(mensaje)) return 'Demasiados intentos. Espere un momento';
  return porDefecto;
}
