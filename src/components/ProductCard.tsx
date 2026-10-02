import React from 'react';
import { Smartphone } from 'lucide-react';
import { Product } from '../types';

interface ProductCardProps {
  key?: any;
  prod: Product;
  /** Recibe el producto para que el padre pase UN callback estable a todas
   *  las tarjetas (si fuera `() => void` inline por tarjeta, la memoización
   *  no serviría de nada). */
  onClick: (prod: Product) => void;
  onAddToCart: (prod: Product) => void;
  getProductDiscountedPrice: (prod: Product) => number;
}

/**
 * Tarjeta de producto — Cristal Ligero.
 *
 * Geometría de la maqueta aprobada:
 *   · contenedor de 18 px con borde fino y SIN sombra (el contenido es
 *     sólido y plano; el vidrio vive solo en los controles flotantes);
 *   · la foto va en una baldosa tintada de 12 px, no a sangre;
 *   · el precio manda: grande, en la tipografía normal (no monoespaciada),
 *     con el ₡ pequeño al lado;
 *   · UN solo botón en cápsula de ancho completo.
 *
 * Se conserva TODO el comportamiento anterior: misma firma de props, mismo
 * cálculo de precios, tocar la foto o el nombre abre la ficha y el botón
 * agrega al carrito y abre el checkout (con `stopPropagation` para que sea
 * un gesto aparte). La garantía sigue como insignia sobre la foto.
 */
export const ProductCard = React.memo(function ProductCard({ prod, onClick, onAddToCart, getProductDiscountedPrice }: ProductCardProps) {
  // Sin esto, una imageUrl rota (archivo borrado del Storage, dominio
  // caído) dejaba el ícono de imagen partida del navegador en la tarjeta,
  // en vez de caer al estado "Sin imagen".
  const [imagenRota, setImagenRota] = React.useState(false);
  React.useEffect(() => { setImagenRota(false); }, [prod.imageUrl]);

  const discountedPrice = getProductDiscountedPrice(prod);
  const isDiscounted = discountedPrice < prod.price;
  const discountPct = isDiscounted
    ? Math.round(((prod.price - discountedPrice) / prod.price) * 100)
    : 0;
  const agotado = prod.stock <= 0;

  return (
    <article
      onClick={() => onClick(prod)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(prod);
        }
      }}
      aria-label={prod.name}
      className="tv-prod group relative flex h-full cursor-pointer flex-col overflow-hidden"
    >
      {/* ----------------------------- Foto ------------------------------- */}
      {/* Baldosa tintada de esquinas redondeadas. `object-contain`: la imagen
          nunca se recorta ni se deforma, solo se le da su marco. */}
      <div className="tv-prod-foto product-media relative aspect-[7/5] w-full flex-shrink-0 overflow-hidden">
        {prod.imageUrl && !imagenRota ? (
          <img
            src={prod.imageUrl}
            alt={prod.name}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-contain p-2 transition-transform duration-200 group-hover:scale-105"
            referrerPolicy="no-referrer"
            onError={() => setImagenRota(true)}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-[var(--accent)]">
            <Smartphone className="mb-1 h-8 w-8 opacity-60" />
            <span className="text-[10px] text-[var(--text-muted)]">Sin imagen</span>
          </div>
        )}

        {/* Garantía: lo que más pesa al comparar un reacondicionado. */}
        {prod.warranty && (
          <span className="tv-prod-insignia tv-prod-insignia--ok absolute left-2 top-2 max-w-[calc(100%-1rem)] tv-ellipsis">
            {prod.warranty}
          </span>
        )}

        {/* El descuento va abajo para no chocar con la garantía. */}
        {isDiscounted && (
          <span className="tv-prod-insignia tv-prod-insignia--acento absolute bottom-2 left-2">
            −{discountPct}%
          </span>
        )}

        {agotado && (
          <span className="tv-prod-insignia tv-prod-insignia--neutra absolute right-2 top-2">
            Agotado
          </span>
        )}
      </div>

      {/* ---------------------------- Detalle ----------------------------- */}
      <div className="flex min-w-0 flex-1 flex-col gap-1 px-0.5 pt-2">
        {/* Alto RESERVADO de dos líneas: con line-clamp a secas un nombre de
            una línea deja la tarjeta más baja que su vecina y la fila de la
            rejilla queda desalineada. */}
        <h4 className="tv-nombre-producto tv-clamp-2 min-h-[2.1rem] font-semibold text-[var(--text-primary)]">
          {prod.name}
        </h4>

        {/* `mt-auto` empuja precio y botón al fondo: todas las tarjetas de la
            fila alinean su botón aunque el nombre ocupe una línea. */}
        <div className="mt-auto flex min-w-0 flex-col gap-0.5">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
            <span className="tv-prod-precio">
              <span className="tv-prod-moneda">₡</span>{discountedPrice.toLocaleString()}
            </span>
            {isDiscounted && (
              <span className="tv-prod-tachado">
                ₡{prod.price.toLocaleString()}
              </span>
            )}
          </div>

          <span className="tv-ellipsis tv-prod-meta">
            {prod.category}
            {' · '}
            {agotado ? 'Bajo pedido' : `${prod.stock} ${prod.stock === 1 ? 'disponible' : 'disponibles'}`}
          </span>

          {/* "Comprar": agrega al carrito y abre el checkout de una vez.
              `stopPropagation` para que sea un gesto aparte del que abre la
              ficha (foto/nombre). */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onAddToCart(prod); }}
            disabled={agotado}
            className="tv-prod-boton tv-ellipsis"
          >
            {agotado ? 'Agotado' : 'Comprar'}
          </button>
        </div>
      </div>
    </article>
  );
});
