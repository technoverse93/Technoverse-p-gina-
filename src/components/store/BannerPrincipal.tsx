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
import { estaVigente, ordenarBanners, esPiezaDisenada } from '../../utils/bannerEstado';
import { marcarVistaEnSesion, registrarEventoBanner } from '../../utils/bannerMetricas';
import { alTocarEnlace } from '../../utils/whatsapp';

interface Props {
  banners: Banner[];
  /** Vista previa del panel: no cuenta vistas ni clics. */
  vista?: boolean;
}

/** Milisegundos que se queda cada cartel antes de pasar al siguiente. */
const INTERVALO_MS = 6000;

// La regla de vigencia (activo + ventana de fechas) vive en utils/bannerEstado.ts, junto con el estado que
// muestra el panel. Se reexporta aquí porque otros componentes de la tienda la importan de este archivo.
export { estaVigente };

export default function BannerPrincipal({ banners, vista = false }: Props) {
  const visibles = useMemo(
    // Solo los banners de formato "hero" (o los viejos sin formato, que se
    // tratan como hero). Los de divisor / grid / popup se pintan en su
    // propio lugar, no en este carrusel.
    () => ordenarBanners((banners || [])
      .filter(estaVigente)
      .filter(b => (b.formato || 'hero') === 'hero')
      .filter(b => !!b.imageUrl)),
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

  const actual = visibles[Math.min(indice, visibles.length - 1)];

  // Una vista por cartel y por sesión: se cuenta al mostrarse (el carrusel va pasando de uno a otro).
  // Va ANTES del `return null` de abajo: un hook después de un return condicional
  // cambia el orden de hooks entre renders y tumba toda la app (error #310).
  useEffect(() => {
    if (vista || !actual) return;
    if (marcarVistaEnSesion(actual.id)) registrarEventoBanner(actual.id, 'vista');
  }, [actual?.id, vista]);

  // Sin banners cargados no se reserva NADA de alto. Es deliberado: dejar
  // un hueco vacío del tamaño del cartel correría el catálogo hacia abajo
  // en toda tienda que todavía no haya subido ninguno.
  if (!actual) return null;

  const pieza = esPiezaDisenada(actual);

  const contenido = (
    <>
      <img
        src={actual.imageUrl}
        alt={actual.title || 'Promoción'}
        className={`absolute inset-0 w-full h-full ${pieza ? 'object-contain' : 'object-cover'}`}
        /* El primer cartel es lo más grande que se ve al abrir: se pide
           con prioridad para que no llegue después del catálogo. */
        loading="eager"
        decoding="async"
      />
      {actual.oferta && !pieza && (
        <span
          className="absolute top-3 left-3 sm:top-4 sm:left-4 rounded-full px-3 py-1 text-[11px] sm:text-[13px] font-black shadow-md"
          style={{ background: 'var(--accent-2)', color: 'var(--accent-2-ink)' }}
        >
          {actual.oferta}
        </span>
      )}
      {/* Solo se dibuja el velo y el texto si hay texto que poner. Un
          cartel diseñado con su propia tipografía no necesita que se le
          encime nada. */}
      {!pieza && (actual.title || actual.description) && (
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
          {actual.cta && (
            <span
              className="inline-flex self-start items-center gap-1.5 rounded-xl mt-2.5 px-4 py-1.5 text-[12.5px] sm:text-[13.5px] font-bold"
              style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
            >
              <span className="tv-1l">{actual.cta}</span>
            </span>
          )}
        </div>
      )}
    </>
  );

  return (
    <section aria-label="Promociones" className="w-full">
      <div className={`relative w-full overflow-hidden rounded-2xl ${pieza ? 'aspect-[16/5]' : 'aspect-[4/3] md:aspect-[16/5]'} bg-[var(--bg-surface)]`}>
        {actual.link ? (
          <a
            href={actual.link}
            target={/^https?:\/\//i.test(actual.link) ? '_blank' : undefined}
            rel="noopener noreferrer"
            className="absolute inset-0 block"
            onClick={e => { if (!vista) registrarEventoBanner(actual.id, 'clic'); alTocarEnlace(e, actual.link); }}
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
