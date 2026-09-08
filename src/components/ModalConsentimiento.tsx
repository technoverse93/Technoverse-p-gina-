import { useState } from 'react';
import { ShieldCheck, ChevronDown, MonitorSmartphone, Camera } from 'lucide-react';
import {
  guardarConsentimiento,
  PERMISOS_POR_DEFECTO,
  type ClaveConsentimiento,
} from '../seguridad/consentimiento';

/**
 * El aviso de inicio, estilo "cookies".
 *
 * COMPORTAMIENTO EXACTO
 * ---------------------------------------------------------------------
 *   · Por defecto se ven SOLO "Aceptar" y "Rechazar". Los permisos
 *     concretos están ocultos.
 *   · "Aceptar" a secas concede todo lo que la plataforma necesita, en un
 *     único gesto — y desde ese mismo gesto se encadenan las peticiones
 *     nativas que el navegador permita (ver `onAceptar`).
 *   · "Ver detalles" abre el acordeón con un interruptor por permiso.
 *     Quien quiera, apaga lo que no desee y RECIÉN AHÍ acepta.
 *
 * `onResuelto` se llama SIEMPRE que la persona responde (acepte o
 * rechace), para que la app siga su curso: rechazar no bloquea nada.
 */

interface DetallePermiso {
  clave: ClaveConsentimiento;
  icono: typeof MonitorSmartphone;
  titulo: string;
  texto: string;
  /** Un permiso puede ser imprescindible; aquí ninguno lo es. */
  bloqueado?: boolean;
}

const PERMISOS: DetallePermiso[] = [
  {
    clave: 'supervision',
    icono: MonitorSmartphone,
    titulo: 'Soporte y supervisión en vivo',
    texto:
      'Permite que nuestro equipo vea esta pantalla mientras te atiende, para resolver más rápido. ' +
      'Solo se ve ESTA aplicación —nunca otras apps— y solo mientras la tenés abierta.',
  },
  {
    clave: 'camara',
    icono: Camera,
    titulo: 'Cámara para videollamada de soporte',
    texto:
      'Se usa solo si aceptás una videollamada para mostrar un equipo. Es solo video, sin audio, ' +
      'y el sistema te vuelve a pedir permiso en el momento. Nunca se enciende sola.',
  },
];

export default function ModalConsentimiento({ onResuelto }: { onResuelto: () => void }) {
  const [detalles, setDetalles] = useState(false);
  const [permisos, setPermisos] = useState<Record<ClaveConsentimiento, boolean>>({ ...PERMISOS_POR_DEFECTO });
  const [procesando, setProcesando] = useState(false);

  const alternar = (clave: ClaveConsentimiento) =>
    setPermisos(p => ({ ...p, [clave]: !p[clave] }));

  /**
   * Encadena las peticiones nativas AQUÍ, dentro del gesto de "Aceptar".
   *
   * Es el único momento en que el navegador acepta pedir permisos sin
   * fricción: un `click` real de por medio. Se hace con guantes —cada
   * intento envuelto— porque si el sistema deniega uno, no debe tumbar el
   * resto ni dejar el aviso colgado. Lo que no se pueda encadenar aquí se
   * pedirá cuando de verdad haga falta.
   */
  const onAceptar = async () => {
    if (procesando) return;
    setProcesando(true);
    guardarConsentimiento(true, permisos);

    // Cámara: se toca el permiso ahora, con el gesto, para que la primera
    // videollamada no tenga que pedirlo a mitad de camino. `registrarPermisoCamara`
    // ya está pensado para fallar en silencio si se deniega.
    if (permisos.camara) {
      try {
        const { registrarPermisoCamara } = await import('../supervision/camara');
        await registrarPermisoCamara();
      } catch { /* denegado o sin cámara: se pedirá al llamar */ }
    }

    onResuelto();
  };

  const onRechazar = () => {
    if (procesando) return;
    guardarConsentimiento(false, { supervision: false, camara: false });
    onResuelto();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/55 backdrop-blur-[2px] p-3 sm:p-6">
      <div className="w-full max-w-md rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-color)] shadow-[var(--float-shadow-lg)] overflow-hidden max-h-[calc(100dvh-2rem)] flex flex-col">
        <div className="p-5 flex flex-col gap-3 overflow-y-auto">
          <div className="flex items-center gap-2.5">
            <span className="w-10 h-10 rounded-xl bg-[rgba(var(--accent-rgb),0.14)] text-[var(--accent)] flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </span>
            <h2 className="font-display font-bold text-[16px] text-[var(--text-primary)] leading-tight">
              Términos de uso y permisos
            </h2>
          </div>

          <p className="text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
            Para brindarte soporte en tiempo real, Technoverse CR puede usar algunos permisos de tu
            dispositivo. Al aceptar, autorizás el paquete completo. Podés revisarlos y ajustarlos en
            «Ver detalles», y todo funciona igual si preferís rechazarlos.
          </p>

          <button
            type="button"
            onClick={() => setDetalles(d => !d)}
            className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] px-3.5 py-2.5 text-[12.5px] font-semibold text-[var(--text-primary)]"
            aria-expanded={detalles}
          >
            {detalles ? 'Ocultar detalles' : 'Ver detalles y configurar permisos'}
            <ChevronDown className={`w-4 h-4 transition-transform ${detalles ? 'rotate-180' : ''}`} />
          </button>

          {detalles && (
            <div className="flex flex-col gap-2">
              {PERMISOS.map(p => {
                const Icono = p.icono;
                const activo = permisos[p.clave];
                return (
                  <div key={p.clave} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-3 flex gap-3">
                    <Icono className="w-4 h-4 shrink-0 mt-0.5 text-[var(--accent)]" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-[12.5px] font-bold text-[var(--text-primary)]">{p.titulo}</h3>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={activo}
                          disabled={p.bloqueado}
                          onClick={() => alternar(p.clave)}
                          className={`relative w-9 h-5 rounded-full shrink-0 transition disabled:opacity-50 ${activo ? 'bg-[var(--accent)]' : 'bg-[var(--bg-sunken)] border border-[var(--border-color)]'}`}
                        >
                          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${activo ? 'left-[18px]' : 'left-0.5'}`} />
                        </button>
                      </div>
                      <p className="text-[11px] leading-relaxed text-[var(--text-secondary)] mt-1">{p.texto}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="shrink-0 flex gap-2 p-4 pt-3 border-t border-[var(--border-color)] bg-[var(--bg-elevated)] pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
          <button
            type="button"
            onClick={onRechazar}
            disabled={procesando}
            className="flex-1 rounded-xl border border-[var(--border-color)] px-4 py-2.5 text-[13px] font-semibold text-[var(--text-secondary)] disabled:opacity-50"
          >
            Rechazar
          </button>
          <button
            type="button"
            onClick={() => void onAceptar()}
            disabled={procesando}
            className="flex-[1.4] rounded-xl bg-[var(--accent)] text-[var(--accent-ink)] px-4 py-2.5 text-[13px] font-bold disabled:opacity-50"
          >
            {procesando ? 'Un momento…' : detalles ? 'Guardar y aceptar' : 'Aceptar'}
          </button>
        </div>
      </div>
    </div>
  );
}
