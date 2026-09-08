import { useState } from 'react';
import { Mic, ExternalLink } from 'lucide-react';

/**
 * Nota de voz de un mensaje del chat, con la misma salida de emergencia
 * que el video (ver `VideoMensaje.tsx`).
 *
 * ---------------------------------------------------------------------
 * POR QUÉ TAMBIÉN HACE FALTA LA SALIDA DE EMERGENCIA
 * ---------------------------------------------------------------------
 * El contenedor lo elige el navegador que GRABÓ, no el que reproduce. Una
 * nota grabada en Chrome sale en `audio/webm` (opus); otro motor puede
 * mandar `audio/mp4`. Casi siempre se cruzan bien, pero cuando no —un
 * navegador viejo, un códec que falta— el `<audio>` se queda mudo en 0:00
 * sin decir por qué.
 *
 * Antes que dejar una barra muerta, el `onError` cambia a un enlace que
 * abre el archivo con el reproductor del sistema, que sí lo entiende. Es
 * exactamente el mismo criterio que se usó con los videos HEVC.
 *
 * `preload="metadata"` baja solo la duración: con `auto`, abrir una
 * conversación con varias notas empezaría a descargarlas todas.
 */
export default function AudioMensaje({ src }: { src: string }) {
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
        <Mic className="w-5 h-5 shrink-0 text-[var(--accent)]" />
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] font-semibold text-[var(--text-primary)]">
            Abrir nota de voz
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
    <audio
      src={src}
      controls
      preload="metadata"
      // Los controles son suyos: sin esto, darle a "play" dispararía
      // además el menú de acciones del mensaje.
      onClick={(e) => e.stopPropagation()}
      onError={() => setFalloReproduccion(true)}
      className="mb-1.5 w-full max-w-[240px] h-10"
    />
  );
}
