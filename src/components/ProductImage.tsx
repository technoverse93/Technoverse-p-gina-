import React from 'react';
import { Package } from 'lucide-react';

/**
 * Imagen de producto con caída controlada.
 *
 * ---------------------------------------------------------------------
 * EL FALLO QUE ESTO CORRIGE
 * ---------------------------------------------------------------------
 * Casi todo `<img src={producto.imageUrl}>` de la aplicación no tenía
 * `onError`: si la URL apuntaba a un archivo borrado del Storage, a un
 * dominio caído, o simplemente venía vacía/rota desde una importación,
 * el navegador dejaba el ícono de imagen partida — o un hueco en blanco
 * — en pantalla, tanto en la tienda pública como en el carrito y el
 * checkout. Nada volvía a intentarlo ni mostraba una alternativa. Solo
 * `InventarioControl.tsx` tenía este resguardo, en un componente local
 * que nadie más podía reutilizar.
 *
 * Este componente centraliza esa protección: si `src` falta o falla al
 * cargar, cae a un ícono de repuesto en vez de a un hueco roto. Y
 * `loading="lazy"` + `decoding="async"` evitan que decenas de imágenes
 * de una grilla bloqueen el hilo principal mientras se pintan.
 */
export function ProductImage({
  src,
  alt,
  className = 'w-10 h-10',
  iconClassName = 'w-5 h-5',
}: {
  src?: string | null;
  alt: string;
  className?: string;
  iconClassName?: string;
}) {
  const [fallo, setFallo] = React.useState(false);

  if (!src || fallo) {
    return (
      <div className={`${className} rounded-lg bg-[var(--bg-surface)] border border-[var(--border-color)] flex items-center justify-center text-[var(--text-muted)] shrink-0`}>
        <Package className={`${iconClassName} opacity-50`} aria-hidden="true" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={`${className} product-thumb rounded-lg object-contain p-0.5 border border-[var(--border-color)]/80`}
      onError={() => setFallo(true)}
      referrerPolicy="no-referrer"
    />
  );
}
