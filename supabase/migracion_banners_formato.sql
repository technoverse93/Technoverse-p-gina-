-- =====================================================================
-- BANNERS: formato de colocación + etiqueta de oferta
-- =====================================================================
-- La tabla `banners` ya existía (id, title, description, image_url, link,
-- type, active, fechas). Se le agregan DOS columnas para el sistema de 3
-- formatos + pop-up:
--
--   · formato — DÓNDE se pinta el banner en la tienda:
--       'hero' (carrusel principal), 'divisor' (franja entre secciones),
--       'grid' (tarjeta en la cuadrícula), 'popup' (emergente 1x sesión).
--     Los banners viejos, sin este campo, quedan como 'hero' por defecto.
--   · oferta — etiqueta corta de promoción ("2x1", "-30%", ...). Opcional.
--
-- Cambio aditivo: no toca ninguna fila existente ni ninguna otra columna.
-- =====================================================================

alter table public.banners
  add column if not exists formato text not null default 'hero',
  add column if not exists oferta  text;

-- Solo los cuatro formatos que la app entiende.
do $$ begin
  alter table public.banners
    add constraint banners_formato_check
    check (formato in ('hero', 'divisor', 'grid', 'popup'));
exception when duplicate_object then null; end $$;
