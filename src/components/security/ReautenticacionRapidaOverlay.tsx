import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Fingerprint } from 'lucide-react';
import { Z } from '../ui/Overlays';
import {
  capacidadesDeDesbloqueo, entrarConBiometria, entrarConDesbloqueoLocal,
  CapacidadesDesbloqueo,
} from '../../utils/biometria';
import { esperaRestanteMs, longitudPinLocal, metodoDesbloqueoLocal } from '../../utils/desbloqueoLocal';
import { esAplicacionNativa } from '../../utils/biometriaNativa';
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
  onDesbloqueado: (resultado: { userId?: string; email?: string }) => void | Promise<void>;
  /**
   * La persona no quiere (o no puede) abrir el cerrojo con la huella y pide entrar con su contraseña.
   * La pantalla de arriba tiene que dejar ver el acceso: ver `candadoOmitido` en App.tsx.
   */
  onFalloTotal: () => void;
  /**
   * Este aparato no tiene NINGÚN método para abrir el cerrojo: ni lector
   * biométrico disponible ni PIN/patrón configurado. Ver el bloque de abajo.
   */
  onSinMetodo: () => void;
  /**
   * «arranque»: la app se acaba de abrir y no hay nada que mostrar debajo (el candado es la pantalla).
   * Antes se difuminaba lo que hubiera detrás: con el panel todavía sin mostrar eso era un fondo liso,
   * negro o blanco según el tema, con un icono casi invisible («se queda en pantalla negra o blanca»).
   * «sobre-pantalla»: se vuelve del segundo plano y se difumina lo que ya estaba en pantalla.
   */
  variante?: 'sobre-pantalla' | 'arranque';
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
/** Lo que tarda como máximo cada paso que depende del teléfono: pasado esto, el candado no se queda esperando. */
const LIMITE_CAPACIDADES_MS = 3500;
const LIMITE_DIALOGO_HUELLA_MS = 45_000;

/** Devuelve `valor` si `promesa` no responde (o falla) a tiempo. */
function conLimite<T>(promesa: Promise<T>, ms: number, valor: T): Promise<T> {
  return new Promise<T>(resolver => {
    const t = setTimeout(() => resolver(valor), ms);
    promesa.then(v => { clearTimeout(t); resolver(v); }, () => { clearTimeout(t); resolver(valor); });
  });
}

export default function ReautenticacionRapidaOverlay({ email, onDesbloqueado, onFalloTotal, onSinMetodo, variante = 'sobre-pantalla' }: Props) {
  const [capacidades, setCapacidades] = useState<CapacidadesDesbloqueo | null>(null);
  const [modo, setModo] = useState<Modo>('cargando');
  const [fallo, setFallo] = useState<string | null>(null);
  const [verificando, setVerificando] = useState(false);
  // Ya se aprobó el dedo y se está terminando de entrar (leer el perfil puede tardar con mala red).
  const [entrando, setEntrando] = useState(false);
  const [pin, setPin] = useState('');
  const [esperaSeg, setEsperaSeg] = useState(0);
  const enCurso = useRef(false);
  const vigente = useRef(true);
  const arranque = variante === 'arranque';

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

  /** Termina de entrar con lo que acaba de abrir el cerrojo, mostrando «Entrando…» mientras tanto. */
  const terminarDeEntrar = async (resultado: { userId?: string; email?: string }) => {
    setEntrando(true);
    try {
      await onDesbloqueado(resultado);
    } catch {
      if (vigente.current) setFallo('No se pudo abrir su sesión. Revise la conexión y toque para reintentar');
    } finally {
      if (vigente.current) setEntrando(false);
    }
  };

  const pedirHuella = async () => {
    if (enCurso.current) return;
    enCurso.current = true;
    setVerificando(true);
    setFallo(null);
    try {
      // Si el diálogo del sistema nunca se dibuja ni responde, no se deja el botón apagado para siempre.
      const resultado = await Promise.race([
        entrarConBiometria(email),
        new Promise<null>(r => setTimeout(() => r(null), LIMITE_DIALOGO_HUELLA_MS)),
      ]);
      if (!vigente.current) return;
      if (resultado === null) {
        setFallo('No se confirmó la huella. Toque para reintentar');
      } else if (resultado.ok) {
        await terminarDeEntrar({ userId: resultado.userId, email: resultado.email });
      } else if (!resultado.cancelado) {
        setFallo(avisoCorto(resultado.mensaje));
      }
      // Cancelado: no se regaña. Los botones de abajo siguen ahí.
    } catch {
      if (vigente.current) setFallo('No se pudo verificar. Toque para reintentar');
    } finally {
      enCurso.current = false;
      if (vigente.current) setVerificando(false);
    }
  };

  // Decide el método al montarse.
  useEffect(() => {
    (async () => {
      // Si el teléfono no contesta si hay huella, el candado no se queda vacío para siempre: como el candado
      // existe porque la huella estaba activada, se da por buena y se intenta (si no, se verá el error).
      const alterno: CapacidadesDesbloqueo = {
        biometria: esAplicacionNativa(),
        metodoLocal: metodoDesbloqueoLocal(),
        hayAlguno: true,
      };
      const c = await conLimite(capacidadesDeDesbloqueo(), LIMITE_CAPACIDADES_MS, alterno);
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
        await terminarDeEntrar({ userId: resultado.userId, email: resultado.email });
        return;
      }
      setFallo(avisoCorto(resultado.mensaje, 'Incorrecto'));
      setPin('');
      setEsperaSeg(Math.ceil(esperaRestanteMs() / 1000));
    } catch {
      if (vigente.current) setFallo('No se pudo verificar. Intente de nuevo');
    } finally {
      if (vigente.current) setVerificando(false);
    }
  };

  const conEspera = esperaSeg > 0;
  const localDisponible = capacidades?.metodoLocal ?? null;
  const usarHuella = () => { setFallo(null); setModo('biometria'); void pedirHuella(); };

  const enlace = 'text-[12.5px] font-semibold text-white/75 hover:text-white underline-offset-4 hover:underline disabled:opacity-50 px-2 py-1';

  const mensaje = entrando
    ? 'Entrando…'
    : conEspera
      ? `Espere ${esperaSeg} s`
      : fallo || (modo === 'biometria'
        ? (verificando ? 'Confirme con su huella' : arranque ? 'Toque la huella para entrar' : 'Confirme con su huella')
        : modo === 'pin' ? 'Ingrese su PIN' : 'Dibuje su patrón');

  return createPortal(
    <div
      className="fixed inset-0 flex flex-col items-center justify-center gap-5 px-6 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150"
      style={{ zIndex: Z.modal, paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      role="dialog"
      aria-modal="true"
      aria-label="Desbloquear"
    >
      {arranque
        // La app recién abierta: pantalla propia, con colores fijos (se lee igual con el tema claro o el oscuro).
        ? <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, #0B1530 0%, #0F1217 60%)' }} aria-hidden="true" />
        // Solo se difumina lo que hay detrás: nada se desmonta.
        : <div className="absolute inset-0 bg-slate-950/45 backdrop-blur-xl" aria-hidden="true" />}

      {arranque && (
        <div className="relative flex flex-col items-center gap-1.5 text-center">
          <img src="/logo.png" alt="" width={72} height={72} className="w-[72px] h-[72px] rounded-2xl shadow-lg shadow-black/40" />
          <div className="mt-2 text-[20px] font-bold text-[#E9ECF1] leading-tight">Technoverse</div>
          <div className="text-[12.5px] text-[#8B93A1]">Panel de administración</div>
          {email && <div className="max-w-[260px] truncate text-[12px] text-[#8B93A1]/80">{email}</div>}
        </div>
      )}

      <div className="relative flex flex-col items-center gap-4 w-full max-w-[300px]">
        {(modo === 'cargando' || entrando) && (
          <div className="w-9 h-9 rounded-full border-2 border-white/70 border-t-transparent animate-spin" role="status" aria-label="Cargando" />
        )}

        {modo === 'biometria' && !entrando && (
          <button
            type="button"
            onClick={pedirHuella}
            disabled={verificando}
            aria-label="Confirmar con la huella"
            className={arranque
              ? 'w-24 h-24 rounded-full flex items-center justify-center bg-[#FB923C] text-[#1a1206] shadow-lg shadow-orange-500/25 transition active:scale-95 disabled:opacity-90'
              : 'w-20 h-20 rounded-full flex items-center justify-center bg-white/10 ring-1 ring-white/25 text-white transition active:scale-95'}
          >
            <Fingerprint className={`${arranque ? 'w-12 h-12' : 'w-10 h-10'} ${verificando ? 'animate-pulse' : ''}`} />
          </button>
        )}

        {modo === 'pin' && !entrando && (
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

        {modo === 'patron' && !entrando && (
          <div className="w-full rounded-2xl bg-[var(--bg-surface)] shadow-2xl p-3">
            <PatronLock onCompleto={probarSecreto} disabled={verificando || conEspera} error={!!fallo} />
          </div>
        )}

        {modo !== 'cargando' && (
          <p className="min-h-[18px] text-center text-[13.5px] font-semibold text-white/90" role={fallo ? 'alert' : undefined}>
            {mensaje}
          </p>
        )}
        {modo === 'cargando' && arranque && <p className="text-center text-[13px] text-white/70">Preparando el acceso…</p>}
      </div>

      {/* Mientras carga el candado también se ofrece la salida: nunca queda una pantalla sin nada que tocar. */}
      {!entrando && (
        <div className="relative flex flex-wrap items-center justify-center gap-x-3">
          {modo === 'biometria' && localDisponible && (
            <button type="button" className={enlace} onClick={() => { setFallo(null); setModo(localDisponible); }}>
              {localDisponible === 'pin' ? 'Usar PIN' : 'Usar patrón'}
            </button>
          )}
          {(modo === 'pin' || modo === 'patron') && capacidades?.biometria && (
            <button type="button" className={enlace} onClick={usarHuella}>Usar huella</button>
          )}
          <button type="button" className={enlace} onClick={onFalloTotal}>{arranque ? 'Entrar con contraseña' : 'Cerrar sesión'}</button>
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
