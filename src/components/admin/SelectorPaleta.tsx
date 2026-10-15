// =====================================================================
// SELECTOR DE PALETA DE MARCA (Configuración)
// =====================================================================
// El dueño elige con qué colores se ve la marca: Esmeralda (la de siempre),
// Océano, Atardecer u Orquídea. Cada una trae su versión clara y su versión
// oscura —la persona sigue escogiendo claro u oscuro con el botón de siempre—
// y la elección vale para TODOS: la tienda y el panel.
//
// Las miniaturas se dibujan con los tokens REALES de cada paleta (el elemento
// lleva `data-paleta-muestra`, ver styles/paletas.css), así que lo que se ve
// acá es exactamente lo que va a ver el cliente, no una imitación.
//
// Al tocar una paleta se ve al instante y se guarda para todos; si no se pudo
// guardar, vuelve a la anterior y lo dice (utils/paleta.ts).
// =====================================================================

import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { PALETAS, EVENTO_PALETA, fijarPaletaDeMarca, paletaActual, type Paleta } from '../../utils/paleta';
import { suscribirContenido } from '../../utils/contenidoSitio';

/** La paleta puesta ahora, al día aunque la cambie otro administrador en vivo. */
export function usePaleta(): Paleta {
  const [paleta, setPaleta] = useState<Paleta>(() => paletaActual());
  useEffect(() => {
    const alCambiar = () => setPaleta(paletaActual());
    window.addEventListener(EVENTO_PALETA, alCambiar);
    return () => window.removeEventListener(EVENTO_PALETA, alCambiar);
  }, []);
  return paleta;
}

/** Una miniatura de la paleta, en claro u oscuro, con sus colores de verdad. */
function Miniatura({ id, oscuro }: { id: Paleta; oscuro: boolean }) {
  // `data-modo` fija claro u oscuro en el propio elemento: se ve igual aunque la app esté en el otro modo.
  return (
    <div className="sp-mini" data-paleta-muestra={id} data-modo={oscuro ? 'oscuro' : 'claro'} aria-hidden="true">
      <span className="sp-barra" />
      <span className="sp-fila">
        <span className="sp-chip" />
        <span className="sp-linea sp-linea--corta" />
      </span>
      <span className="sp-linea" />
    </div>
  );
}

export default function SelectorPaleta({ quien }: { quien?: string | null }) {
  const actual = usePaleta();
  const [ocupada, setOcupada] = useState<Paleta | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Mientras se ve este selector, el canal en vivo del contenido está abierto:
  // si otro administrador cambia la paleta, aquí se nota al instante.
  useEffect(() => suscribirContenido(() => undefined), []);

  const elegir = async (p: Paleta) => {
    if (p === actual || ocupada) return;
    setError(null);
    setOcupada(p);
    try {
      await fijarPaletaDeMarca(p, quien);
    } catch {
      setError('No se pudo guardar la paleta. Revisá la conexión e intentá de nuevo.');
    } finally {
      setOcupada(null);
    }
  };

  return (
    <div className="tv-stack">
      <div className="sp-grid" role="group" aria-label="Paleta de colores de la marca">
        {PALETAS.map(p => {
          const activa = p.id === actual;
          return (
            <button
              key={p.id}
              type="button"
              className="sp-op"
              aria-pressed={activa}
              disabled={!!ocupada}
              onClick={() => void elegir(p.id)}
            >
              <span className="sp-vista">
                <Miniatura id={p.id} oscuro={false} />
                <Miniatura id={p.id} oscuro />
              </span>
              <span className="sp-cab">
                <span className="sp-nombre tv-1l">{p.nombre}</span>
                {activa && <Check className="sp-check" aria-label="Paleta en uso" />}
              </span>
              <span className="sp-nota tv-1l">{p.caracter}</span>
            </button>
          );
        })}
      </div>
      <p className="tv-hint !mt-0">
        Se aplica de inmediato en la tienda y en el panel, en claro y en oscuro. Los banners y las piezas
        destacadas toman estos colores solos.
      </p>
      {error && <p className="text-[12.5px] font-semibold text-[var(--tv-danger)]" role="alert">{error}</p>}
    </div>
  );
}
