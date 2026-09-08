import { useEffect, useRef, useState } from 'react';
import { Headset, ChevronDown } from 'lucide-react';
import { obtenerDeviceId } from '../../utils/dispositivo';
import { iniciarReceptorControl, type ReceptorControl } from '../../supervision/controlRemoto';

// =====================================================================
// SOPORTE REMOTO — autorización del cliente, desde el pie de página
// =====================================================================
// Entrada plegable y amigable. Cerrada no dice más que "Soporte remoto".
// Al abrir, un resumen corto y honesto de lo que pasa, y UN botón de
// autorizar. Mientras no se toque ese botón, NO se arma nada: no hay
// canal, no hay control, nada. Si se autoriza, el receptor abre el canal
// y aparece arriba la barra "Soporte remoto activo" con su botón "Cortar"
// —desde ahí la persona corta cuando quiera, sin depender de este pie—.
//
// Es lo inverso a espiar: la persona ELIGE, ve que está activo, y corta.
// La pantalla del técnico nunca se transmite hacia acá.
// =====================================================================

export default function SoporteRemoto() {
  const [abierto, setAbierto] = useState(false);
  const [activo, setActivo] = useState(false);
  const receptorRef = useRef<ReceptorControl | null>(null);

  // Si el componente se desmonta con el soporte activo, se corta el canal:
  // no puede quedar un receptor escuchando comandos sin que nadie lo vea.
  useEffect(() => {
    return () => { try { receptorRef.current?.detener(); } catch { /* nada */ } };
  }, []);

  const autorizar = () => {
    if (activo) return;
    const id = obtenerDeviceId();
    if (!id) return;
    receptorRef.current = iniciarReceptorControl(`v:${id}`, {
      discreto: false,
      alCortar: () => { receptorRef.current = null; setActivo(false); },
    });
    setActivo(true);
  };

  return (
    <div className="rounded-xl" style={{ background: 'rgba(255,255,255,0.035)' }}>
      <button
        type="button"
        onClick={() => setAbierto(v => !v)}
        aria-expanded={abierto}
        className="flex w-full items-center justify-between gap-3 p-4 text-left rounded-xl transition-colors hover:bg-white/[0.03]"
      >
        <span className="flex items-center gap-2">
          <Headset className="h-4 w-4 flex-shrink-0" aria-hidden="true" style={{ color: '#6EE7B7' }} />
          <span className="text-[13px] font-semibold" style={{ color: '#E9ECF1' }}>Soporte remoto</span>
        </span>
        <span className="flex-shrink-0">
          <ChevronDown aria-hidden="true" className={`h-4 w-4 transition-transform duration-300 ${abierto ? 'rotate-180' : ''}`} style={{ color: '#6EE7B7' }} />
        </span>
      </button>

      <div
        className="grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none"
        style={{ gridTemplateRows: abierto ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="px-4 pb-4">
            {!activo ? (
              <>
                <p className="mb-3 text-[12.5px] leading-relaxed" style={{ color: '#A7AFBD' }}>
                  Si un técnico te está ayudando, con esto le permitís <strong style={{ color: '#E9ECF1' }}>ver y
                  guiar tu pantalla dentro de la tienda</strong> para resolver más rápido. Vos ves todo lo
                  que pasa, aparece un aviso mientras dura, y lo cortás cuando quieras. Solo si lo autorizás.
                </p>
                <button
                  type="button"
                  onClick={autorizar}
                  className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-[12.5px] font-bold transition-colors"
                  style={{ background: '#0F766E', color: '#FFFFFF' }}
                >
                  Autorizar soporte remoto
                </button>
              </>
            ) : (
              <p className="text-[12.5px] leading-relaxed" style={{ color: '#6EE7B7' }}>
                Soporte remoto activo. Podés cortarlo cuando quieras desde el aviso de arriba
                («Cortar»).
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
