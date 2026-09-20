import React, { useEffect, useRef } from 'react';
import { Camera, ImagePlus } from 'lucide-react';

interface Props {
  onClose: () => void;
  onCamara: () => void;
  onGaleria: () => void;
  /**
   * Clase de posición horizontal (`left-0`, `left-11`, …). El menú se
   * ancla al contenedor `position: relative` más cercano que NO tenga
   * `overflow: hidden` —ver el porqué en el comentario de más abajo—, y
   * ese contenedor no siempre empieza justo en el botón "Adjuntar": en el
   * panel de admin hay un botón de "nota interna" ANTES. Por defecto
   * `left-0` (el botón es el primero, caso del widget del cliente).
   */
  anchorOffsetClass?: string;
}

/**
 * Menú de "Adjuntar" — cámara + galería detrás de UN solo botón.
 *
 * ---------------------------------------------------------------------
 * POR QUÉ EXISTE
 * ---------------------------------------------------------------------
 * Antes cada acción secundaria (cámara, adjuntar, nota de voz) tenía su
 * propio botón fijo en la barra del chat. Con la cámara agregada, eran
 * tres círculos permanentes compitiendo por el mismo espacio angosto que
 * el campo de texto — "saturación visual" reportada, el cliente ya no
 * tenía dónde leer cómodamente lo que escribía. Cámara y galería son la
 * MISMA intención ("mandar una foto"), solo cambia de dónde sale: tiene
 * sentido que compartan un solo botón con un menú, no dos círculos fijos.
 *
 * La nota de voz se queda AFUERA de este menú a propósito: no es "elegir
 * una opción y listo" como estas dos, es un gesto de dos toques (empezar
 * a grabar / mandar) que necesita su propio botón visible con su propio
 * estado (rojo y pulsando mientras graba). Meterla en un desplegable
 * rompería ese gesto.
 *
 * Se comparte entre el widget del cliente (LiveChat) y el hilo del panel
 * (ChatThread): es exactamente el mismo menú en los dos lados.
 *
 * Abre HACIA ARRIBA (`bottom-full`), no hacia abajo como los demás menús
 * de la app: este botón vive en la barra de INPUT, pegada al borde
 * inferior de una ventana angosta (el widget flotante o el panel), así
 * que un menú que abriera hacia abajo saldría cortado o tapado por el
 * borde de la pantalla.
 *
 * ---------------------------------------------------------------------
 * FALLO CORREGIDO — el botón no hacía nada visible
 * ---------------------------------------------------------------------
 * Este menú es `position: absolute` y se ancla al `position: relative`
 * más cercano. El botón "Adjuntar" vive dentro de un contenedor con
 * `overflow: hidden` (el que anima el ancho a cero al escribir, ver
 * LiveChat.tsx/ChatThread.tsx): si el `relative` que ancla este menú
 * quedara DENTRO de esa caja recortada, el menú se recorta a la nada —el
 * botón cambia de estado con normalidad, pero visualmente no aparece
 * nada, exactamente el "toco el ícono y no pasa nada" reportado. Por eso
 * quien llama a este componente debe ponerlo como HERMANO del contenedor
 * `overflow-hidden`, dentro de un `relative` que quede AFUERA de él.
 */
export default function AdjuntarMenu({ onClose, onCamara, onGaleria, anchorOffsetClass = 'left-0' }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const alTocarFuera = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    const alEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', alTocarFuera);
    document.addEventListener('keydown', alEscape);
    return () => {
      document.removeEventListener('mousedown', alTocarFuera);
      document.removeEventListener('keydown', alEscape);
    };
  }, [onClose]);

  return (
    <div
      ref={rootRef}
      className={`absolute ${anchorOffsetClass} bottom-full mb-1.5 w-48 z-[70] rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] shadow-lg overflow-hidden animate-in fade-in slide-in-from-bottom-1 duration-150`}
      id="menu-adjuntar-chat"
    >
      <button
        type="button"
        onClick={() => { onCamara(); onClose(); }}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[12.5px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-sunken)] transition"
      >
        <span className="w-7 h-7 rounded-full bg-[rgba(var(--accent-rgb),0.14)] text-[var(--accent)] flex items-center justify-center shrink-0">
          <Camera className="w-3.5 h-3.5" />
        </span>
        Tomar foto
      </button>
      <button
        type="button"
        onClick={() => { onGaleria(); onClose(); }}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[12.5px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-sunken)] transition border-t border-[var(--border-color)]/60"
      >
        <span className="w-7 h-7 rounded-full bg-[rgba(var(--accent-rgb),0.14)] text-[var(--accent)] flex items-center justify-center shrink-0">
          <ImagePlus className="w-3.5 h-3.5" />
        </span>
        Elegir de la galería
      </button>
    </div>
  );
}
