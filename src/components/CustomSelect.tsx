import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Search } from 'lucide-react';

interface CustomSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  /**
   * Texto adicional para buscar (p. ej. el SKU) que NO se muestra en la
   * etiqueta. Sirve para poder escribir el código de un repuesto y
   * encontrarlo aunque el SKU no forme parte del texto visible.
   */
  searchText?: string;
}

interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: CustomSelectOption[];
  placeholder?: string;
  className?: string;
  id?: string;
  /**
   * Muestra un campo de búsqueda arriba de la lista. Pensado para
   * selectores con decenas o cientos de opciones (repuestos, insumos):
   * sin esto, encontrar un artículo obliga a hacer scroll manual sobre
   * toda la lista.
   */
  searchable?: boolean;
  searchPlaceholder?: string;
}

export function CustomSelect({
  value, onChange, options, placeholder = 'Seleccionar', className = '', id,
  searchable = false, searchPlaceholder = 'Buscar por nombre o SKU...',
}: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Al abrir, arranca con el campo vacío y el foco puesto ahí: se abre y se
  // escribe de inmediato, sin tocar el mouse.
  useEffect(() => {
    if (isOpen && searchable) {
      setQuery('');
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [isOpen, searchable]);

  const selected = options.find(o => o.value === value);

  const q = query.trim().toLowerCase();
  const opcionesFiltradas = !searchable || !q
    ? options
    : options.filter(o =>
        o.label.toLowerCase().includes(q) || (o.searchText || '').toLowerCase().includes(q)
      );

  return (
    <div ref={rootRef} className="relative" id={id}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={`glass-input w-full flex items-center justify-between gap-2 rounded-xl px-4 py-3 text-sm text-[var(--text-primary)] transition cursor-pointer ${className}`}
      >
        {/* `min-w-0` es imprescindible: `truncate` por sí solo NO recorta
            dentro de un contenedor flex, porque el ancho mínimo por defecto
            de un item de flex es el de su contenido. Sin esto, una opción
            larga estiraba el select y desplazaba la flecha fuera de la caja. */}
        <span className={`min-w-0 truncate ${selected ? '' : 'text-[var(--text-muted)]'}`}>{selected ? selected.label : placeholder}</span>
        <ChevronDown className={`w-4 h-4 text-[var(--text-muted)] flex-shrink-0 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen && (
        <div className="absolute left-0 right-0 z-[70] mt-1.5 max-h-64 overflow-y-auto glass-panel rounded-xl p-1.5 shadow-lg" role="listbox">
          {searchable && (
            <div className="relative mb-1.5 sticky top-0">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onClick={e => e.stopPropagation()}
                onKeyDown={e => e.stopPropagation()}
                placeholder={searchPlaceholder}
                className="w-full bg-[var(--bg-base)] border border-[var(--border-color)]/80 rounded-lg pl-8 pr-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-sky-500 "
              />
            </div>
          )}
          {searchable && opcionesFiltradas.length === 0 && (
            <p className="px-3 py-2.5 text-sm text-[var(--text-muted)] tv-break">Ningún resultado para «{query}».</p>
          )}
          {opcionesFiltradas.map(opt => (
            <button
              key={opt.value}
              type="button"
              role="option"
              aria-selected={opt.value === value}
              aria-disabled={opt.disabled}
              disabled={opt.disabled}
              onClick={() => { if (opt.disabled) return; onChange(opt.value); setIsOpen(false); }}
              className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition ${
                opt.disabled
                  ? 'text-[var(--text-muted)] opacity-50 cursor-not-allowed'
                  : opt.value === value
                    ? 'bg-[var(--brand-gold-mid)]/15 text-[var(--brand-navy)] font-bold'
                    : 'text-[var(--text-primary)] hover:bg-[var(--bg-base)]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
