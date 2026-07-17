import React from 'react';
import { ShoppingBag, Heart, Smartphone } from 'lucide-react';
import { Product } from '../types';

interface ProductCardProps {
  key?: any;
  prod: Product;
  onClick: () => void;
  onAddToCart: (prod: Product) => void;
  getProductDiscountedPrice: (prod: Product) => number;
}

export function ProductCard({ prod, onClick, onAddToCart, getProductDiscountedPrice }: ProductCardProps) {
  const discountedPrice = getProductDiscountedPrice(prod);
  const isDiscounted = discountedPrice < prod.price;

  return (
    <div
      onClick={onClick}
      className="glass-card rounded-2xl overflow-hidden flex flex-col justify-between group relative cursor-pointer hover:-translate-y-1.5"
    >
      {/* Superposed Actions */}
      <div className="absolute top-3 right-3 z-20 flex flex-col gap-2">
        <button
          onClick={(e) => { e.stopPropagation(); /* Add to favorites logic placeholder */ }}
          className="glass-pill p-1.5 rounded-full text-[var(--text-muted)] hover:text-rose-500 transition-colors"
          title="Favoritos"
        >
          <Heart className="w-4 h-4" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onAddToCart(prod); }}
          className="glass-pill p-1.5 rounded-full text-[var(--text-muted)] hover:text-blue-600 dark:hover:text-[var(--brand-gold-light)] transition-colors"
          title="Añadir al carrito"
        >
          <ShoppingBag className="w-4 h-4" />
        </button>
      </div>

      {/* Image viewer */}
      <div className="h-44 relative flex items-center justify-center p-4 bg-gradient-to-b from-transparent to-[var(--brand-navy)]/[0.03] dark:to-black/10">
        {prod.imageUrl ? (
          <img
            src={prod.imageUrl}
            alt={prod.name}
            className="max-h-full max-w-full object-contain group-hover:scale-105 transition duration-300"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex flex-col items-center justify-center text-[var(--text-muted)] text-center">
            <Smartphone className="w-10 h-10 mb-1" />
            <span className="text-[10px] font-mono">Sin Imagen</span>
          </div>
        )}

        {/* Category Badge if Discounted or new (Placeholder) */}
        {isDiscounted && (
          <span className="absolute top-3 left-3 z-10 text-[9px] btn-glass-primary px-2 py-0.5 rounded-full font-bold">
            OFERTA
          </span>
        )}
      </div>

      {/* Product Detail */}
      <div className="p-4 flex-1 flex flex-col justify-between space-y-2">
        <div className="space-y-1">
          <span className="text-[10px] font-bold text-[var(--text-secondary)] tracking-widest">{prod.category}</span>
          <h4 className="font-bold text-sm text-[var(--text-primary)] leading-tight line-clamp-2">{prod.name}</h4>
        </div>

        <div className="pt-2">
          {/* Price display */}
          <div className="flex items-baseline gap-2">
            {isDiscounted ? (
              <>
                <span className="text-lg font-bold text-[var(--brand-navy)] dark:text-[var(--brand-gold-light)] font-mono">₡{discountedPrice.toLocaleString()}</span>
                <span className="text-xs text-[var(--text-muted)] line-through font-mono">₡{prod.price.toLocaleString()}</span>
              </>
            ) : (
              <span className="text-lg font-bold text-[var(--brand-navy)] dark:text-[var(--brand-gold-light)] font-mono">₡{prod.price.toLocaleString()}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
