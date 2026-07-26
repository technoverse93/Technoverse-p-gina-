import React from 'react';
import { ShoppingBag, Heart, Smartphone, ShieldCheck } from 'lucide-react';
import { Product } from '../types';

interface ProductCardProps {
  key?: any;
  prod: Product;
  onClick: () => void;
  onAddToCart: (prod: Product) => void;
  getProductDiscountedPrice: (prod: Product) => number;
}

/**
 * Tarjeta de producto — línea "retail limpio".
 *
 * Toda la piel (colores, sombras, radios) sale de las variables del tema, así
 * que la tarjeta se ve correcta en modo claro y oscuro sin lógica extra.
 *
 * No cambia ninguna prop ni ningún dato: mismas entradas y misma lógica de
 * carrito y de precios que antes.
 */
export function ProductCard({ prod, onClick, onAddToCart, getProductDiscountedPrice }: ProductCardProps) {
  const discountedPrice = getProductDiscountedPrice(prod);
  const isDiscounted = discountedPrice < prod.price;
  const discountPct = isDiscounted
    ? Math.round(((prod.price - discountedPrice) / prod.price) * 100)
    : 0;
  const agotado = prod.stock <= 0;

  const handleAdd = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!agotado) onAddToCart(prod);
  };

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
      className="glass-card overflow-hidden flex flex-col group relative cursor-pointer h-full"
    >
      {/* ------------------------------ Imagen ------------------------------ */}
      {/* `product-media` conserva la transparencia del PNG y, solo en modo
          oscuro, agrega placa elevada + foco radial + halo de contorno para que
          un producto negro no se pierda contra el fondo. Ver src/index.css. */}
      <div className="product-media relative flex items-center justify-center h-32 sm:h-36 p-4">
        {prod.imageUrl ? (
          <img
            src={prod.imageUrl}
            alt={prod.name}
            loading="lazy"
            decoding="async"
            className="max-h-full max-w-full object-contain transition-transform duration-200 group-hover:scale-105"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex flex-col items-center justify-center text-[var(--text-muted)] text-center">
            <Smartphone className="w-8 h-8 mb-1 opacity-60" />
            <span className="text-[10px]">Sin imagen</span>
          </div>
        )}

        {isDiscounted && (
          <span className="absolute top-2.5 left-2.5 px-2 py-1 rounded-md text-[10px] font-bold bg-[var(--accent)] text-[var(--accent-ink)]">
            −{discountPct}%
          </span>
        )}

        <button
          onClick={(e) => { e.stopPropagation(); }}
          className="absolute top-2 right-2 w-8 h-8 rounded-full grid place-items-center bg-[var(--bg-surface)] border border-[var(--border-color)] text-[var(--text-muted)] hover:text-rose-500 transition-colors"
          title="Guardar en favoritos"
          aria-label="Guardar en favoritos"
        >
          <Heart className="w-4 h-4" />
        </button>
      </div>

      {/* ------------------------------ Detalle ----------------------------- */}
      <div className="p-3 flex flex-col gap-2 flex-1 justify-between">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-[0.13em] text-[var(--text-muted)]">
            {prod.category}
          </span>
          <h4 className="mt-1 text-sm font-semibold leading-snug text-[var(--text-primary)] line-clamp-2">
            {prod.name}
          </h4>
        </div>

        <div className="flex flex-col gap-2">
          {/* Insignias: garantía · IVA incluido · disponibilidad */}
          <div className="flex flex-wrap gap-1.5">
            {prod.warranty && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--bg-sunken)] border border-[var(--border-soft)] text-[var(--text-secondary)]">
                <ShieldCheck className="w-3 h-3" />
                {prod.warranty}
              </span>
            )}
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--gold-soft)] border border-[var(--gold-line)] text-[var(--brand-gold-dark)]">
              IVA incluido
            </span>
            <span
              className="px-2 py-0.5 rounded-full text-[10px] font-semibold border"
              style={
                agotado
                  ? { background: 'var(--bg-sunken)', borderColor: 'var(--border-soft)', color: 'var(--text-muted)' }
                  : { background: 'var(--ok-soft)', borderColor: 'transparent', color: 'var(--ok)' }
              }
            >
              {agotado ? 'Bajo pedido' : 'En stock'}
            </span>
          </div>

          {/* Precio y acción */}
          <div className="flex items-end justify-between gap-2">
            <div className="flex flex-col leading-none min-w-0">
              {isDiscounted && (
                <span className="text-[11px] text-[var(--text-muted)] line-through font-mono mb-1">
                  ₡{prod.price.toLocaleString()}
                </span>
              )}
              <span className="text-lg font-bold font-mono tracking-tight text-[var(--text-primary)] truncate">
                ₡{discountedPrice.toLocaleString()}
              </span>
            </div>

            <button
              onClick={handleAdd}
              disabled={agotado}
              className="btn-glass-primary shrink-0 px-3 py-2 text-[11px] inline-flex items-center gap-1.5"
              aria-label={`Agregar ${prod.name} al carrito`}
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Agregar</span>
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
