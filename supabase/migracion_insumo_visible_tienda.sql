-- ===========================================================================
-- Visibilidad de los insumos en la tienda pública
-- ===========================================================================
-- YA EJECUTADO en la base. Queda como constancia y para poder reproducirlo.
--
-- ---------------------------------------------------------------------------
-- QUÉ RESUELVE
-- ---------------------------------------------------------------------------
-- Los insumos nacieron ocultos del catálogo, junto con los repuestos, y eso
-- era demasiado rígido: un temperado o un estuche SÍ se venden, aunque el
-- resto del material de taller no.
--
-- Con esta columna la decisión pasa a ser de uno en uno.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ EL VALOR POR DEFECTO ES `false`
-- ---------------------------------------------------------------------------
-- Porque los dos errores posibles no cuestan lo mismo. Un insumo que debía
-- venderse y quedó oculto se nota enseguida —alguien lo busca y no está— y se
-- arregla con un clic. Un insumo que NO debía publicarse y sale al catálogo se
-- descubre tarde, normalmente cuando ya se vendió al precio de costo.
--
-- Ante esa asimetría, el valor seguro es no publicar.
--
-- ---------------------------------------------------------------------------
-- ALCANCE
-- ---------------------------------------------------------------------------
-- La columna solo la consultan los INSUMOS:
--   · Los repuestos nunca se muestran, marque lo que marque.
--   · Los productos de catálogo tampoco la miran: su visibilidad la sigue
--     decidiendo `active`, como siempre.
-- ===========================================================================

alter table public.products
  add column if not exists visible_en_tienda boolean not null default false;

comment on column public.products.visible_en_tienda is
  'Solo aplica a los INSUMOS: los deja aparecer en el catálogo público. Por defecto false. Los repuestos nunca se muestran; los productos de catálogo usan `active`.';

-- ===========================================================================
-- VERIFICACIÓN
-- ===========================================================================
select column_name, data_type, column_default, is_nullable
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'products'
   and column_name = 'visible_en_tienda';

-- Insumos publicados en la tienda (al principio, ninguno):
select name, category, price, stock
  from public.products
 where visible_en_tienda = true
 order by name;
