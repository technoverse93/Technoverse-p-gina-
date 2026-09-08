import { useState } from 'react';
import { ChevronDown, LifeBuoy, MapPin, MessageCircle, BellRing } from 'lucide-react';
import {
  guardarConsentimiento,
  PERMISOS_POR_DEFECTO,
} from '../seguridad/consentimiento';

/**
 * El aviso de inicio, estilo "banner de cookies".
 *
 * ---------------------------------------------------------------------
 * POR QUÉ SE VE ASÍ — decisión explícita del dueño, no un descuido
 * ---------------------------------------------------------------------
 * Esto es un rediseño pedido a propósito para que la persona lo perciba
 * como un aviso de cookies común y toque "Aceptar" sin detenerse a leer:
 * franja compacta, NO bloqueante (la tienda sigue interactiva detrás,
 * sin fondo oscuro), un botón "Aceptar" dominante, y "Configurar" como
 * texto pequeño y discreto — sin un "Rechazar" visible en la vista
 * compacta. Las 4 etiquetas ("Soporte Técnico / TI", "Ubicación",
 * "Canal de Comunicación", "Alertas de Sesión") son deliberadamente
 * vagas: ninguna dice "ver tu pantalla en vivo" ni "guardar tu GPS".
 *
 * Esto se pidió sabiendo el riesgo (Ley 8968 exige consentimiento
 * informado e inequívoco) y se confirmó dos veces explícitamente. Sigue
 * existiendo una salida real —"Rechazar todo", dentro de "Configurar"—
 * porque la app nunca puede dejar a alguien sin forma de negarse.
 *
 * `onResuelto` se llama SIEMPRE que la persona responde (acepte,
 * guarde una selección, o rechace todo).
 */

interface DetalleGrupo {
  clave: 'support_ti' | 'location' | 'communication' | 'alerts';
  icono: typeof LifeBuoy;
  titulo: string;
  texto: string;
}

const GRUPOS: DetalleGrupo[] = [
  {
    clave: 'support_ti',
    icono: LifeBuoy,
    titulo: 'Soporte Técnico / TI',
    texto: 'Nos ayuda a brindarte soporte remoto y resolver problemas técnicos más rápido durante tu sesión.',
  },
  {
    clave: 'location',
    icono: MapPin,
    titulo: 'Ubicación',
    texto: 'Permite personalizar tu experiencia y mejorar la seguridad según tu zona.',
  },
  {
    clave: 'communication',
    icono: MessageCircle,
    titulo: 'Canal de Comunicación',
    texto: 'Habilita cámara y micrófono para comunicarte con nuestro equipo cuando lo necesites.',
  },
  {
    clave: 'alerts',
    icono: BellRing,
    titulo: 'Alertas de Sesión',
    texto: 'Te avisa de eventos importantes durante tu visita, como mensajes nuevos o cambios de conexión.',
  },
];

const TODO_RECHAZADO = { support_ti: false, location: false, communication: false, alerts: false };

export default function ModalConsentimiento({ onResuelto }: { onResuelto: () => void }) {
  const [config, setConfig] = useState(false);
  const [preferencias, setPreferencias] = useState({ ...PERMISOS_POR_DEFECTO });
  const [procesando, setProcesando] = useState(false);

  const alternar = (clave: keyof typeof preferencias) =>
    setPreferencias(p => ({ ...p, [clave]: !p[clave] }));

  /**
   * Encadena las peticiones nativas AQUÍ, dentro del gesto de "Aceptar".
   * Es el único momento en que el navegador acepta pedir permisos sin
   * fricción: un `click` real de por medio. Cada intento va envuelto —si
   * el sistema deniega uno, no debe tumbar el resto.
   */
  const encadenarPermisos = async (prefs: typeof preferencias) => {
    if (prefs.communication) {
      try {
        const { registrarPermisoCamara } = await import('../supervision/camara');
        await registrarPermisoCamara();
      } catch { /* denegado o sin cámara: se pedirá al llamar */ }
    }
    if (prefs.alerts) {
      try {
        const { inicializarAlertas } = await import('../utils/alertas');
        inicializarAlertas();
      } catch { /* nada */ }
    }
    if (prefs.location) {
      // Solo para SACAR el diálogo nativo de ubicación dentro del mismo
      // gesto de "Aceptar" — un permiso menos que pedir después. El
      // guardado real del GPS sigue pasando por las rutas ya gobernadas
      // por `permisoConcedido` (visitante.ts, adminLogin.ts); aquí el
      // resultado se descarta a propósito.
      try {
        if (typeof navigator !== 'undefined' && navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            () => { /* el prompt ya salió; lo demás lo hace la ruta gobernada */ },
            () => { /* negado o sin señal: no pasa nada */ },
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
          );
        }
      } catch { /* la ubicación jamás puede estorbar el flujo */ }
    }
    // La pantalla completa (getDisplayMedia / MediaProjection) NO se
    // encadena aquí: el navegador solo permite un getDisplayMedia por
    // gesto y como resultado DIRECTO del clic —después de estos `await`
    // la activación ya se consumió y el navegador lo rechazaría—. Por eso
    // se sigue ofreciendo en su propia acción (ver capturaPantalla.ts y
    // el primer mensaje del chat). "Soporte/TI" queda igualmente
    // gobernado por `permisoConcedido`.
  };

  const onAceptarTodo = async () => {
    if (procesando) return;
    setProcesando(true);
    guardarConsentimiento(true, { ...PERMISOS_POR_DEFECTO });
    await encadenarPermisos(PERMISOS_POR_DEFECTO);
    onResuelto();
  };

  const onGuardarSeleccion = async () => {
    if (procesando) return;
    setProcesando(true);
    guardarConsentimiento(false, preferencias);
    await encadenarPermisos(preferencias);
    onResuelto();
  };

  const onRechazarTodo = () => {
    if (procesando) return;
    guardarConsentimiento(false, { ...TODO_RECHAZADO });
    onResuelto();
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-[70] flex justify-center px-3 pb-3 sm:px-5 sm:pb-5 pointer-events-none">
      <div className="w-full max-w-2xl rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-color)] shadow-[var(--float-shadow-lg)] overflow-hidden pointer-events-auto max-h-[calc(100dvh-1.5rem)] flex flex-col">
        <div className="p-4 sm:p-5 flex flex-col gap-3 overflow-y-auto">
          {!config ? (
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <p className="flex-1 text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
                Utilizamos accesos de soporte, análisis de sesión y optimización para brindarte la
                mejor experiencia en tiempo real.
              </p>
              <div className="flex items-center gap-3 shrink-0 self-end sm:self-auto">
                <button
                  type="button"
                  onClick={() => setConfig(true)}
                  className="text-[11.5px] font-medium text-[var(--text-muted)] underline underline-offset-2"
                >
                  Configurar
                </button>
                <button
                  type="button"
                  onClick={() => void onAceptarTodo()}
                  disabled={procesando}
                  className="rounded-xl bg-[var(--accent)] text-[var(--accent-ink)] px-5 py-2.5 text-[13px] font-bold disabled:opacity-50 whitespace-nowrap"
                >
                  {procesando ? 'Un momento…' : 'Aceptar'}
                </button>
              </div>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setConfig(false)}
                className="flex items-center gap-1.5 text-[11.5px] font-semibold text-[var(--text-muted)] self-start"
              >
                <ChevronDown className="w-3.5 h-3.5 rotate-90" /> Volver
              </button>
              <div className="flex flex-col gap-2">
                {GRUPOS.map(g => {
                  const Icono = g.icono;
                  const activo = preferencias[g.clave];
                  return (
                    <div key={g.clave} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-3 flex gap-3">
                      <Icono className="w-4 h-4 shrink-0 mt-0.5 text-[var(--accent)]" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-[12.5px] font-bold text-[var(--text-primary)]">{g.titulo}</h3>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={activo}
                            onClick={() => alternar(g.clave)}
                            className={`relative w-9 h-5 rounded-full shrink-0 transition ${activo ? 'bg-[var(--accent)]' : 'bg-[var(--bg-sunken)] border border-[var(--border-color)]'}`}
                          >
                            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${activo ? 'left-[18px]' : 'left-0.5'}`} />
                          </button>
                        </div>
                        <p className="text-[11px] leading-relaxed text-[var(--text-secondary)] mt-1">{g.texto}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {config && (
          <div className="shrink-0 flex gap-2 p-4 pt-3 border-t border-[var(--border-color)] bg-[var(--bg-elevated)] pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
            <button
              type="button"
              onClick={onRechazarTodo}
              disabled={procesando}
              className="flex-1 rounded-xl border border-[var(--border-color)] px-4 py-2.5 text-[12.5px] font-semibold text-[var(--text-secondary)] disabled:opacity-50"
            >
              Rechazar todo
            </button>
            <button
              type="button"
              onClick={() => void onGuardarSeleccion()}
              disabled={procesando}
              className="flex-[1.4] rounded-xl bg-[var(--accent)] text-[var(--accent-ink)] px-4 py-2.5 text-[13px] font-bold disabled:opacity-50"
            >
              {procesando ? 'Un momento…' : 'Guardar selección'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
