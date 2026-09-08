import { useEffect, useRef, useState } from 'react';
import { X, Radio, Loader2 } from 'lucide-react';
import { conectarComoVisor } from '../../supervision/capturaPantalla';

/**
 * Visor de pantalla completa REAL (getDisplayMedia), no el espejo del DOM.
 *
 * Solo lo puede abrir el Superadmin, y solo cuando la persona ya la ofreció
 * (ver capturaPantalla.ts): esto NUNCA pide permiso ni enciende nada, solo
 * se conecta a un stream que el otro lado ya decidió compartir.
 *
 * Cerrarlo es un desconecte del lado del que MIRA — no apaga la
 * transmisión del otro lado. Eso solo lo corta la propia persona, con el
 * botón nativo de su navegador o al cerrar su sesión (kill-switch).
 */
export default function VisorPantallaCompleta({ clave, onCerrar }: { clave: string; onCerrar: () => void }) {
  const [conectado, setConectado] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const { desconectar } = conectarComoVisor(clave, (stream) => {
      if (videoRef.current) videoRef.current.srcObject = stream;
      setConectado(true);
    });
    return () => desconectar();
  }, [clave]);

  return (
    <div className="fixed inset-0 z-[65] bg-black flex flex-col">
      <div className="shrink-0 flex items-center justify-between gap-2 px-4 py-2.5 bg-black/80">
        <span className="flex items-center gap-2 text-[12px] font-semibold text-white/85">
          {conectado
            ? <><Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" /> Pantalla completa en vivo</>
            : <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Conectando…</>}
        </span>
        <button
          type="button"
          onClick={onCerrar}
          className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10"
          aria-label="Cerrar visor"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="relative flex-1 min-h-0">
        <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-contain bg-black" />
        {!conectado && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-[12.5px] text-white/50">Esperando el video…</p>
          </div>
        )}
      </div>
    </div>
  );
}
