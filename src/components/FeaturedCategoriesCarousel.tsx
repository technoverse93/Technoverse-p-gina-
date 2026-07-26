import React, { useRef } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Smartphone,
  Headphones,
  BatteryCharging,
  Shield,
  Wrench,
  Watch,
  Laptop,
  Cable,
  Package,
} from 'lucide-react';

/**
 * Carrusel de categorías destacadas — maqueta "Opción C / Retail limpio".
 *
 * Cada categoría es una tarjeta cuadrada de esquinas redondeadas (56 px) con el
 * icono centrado y la etiqueta debajo, desplazándose en un riel horizontal.
 *
 * Los iconos NO llevan color fijo: heredan `currentColor` del contenedor, que a
 * su vez usa las variables del tema. Por eso cambian solos entre el azul marino
 * del modo claro y el dorado del modo oscuro, sin lógica de JavaScript ni
 * clases duplicadas por tema.
 */

const ICON_CLASS = 'w-6 h-6';

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  'Dispositivos': <Smartphone className={ICON_CLASS} />,
  'Celulares': <Smartphone className={ICON_CLASS} />,
  'Estuches': <Shield className={ICON_CLASS} />,
  'Fundas': <Shield className={ICON_CLASS} />,
  'Audio': <Headphones className={ICON_CLASS} />,
  'Audífonos': <Headphones className={ICON_CLASS} />,
  'Cargadores': <BatteryCharging className={ICON_CLASS} />,
  'Cables': <Cable className={ICON_CLASS} />,
  'Repuestos': <Wrench className={ICON_CLASS} />,
  'Wearables': <Watch className={ICON_CLASS} />,
  'Relojes': <Watch className={ICON_CLASS} />,
  'Laptops': <Laptop className={ICON_CLASS} />,
  'Computadoras': <Laptop className={ICON_CLASS} />,
  'Otros': <Package className={ICON_CLASS} />,
};

interface FeaturedCategoriesCarouselProps {
  categories: string[];
  onSelectCategory: (cat: string) => void;
  selectedCategory: string | null;
}

export function FeaturedCategoriesCarousel({
  categories,
  onSelectCategory,
  selectedCategory,
}: FeaturedCategoriesCarouselProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const scrollAmount = direction === 'left' ? -220 : 220;
      scrollRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  const validCategories = categories.filter(c => c && c !== 'Todos');

  if (validCategories.length === 0) return null;

  return (
    <section className="relative mb-8 group" aria-label="Categorías destacadas">
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <h3 className="font-bold text-[var(--text-primary)] m-0">Categorías destacadas</h3>
        {selectedCategory && selectedCategory !== 'Todos' && (
          <button
            type="button"
            onClick={() => onSelectCategory('Todos')}
            className="text-xs font-semibold text-[var(--accent)] hover:underline cursor-pointer"
          >
            Ver todo
          </button>
        )}
      </div>

      {/* Controles de desplazamiento: solo en pantallas grandes con puntero,
          donde no existe el arrastre táctil. */}
      <button
        type="button"
        onClick={() => scroll('left')}
        aria-label="Desplazar categorías a la izquierda"
        className="absolute left-0 top-[54%] -translate-y-1/2 -ml-3 z-10 w-9 h-9 rounded-full bg-[var(--bg-surface)] border border-[var(--border-color)] text-[var(--text-secondary)] opacity-0 group-hover:opacity-100 transition-opacity hover:text-[var(--text-primary)] hidden lg:flex items-center justify-center cursor-pointer"
        style={{ boxShadow: 'var(--shadow-sm)' }}
      >
        <ChevronLeft className="w-4 h-4" />
      </button>

      <button
        type="button"
        onClick={() => scroll('right')}
        aria-label="Desplazar categorías a la derecha"
        className="absolute right-0 top-[54%] -translate-y-1/2 -mr-3 z-10 w-9 h-9 rounded-full bg-[var(--bg-surface)] border border-[var(--border-color)] text-[var(--text-secondary)] opacity-0 group-hover:opacity-100 transition-opacity hover:text-[var(--text-primary)] hidden lg:flex items-center justify-center cursor-pointer"
        style={{ boxShadow: 'var(--shadow-sm)' }}
      >
        <ChevronRight className="w-4 h-4" />
      </button>

      {/* Riel horizontal con desplazamiento táctil nativo y anclaje suave. */}
      <div
        ref={scrollRef}
        className="flex gap-2.5 overflow-x-auto pb-1 hide-scrollbar"
        style={{ scrollSnapType: 'x proximity' }}
      >
        {validCategories.map(cat => {
          const isSelected = selectedCategory === cat;
          return (
            <button
              key={cat}
              type="button"
              onClick={() => onSelectCategory(isSelected ? 'Todos' : cat)}
              aria-pressed={isSelected}
              className="flex-none w-[78px] flex flex-col items-center gap-[7px] cursor-pointer group/cat"
              style={{ scrollSnapAlign: 'start' }}
            >
              {/* Tarjeta del icono. El SVG hereda el color de este contenedor
                  (currentColor), así que sigue al tema sin clases extra. */}
              <span
                className={`w-14 h-14 rounded-[14px] grid place-items-center border text-[var(--accent)] transition-[transform,border-color,background-color] duration-200 ${
                  isSelected
                    ? 'border-[var(--accent)]'
                    : 'border-[var(--border-color)] bg-[var(--bg-surface)] group-hover/cat:border-[var(--accent)] group-hover/cat:-translate-y-0.5'
                }`}
                style={
                  isSelected
                    ? {
                        backgroundColor: 'rgba(var(--accent-rgb), 0.10)',
                        boxShadow: 'var(--shadow-sm)',
                      }
                    : { boxShadow: 'var(--shadow-sm)' }
                }
              >
                {CATEGORY_ICONS[cat] || <Package className={ICON_CLASS} />}
              </span>

              <span
                className={`text-[11.5px] font-semibold leading-[1.25] text-center transition-colors ${
                  isSelected
                    ? 'text-[var(--accent)]'
                    : 'text-[var(--text-secondary)] group-hover/cat:text-[var(--text-primary)]'
                }`}
              >
                {cat}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
