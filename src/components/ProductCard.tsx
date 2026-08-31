import React from 'react';
import { Smartphone } from 'lucide-react';
import { Product } from '../types';

interface ProductCardProps {
  key?: any;
  prod: Product;
  onClick: () => void;
  onAddToCart: (prod: Product) => void;
  getProductDiscountedPrice: (prod: Product) => number;
}

/**
 * Tarjeta de producto — diseño aprobado.
 *
 * ---------------------------------------------------------------------
 * QUÉ CAMBIA RESPECTO A LA TARJETA ANTERIOR, Y POR QUÉ
 * ---------------------------------------------------------------------
 * 1. IMAGEN CUADRADA (`aspect-square`) en vez de alto fijo en píxeles.
 *    Con alto fijo, en una rejilla de dos columnas en un teléfono de
 *    360 px la foto quedaba achatada y desperdiciaba el ancho; el
 *    cuadrado se adapta al ancho de la columna sea cual sea.
 *
 * 2. LA GARANTÍA SUBE A LA FOTO, como insignia. Antes competía abajo
 *    con "IVA incluido" y con el estado de stock en una fila de tres
 *    píldoras que, en dos columnas, se partía en dos líneas y desalineaba
 *    todas las tarjetas de la fila.
 *
 * 3. FUERA "IVA incluido" DE LA TARJETA. Es información de precio, no de
 *    producto, y ya se dice en la ficha y en el carrito; en la tarjeta
 *    solo robaba la línea que ahora usa el stock real.
 *
 * 4. FUERA EL BOTÓN DE FAVORITOS. No guardaba nada — abría un onClick
 *    vacío con `stopPropagation`. Un corazón que no hace nada es peor
 *    que no tenerlo.
 *
 * 5. UN SOLO BOTÓN, "Comprar", de ancho completo, con su propio gesto
 *    (`stopPropagation`) en vez de un ícono pequeño que competía con el
 *    clic de la tarjeta en un objetivo de 32 px. Agrega al carrito y abre
 *    el checkout de inmediato — sin pasos intermedios. Tocar el resto de
 *    la tarjeta (foto, nombre) sigue abriendo la ficha completa, para
 *    quien quiera revisar descripción/garantía o elegir cantidad antes.
 *
 * Toda la piel sale de variables del tema, así que la tarjeta se ve
 * correcta en claro y en oscuro sin lógica extra. No cambia ninguna prop:
 * mismas entradas y misma lógica de precios que antes.
 */
export function ProductCard({ prod, onClick, onAddToCart, getProductDiscountedPrice }: ProductCardProps) {
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
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      aria-label={prod.name}
      className="group relative flex h-full cursor-pointer flex-col overflow-hidden rounded-[14px] border border-[var(--border-color)] bg-[var(--bg-surface)] transition-colors hover:border-[var(--accent)]"
    >
      {/* ----------------------------- Imagen ----------------------------- */}
      {/* 5:4 en vez de cuadrada. Medido sobre la tienda real, la tarjeta
          salía a 332 px de alto en teléfono con solo 166 px de ancho: casi
          el doble de alto que de ancho, y la mitad de eso era la foto. Al
          ser `object-contain` la imagen NO se recorta ni se deforma —solo
          se le da menos alto al marco—, así que se gana densidad sin
          maltratar ninguna foto. */}
      <div className="product-media relative aspect-[8/5] sm:aspect-[5/4] w-full flex-shrink-0 overflow-hidden bg-[var(--bg-sunken)]">
        {prod.imageUrl && !imagenRota ? (
          <img
            src={prod.imageUrl}
            alt={prod.name}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-contain p-1.5 transition-transform duration-200 group-hover:scale-105"
            referrerPolicy="no-referrer"
            onError={() => setImagenRota(true)}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-[var(--text-muted)]">
            <Smartphone className="mb-1 h-7 w-7 opacity-50" />
            <span className="text-[10px]">Sin imagen</span>
          </div>
        )}

        {/* Garantía: lo que más pesa al comparar un reacondicionado. */}
        {prod.warranty && (
          <span className="absolute left-2 top-2 max-w-[calc(100%-1rem)] rounded-md bg-[var(--ok-soft)] px-2 py-[3px] text-[9.5px] font-bold text-[var(--ok)] tv-ellipsis">
            {prod.warranty}
          </span>
        )}

        {/* El descuento va abajo para no chocar con la garantía. */}
        {isDiscounted && (
          <span className="absolute bottom-2 left-2 rounded-md bg-[var(--accent)] px-2 py-[3px] text-[9.5px] font-bold text-[var(--accent-ink)]">
            −{discountPct}%
          </span>
        )}

        {agotado && (
          <span className="absolute right-2 top-2 rounded-md bg-[var(--bg-surface)] px-2 py-[3px] text-[9.5px] font-bold text-[var(--text-muted)] border border-[var(--border-color)]">
            Agotado
          </span>
        )}
      </div>

      {/* ----------------------------- Detalle ---------------------------- */}
      <div className="flex min-w-0 flex-1 flex-col gap-0 sm:gap-0.5 p-1.5 sm:p-2">
        {/* Alto RESERVADO de dos líneas, no solo recorte: con line-clamp a
            secas un nombre de una línea deja la tarjeta más baja que su
            vecina y la fila de la rejilla queda desalineada. */}
        <h4 className="tv-nombre-producto tv-clamp-2 min-h-[1.6rem] sm:min-h-[1.95rem] font-semibold text-[var(--text-primary)]">
          {prod.name}
        </h4>

        {/* `mt-auto` empuja precio y botón al fondo, así todas las tarjetas
            de la fila alinean su botón aunque el nombre ocupe una línea. */}
        <div className="mt-auto flex min-w-0 flex-col gap-0 sm:gap-0.5">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
            <span className="font-mono text-[12px] sm:text-[13px] font-bold leading-tight tracking-tight text-[var(--accent)]">
              ₡{discountedPrice.toLocaleString()}
            </span>
            {isDiscounted && (
              <span className="font-mono text-[9.5px] text-[var(--text-muted)] line-through">
                ₡{prod.price.toLocaleString()}
              </span>
            )}
          </div>

          {/* Categoría y existencias comparten renglón. Antes ocupaban dos
              líneas separadas —y la categoría ya se ve en los chips de
              arriba y en la ficha—, así que juntarlas quita alto sin quitar
              información. */}
          <span className="tv-ellipsis text-[9.5px] leading-tight text-[var(--text-muted)]">
            {prod.category}
            {' · '}
            {agotado ? 'Bajo pedido' : `${prod.stock} ${prod.stock === 1 ? 'disponible' : 'disponibles'}`}
          </span>

          {/* "Comprar", no "Ver": agrega al carrito y abre el checkout de
              una vez —handleAddToCart ya hace las dos cosas— en vez de
              nada más abrir la ficha. `stopPropagation` para que sea un
              gesto aparte del que abre la tarjeta: tocar la foto o el
              nombre sigue llevando a la ficha completa (descripción,
              garantía, elegir cantidad), para quien quiera revisar antes
              de comprar; este botón es el atajo para quien ya decidió. */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onAddToCart(prod); }}
            disabled={agotado}
            className={`tv-ellipsis mt-0.5 rounded-lg px-2 py-[3px] sm:py-1 text-center text-[10.5px] font-bold transition-colors ${
              agotado
                ? 'cursor-not-allowed bg-[var(--bg-sunken)] text-[var(--text-muted)]'
                : 'bg-[var(--accent)] text-[var(--accent-ink)] hover:bg-[var(--accent-hover)]'
            }`}
          >
            {agotado ? 'Agotado' : 'Comprar'}
          </button>
        </div>
      </div>
    </article>
  );
}
