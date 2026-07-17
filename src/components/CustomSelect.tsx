import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

interface CustomSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: CustomSelectOption[];
  placeholder?: string;
  className?: string;
  id?: string;
}

export function CustomSelect({ value, onChange, options, placeholder = 'Seleccionar', className = '', id }: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selected = options.find(o => o.value === value);

  return (
    <div ref={rootRef} className="relative" id={id}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={`glass-input w-full flex items-center justify-between gap-2 rounded-xl px-4 py-3 text-sm text-[var(--text-primary)] transition cursor-pointer ${className}`}
      >
        <span className={`truncate ${selected ? '' : 'text-[var(--text-muted)]'}`}>{selected ? selected.label : placeholder}</span>
        <ChevronDown className={`w-4 h-4 text-[var(--text-muted)] flex-shrink-0 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen && (
        <div className="absolute left-0 right-0 z-[70] mt-1.5 max-h-64 overflow-y-auto glass-panel rounded-xl p-1.5 shadow-lg" role="listbox">
          {options.map(opt => (
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
                    ? 'bg-[var(--brand-gold-mid)]/15 text-[var(--brand-navy)] dark:text-[var(--brand-gold-light)] font-bold'
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
