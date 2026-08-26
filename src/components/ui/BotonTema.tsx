import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';
import { Tema, temaInicial, alternarTema, EVENTO_TEMA } from '../../utils/tema';

/**
 * Devuelve el tema actual y lo mantiene al día.
 *
 * Escucha el evento del módulo de tema en vez de recibir el valor por
 * props, así que dos interruptores en pantallas distintas —el de la
 * tienda y el del panel— se mantienen sincronizados solos.
 */
export function useTema(): Tema {
  const [tema, setTema] = useState<Tema>(() => temaInicial());
  useEffect(() => {
    const alCambiar = (e: Event) => {
      const t = (e as CustomEvent<{ tema?: Tema }>).detail?.tema;
      if (t) setTema(t);
    };
    window.addEventListener(EVENTO_TEMA, alCambiar);
    return () => window.removeEventListener(EVENTO_TEMA, alCambiar);
  }, []);
  return tema;
}

interface Props {
  /** Clases extra para encajar con la barra donde se coloque. */
  className?: string;
}

/**
 * Interruptor de tema. Un solo botón que alterna, no dos opciones: es la
 * forma que menos espacio ocupa en la barra superior de la tienda y en la
 * del panel, donde el ancho es escaso en teléfono.
 *
 * El icono muestra A DÓNDE se va, no dónde se está: en tema claro se ve
 * una luna ("cambiar a oscuro"), que es lo que la gente espera.
 */
export default function BotonTema({ className = '' }: Props) {
  const tema = useTema();
  const vaAOscuro = tema === 'claro';
  return (
    <button
      type="button"
      onClick={() => alternarTema()}
      aria-label={vaAOscuro ? 'Cambiar a tema oscuro' : 'Cambiar a tema claro'}
      title={vaAOscuro ? 'Tema oscuro' : 'Tema claro'}
      className={`flex-shrink-0 inline-flex items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition cursor-pointer ${className}`}
    >
      {vaAOscuro ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
    </button>
  );
}
