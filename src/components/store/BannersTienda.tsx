// =====================================================================
// BANNERS DE LA TIENDA — formatos Divisor, Grid y Pop-up
// =====================================================================
// El Hero (carrusel principal) vive en `BannerPrincipal.tsx`. Aquí están
// los otros tres formatos del sistema:
//
//   · BannerDivisor      — franja ancha para separar secciones.
//   · TarjetasBannerGrid — banners que ocupan un espacio de la cuadrícula.
//   · PopupPromocional   — emergente, UNA vez por sesión (localStorage).
//
// Todos comparten la misma regla de vigencia que el Hero (`estaVigente`)
// y todos son opcionales: sin banners de su formato, no pintan nada.
// =====================================================================

import React, { useEffect, useMemo, useState } from 'react';
import { X, ArrowRight } from 'lucide-react';
import type { Banner } from '../../types';
import { estaVigente } from './BannerPrincipal';

function porFormato(banners: Banner[], formato: Banner['formato']): Banner[] {
  return (banners || [])
    .filter(estaVigente)
    .filter(b => (b.formato || 'hero') === formato)
    .filter(b => !!b.imageUrl);
}

/** ¿El enlace sale del sitio? (WhatsApp, redes...) Para abrirlo en pestaña nueva. */
function esExterno(link?: string): boolean {
  return !!link && /^https?:\/\//i.test(link);
}

function Envoltura({ link, className, children }: { link?: string; className?: string; children: React.ReactNode }) {
  if (link) {
    return (
      <a href={link} target={esExterno(link) ? '_blank' : undefined} rel="noopener noreferrer" className={className}>
        {children}
      </a>
    );
  }
  return <div className={className}>{children}</div>;
}

// ---------------------------------------------------------------------
// DIVISOR — franja ancha entre secciones del catálogo
// ---------------------------------------------------------------------
export function BannerDivisor({ banners }: { banners: Banner[] }) {
  const lista = useMemo(() => porFormato(banners, 'divisor'), [banners]);
  if (lista.length === 0) return null;

  // Se muestra el primero vigente; los demás quedan como respaldo por si el
  // primero cae fuera de fecha. Un divisor es un separador, no un carrusel.
  const b = lista[0];

  return (
    <section aria-label={b.title || 'Promoción'} className="w-full my-6">
      <Envoltura
        link={b.link}
        className="relative block w-full overflow-hidden rounded-2xl aspect-[16/5] sm:aspect-[21/5] bg-[var(--bg-surface)] group"
      >
        <img
          src={b.imageUrl}
          alt={b.title || 'Promoción'}
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          loading="lazy"
          decoding="async"
        />
        {(b.title || b.description || b.oferta) && (
          <div className="absolute inset-0 flex flex-col justify-center gap-1 p-4 sm:p-6 md:p-8 bg-gradient-to-r from-black/70 via-black/30 to-transparent">
            {b.oferta && (
              <span className="self-start rounded-full px-2.5 py-0.5 text-[11px] font-black mb-1"
                style={{ background: 'var(--accent)', color: 'var(--accent-ink, #fff)' }}>
                {b.oferta}
              </span>
            )}
            {b.title && (
              <h3 className="font-black text-base sm:text-xl md:text-2xl leading-tight" style={{ color: '#ffffff' }}>
                {b.title}
              </h3>
            )}
            {b.description && (
              <p className="text-white/90 text-xs sm:text-sm max-w-lg line-clamp-2">{b.description}</p>
            )}
            {b.link && (
              <span className="inline-flex items-center gap-1 text-white font-bold text-xs sm:text-sm mt-1">
                Ver más <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </span>
            )}
          </div>
        )}
      </Envoltura>
    </section>
  );
}

// ---------------------------------------------------------------------
// GRID — tarjetas que se mezclan en la cuadrícula de productos
// ---------------------------------------------------------------------
// Devuelve las tarjetas para inyectarlas dentro de la MISMA rejilla del
// catálogo, así miden igual que un producto. Cada una ocupa dos columnas
// (`col-span-2`) para que se lea como banner y no como un producto más.
export function TarjetasBannerGrid({ banners }: { banners: Banner[] }) {
  const lista = useMemo(() => porFormato(banners, 'grid'), [banners]);
  if (lista.length === 0) return null;

  return (
    <>
      {lista.map(b => (
        <React.Fragment key={b.id}>
        <Envoltura
          link={b.link}
          className="relative col-span-2 overflow-hidden rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-color)] group"
        >
          <div className="relative w-full aspect-square sm:aspect-[2/1]">
            <img
              src={b.imageUrl}
              alt={b.title || 'Promoción'}
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
              loading="lazy"
              decoding="async"
            />
            {b.oferta && (
              <span className="absolute top-2 left-2 rounded-full px-2 py-0.5 text-[10px] font-black shadow"
                style={{ background: 'var(--accent)', color: 'var(--accent-ink, #fff)' }}>
                {b.oferta}
              </span>
            )}
            {(b.title || b.description) && (
              <div className="absolute inset-x-0 bottom-0 p-2.5 bg-gradient-to-t from-black/75 to-transparent">
                {b.title && <div className="font-bold text-[13px] leading-tight" style={{ color: '#fff' }}>{b.title}</div>}
                {b.description && <div className="text-white/85 text-[11px] line-clamp-1">{b.description}</div>}
              </div>
            )}
          </div>
        </Envoltura>
        </React.Fragment>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------
// POP-UP — emergente promocional, una vez por sesión
// ---------------------------------------------------------------------
// Control de frecuencia con `sessionStorage`: aparece UNA vez por sesión
// del navegador y por banner (la clave lleva el id). Así no satura: quien
// ya lo cerró no lo vuelve a ver hasta abrir la tienda de cero. Se puede
// subir a "una vez al día" cambiando la clave por una fecha.
const CLAVE_POPUP = 'technoverse_popup_visto_';

export function PopupPromocional({ banners }: { banners: Banner[] }) {
  const lista = useMemo(() => porFormato(banners, 'popup'), [banners]);
  const b = lista[0];
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    if (!b) return;
    let yaVisto = false;
    try { yaVisto = sessionStorage.getItem(CLAVE_POPUP + b.id) === '1'; } catch { /* incógnito */ }
    if (yaVisto) return;
    // Un respiro antes de aparecer: cae mejor que saltar encima al instante.
    const t = setTimeout(() => setAbierto(true), 1200);
    return () => clearTimeout(t);
  }, [b]);

  if (!b || !abierto) return null;

  const cerrar = () => {
    setAbierto(false);
    try { sessionStorage.setItem(CLAVE_POPUP + b.id, '1'); } catch { /* nada */ }
  };

  return (
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-label={b.title || 'Promoción'}
      onClick={cerrar}
    >
      <div
        className="relative w-full max-w-md rounded-2xl overflow-hidden bg-[var(--bg-elevated)] shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={cerrar}
          aria-label="Cerrar"
          className="absolute top-2 right-2 z-10 w-8 h-8 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-black/60 transition"
        >
          <X className="w-4 h-4" />
        </button>

        <Envoltura link={b.link} className="block">
          <div className="relative w-full aspect-[4/3]">
            <img src={b.imageUrl} alt={b.title || 'Promoción'} className="absolute inset-0 w-full h-full object-cover" />
            {b.oferta && (
              <span className="absolute top-3 left-3 rounded-full px-3 py-1 text-[13px] font-black shadow"
                style={{ background: 'var(--accent)', color: 'var(--accent-ink, #fff)' }}>
                {b.oferta}
              </span>
            )}
          </div>
          {(b.title || b.description) && (
            <div className="p-4">
              {b.title && <h3 className="font-black text-lg text-[var(--text-primary)]">{b.title}</h3>}
              {b.description && <p className="text-[13px] text-[var(--text-secondary)] mt-1 leading-relaxed">{b.description}</p>}
              {b.link && (
                <span className="inline-flex items-center gap-1.5 mt-3 rounded-xl px-4 py-2 text-[13px] font-bold"
                  style={{ background: 'var(--accent)', color: 'var(--accent-ink, #fff)' }}>
                  Ver la oferta <ArrowRight className="w-4 h-4" />
                </span>
              )}
            </div>
          )}
        </Envoltura>
      </div>
    </div>
  );
}
