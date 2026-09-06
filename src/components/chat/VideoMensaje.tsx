import { useState } from 'react';
import { Film, ExternalLink } from 'lucide-react';

/**
 * Video de un mensaje del chat, con salida de emergencia.
 *
 * ---------------------------------------------------------------------
 * POR QUÉ NO BASTA CON UN <video>
 * ---------------------------------------------------------------------
 * Un `.mp4` no es un formato, es una CAJA. Dentro puede venir H.264, que
 * reproduce cualquier navegador, o H.265/HEVC, que es lo que graban por
 * defecto muchos teléfonos en modo "alta eficiencia" y que Chrome no sabe
 * decodificar. La subida funciona igual —el archivo llega entero y el
 * servidor lo guarda como `video/mp4`, que es cierto—, pero al reproducir
 * el navegador se queda con el reproductor en 0:00 y un icono roto.
 *
 * Visto desde fuera parece que el envío falló. No falló: el archivo está
 * ahí y se puede abrir con el reproductor del sistema, que sí entiende
 * HEVC. Por eso, cuando el `<video>` avisa que no puede, esto deja de
 * fingir y ofrece abrirlo aparte en vez de dejar un cuadro negro mudo.
 *
 * `preload="metadata"` baja solo la carátula y la duración: con `auto`,
 * abrir una conversación con varios videos empezaría a descargarlos todos.
 * ---------------------------------------------------------------------
 */
export default function VideoMensaje({ src, alto = 'max-h-64' }: { src: string; alto?: string }) {
  const [falloReproduccion, setFalloReproduccion] = useState(false);

  if (falloReproduccion) {
    return (
      <a
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="flex items-center gap-2.5 mb-1.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-sunken)] px-3 py-2.5 no-underline"
      >
        <Film className="w-5 h-5 shrink-0 text-[var(--accent)]" />
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] font-semibold text-[var(--text-primary)]">
            Abrir video
          </span>
          <span className="block text-[10.5px] leading-snug text-[var(--text-secondary)]">
            Este formato no se reproduce dentro del chat.
          </span>
        </span>
        <ExternalLink className="w-4 h-4 shrink-0 text-[var(--text-muted)]" />
      </a>
    );
  }

  return (
    <video
      src={src}
      controls
      playsInline
      preload="metadata"
      // Los controles del video son suyos: sin esto, darle a "play"
      // dispararía además el menú de acciones del mensaje.
      onClick={(e) => e.stopPropagation()}
      onError={() => setFalloReproduccion(true)}
      className={`rounded-xl max-w-full mb-1.5 ${alto} bg-black`}
    />
  );
}
