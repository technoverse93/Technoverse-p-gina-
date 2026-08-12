-- ===========================================================================
-- RESET A PRODUCCIÓN — Technoverse Costa Rica
-- ===========================================================================
-- Deja la base lista para operar en real: borra TODO el historial de pruebas
-- —ventas, facturas, clientes, tickets de taller, movimientos— y además vacía
-- el catálogo de productos, para volver a cargarlo con el inventario real.
--
-- Es la versión "a fondo" de reset_datos_prueba.sql, que conservaba el
-- catálogo. Ese archivo se mantiene para limpiezas parciales; este es el que
-- se corre UNA vez, antes de abrir al público.
--
-- ---------------------------------------------------------------------------
-- QUÉ **NO** TOCA, A PROPÓSITO
-- ---------------------------------------------------------------------------
--   · Estructura: tablas, columnas, llaves foráneas, índices, políticas RLS,
--     funciones y triggers quedan EXACTAMENTE igual. Aquí solo hay DELETE de
--     filas: ni un DROP, ni un ALTER.
--   · Cuentas del personal: profiles y auth.users. Nadie pierde su acceso ni
--     su huella registrada.
--   · Configuración: app_settings (identificación del emisor, teléfono,
--     dirección, logo, webhook) y banners.
--   · Categorías estructurales: viven en el código (src/utils/categorias.ts),
--     no en la base, así que no hay nada que preservar aquí.
--   · `user_credentials`: son las LLAVES BIOMÉTRICAS ya registradas. Borrarlas
--     dejaría a cada persona sin su huella y obligaría a volver a activarla
--     aparato por aparato. Se conservan.
--   · `banned_ips`, `banned_devices`, `ip_whitelist`, `blocked_users_list`:
--     bloqueos de seguridad. NO se tocan a propósito: desde fuera no hay forma
--     de distinguir un bloqueo puesto durante las pruebas de uno puesto contra
--     alguien real, y levantar por error un bloqueo legítimo es peor que
--     dejar uno de prueba. Si quiere vaciarlos, hágalo a mano revisándolos
--     uno por uno desde el Centro de Ciberseguridad.
--   · `legal_privacy_settings` y `banners`: configuración.
--
-- ---------------------------------------------------------------------------
-- CÓMO EJECUTARLO
-- ---------------------------------------------------------------------------
--   Panel de Supabase → SQL Editor → pegar TODO → Run.
--   Va dentro de una transacción: si algo falla, no se borra nada a medias.
--
-- ⚠️ ESTO NO SE PUEDE DESHACER. Antes de correrlo, haga un respaldo en
--    Supabase → Database → Backups. Cuesta un minuto y es la única red.
-- ===========================================================================

begin;

-- --------------------------------------------------------------------------
-- 1. Ventas y facturación
-- --------------------------------------------------------------------------
-- invoices referencia orders con NO ACTION, así que las facturas van primero:
-- al revés, Postgres rechaza el borrado por la llave foránea.
delete from invoices;
delete from orders;

-- Reinicia la numeración de comprobantes. `issue_invoice()` toma el siguiente
-- número desde aquí, así que dejarlo en 0 hace que la primera factura REAL
-- salga con consecutivo 0001.
--
-- Se hace UPDATE y no DELETE a propósito: estas filas definen los tipos de
-- documento ('01' factura, '04' tiquete) y la función los espera existiendo.
-- Borrarlas rompería la emisión con un error que no dice nada útil.
update invoice_counters set last_number = 0;

-- --------------------------------------------------------------------------
-- 2. Clientes y entregas
-- --------------------------------------------------------------------------
delete from logistics_deliveries;
delete from client_profiles;

-- --------------------------------------------------------------------------
-- 3. Taller
-- --------------------------------------------------------------------------
delete from repair_orders;

-- --------------------------------------------------------------------------
-- 4. Chat
-- --------------------------------------------------------------------------
-- chat_messages tiene ON DELETE CASCADE hacia chat_conversations, así que
-- borrar las conversaciones arrastra sus mensajes. El DELETE explícito queda
-- por claridad y por si hubiera quedado alguno huérfano.
delete from chat_messages;
delete from chat_conversations;

-- --------------------------------------------------------------------------
-- 5. Marketing y bitácora
-- --------------------------------------------------------------------------
delete from marketing_requests;
delete from marketing_campaigns;   -- cupones de prueba
delete from audit_logs;

-- --------------------------------------------------------------------------
-- 6. Telemetría y rastros de las pruebas
-- --------------------------------------------------------------------------
-- Estas tablas no estaban en el reset anterior y por eso el "arranque
-- limpio" no lo era: el Centro de Ciberseguridad seguía mostrando los
-- accesos y los aparatos de las pruebas como si fueran visitas reales, y
-- las primeras métricas del negocio salían contaminadas.
delete from login_audit_logs;      -- intentos de acceso durante las pruebas
delete from visitor_fingerprints;  -- visitas registradas mientras se probaba
delete from known_devices;         -- aparatos vistos durante las pruebas

-- Retos de WebAuthn a medio usar. Son de un solo uso y caducan en
-- minutos: los que queden aquí son basura de intentos de prueba.
-- CUIDADO: esto NO es lo mismo que `user_credentials`, que sí guarda las
-- llaves biométricas registradas. Esa tabla no se toca (ver abajo).
delete from webauthn_challenges;

-- --------------------------------------------------------------------------
-- 7. Catálogo
-- --------------------------------------------------------------------------
-- Va AL FINAL porque inventory_movements y marketing_requests apuntan a
-- products: si se borrara antes, la llave foránea lo impediría.
delete from inventory_movements;
delete from products;
delete from historical_skus;       -- autorrelleno por SKU de productos de prueba

commit;

-- ===========================================================================
-- VERIFICACIÓN — corra esto después. Todo debe dar 0.
-- ===========================================================================
select 'orders'               as tabla, count(*) as filas from orders
union all select 'invoices',             count(*) from invoices
union all select 'client_profiles',      count(*) from client_profiles
union all select 'logistics_deliveries', count(*) from logistics_deliveries
union all select 'inventory_movements',  count(*) from inventory_movements
union all select 'repair_orders',        count(*) from repair_orders
union all select 'chat_conversations',   count(*) from chat_conversations
union all select 'chat_messages',        count(*) from chat_messages
union all select 'marketing_requests',   count(*) from marketing_requests
union all select 'marketing_campaigns',  count(*) from marketing_campaigns
union all select 'audit_logs',           count(*) from audit_logs
union all select 'products',             count(*) from products
union all select 'historical_skus',      count(*) from historical_skus
union all select 'login_audit_logs',     count(*) from login_audit_logs
union all select 'visitor_fingerprints', count(*) from visitor_fingerprints
union all select 'known_devices',        count(*) from known_devices
union all select 'webauthn_challenges',  count(*) from webauthn_challenges
order by 1;

-- Debe mostrar last_number = 0 en cada tipo de documento:
select tipo_doc, last_number from invoice_counters order by tipo_doc;

-- Estos NO deben dar 0 — confirman que lo que debía sobrevivir sobrevivió:
select 'app_settings' as tabla, count(*) as filas from app_settings
union all select 'profiles',              count(*) from profiles
union all select 'user_credentials',      count(*) from user_credentials
union all select 'legal_privacy_settings', count(*) from legal_privacy_settings;
