// =====================================================================
// ICONO EDITABLE — cambiar un ícono desde el modo edición
// =====================================================================
// Fuera del modo edición, dibuja el ícono guardado (o el de por defecto).
// Dentro del modo edición, al tocarlo se abre una grilla con una lista
// curada de íconos; al elegir uno, se guarda su nombre.
//
//   <IconoEditable clave="tienda.titulo_icono" defecto="Sparkles" className="w-5 h-5" />
//
// Se usa una lista CURADA (no toda la librería lucide) a propósito: así el
// bundle no crece con cientos de íconos que nadie va a usar, y la persona
// elige de un set pensado para una tienda.
// =====================================================================

import { useEffect, useRef, useState } from 'react';
import {
  Sparkles, Star, Zap, Tag, Gift, ShoppingBag, ShoppingCart, Smartphone,
  Headphones, Wrench, ShieldCheck, Truck, Percent, Flame, Heart, Crown,
  Bell, ThumbsUp, BadgeCheck, Rocket,
  type LucideIcon,
} from 'lucide-react';
import { obtenerContenido, guardarContenido, suscribirContenido } from '../utils/contenidoSitio';
import { useModoEdicion } from './ModoEdicion';

/** Lista curada. La clave es el nombre que se guarda en la base. */
const ICONOS: Record<string, LucideIcon> = {
  Sparkles, Star, Zap, Tag, Gift, ShoppingBag, ShoppingCart, Smartphone,
  Headphones, Wrench, ShieldCheck, Truck, Percent, Flame, Heart, Crown,
  Bell, ThumbsUp, BadgeCheck, Rocket,
};

interface Props {
  clave: string;
  /** Nombre del ícono por defecto (debe existir en ICONOS). */
  defecto: string;
  className?: string;
}

export function IconoEditable({ clave, defecto, className = 'w-5 h-5' }: Props) {
  const { activo, quien } = useModoEdicion();
  const [nombre, setNombre] = useState(() => obtenerContenido(clave, defecto));
  const [abierto, setAbierto] = useState(false);
  const cajaRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    return suscribirContenido(() => setNombre(obtenerContenido(clave, defecto)));
  }, [clave, defecto]);

  // Cerrar la grilla al tocar fuera.
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (cajaRef.current && !cajaRef.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, [abierto]);

  const Icono = ICONOS[nombre] || ICONOS[defecto] || Sparkles;

  const elegir = async (n: string) => {
    setNombre(n);
    setAbierto(false);
    try { await guardarContenido(clave, n, 'icono', quien); } catch { /* queda local */ }
  };

  if (!activo) {
    return <Icono className={className} aria-hidden="true" />;
  }

  return (
    <span ref={cajaRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setAbierto(v => !v)}
        title="Cambiar ícono"
        className="inline-flex rounded outline-dashed outline-1 outline-[var(--accent)] p-0.5 cursor-pointer"
      >
        <Icono className={className} aria-hidden="true" />
      </button>

      {abierto && (
        <span className="absolute z-[901] top-full left-0 mt-1 grid grid-cols-5 gap-1 p-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] shadow-[var(--float-shadow-lg)] w-[190px]">
          {Object.entries(ICONOS).map(([n, Ic]) => (
            <button
              key={n}
              type="button"
              onClick={() => void elegir(n)}
              title={n}
              className={`inline-flex items-center justify-center rounded-lg p-1.5 transition hover:bg-[var(--bg-sunken)] ${n === nombre ? 'bg-[var(--accent)]/15 text-[var(--accent)]' : 'text-[var(--text-secondary)]'}`}
            >
              <Ic className="w-4 h-4" aria-hidden="true" />
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
