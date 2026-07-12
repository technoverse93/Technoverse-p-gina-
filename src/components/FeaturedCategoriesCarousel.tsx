import React, { useRef } from 'react';
import { ChevronLeft, ChevronRight, Smartphone, Headphones, Battery, Shield } from 'lucide-react';

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  'Dispositivos': <Smartphone className="w-8 h-8 text-[var(--brand-gold-mid)]" />,
  'Estuches': <Shield className="w-8 h-8 text-[var(--brand-gold-mid)]" />,
  'Audio': <Headphones className="w-8 h-8 text-[var(--brand-gold-mid)]" />,
  'Cargadores': <Battery className="w-8 h-8 text-[var(--brand-gold-mid)]" />
};

interface FeaturedCategoriesCarouselProps {
  categories: string[];
  onSelectCategory: (cat: string) => void;
  selectedCategory: string | null;
}

export function FeaturedCategoriesCarousel({ categories, onSelectCategory, selectedCategory }: FeaturedCategoriesCarouselProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const scrollAmount = direction === 'left' ? -200 : 200;
      scrollRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  const validCategories = categories.filter(c => c !== 'Todos');

  return (
    <div className="relative mb-8 group">
      <h3 className="font-bold text-[var(--text-primary)] mb-4 ml-1">Categorías Destacadas</h3>
      
      {/* Scroll Controls */}
      <button 
        onClick={() => scroll('left')}
        className="absolute left-0 top-1/2 translate-y-2 -ml-4 z-10 p-2 bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-full text-[var(--text-primary)] shadow-sm opacity-0 group-hover:opacity-100 transition-opacity hover:scale-105 hidden sm:block"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>

      <button 
        onClick={() => scroll('right')}
        className="absolute right-0 top-1/2 translate-y-2 -mr-4 z-10 p-2 bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-full text-[var(--text-primary)] shadow-sm opacity-0 group-hover:opacity-100 transition-opacity hover:scale-105 hidden sm:block"
      >
        <ChevronRight className="w-5 h-5" />
      </button>

      {/* Carousel Container */}
      <div 
        ref={scrollRef}
        className="flex gap-4 overflow-x-auto pb-4 scroll-smooth hide-scrollbar px-1"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {validCategories.map(cat => {
          const isSelected = selectedCategory === cat;
          return (
            <button
              key={cat}
              onClick={() => onSelectCategory(isSelected ? 'Todos' : cat)}
              className="flex flex-col items-center gap-3 min-w-[100px] flex-shrink-0 group/card cursor-pointer"
            >
              <div className={`w-[84px] h-[84px] rounded-full flex items-center justify-center transition-all duration-300 border-2 ${
                isSelected 
                  ? 'border-[var(--brand-gold-mid)] bg-[var(--brand-gold-mid)]/10 shadow-md' 
                  : 'border-transparent bg-[var(--bg-surface)] group-hover/card:border-[var(--border-color)] group-hover/card:shadow-sm'
              }`}>
                {CATEGORY_ICONS[cat] || <Smartphone className="w-8 h-8 text-[var(--text-muted)]" />}
              </div>
              <span className={`text-xs font-bold transition-colors ${
                isSelected ? 'text-[var(--brand-gold-mid)]' : 'text-[var(--text-secondary)] group-hover/card:text-[var(--text-primary)]'
              }`}>
                {cat}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  );
}
