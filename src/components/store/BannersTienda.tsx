// =====================================================================
// BANNERS DE LA TIENDA — cintillo, tarjetas de campaña, divisor, cuadrícula y pop-up
// =====================================================================
// El Hero (carrusel principal) vive en `BannerPrincipal.tsx`. Aquí están los demás formatos:
//
//   · Cintillo           — franja delgada de TEXTO con la oferta (sin imagen), arriba del catálogo.
//   · TarjetasCampana    — tarjetas de campaña con título, descripción y botón (imagen opcional).
//   · BannerDivisor      — franja ancha con imagen para separar secciones.
//   · TarjetasBannerGrid — banners que ocupan un espacio de la cuadrícula.
//   · PopupPromocional   — emergente, UNA vez por sesión (sessionStorage).
//
// Todos comparten la misma regla de vigencia (`estaVigente`, utils/bannerEstado.ts), se ordenan por
// `prioridad`, y todos son opcionales: sin banners de su formato, no pintan nada (ni un píxel).
//
// COLORES: nunca un hex. La insignia de oferta es el acento SECUNDARIO de la paleta (`--accent-2`), y los
// banners de texto (cintillo y campaña) toman su variante de utils/bannerEstado.ts: fondo/tinta/botón por
// tokens, así que siguen a la paleta de marca (Esmeralda, Océano, Atardecer, Orquídea) y al modo claro/oscuro.
// Solo el texto SOBRE una foto va en blanco con velo oscuro (la foto no es del tema).
//
// MÉTRICAS: cada banner cuenta una vista por sesión y un clic cada vez que se toca (utils/bannerMetricas.ts).
// En la vista previa del panel (`vista`) no se cuenta nada ni se recuerda nada en el navegador.
// =====================================================================

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, ArrowRight } from 'lucide-react';
import type { Banner } from '../../types';
import { estaVigente, estiloDe, ordenarBanners } from '../../utils/bannerEstado';
import { marcarVistaEnSesion, registrarEventoBanner } from '../../utils/bannerMetricas';

export { estaVigente };

/** Los banners de un formato que se ven hoy, en su orden. `conImagen`: los de imagen no se pintan sin ella. */
function porFormato(banners: Banner[], formato: NonNullable<Banner['formato']>, conImagen = true): Banner[] {
  return ordenarBanners(
    (banners || [])
      .filter(estaVigente)
      .filter(b => (b.formato || 'hero') === formato)
      .filter(b => !conImagen || !!b.imageUrl),
  );
}

/** ¿El enlace sale del sitio? (WhatsApp, redes...) Para abrirlo en pestaña nueva. */
function esExterno(link?: string): boolean {
  return !!link && /^https?:\/\//i.test(link);
}

/** Cuenta UNA vista (por sesión) cuando la mitad del banner estuvo en pantalla casi un segundo. */
export function useVistaUnaVez(id: string, activo: boolean) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!activo || !el || !id) return;
    if (typeof IntersectionObserver === 'undefined') { if (marcarVistaEnSesion(id)) registrarEventoBanner(id, 'vista'); return; }
    let reloj: ReturnType<typeof setTimeout> | null = null;
    const obs = new IntersectionObserver(entradas => {
      for (const e of entradas) {
        if (e.isIntersecting && e.intersectionRatio >= 0.5) {
          if (!reloj) reloj = setTimeout(() => { if (marcarVistaEnSesion(id)) registrarEventoBanner(id, 'vista'); obs.disconnect(); }, 900);
        } else if (reloj) { clearTimeout(reloj); reloj = null; }
      }
    }, { threshold: [0.5] });
    obs.observe(el);
    return () => { obs.disconnect(); if (reloj) clearTimeout(reloj); };
  }, [id, activo]);
  return ref;
}

interface EnvolturaProps {
  link?: string;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
  /** Id del banner para contar el clic; sin él (vista previa) no se cuenta. */
  contar?: string;
}

function Envoltura({ link, className, style, children, contar }: EnvolturaProps) {
  if (link) {
    return (
      <a
        href={link}
        target={esExterno(link) ? '_blank' : undefined}
        rel="noopener noreferrer"
        className={className}
        style={style}
        onClick={contar ? () => registrarEventoBanner(contar, 'clic') : undefined}
      >
        {children}
      </a>
    );
  }
  return <div className={className} style={style}>{children}</div>;
}

/** La etiqueta de oferta: el acento SECUNDARIO de la paleta. */
function Insignia({ texto, className = '' }: { texto: string; className?: string }) {
  return (
    <span
      className={`rounded-full font-black shadow-sm ${className}`}
      style={{ background: 'var(--accent-2)', color: 'var(--accent-2-ink)' }}
    >
      {texto}
    </span>
  );
}

/** El botón de llamado a la acción. Es un <span> (no un botón): el banner entero ya es el enlace. */
function BotonCta({ texto, className = '', style }: { texto: string; className?: string; style: React.CSSProperties }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-xl font-bold ${className}`} style={style}>
      <span className="tv-1l">{texto}</span> <ArrowRight className="w-4 h-4 flex-none" aria-hidden="true" />
    </span>
  );
}

// ---------------------------------------------------------------------
// CINTILLO — franja delgada de texto con la oferta
// ---------------------------------------------------------------------
// Una sola línea: la oferta (insignia), el mensaje y, si hay enlace, el llamado. Con varios cintillos vigentes
// rotan cada 6 s (se detienen al pasar el cursor y con «reducir movimiento»). La X lo oculta durante la sesión;
// si el dueño cambia el mensaje o suma otro, reaparece (la huella incluye ids y textos).
const CLAVE_CINTILLO = 'tv_cintillo_cerrado';
const INTERVALO_CINTILLO_MS = 6000;

export function Cintillo({ banners, vista = false }: { banners: Banner[]; vista?: boolean }) {
  const lista = useMemo(() => porFormato(banners, 'cintillo', false).filter(b => b.title || b.oferta), [banners]);
  const huella = useMemo(() => lista.map(b => `${b.id}:${b.title || ''}:${b.oferta || ''}:${b.link || ''}`).join('|'), [lista]);

  const [cerradoHuella, setCerradoHuella] = useState<string | null>(() => {
    if (vista) return null;
    try { return sessionStorage.getItem(CLAVE_CINTILLO); } catch { return null; }
  });
  const [indice, setIndice] = useState(0);
  const [pausado, setPausado] = useState(false);

  useEffect(() => { if (indice > lista.length - 1) setIndice(0); }, [lista.length, indice]);

  useEffect(() => {
    if (lista.length < 2 || pausado) return;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => setIndice(i => (i + 1) % lista.length), INTERVALO_CINTILLO_MS);
    return () => clearInterval(t);
  }, [lista.length, pausado]);

  const actual = lista[Math.min(indice, Math.max(0, lista.length - 1))];
  const ref = useVistaUnaVez(actual?.id || '', !vista && !!actual);

  if (!actual || (!vista && cerradoHuella === huella)) return null;

  const est = estiloDe(actual);
  const cerrar = () => {
    setCerradoHuella(huella);
    try { sessionStorage.setItem(CLAVE_CINTILLO, huella); } catch { /* incógnito */ }
  };

  return (
    <div
      ref={ref as React.RefObject<HTMLDivElement>}
      role="region"
      aria-label="Aviso promocional"
      className="tv-cintillo"
      style={{ background: est.fondo, color: est.tinta, borderColor: est.borde }}
      onMouseEnter={() => setPausado(true)}
      onMouseLeave={() => setPausado(false)}
      onFocus={() => setPausado(true)}
      onBlur={() => setPausado(false)}
    >
      <Envoltura link={actual.link} className="tv-cintillo-cuerpo" contar={vista ? undefined : actual.id}>
        {actual.oferta && (
          <span className="tv-cintillo-ins" style={{ background: est.insigniaFondo, color: est.insigniaTinta }}>{actual.oferta}</span>
        )}
        <span className="tv-cintillo-txt tv-1l" aria-live="polite">{actual.title || actual.description}</span>
        {actual.link && (
          <span className="tv-cintillo-cta">
            <span className="tv-1l">{actual.cta || 'Ver más'}</span> <ArrowRight className="w-3.5 h-3.5 flex-none" aria-hidden="true" />
          </span>
        )}
      </Envoltura>
      {lista.length > 1 && (
        <span className="tv-cintillo-n" aria-hidden="true">{Math.min(indice, lista.length - 1) + 1}/{lista.length}</span>
      )}
      <button type="button" className="tv-cintillo-x" onClick={cerrar} aria-label="Cerrar aviso" disabled={vista}>
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------
// CAMPAÑA — tarjetas de campaña con botón (imagen opcional)
// ---------------------------------------------------------------------
// Hasta tres, en fila (una columna en el teléfono). Texto primero: se arma solo con título, descripción y el
// botón, con los colores de su variante; si tiene imagen, va como foto al costado (arriba en el teléfono).
export function TarjetasCampana({ banners, vista = false }: { banners: Banner[]; vista?: boolean }) {
  const lista = useMemo(() => porFormato(banners, 'campana', false).filter(b => b.title || b.description || b.imageUrl).slice(0, 3), [banners]);
  if (lista.length === 0) return null;
  return (
    <section aria-label="Campañas" className="tv-campanas">
      {lista.map(b => <React.Fragment key={b.id}><TarjetaCampana b={b} vista={vista} /></React.Fragment>)}
    </section>
  );
}

function TarjetaCampana({ b, vista }: { b: Banner; vista: boolean }) {
  const est = estiloDe(b);
  const ref = useVistaUnaVez(b.id, !vista);
  return (
    <article ref={ref as React.RefObject<HTMLElement>} className="tv-campana" style={{ background: est.fondo, color: est.tinta, borderColor: est.borde }}>
      <Envoltura link={b.link} className="tv-campana-cuerpo" contar={vista ? undefined : b.id}>
        {b.imageUrl && (
          <span className="tv-campana-foto">
            <img src={b.imageUrl} alt="" loading="lazy" decoding="async" />
          </span>
        )}
        <span className="tv-campana-txt">
          {b.oferta && (
            <span className="tv-campana-ins" style={{ background: est.insigniaFondo, color: est.insigniaTinta }}>{b.oferta}</span>
          )}
          {b.title && <span className="tv-campana-tit" style={{ color: est.tinta }}>{b.title}</span>}
          {b.description && <span className="tv-campana-desc" style={{ color: est.tinta }}>{b.description}</span>}
          {(b.link || b.cta) && (
            <BotonCta
              texto={b.cta || 'Ver más'}
              className="mt-auto self-start px-3.5 py-1.5 text-[12.5px]"
              style={{ background: est.botonFondo, color: est.botonTinta }}
            />
          )}
        </span>
      </Envoltura>
    </article>
  );
}

// ---------------------------------------------------------------------
// DIVISOR — franja ancha entre secciones del catálogo
// ---------------------------------------------------------------------
export function BannerDivisor({ banners, vista = false }: { banners: Banner[]; vista?: boolean }) {
  const lista = useMemo(() => porFormato(banners, 'divisor'), [banners]);
  const b = lista[0];
  const ref = useVistaUnaVez(b?.id || '', !vista && !!b);
  if (!b) return null;

  // Se muestra el primero vigente; los demás quedan como respaldo por si el
  // primero cae fuera de fecha. Un divisor es un separador, no un carrusel.
  return (
    <section ref={ref as React.RefObject<HTMLElement>} aria-label={b.title || 'Promoción'} className="w-full my-6">
      <Envoltura
        link={b.link}
        contar={vista ? undefined : b.id}
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
            {b.oferta && <Insignia texto={b.oferta} className="self-start px-2.5 py-0.5 text-[11px] mb-1" />}
            {b.title && (
              <h3 className="font-black text-base sm:text-xl md:text-2xl leading-tight" style={{ color: '#ffffff' }}>
                {b.title}
              </h3>
            )}
            {b.description && (
              <p className="text-white/90 text-xs sm:text-sm max-w-lg line-clamp-2">{b.description}</p>
            )}
            {(b.link || b.cta) && (
              <BotonCta
                texto={b.cta || 'Ver más'}
                className="self-start mt-1.5 px-3 py-1 text-[12px]"
                style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
              />
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
export function TarjetasBannerGrid({ banners, vista = false }: { banners: Banner[]; vista?: boolean }) {
  const lista = useMemo(() => porFormato(banners, 'grid'), [banners]);
  if (lista.length === 0) return null;

  return (
    <>
      {lista.map(b => <React.Fragment key={b.id}><TarjetaGrid b={b} vista={vista} /></React.Fragment>)}
    </>
  );
}

function TarjetaGrid({ b, vista }: { b: Banner; vista: boolean }) {
  const ref = useVistaUnaVez(b.id, !vista);
  // Se arma como una tarjeta de producto más (mismo fondo, borde y baldosa de foto), ocupando dos lugares:
  // foto a la izquierda y texto a la derecha (foto arriba en el teléfono). Antes la foto iba con `object-cover`
  // —el producto salía recortado— y el texto encima con un velo negro que sobre una foto clara se veía como
  // una sombra sucia; además no medía lo mismo que las tarjetas de al lado.
  return (
    <div ref={ref as React.RefObject<HTMLDivElement>} className="col-span-2 min-w-0">
      <Envoltura link={b.link} contar={vista ? undefined : b.id} className="tv-prod tv-grid-banner group">
        <div className="tv-prod-foto tv-grid-banner-foto">
          <img src={b.imageUrl} alt={b.title || 'Promoción'} loading="lazy" decoding="async" />
          {b.oferta && <Insignia texto={b.oferta} className="absolute top-2 left-2 px-2 py-0.5 text-[11px]" />}
        </div>
        {(b.title || b.description || b.cta) && (
          <div className="tv-grid-banner-txt">
            {b.title && <div className="tv-grid-banner-tit">{b.title}</div>}
            {b.description && <div className="tv-grid-banner-desc">{b.description}</div>}
            {b.cta && (
              <BotonCta texto={b.cta} className="mt-auto px-3 py-1.5 text-[12px]" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }} />
            )}
          </div>
        )}
      </Envoltura>
    </div>
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

/** La tarjeta del pop-up (se usa también en la vista previa del panel, sin el fondo oscuro). */
export function PopupTarjeta({ b, onCerrar, vista = false }: { b: Banner; onCerrar?: () => void; vista?: boolean }) {
  return (
    <div
      className="relative w-full max-w-md rounded-2xl overflow-hidden bg-[var(--bg-elevated)] shadow-2xl"
      onClick={e => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={onCerrar}
        aria-label="Cerrar"
        className="absolute top-2 right-2 z-10 w-8 h-8 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-black/60 transition"
      >
        <X className="w-4 h-4" />
      </button>

      <Envoltura link={b.link} className="block" contar={vista ? undefined : b.id}>
        <div className="relative w-full aspect-[4/3]">
          <img src={b.imageUrl} alt={b.title || 'Promoción'} className="absolute inset-0 w-full h-full object-cover" />
          {b.oferta && <Insignia texto={b.oferta} className="absolute top-3 left-3 px-3 py-1 text-[13px]" />}
        </div>
        {(b.title || b.description) && (
          <div className="p-4">
            {b.title && <h3 className="font-black text-lg text-[var(--text-primary)]">{b.title}</h3>}
            {b.description && <p className="text-[13px] text-[var(--text-secondary)] mt-1 leading-relaxed">{b.description}</p>}
            {(b.link || b.cta) && (
              <BotonCta
                texto={b.cta || 'Ver la oferta'}
                className="mt-3 px-4 py-2 text-[13px]"
                style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
              />
            )}
          </div>
        )}
      </Envoltura>
    </div>
  );
}

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
    const t = setTimeout(() => {
      setAbierto(true);
      if (marcarVistaEnSesion(b.id)) registrarEventoBanner(b.id, 'vista');
    }, 1200);
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
      <PopupTarjeta b={b} onCerrar={cerrar} />
    </div>
  );
}
