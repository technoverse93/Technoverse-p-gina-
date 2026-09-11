// =====================================================================
// COLOR EDITABLE — cambiar el color de un elemento desde el modo edición
// =====================================================================
// Fuera del modo edición, pinta a sus hijos con el color guardado (o el
// de por defecto). Dentro del modo edición, aparece un botón de muestra:
// al tocarlo se abre el selector de color nativo y, al elegir, se guarda.
//
//   <ColorEditable clave="tienda.titulo_color" defecto="#0E6B4F" prop="color">
//     <TextoEditable clave="tienda.titulo">…</TextoEditable>
//   </ColorEditable>
//
// `prop` es la propiedad CSS a pintar ('color' por defecto; puede ser
// 'backgroundColor', 'borderColor', …). El `defecto` DEBE ser un hex
// (#rrggbb): es lo que entiende el selector nativo.
// =====================================================================

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { obtenerContenido, guardarContenido, suscribirContenido } from '../utils/contenidoSitio';
import { useModoEdicion } from './ModoEdicion';

interface Props {
  clave: string;
  children: ReactNode;
  /** Hex con el que arranca el selector si todavía no hay color elegido. */
  defecto: string;
  /** Propiedad CSS que se pinta. Por defecto el color del texto. */
  prop?: 'color' | 'backgroundColor' | 'borderColor';
  className?: string;
}

export function ColorEditable({ clave, children, defecto, prop = 'color', className = '' }: Props) {
  const { activo, quien } = useModoEdicion();
  // '' = sin color elegido → NO se pinta nada y el elemento hereda el color
  // del tema (claro/oscuro). Solo cuando el admin elige uno se sobreescribe.
  const [valor, setValor] = useState(() => obtenerContenido(clave, ''));
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return suscribirContenido(() => setValor(obtenerContenido(clave, '')));
  }, [clave]);

  const estilo = valor ? { [prop]: valor } : undefined;

  const elegir = async (hex: string) => {
    setValor(hex);
    try { await guardarContenido(clave, hex, 'color', quien); } catch { /* queda local */ }
  };

  const restablecer = async () => {
    setValor('');
    try { await guardarContenido(clave, '', 'color', quien); } catch { /* nada */ }
  };

  if (!activo) {
    return <span className={className} style={estilo}>{children}</span>;
  }

  return (
    <span className={`relative inline-flex items-center gap-1 ${className}`} style={estilo}>
      {children}
      {/* Muestra de color: abre el selector nativo. */}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        title="Cambiar color"
        className="inline-flex h-4 w-4 shrink-0 rounded-full border border-black/20 shadow-sm align-middle"
        style={{ background: valor || defecto }}
      />
      <button
        type="button"
        onClick={restablecer}
        title="Volver al color original"
        className="text-[10px] font-bold underline opacity-60 hover:opacity-100"
        style={{ color: 'var(--text-secondary)' }}
      >
        ↺
      </button>
      <input
        ref={inputRef}
        type="color"
        value={/^#[0-9a-fA-F]{6}$/.test(valor) ? valor : defecto}
        onChange={e => void elegir(e.target.value)}
        className="absolute h-px w-px opacity-0 pointer-events-none"
        aria-hidden="true"
        tabIndex={-1}
      />
    </span>
  );
}
