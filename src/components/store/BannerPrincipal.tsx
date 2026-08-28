// =====================================================================
// BANNER PRINCIPAL DE LA TIENDA
// =====================================================================
// Va inmediatamente debajo de la barra superior y por encima de las
// categorías y del catálogo. Es lo primero que se ve al abrir la tienda.
//
// ---------------------------------------------------------------------
// LAS DOS PROPORCIONES, Y POR QUÉ SON DOS Y NO UNA
// ---------------------------------------------------------------------
// El contenedor tiene una proporción FIJA y la imagen se recorta con
// `object-fit: cover`. Eso garantiza lo que se pidió: la imagen nunca se
// deforma —no se estira ni se aplasta— pase lo que pase con su tamaño
// original. Lo que sí puede pasar es que se recorte por los bordes si la
// proporción no calza, y por eso conviene exportar con las medidas
// exactas:
//
//   · Escritorio (≥ 768 px):  1920 × 600 px   (proporción 16:5)
//   · Teléfono   (< 768 px):  1080 × 810 px   (proporción 4:3)
//
// La de teléfono NO es cuadrada a propósito. Un 1080×1080 ocupa, en una
// pantalla de 375 px de ancho, unos 375 px de alto: casi la mitad del
// teléfono solo para el cartel, empujando el catálogo por debajo del
// borde visible. Eso choca de frente con el otro objetivo de esta misma
// tanda —ver más productos sin tanto scroll—, así que se usa 4:3, que en
// ese mismo teléfono ocupa ~281 px y deja la primera fila de productos a
// la vista. Si algún día se prefiere el cuadrado, es cambiar el
// `aspect-[4/3]` de abajo por `aspect-square` y reexportar a 1080×1080.
//
// ZONA SEGURA: como en escritorio y teléfono se recorta distinto, el
// texto o el logotipo del cartel conviene mantenerlos dentro del 80 %
// central de la imagen. Lo que quede pegado a un borde puede perderse en
// el otro tamaño.
// =====================================================================

import React, { useEffect, useMemo, useState } from 'react';
import type { Banner } from '../../types';

interface Props {
  banners: Banner[];
}

/** Milisegundos que se queda cada cartel antes de pasar al siguiente. */
const INTERVALO_MS = 6000;

/**
 * ¿Este banner debe verse hoy?
 *
 * Se apoya en `active` y en la ventana de fechas. Las fechas son
 * opcionales: un banner sin fechas se considera siempre vigente, que es
 * lo que espera quien solo quiere dejarlo puesto.
 */
function estaVigente(b: Banner): boolean {
  if (!b || b.active === false) return false;
  const hoy = Date.now();
  if (b.startDate) {
    const desde = new Date(b.startDate).getTime();
    if (Number.isFinite(desde) && hoy < desde) return false;
  }
  if (b.endDate) {
    // Se toma el final del día indicado: un banner que "termina el 30"
    // tiene que verse durante todo el 30, no apagarse a medianoche del 29.
    const hasta = new Date(b.endDate).getTime();
    if (Number.isFinite(hasta) && hoy > hasta + 24 * 60 * 60 * 1000 - 1) return false;
  }
  return true;
}

export default function BannerPrincipal({ banners }: Props) {
  const visibles = useMemo(
    () => (banners || []).filter(estaVigente).filter(b => !!b.imageUrl),
    [banners]
  );

  const [indice, setIndice] = useState(0);

  // El índice se recorta si cambian los banners mientras se miran: sin
  // esto, borrar el último desde el panel dejaría el carrusel apuntando a
  // una posición que ya no existe.
  useEffect(() => {
    if (indice > visibles.length - 1) setIndice(0);
  }, [visibles.length, indice]);

  // Rotación automática. Se apaga con un solo banner (no hay a dónde ir) y
  // también para quien pidió menos movimiento en su sistema.
  useEffect(() => {
    if (visibles.length < 2) return;
    if (typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    const t = setInterval(() => {
      setIndice(i => (i + 1) % visibles.length);
    }, INTERVALO_MS);
    return () => clearInterval(t);
  }, [visibles.length]);

  // Sin banners cargados no se reserva NADA de alto. Es deliberado: dejar
  // un hueco vacío del tamaño del cartel correría el catálogo hacia abajo
  // en toda tienda que todavía no haya subido ninguno.
  if (visibles.length === 0) return null;

  const actual = visibles[Math.min(indice, visibles.length - 1)];

  const contenido = (
    <>
      <img
        src={actual.imageUrl}
        alt={actual.title || 'Promoción'}
        className="absolute inset-0 w-full h-full object-cover"
        /* El primer cartel es lo más grande que se ve al abrir: se pide
           con prioridad para que no llegue después del catálogo. */
        loading="eager"
        decoding="async"
      />
      {/* Solo se dibuja el velo y el texto si hay texto que poner. Un
          cartel diseñado con su propia tipografía no necesita que se le
          encime nada. */}
      {(actual.title || actual.description) && (
        <div className="absolute inset-0 flex flex-col justify-end p-4 sm:p-6 md:p-8 bg-gradient-to-t from-black/70 via-black/25 to-transparent">
          {/* El color va en `style` y no en una clase `text-white`, y no es
              capricho: medido sobre la tienda compilada, el título salía en
              rgb(15,23,42) —casi negro sobre una foto oscura, ilegible—
              aunque llevara `text-white`. La causa es la cascada por capas:
              las utilidades de Tailwind viven dentro de una `@layer`, y una
              regla SIN capa le gana a cualquier regla con capa por
              específica que sea. index.css declara `h1,h2,h3,h4,h5 { color:
              var(--text-primary) }` sin capa, así que se imponía. Un estilo
              en línea no participa de ese pulso y siempre gana. */}
          {actual.title && (
            <h2
              className="font-black text-lg sm:text-2xl md:text-3xl leading-tight drop-shadow-sm"
              style={{ color: '#ffffff' }}
            >
              {actual.title}
            </h2>
          )}
          {actual.description && (
            <p className="text-white/90 text-xs sm:text-sm md:text-base mt-1 max-w-2xl line-clamp-2">
              {actual.description}
            </p>
          )}
        </div>
      )}
    </>
  );

  return (
    <section aria-label="Promociones" className="w-full">
      <div className="relative w-full overflow-hidden rounded-2xl aspect-[4/3] md:aspect-[16/5] bg-[var(--bg-surface)]">
        {actual.link ? (
          <a
            href={actual.link}
            target={/^https?:\/\//i.test(actual.link) ? '_blank' : undefined}
            rel="noopener noreferrer"
            className="absolute inset-0 block"
          >
            {contenido}
          </a>
        ) : (
          contenido
        )}
      </div>

      {/* Puntos de navegación. Solo con más de un cartel. */}
      {visibles.length > 1 && (
        <div className="flex items-center justify-center gap-2 mt-3">
          {visibles.map((b, i) => (
            <button
              key={b.id || i}
              type="button"
              onClick={() => setIndice(i)}
              aria-label={`Ver promoción ${i + 1} de ${visibles.length}`}
              aria-current={i === indice}
              className={`h-2 rounded-full transition-all ${
                i === indice
                  ? 'w-6 bg-[var(--accent)]'
                  : 'w-2 bg-[var(--border-color)] hover:bg-[var(--text-muted)]'
              }`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
