-- =====================================================================
-- Control de ganancias: persistir el costo real de repuestos/insumos y
-- el margen neto de cada cobro en columnas propias de `orders`, en vez
-- de que solo exista como texto libre dentro de audit_logs.detail. Sin
-- esto ningún reporte podía sumar "cuánto costaron los repuestos
-- facturados" — que era la queja concreta.
-- =====================================================================
alter table public.orders
  add column if not exists costo_repuestos numeric not null default 0,
  add column if not exists costo_regalias numeric not null default 0,
  add column if not exists margen_neto numeric;

comment on column public.orders.costo_repuestos is 'Costo real (no precio) de repuestos + insumos no regalados consumidos en este cobro.';
comment on column public.orders.costo_regalias is 'Costo real de los insumos entregados como regalía en este cobro.';
comment on column public.orders.margen_neto is 'ingreso - costo_repuestos - costo_regalias, calculado y guardado al momento del cobro.';

-- =====================================================================
-- v_product_components: agrega el precio de venta del componente, que
-- faltaba. Sin él, los insumos traídos por "Traer vinculados" en Cobros
-- no tenían forma de desglosarse en la factura a su precio normal (solo
-- se conocía su costo, nunca su precio de venta). La columna nueva va AL
-- FINAL: CREATE OR REPLACE VIEW exige que las columnas existentes
-- conserven su nombre y posición.
-- =====================================================================
create or replace view public.v_product_components as
select
  pc.product_id,
  p.name                       as product_name,
  pc.component_id,
  c.name                       as component_name,
  c.sku                        as component_sku,
  c.category                   as component_category,
  pc.tipo,
  pc.quantity,
  c.cost                       as component_cost,
  c.stock                      as component_stock,
  (pc.quantity * coalesce(c.cost, 0)) as costo_total,
  c.price                      as component_price
from public.product_components pc
join public.products p on p.id = pc.product_id
join public.products c on c.id = pc.component_id;

-- Verificación:
select column_name, data_type from information_schema.columns
 where table_schema = 'public' and table_name = 'orders'
   and column_name in ('costo_repuestos', 'costo_regalias', 'margen_neto');

select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'v_product_components'
 order by ordinal_position;
