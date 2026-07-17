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
}

export function MarketingRow({ title, products, onProductClick, onAddToCart, getProductDiscountedPrice }: MarketingRowProps) {
  if (!products || products.length === 0) return null;

  return (
    <div className="mb-10">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h3 className="text-xl font-bold text-[var(--text-primary)]">{title}</h3>
          <div className="hidden sm:block h-px w-24 bg-[var(--brand-gold-mid)]"></div>
        </div>
        <button className="text-sm font-bold text-[var(--brand-gold-mid)] flex items-center gap-1 hover:text-[var(--brand-gold-dark)] transition-colors group">
          Ver más <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
        </button>
      </div>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {products.slice(0, 4).map(prod => (
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
