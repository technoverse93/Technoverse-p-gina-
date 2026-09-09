import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

/**
 * Imagen de un mensaje del chat: miniatura en la burbuja, y un toque la
 * amplía en un modal SOBRE la misma vista de chat —nunca una pestaña
 * nueva ni una redirección—. Se cierra tocando afuera, la X, o Escape.
 */
export default function ImagenMensaje({ src, alto = 'max-h-56' }: { src: string; alto?: string }) {
  const [ampliada, setAmpliada] = useState(false);

  useEffect(() => {
    if (!ampliada) return;
    const alTeclado = (e: KeyboardEvent) => { if (e.key === 'Escape') setAmpliada(false); };
    window.addEventListener('keydown', alTeclado);
    return () => window.removeEventListener('keydown', alTeclado);
  }, [ampliada]);

  return (
    <>
      <img
        src={src}
        alt="Imagen adjunta"
        loading="lazy"
        decoding="async"
        onClick={(e) => { e.stopPropagation(); setAmpliada(true); }}
        className={`rounded-xl max-w-full mb-1.5 object-cover cursor-zoom-in ${alto}`}
      />
      {ampliada && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/85 p-4"
          onClick={(e) => { e.stopPropagation(); setAmpliada(false); }}
        >
          <img src={src} alt="Imagen adjunta ampliada" className="max-w-full max-h-full rounded-lg object-contain" />
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setAmpliada(false); }}
            aria-label="Cerrar"
            className="absolute top-3 right-3 w-9 h-9 rounded-full bg-black/60 text-white flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}
    </>
  );
}
