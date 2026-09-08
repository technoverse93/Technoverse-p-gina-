import { useEffect, useRef, useState } from 'react';
import { PhoneOff, VideoOff, Loader2, AlertTriangle } from 'lucide-react';
import { abrirVideollamada, type EstadoLlamada, type ManejadorLlamada } from '../../supervision/videollamada';

/**
 * Superficie de la videollamada. La usan los DOS lados igual: lo único que
 * cambia es el `rol`, que decide quién hace la oferta.
 *
 * Se monta solo cuando la llamada ya fue aceptada. Montarlo es lo que pide
 * la cámara, así que mientras esto no exista en pantalla no hay ninguna
 * posibilidad de que la cámara esté encendida.
 */
export default function PanelVideollamada({
  sala,
  rol,
  onCerrar,
}: {
  sala: string;
  rol: 'llama' | 'contesta';
  onCerrar: () => void;
}) {
  const [estado, setEstado] = useState<EstadoLlamada>('inactiva');
  const videoLocal = useRef<HTMLVideoElement>(null);
  const videoRemoto = useRef<HTMLVideoElement>(null);
  const llamada = useRef<ManejadorLlamada | null>(null);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const h = await abrirVideollamada({
        sala,
        rol,
        alTenerVideoLocal: (s) => { if (videoLocal.current) videoLocal.current.srcObject = s; },
        alTenerVideoRemoto: (s) => { if (videoRemoto.current) videoRemoto.current.srcObject = s; },
        alCambiarEstado: (e) => { if (vivo) setEstado(e); },
      });
      if (!vivo) { h.colgar(); return; }
      llamada.current = h;
    })();

    // Colgar al desmontar es obligatorio, no una cortesía: si el componente
    // se va sin cerrar la conexión, la cámara se queda encendida.
    return () => { vivo = false; llamada.current?.colgar(); };
  }, [sala, rol]);

  const colgar = () => { llamada.current?.colgar(); onCerrar(); };

  const leyenda: Record<EstadoLlamada, string> = {
    'inactiva': 'Preparando…',
    'pidiendo-permiso': 'Autorizá el uso de la cámara',
    'llamando': 'Llamando…',
    'conectando': 'Conectando…',
    'en-curso': '',
    'rechazada': 'No aceptaron la llamada.',
    'sin-camara': 'No se pudo usar la cámara. Revisá el permiso en tu navegador.',
    'sin-conexion': 'No se pudo establecer la conexión. Puede ser la red de alguno de los dos.',
    'terminada': 'Llamada finalizada.',
  };

  const fallo = estado === 'sin-camara' || estado === 'sin-conexion' || estado === 'rechazada';

  return (
    <div className="fixed inset-0 z-[60] bg-black flex flex-col">
      {/* Video del otro lado: es el que importa, ocupa todo. */}
      <div className="relative flex-1 min-h-0">
        <video
          ref={videoRemoto}
          autoPlay
          playsInline
          // Muted no es decorativo: no hay pista de audio, y sin esto
          // algunos navegadores bloquean la reproducción automática.
          muted
          className="w-full h-full object-contain bg-black"
        />

        {estado !== 'en-curso' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-6">
            {fallo
              ? <AlertTriangle className="w-9 h-9 text-amber-400" />
              : <Loader2 className="w-9 h-9 text-white/70 animate-spin" />}
            <p className="text-[13px] text-white/85 max-w-[280px] leading-relaxed">
              {leyenda[estado]}
            </p>
          </div>
        )}

        {/* Vista previa propia, chica y en una esquina. */}
        <video
          ref={videoLocal}
          autoPlay
          playsInline
          muted
          className="absolute bottom-3 right-3 w-24 sm:w-32 rounded-xl border border-white/25 bg-black object-cover shadow-lg"
        />
      </div>

      <div className="shrink-0 flex items-center justify-center gap-4 py-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] bg-black">
        <div className="flex items-center gap-1.5 text-[11px] text-white/50">
          <VideoOff className="w-3.5 h-3.5" />
          Solo video, sin audio
        </div>
        <button
          type="button"
          onClick={colgar}
          aria-label="Colgar"
          className="w-14 h-14 rounded-full bg-[#e5484d] text-white flex items-center justify-center active:scale-95 transition"
        >
          <PhoneOff className="w-6 h-6" />
        </button>
      </div>
    </div>
  );
}
