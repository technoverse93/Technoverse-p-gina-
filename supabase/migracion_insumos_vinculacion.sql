-- ===========================================================================
-- INVENTARIO FLEXIBLE — insumos, vinculación N-a-N y garantía fija
-- ===========================================================================
-- YA EJECUTADO en la base. Queda como constancia y para poder reproducirlo.
--
-- Tres cambios, todos ADITIVOS. No se borra ni se renombra nada: lo que hoy
-- funciona sigue funcionando exactamente igual después de correr esto.
--
--   1. Vinculación N-a-N entre un producto/servicio y sus componentes
--      (repuestos e insumos), sin límite de cantidad.
--   2. Garantía en la factura, restringida a 1, 3, 6 o 12 meses.
--   3. Vista de apoyo para que facturación despliegue de un tirón todo lo
--      vinculado a un servicio.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ LOS INSUMOS **NO** LLEVAN TABLA PROPIA
-- ---------------------------------------------------------------------------
-- Un insumo es un artículo con nombre, SKU, costo, precio y existencias:
-- exactamente lo mismo que un repuesto y que un producto. Ya existe una tabla
-- que guarda eso —`products`— y los repuestos viven ahí desde el principio,
-- distinguidos por su categoría.
--
-- Crear `insumos` aparte obligaría a duplicar el ajuste atómico de stock, los
-- movimientos de inventario, las políticas RLS y la pantalla de gestión; y el
-- día que un artículo tuviera que ser las dos cosas —un cable que se vende Y
-- se usa en taller— habría que decidir en cuál de las dos tablas vive.
--
-- Los insumos se distinguen por categoría, igual que los repuestos. La lista
-- está en src/utils/categorias.ts (CATEGORIAS_INSUMO) y se refleja aquí abajo
-- para que la base pueda razonar sobre ella.
--
-- ---------------------------------------------------------------------------
-- CÓMO EJECUTARLO
-- ---------------------------------------------------------------------------
--   Panel de Supabase → SQL Editor → pegar TODO → Run.
--   Es idempotente: se puede correr dos veces sin efectos secundarios.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. QUÉ CUENTA COMO REPUESTO Y QUÉ COMO INSUMO
-- ---------------------------------------------------------------------------
-- Se declaran como funciones y no como texto repetido en cada consulta: si
-- mañana se agrega una categoría, se cambia aquí y toda la base la ve.
create or replace function public.es_repuesto(categoria text)
returns boolean
language sql
immutable
as $$
  select coalesce(trim(categoria), '') = any (array[
    'LCD','Batería','Rack de Carga','Tapa','Desbloqueo','Flex','Conector','Otra','Repuestos'
  ]);
$$;

create or replace function public.es_insumo(categoria text)
returns boolean
language sql
immutable
as $$
  select coalesce(trim(categoria), '') = any (array[
    'Temperado','Mica','Estuche de taller','Cable de taller',
    'Adaptador','Limpieza','Empaque','Otro insumo'
  ]);
$$;

-- ---------------------------------------------------------------------------
-- 2. VINCULACIÓN N-a-N
-- ---------------------------------------------------------------------------
-- Un producto o servicio puede tener CUALQUIER combinación de repuestos e
-- insumos, y un mismo componente puede pertenecer a muchos productos.
--
-- Sustituye funcionalmente a `products.linked_spare_part_sku`, que solo
-- admitía UN repuesto por producto y lo referenciaba por SKU —un texto que
-- se puede editar y dejar el enlace roto sin que nadie se entere. Esa
-- columna NO se borra: hay datos en ella y el código que la lee sigue
-- funcionando. El paso 5 la migra a esta tabla.
create table if not exists public.product_components (
  id            bigserial primary key,

  -- El producto o servicio que se factura.
  product_id    text not null
                references public.products(id) on delete cascade,

  -- La pieza o el insumo que consume. ON DELETE RESTRICT a propósito:
  -- borrar un repuesto que está vinculado a un servicio dejaría ese
  -- servicio sin poder calcular su costo, en silencio. Obliga a
  -- desvincular primero, que es una decisión consciente.
  component_id  text not null
                references public.products(id) on delete restrict,

  -- Cuántas unidades del componente lleva UNA unidad del producto.
  quantity      numeric not null default 1 check (quantity > 0),

  -- 'repuesto' | 'insumo'. Se guarda además de poder deducirse de la
  -- categoría porque la categoría del componente puede cambiar con el
  -- tiempo, y el vínculo debe seguir contando lo que era al crearlo.
  tipo          text not null check (tipo in ('repuesto','insumo')),

  created_at    timestamptz not null default now(),

  -- Un componente no puede estar dos veces en el mismo producto: para eso
  -- está `quantity`. Sin esto, agregar dos veces la misma pieza duplicaría
  -- el costo del servicio sin que se notara.
  constraint product_components_unicos unique (product_id, component_id),

  -- Un producto no puede componerse de sí mismo.
  constraint product_components_sin_ciclo check (product_id <> component_id)
);

create index if not exists idx_product_components_product
  on public.product_components (product_id);
create index if not exists idx_product_components_component
  on public.product_components (component_id);

-- ---------------------------------------------------------------------------
-- 3. SEGURIDAD (RLS)
-- ---------------------------------------------------------------------------
-- Misma política que el resto del inventario: leer es público —la tienda
-- necesita resolver qué compone cada producto— y escribir exige sesión.
alter table public.product_components enable row level security;

drop policy if exists "componentes lectura publica" on public.product_components;
create policy "componentes lectura publica"
  on public.product_components for select
  using (true);

drop policy if exists "componentes escritura autenticada" on public.product_components;
create policy "componentes escritura autenticada"
  on public.product_components for all
  to authenticated
  using (true)
  with check (true);

-- ---------------------------------------------------------------------------
-- 4. VISTA PARA FACTURACIÓN
-- ---------------------------------------------------------------------------
-- Devuelve, para cada producto, sus componentes ya resueltos con nombre,
-- costo y existencias. Es lo que la pantalla de cobro necesita para
-- desplegar de un tirón todo lo vinculado a un servicio, sin encadenar
-- consultas desde el navegador.
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
  (pc.quantity * coalesce(c.cost, 0)) as costo_total
from public.product_components pc
join public.products p on p.id = pc.product_id
join public.products c on c.id = pc.component_id;

-- ---------------------------------------------------------------------------
-- 5. MIGRACIÓN DEL VÍNCULO ANTIGUO
-- ---------------------------------------------------------------------------
-- Traslada los `linked_spare_part_sku` existentes a la tabla nueva, para que
-- ningún vínculo ya creado se pierda al cambiar de modelo. Solo se copian los
-- que apuntan a un SKU que existe de verdad; los rotos se ignoran en vez de
-- hacer fallar la migración entera.
insert into public.product_components (product_id, component_id, quantity, tipo)
select p.id, c.id, 1,
       case when public.es_insumo(c.category) then 'insumo' else 'repuesto' end
  from public.products p
  join public.products c on c.sku = p.linked_spare_part_sku
 where p.linked_spare_part_sku is not null
   and trim(p.linked_spare_part_sku) <> ''
   and c.id <> p.id
on conflict (product_id, component_id) do nothing;

-- ---------------------------------------------------------------------------
-- 6. GARANTÍA EN LA FACTURA
-- ---------------------------------------------------------------------------
-- Cuatro valores y ninguno más. La restricción vive en la base y no solo en
-- la pantalla: así ninguna vía —una corrección a mano, una integración
-- futura— puede colar un plazo que el negocio no ofrece.
alter table public.invoices
  add column if not exists garantia_meses smallint;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'invoices_garantia_valida'
  ) then
    alter table public.invoices
      add constraint invoices_garantia_valida
      check (garantia_meses is null or garantia_meses in (1, 3, 6, 12));
  end if;
end $$;

comment on column public.invoices.garantia_meses is
  'Meses de garantía del comprobante. Solo 1, 3, 6 o 12. NULL en las facturas anteriores a este cambio.';

commit;

-- ===========================================================================
-- VERIFICACIÓN
-- ===========================================================================
-- La tabla y la vista existen:
select table_name, table_type
  from information_schema.tables
 where table_schema = 'public'
   and table_name in ('product_components', 'v_product_components')
 order by table_name;

-- Vínculos migrados desde el modelo antiguo:
select tipo, count(*) as vinculos
  from public.product_components
 group by tipo
 order by tipo;

-- La restricción de garantía quedó puesta:
select conname as restriccion, pg_get_constraintdef(oid) as definicion
  from pg_constraint
 where conname = 'invoices_garantia_valida';

-- Reparto actual del inventario entre las tres familias:
select case
         when public.es_repuesto(category) then 'repuesto'
         when public.es_insumo(category)   then 'insumo'
         else 'catálogo'
       end as familia,
       count(*) as articulos
  from public.products
 group by 1
 order by 1;
