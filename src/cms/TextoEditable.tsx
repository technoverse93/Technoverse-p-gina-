// =====================================================================
// TEXTO EDITABLE — una pieza de texto que el admin edita en su lugar
// =====================================================================
// Fuera del modo edición es texto normal. Dentro del modo edición se
// vuelve editable (contentEditable): se escribe encima y al salir del
// campo (blur) se guarda. Si se deja vacío, vuelve al texto por defecto.
//
//   <TextoEditable clave="tienda.titulo_catalogo" as="h3" className="…">
//     Nuestros Productos Disponibles
//   </TextoEditable>
//
// El `children` es el TEXTO POR DEFECTO: lo que se ve si nadie lo ha
// editado. La clave debe ser estable y única.
// =====================================================================

import { useEffect, useRef, useState, type ElementType } from 'react';
import { obtenerContenido, guardarContenido, suscribirContenido } from '../utils/contenidoSitio';
import { useModoEdicion } from './ModoEdicion';

interface Props {
  clave: string;
  children: string;
  /** Etiqueta HTML a renderizar. Por defecto <span>. */
  as?: ElementType;
  className?: string;
}

export function TextoEditable({ clave, children, as = 'span', className = '' }: Props) {
  const { activo, quien } = useModoEdicion();
  const defecto = children;
  const [valor, setValor] = useState(() => obtenerContenido(clave, defecto));
  const ref = useRef<HTMLElement | null>(null);

  // Refresca cuando cambia el contenido (carga inicial, Realtime u otra
  // pestaña), salvo mientras se está escribiendo en ESTE campo — para no
  // pisar el cursor a medio texto.
  useEffect(() => {
    return suscribirContenido(() => {
      if (document.activeElement === ref.current) return;
      setValor(obtenerContenido(clave, defecto));
    });
  }, [clave, defecto]);

  const alSalir = async () => {
    const nuevo = (ref.current?.textContent || '').trim();
    if (nuevo === valor) return;
    if (!nuevo) {
      // Vacío = volver al texto por defecto.
      setValor(defecto);
      if (ref.current) ref.current.textContent = defecto;
      try { await guardarContenido(clave, defecto, 'texto', quien); } catch { /* queda local */ }
      return;
    }
    setValor(nuevo);
    try { await guardarContenido(clave, nuevo, 'texto', quien); } catch { /* queda local */ }
  };

  const Tag = as as any;

  if (!activo) {
    return <Tag className={className}>{valor}</Tag>;
  }

  return (
    <Tag
      ref={ref as any}
      className={`${className} tv-editable`}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      onBlur={alSalir}
      title="Editar texto"
      style={{
        outline: '1px dashed var(--accent)',
        outlineOffset: '2px',
        borderRadius: '3px',
        cursor: 'text',
      }}
    >
      {valor}
    </Tag>
  );
}
