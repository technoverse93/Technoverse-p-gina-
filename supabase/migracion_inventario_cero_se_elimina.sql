-- ===========================================================================
-- MIGRACIÓN — Inventario: "si hay 0 de algo, siempre se elimina"
-- ===========================================================================
-- Ya ejecutada en producción (proyecto hzatdfrjcqiimgqxcwwh) el 2026-08-12.
-- Este archivo documenta el cambio en el repo, como el resto de migraciones
-- de esta carpeta.
--
-- ---------------------------------------------------------------------------
-- QUÉ SE PIDIÓ
-- ---------------------------------------------------------------------------
-- Regla del negocio: en cuanto el stock de un artículo llega a 0 —por la
-- razón que sea: se vendió el último en la tienda, se cobró en Taller, o un
-- conteo físico confirmó que ya no queda nada— ese artículo se "elimina".
--
-- ---------------------------------------------------------------------------
-- POR QUÉ ES UN TRIGGER Y NO UN CAMBIO SOLO EN EL PANEL
-- ---------------------------------------------------------------------------
-- El stock de un producto baja por VARIOS caminos distintos: `adjust_stock()`
-- (ventas de la tienda y cobros de Taller), el conteo físico de Inventario
-- (que escribe directo con `saveDB`/`syncTableToSupabase`, sin pasar por
-- `adjust_stock`), y en teoría cualquier función futura que toque
-- `products.stock`. Poner la regla en el código de una sola pantalla
-- —como hacía antes el conteo físico, con `p.active = false` escrito a
-- mano ahí mismo— la deja rota para todos los demás caminos. Un trigger en
-- la tabla la hace cumplir sin importar de dónde vino el cambio, ahora y
-- para cualquier código nuevo que se agregue después.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ "ELIMINAR" ES `active = false` Y NO UN DELETE DE VERDAD
-- ---------------------------------------------------------------------------
-- `product_components.component_id` tiene ON DELETE RESTRICT (ver
-- migracion_auditoria_seguridad.sql): si el producto que llega a 0 está
-- vinculado como repuesto de algún servicio, un DELETE real fallaría por
-- esa restricción — y como el trigger corre DENTRO de la misma transacción
-- que `adjust_stock()`, ese fallo habría reventado la venta que dejó el
-- producto en 0 justo en el momento de cobrarla.
--
-- `active = false` logra el mismo resultado práctico sin ese riesgo: en
-- TODA la aplicación (Cobros, Taller, tienda pública, los selectores de
-- Inventario) el filtro ya es "active !== false", así que un producto en
-- este estado deja de venderse y de aparecer para elegir en cualquier
-- parte, sin arriesgar ninguna transacción en curso.
--
-- Se archiva además su ficha (nombre, categoría, precio, costo, imagen) en
-- `historical_skus`, la misma tabla que ya usa "Recuperar histórico" al dar
-- de alta un producto — es la manera ya existente de traer de vuelta algo
-- que se había retirado, sin tener que volver a escribir sus datos a mano.
--
-- Si luego se reabastece —se le sube el stock por encima de 0 desde el
-- formulario de edición—, InventarioControl.tsx YA reactivaba el producto
-- automáticamente en ese caso (línea con
-- `if (newStock > 0 && ... .active === false) ... .active = true`), así que
-- no hizo falta tocar nada ahí: el trigger y esa reactivación ya encajan.
-- ===========================================================================

create or replace function public.archivar_producto_agotado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.stock <= 0 and new.active is distinct from false then
    insert into public.historical_skus (sku, name, category, price, cost, image_url, deleted_at)
    values (new.sku, new.name, new.category, new.price, new.cost, new.image_url, now())
    on conflict (sku) do update set
      name = excluded.name,
      category = excluded.category,
      price = excluded.price,
      cost = excluded.cost,
      image_url = excluded.image_url,
      deleted_at = excluded.deleted_at;

    new.active := false;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_archivar_producto_agotado on public.products;
create trigger trg_archivar_producto_agotado
  before insert or update on public.products
  for each row
  execute function public.archivar_producto_agotado();

-- ===========================================================================
-- VERIFICACIÓN — se corrió así antes de dar la migración por buena.
-- ===========================================================================
-- insert into public.products (id, name, sku, category, price, cost, stock, active)
-- values ('TEST-TRIGGER-1', 'Producto de prueba trigger', 'TEST-TRG-0001', 'LCD', 20000, 12000, 5, true);
-- update public.products set stock = 0 where id = 'TEST-TRIGGER-1';
-- select id, name, stock, active from public.products where id = 'TEST-TRIGGER-1';
--   -> stock = 0, active = false
-- select sku, name, price, cost, deleted_at from public.historical_skus where sku = 'TEST-TRG-0001';
--   -> fila archivada con los datos del producto y deleted_at con la hora exacta
-- (después se borraron ambas filas de prueba)
