import React from 'react';
import { Delete } from 'lucide-react';
import { PIN_MAX } from '../../utils/desbloqueoLocal';

/**
 * Teclado numérico en pantalla para el PIN.
 *
 * ---------------------------------------------------------------------
 * POR QUÉ UN TECLADO PROPIO Y NO UN <input inputMode="numeric">
 * ---------------------------------------------------------------------
 * En Android, el teclado del sistema se levanta sobre el contenido y tapa
 * buena parte de la pantalla. En un diálogo centrado —que es justo lo que
 * es el candado— eso deja los puntitos del PIN y el aviso de error
 * escondidos detrás del teclado, y la persona escribe a ciegas sin ver si
 * el PIN se rechazó.
 *
 * Con las teclas dentro del propio diálogo, todo queda siempre visible y
 * el gesto es el mismo que el del bloqueo del teléfono. Además el PIN
 * nunca pasa por un campo de texto del sistema, así que ni el autocorrector
 * ni el portapapeles lo ven.
 */

interface Props {
  valor: string;
  onCambio: (valor: string) => void;
  /** Se llama al completar la longitud esperada, si se indica una. */
  onCompleto?: (valor: string) => void;
  /** Cuántos dígitos se esperan; dibuja esa cantidad de puntitos. */
  longitud?: number;
  disabled?: boolean;
  error?: boolean;
}

const TECLAS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

export default function TecladoPin({ valor, onCambio, onCompleto, longitud = 4, disabled, error }: Props) {
  const pulsar = (digito: string) => {
    if (disabled) return;
    const tope = Math.max(longitud, PIN_MAX);
    if (valor.length >= tope) return;
    const siguiente = valor + digito;
    onCambio(siguiente);
    if (siguiente.length === longitud) onCompleto?.(siguiente);
  };

  const borrar = () => {
    if (disabled) return;
    onCambio(valor.slice(0, -1));
  };

  return (
    <div className="space-y-4">
      {/* Puntitos: la única realimentación de cuánto se lleva escrito. */}
      <div className="flex items-center justify-center gap-3" aria-hidden="true">
        {Array.from({ length: longitud }, (_, i) => (
          <span
            key={i}
            className="h-3 w-3 rounded-full border transition-colors"
            style={{
              borderColor: error ? '#E5484D' : 'var(--border-color)',
              background: i < valor.length ? (error ? '#E5484D' : 'var(--accent)') : 'transparent',
            }}
          />
        ))}
      </div>

      <div className="mx-auto grid max-w-[260px] grid-cols-3 gap-2">
        {TECLAS.map(t => (
          <button
            key={t}
            type="button"
            disabled={disabled}
            onClick={() => pulsar(t)}
            className="h-12 rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] text-lg font-semibold text-[var(--text-primary)] transition active:scale-95 disabled:opacity-50"
          >
            {t}
          </button>
        ))}
        {/* Hueco para que el 0 quede centrado, igual que en el teclado del teléfono. */}
        <span aria-hidden="true" />
        <button
          type="button"
          disabled={disabled}
          onClick={() => pulsar('0')}
          className="h-12 rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] text-lg font-semibold text-[var(--text-primary)] transition active:scale-95 disabled:opacity-50"
        >
          0
        </button>
        <button
          type="button"
          disabled={disabled || valor.length === 0}
          onClick={borrar}
          aria-label="Borrar el último dígito"
          className="flex h-12 items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-secondary)] transition active:scale-95 disabled:opacity-40"
        >
          <Delete className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
