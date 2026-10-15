// =====================================================================
// VISTA PREVIA DE UN BANNER — tal como se ve en la tienda, en cada paleta y en claro y oscuro
// =====================================================================
// Dibuja el banner con los MISMOS componentes de la tienda (store/BannersTienda.tsx, BannerPrincipal.tsx),
// así que lo que se ve acá es lo que va a ver el cliente. Se puede cambiar la paleta (Esmeralda, Océano,
// Atardecer, Orquídea) y el modo (claro / oscuro) solo para esta vista previa: el lienzo lleva
// `data-paleta-muestra` y `data-modo`, que son los mismos tokens de styles/paletas.css que usan las
// miniaturas del selector de paleta. Nada de lo que se haga acá toca el tema real de la pantalla.
//
// No cuenta vistas ni clics (`vista`) y no recuerda nada en el navegador.
// =====================================================================

import { useMemo, useState } from 'react';
import type { Banner } from '../../types';
import { formatoRequiereImagen } from '../../utils/bannerEstado';
import { PALETAS, paletaActual, type Paleta } from '../../utils/paleta';
import BannerPrincipal from '../store/BannerPrincipal';
import { BannerDivisor, Cintillo, PopupTarjeta, TarjetasBannerGrid, TarjetasCampana } from '../store/BannersTienda';

type ModoVista = 'actual' | 'claro' | 'oscuro';

function modoDeLaPantalla(): 'claro' | 'oscuro' {
  try { return document.documentElement.classList.contains('dark') ? 'oscuro' : 'claro'; } catch { return 'claro'; }
}

export default function VistaPreviaBanner({ banner }: { banner: Banner }) {
  const [paleta, setPaleta] = useState<'actual' | Paleta>('actual');
  const [modo, setModo] = useState<ModoVista>('actual');

  // Para la vista previa el banner siempre está «activo» y sin fechas: lo que se mira es el diseño.
  const borrador = useMemo<Banner>(() => ({ ...banner, active: true, startDate: undefined, endDate: undefined }), [banner]);
  const formato = borrador.formato || 'hero';
  const falta = formatoRequiereImagen(formato) && !borrador.imageUrl;

  // Si se elige solo la paleta o solo el modo, lo otro es lo de la pantalla real.
  const aislar = paleta !== 'actual' || modo !== 'actual';
  const atributos = aislar
    ? { 'data-paleta-muestra': paleta === 'actual' ? paletaActual() : paleta, 'data-modo': modo === 'actual' ? modoDeLaPantalla() : modo }
    : {};

  return (
    <div className="vp">
      <div className="vp-barra">
        <div className="vp-seg" role="group" aria-label="Paleta de la vista previa">
          <button type="button" aria-pressed={paleta === 'actual'} onClick={() => setPaleta('actual')}>Actual</button>
          {PALETAS.map(p => (
            <button key={p.id} type="button" aria-pressed={paleta === p.id} onClick={() => setPaleta(p.id)}>{p.nombre}</button>
          ))}
        </div>
        <div className="vp-seg" role="group" aria-label="Modo de la vista previa">
          <button type="button" aria-pressed={modo === 'actual'} onClick={() => setModo('actual')}>Auto</button>
          <button type="button" aria-pressed={modo === 'claro'} onClick={() => setModo('claro')}>Claro</button>
          <button type="button" aria-pressed={modo === 'oscuro'} onClick={() => setModo('oscuro')}>Oscuro</button>
        </div>
      </div>

      <div className="vp-lienzo" {...atributos}>
        {falta ? (
          <p className="vp-falta">Subí una imagen para ver cómo queda.</p>
        ) : formato === 'cintillo' ? (
          <Cintillo banners={[borrador]} vista />
        ) : formato === 'campana' ? (
          <TarjetasCampana banners={[borrador]} vista />
        ) : formato === 'divisor' ? (
          <BannerDivisor banners={[borrador]} vista />
        ) : formato === 'grid' ? (
          <div className="grid grid-cols-2 gap-3"><TarjetasBannerGrid banners={[borrador]} vista /></div>
        ) : formato === 'popup' ? (
          <div className="flex justify-center"><PopupTarjeta b={borrador} vista /></div>
        ) : (
          <BannerPrincipal banners={[borrador]} vista />
        )}
      </div>
    </div>
  );
}
