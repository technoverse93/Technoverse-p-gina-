-- ===========================================================================
-- MIGRACIÓN — Bucket de Storage para las actualizaciones OTA de la APK
-- ===========================================================================
-- Ya ejecutada en producción (proyecto hzatdfrjcqiimgqxcwwh) el 2026-08-12.
-- Este archivo documenta el cambio en el repo, como el resto de migraciones
-- de esta carpeta.
--
-- ---------------------------------------------------------------------------
-- QUÉ ES
-- ---------------------------------------------------------------------------
-- El bucket "ota-updates" guarda el bundle web (dist/ empaquetado en .zip)
-- de cada versión publicada, más un manifiesto latest.json con
-- {version, url} apuntando a la versión más reciente. Lo publica el
-- workflow .github/workflows/ota-publish.yml en cada push a main; lo lee
-- la app en cada arranque (src/mobile/otaUpdater.ts).
--
-- ---------------------------------------------------------------------------
-- POR QUÉ ES PÚBLICO DE LECTURA PERO NADIE PUEDE ESCRIBIRLE
-- ---------------------------------------------------------------------------
-- La app necesita leer el manifiesto y el .zip SIN sesión (es lo primero
-- que pasa al abrir, antes de cualquier login) — de ahí `public = true`,
-- igual que "invoices", "productos" y "marketing".
--
-- Pero quien pueda ESCRIBIR en este bucket puede hacer que la app de
-- cualquier administrador descargue y ejecute el código que quiera en su
-- próximo arranque: es, ni más ni menos, un canal de actualización de
-- código remoto. Por eso, a propósito, NO se creó ninguna política de
-- INSERT/UPDATE/DELETE para "anon" ni "authenticated": sin una política
-- que lo permita explícitamente, RLS deniega la escritura por defecto.
-- Solo la service_role key —que nunca sale del secreto de GitHub Actions
-- SUPABASE_SERVICE_ROLE_KEY, y nunca del navegador/APK— puede publicar
-- ahí, porque esa llave evade RLS por completo (mismo mecanismo que ya
-- usan adjust_stock()/issue_invoice(), ver migracion_auditoria_seguridad.sql).
-- ===========================================================================

insert into storage.buckets (id, name, public)
values ('ota-updates', 'ota-updates', true)
on conflict (id) do nothing;

-- Deliberadamente no hay policies de INSERT/UPDATE/DELETE aquí: ver
-- explicación arriba. La ausencia de política ES la protección.

-- ===========================================================================
-- VERIFICACIÓN
-- ===========================================================================
select id, name, public from storage.buckets where id = 'ota-updates';
-- Debe mostrar public = true.

select policyname, cmd, roles
from pg_policies
where schemaname = 'storage' and tablename = 'objects' and policyname ilike 'ota%';
-- Debe devolver 0 filas: ninguna política de escritura para este bucket.
