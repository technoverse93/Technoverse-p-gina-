-- ===========================================================================
-- RESET DE DATOS DE PRUEBA — Technoverse Costa Rica
-- ===========================================================================
-- QUÉ HACE
--   Deja la base como recién estrenada para operar en real: borra ventas,
--   facturas, clientes, movimientos de inventario, entregas, chats y bitácora,
--   y reinicia la numeración de comprobantes para que la primera factura real
--   sea la 0001.
--
-- QUÉ **NO** TOCA (a propósito)
--   · Estructura: tablas, columnas, llaves foráneas, índices, políticas RLS,
--     funciones y triggers quedan EXACTAMENTE igual. Esto es solo DELETE de
--     filas, nunca DROP ni ALTER.
--   · Datos maestros: app_settings (cédula jurídica, teléfono, logo, webhook),
--     banners, profiles (usuarios del personal) y auth.users.
--   · Catálogo: products e historical_skus. Ver el bloque OPCIONAL al final si
--     también querés vaciarlos.
--
-- CÓMO EJECUTARLO
--   Panel de Supabase → SQL Editor → pegar TODO → Run.
--   Va dentro de una transacción: si algo falla, no se borra nada a medias.
--
-- ⚠️ ANTES DE CORRERLO: esto NO se puede deshacer. Hacé un respaldo desde
--    Supabase → Database → Backups si querés conservar el histórico de prueba.
-- ===========================================================================

begin;

-- --------------------------------------------------------------------------
-- 1. Ventas y facturación
-- --------------------------------------------------------------------------
-- invoices referencia orders con NO ACTION, así que las facturas van primero.
delete from invoices;
delete from orders;

-- Reinicia la numeración de comprobantes. `issue_invoice()` toma el siguiente
-- número desde aquí, así que dejarlo en 0 hace que la próxima factura real
-- salga con consecutivo 0001. Se hace UPDATE y no DELETE para no perder las
-- filas de tipo de documento ('01' factura, '04' tiquete) que la función espera.
update invoice_counters set last_number = 0;

-- --------------------------------------------------------------------------
-- 2. Clientes y entregas
-- --------------------------------------------------------------------------
delete from logistics_deliveries;
delete from client_profiles;

-- --------------------------------------------------------------------------
-- 3. Movimientos de inventario
-- --------------------------------------------------------------------------
-- Solo el HISTORIAL de movimientos. El stock actual vive en products.stock y
-- no se toca aquí; si querés dejar todo el catálogo en cero, usá el bloque
-- opcional del final.
delete from inventory_movements;

-- --------------------------------------------------------------------------
-- 4. Taller
-- --------------------------------------------------------------------------
delete from repair_orders;

-- --------------------------------------------------------------------------
-- 5. Chat
-- --------------------------------------------------------------------------
-- chat_messages tiene ON DELETE CASCADE hacia chat_conversations, así que
-- borrar las conversaciones arrastra sus mensajes. El DELETE explícito de
-- mensajes queda igual por claridad y por si quedara alguno huérfano.
delete from chat_messages;
delete from chat_conversations;

-- --------------------------------------------------------------------------
-- 6. Marketing y bitácora
-- --------------------------------------------------------------------------
delete from marketing_requests;
delete from audit_logs;

commit;

-- ===========================================================================
-- VERIFICACIÓN — ejecutá esto después; todas las filas deben dar 0
-- ===========================================================================
select 'orders' tabla, count(*) filas from orders
union all select 'invoices',             count(*) from invoices
union all select 'client_profiles',      count(*) from client_profiles
union all select 'logistics_deliveries', count(*) from logistics_deliveries
union all select 'inventory_movements',  count(*) from inventory_movements
union all select 'repair_orders',        count(*) from repair_orders
union all select 'chat_conversations',   count(*) from chat_conversations
union all select 'chat_messages',        count(*) from chat_messages
union all select 'marketing_requests',   count(*) from marketing_requests
union all select 'audit_logs',           count(*) from audit_logs
order by 1;

-- Debe mostrar last_number = 0 en cada tipo de documento:
select tipo_doc, last_number from invoice_counters order by tipo_doc;

-- Estos NO deben dar 0 — confirman que la configuración sobrevivió:
select 'app_settings' tabla, count(*) filas from app_settings
union all select 'profiles', count(*) from profiles
union all select 'products', count(*) from products;


-- ===========================================================================
-- OPCIONAL — vaciar también el catálogo de productos
-- ===========================================================================
-- Solo si querés arrancar el inventario desde cero. Descomentá el bloque.
-- Ojo: hay que correrlo DESPUÉS del reset de arriba, porque
-- inventory_movements y marketing_requests apuntan a products.
--
-- begin;
--   delete from products;
--   delete from historical_skus;   -- catálogo de autorrelleno por SKU
-- commit;


-- ===========================================================================
-- OPCIONAL — vaciar cupones de prueba
-- ===========================================================================
-- delete from marketing_campaigns;
