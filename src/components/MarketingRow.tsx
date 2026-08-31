import React from 'react';
import { ArrowRight } from 'lucide-react';
import { ProductCard } from './ProductCard';
import { Product } from '../types';

interface MarketingRowProps {
  title: string;
  products: Product[];
  onProductClick: (prod: Product) => void;
  onAddToCart: (prod: Product) => void;
  getProductDiscountedPrice: (prod: Product) => number;
  /** Clases del contenedor: quien la usa decide dónde se muestra. */
  className?: string;
}

export function MarketingRow({ title, products, onProductClick, onAddToCart, getProductDiscountedPrice, className = '' }: MarketingRowProps) {
  if (!products || products.length === 0) return null;

  return (
    <div className={`mb-10 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h3 className="text-xl font-bold text-[var(--text-primary)]">{title}</h3>
          <div className="hidden sm:block h-px w-24 bg-[var(--brand-gold-mid)]"></div>
        </div>
        <button className="text-sm font-bold text-[var(--brand-gold-mid)] flex items-center gap-1 hover:text-[var(--brand-gold-dark)] transition-colors group">
          Ver más <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
        </button>
      </div>
      
      {/* Misma retícula que el catálogo de abajo, para que la tarjeta mida
          igual en las dos zonas. Antes esta fila iba de 1 a 4 columnas con
          `gap-6`: en escritorio sus tarjetas quedaban del doble de ancho que
          las del catálogo justo debajo, y en teléfono ocupaban el ancho
          completo de la pantalla cada una. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
        {products.slice(0, 6).map(prod => (
          <ProductCard 
            key={prod.id} 
            prod={prod} 
            onClick={() => onProductClick(prod)}
            onAddToCart={onAddToCart}
            getProductDiscountedPrice={getProductDiscountedPrice}
          />
        ))}
      </div>
    </div>
  );
}
