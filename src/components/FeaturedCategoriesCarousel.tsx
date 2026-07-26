import React, { useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Carrusel de categorías destacadas — maqueta "Opción C / Retail limpio".
 *
 * Los iconos son EMOJI a color, exactamente como en la maqueta aprobada:
 *
 *   <div class="cat"><i>📱</i><span>Dispositivos</span></div>
 *   .cat i { width:56px; height:56px; border-radius:14px; font-size:22px;
 *            background:var(--surface); border:1px solid var(--line); }
 *
 * Antes se usaban iconos SVG monocromáticos (lucide) que heredaban el color del
 * tema; por eso las capturas no coincidían con la maqueta. El emoji trae su
 * propio color y es lo que da el aspecto de tienda comercial.
 *
 * Nota honesta: el emoji lo dibuja la fuente del sistema, así que se ve algo
 * distinto en Android, iOS y Windows. Es el mismo comportamiento que tenía la
 * maqueta que aprobaste.
 */

const CATEGORY_EMOJI: Record<string, string> = {
  // Nombres exactos de la maqueta
  'Dispositivos': '📱',
  'Estuches': '🛡️',
  'Cargadores': '🔌',
  'Audio': '🎧',
  'Repuestos': '🔧',
  'Wearables': '⌚',
  // Variantes reales del catálogo
  'Celulares': '📱',
  'Teléfonos': '📱',
  'Fundas': '🛡️',
  'Protectores': '🛡️',
  'Vidrios': '🛡️',
  'Audífonos': '🎧',
  'Parlantes': '🔊',
  'Cables': '🔌',
  'Baterías': '🔋',
  'Relojes': '⌚',
  'Laptops': '💻',
  'Computadoras': '💻',
  'Tablets': '📲',
  'Accesorios': '🎒',
  'Memorias': '💾',
  'Gaming': '🎮',
  'Cámaras': '📷',
  'Otros': '📦',
  'Otro': '📦',
};

const FALLBACK_EMOJI = '📦';

/** Búsqueda tolerante: exacta, luego sin acentos/mayúsculas, luego por raíz. */
function emojiFor(cat: string): string {
  if (CATEGORY_EMOJI[cat]) return CATEGORY_EMOJI[cat];

  const norm = (s: string) =>
    s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

  const target = norm(cat);
  for (const [key, emoji] of Object.entries(CATEGORY_EMOJI)) {
    const k = norm(key);
    if (k === target || target.includes(k) || k.includes(target)) return emoji;
  }
  return FALLBACK_EMOJI;
}

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
              {/* Tarjeta del icono: 56×56, radio 14, emoji a 22px. */}
              <span
                aria-hidden="true"
                className={`w-14 h-14 rounded-[14px] grid place-items-center border text-[22px] leading-none select-none transition-[transform,border-color,background-color] duration-200 ${
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
                {emojiFor(cat)}
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
