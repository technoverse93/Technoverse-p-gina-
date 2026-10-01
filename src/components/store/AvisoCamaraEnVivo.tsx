// =====================================================================
// AVISO FIJO: "TU CÁMARA SE ESTÁ COMPARTIENDO EN VIVO"
// =====================================================================
// La persona pidió compartir su cámara a mano (ver PieDePagina →
// CompartirCamaraFooter) y ya NO ve el recuadro espejo de sí misma. Para
// que nunca pierda de vista que la cámara sigue transmitiendo, este aviso
// va FIJO sobre todo el contenido, en cualquier página y aunque el pie
// quede fuera de la pantalla: un punto rojo, el texto claro y un botón
// grande para cortar al instante.
//
// Es la contraparte honesta de haber quitado la autovista: sin espejo,
// pero con una señal permanente e imposible de pasar por alto de que la
// cámara está encendida. Un consentimiento de una sola vez no alcanza
// para algo que sigue transmitiendo; este aviso mantiene a la persona al
// mando todo el tiempo.
// =====================================================================

import { useEffect, useState } from 'react';
import { VideoOff } from 'lucide-react';
import {
  suscribirCamara, detenerCamaraCliente, type EstadoCamaraCliente,
} from '../../supervision/camaraCliente';

export default function AvisoCamaraEnVivo() {
  const [cam, setCam] = useState<EstadoCamaraCliente>({ estado: 'idle', stream: null, mensaje: null });
  useEffect(() => suscribirCamara(setCam), []);

  if (cam.estado !== 'activa') return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 z-[2147483000] flex justify-center px-3"
      style={{
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
        // Se queda a la izquierda de la burbuja de chat flotante para no taparla.
        pointerEvents: 'none',
      }}
    >
      <div
        className="flex items-center gap-3 rounded-full px-4 py-2.5 shadow-2xl"
        style={{
          pointerEvents: 'auto',
          background: '#111827',
          border: '1px solid rgba(229,72,77,0.55)',
          maxWidth: 'min(92vw, 560px)',
        }}
      >
        <span className="relative flex h-3 w-3 flex-shrink-0" aria-hidden="true">
          <span
            className="absolute inline-flex h-full w-full rounded-full motion-safe:animate-ping"
            style={{ background: '#e5484d', opacity: 0.6 }}
          />
          <span className="relative inline-flex h-3 w-3 rounded-full" style={{ background: '#e5484d' }} />
        </span>

        <span className="min-w-0 text-[12.5px] font-semibold leading-tight" style={{ color: '#F3F4F6' }}>
          Tu cámara se está compartiendo en vivo con soporte
        </span>

        <button
          type="button"
          onClick={() => detenerCamaraCliente()}
          className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-bold transition-colors"
          style={{ background: '#e5484d', color: '#FFFFFF' }}
        >
          <VideoOff className="h-4 w-4" aria-hidden="true" />
          Detener
        </button>
      </div>
    </div>
  );
}
