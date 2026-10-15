-- =====================================================================
-- PRUEBAS de supabase/migracion_ajustes_privados.sql
-- =====================================================================
-- Se corre DESPUÉS de blindaje_seguridad.sql (usa sus ayudantes _t y _v y la misma base de pruebas):
--   psql prueba -v ON_ERROR_STOP=1 -q -f supabase/pruebas/ajustes_privados.sql     # desde la raíz del repo
-- =====================================================================
truncate public._resultados;
-- Una dirección ya configurada ANTES de la migración (el caso en que había algo público).
update public.app_settings set instagram_webhook_url = 'https://hooks.zapier.com/hooks/catch/123/abcSECRETO';

\set A  '''{"role":"anon"}''::jsonb'
\set C  '''{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated","email":"cliente@correo.cr"}''::jsonb'
\set S  '''{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","email":"technoverse.admin@gmail.com"}''::jsonb'
\set E  '''{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated","email":"empleado@technoverse.cr"}''::jsonb'

create function public._ver_webhook_publico() returns text language sql security invoker as $$ select instagram_webhook_url from public.app_settings limit 1 $$;
grant execute on function public._ver_webhook_publico() to anon, authenticated, service_role;

select public._v('ANTES', 'la dirección estaba legible en la columna pública', (select instagram_webhook_url from public.app_settings limit 1) like '%SECRETO%');
select public._t('ANTES', 'un anónimo la leía', 'anon', :A, $q$ select 1 / (case when public._ver_webhook_publico() like '%SECRETO%' then 1 else 0 end) $q$);

\i supabase/migracion_ajustes_privados.sql
\i supabase/migracion_ajustes_privados.sql

select public._v('D', 'la dirección se conservó en la tabla privada', (select instagram_webhook_url from public.app_settings_privado) like '%SECRETO%');
select public._v('D', 'la columna pública quedó vacía', (select instagram_webhook_url from public.app_settings limit 1) is null);
select public._t('D', 'un anónimo ya no ve la dirección', 'anon', :A, $q$ select 1 / (case when public._ver_webhook_publico() is not null then 1 else 0 end) $q$, 'division by zero');
select public._t('D', 'un cliente con cuenta tampoco', 'authenticated', :C, $q$ select 1 / (case when public._ver_webhook_publico() is not null then 1 else 0 end) $q$, 'division by zero');
select public._t('D', 'la tabla privada no se lee desde la API', 'anon', :A, $q$ select * from public.app_settings_privado $q$, 'permission denied');
select public._t('D', 'ni con sesión', 'authenticated', :S, $q$ select * from public.app_settings_privado $q$, 'permission denied');
select public._t('D', 'anónimo no llama a leer_webhook_instagram', 'anon', :A, $q$ select public.leer_webhook_instagram() $q$, 'permission denied');
select public._t('D', 'un cliente recibe NULL', 'authenticated', :C, $q$ select 1 / (case when public.leer_webhook_instagram() is null then 0 else 1 end) $q$, 'division by zero');
select public._t('D', 'el dueño la lee completa', 'authenticated', :S, $q$ select 1 / (case when public.leer_webhook_instagram() like '%SECRETO%' then 1 else 0 end) $q$);
select public._t('D', 'un empleado NO la ve (NULL)', 'authenticated', :E, $q$ select 1 / (case when public.leer_webhook_instagram() is null then 0 else 1 end) $q$, 'division by zero');
select public._t('D', 'el empleado solo sabe que está configurada', 'authenticated', :E, $q$ select 1 / (case when public.webhook_instagram_configurado() then 1 else 0 end) $q$);
select public._t('D', 'un cliente: configurada = falso (no se entera de nada)', 'authenticated', :C, $q$ select 1 / (case when public.webhook_instagram_configurado() then 0 else 1 end) $q$);

-- cliente viejo: el dueño guarda otros ajustes (la columna viaja NULL) → no se borra la dirección
select public._t('D', 'cliente viejo guarda ajustes con la columna NULL', 'authenticated', :S, $q$ update public.app_settings set company_phone = '2222-2222', instagram_webhook_url = null where id = true $q$);
select public._v('D', 'la dirección sigue ahí', (select instagram_webhook_url from public.app_settings_privado) like '%SECRETO%');
-- cliente viejo: el dueño pega una dirección nueva en el campo de siempre
select public._t('D', 'cliente viejo guarda una dirección nueva en la columna pública', 'authenticated', :S, $q$ update public.app_settings set instagram_webhook_url = 'https://hooks.zapier.com/hooks/catch/999/NUEVA' where id = true $q$);
select public._v('D', 'queda en la tabla privada', (select instagram_webhook_url from public.app_settings_privado) like '%NUEVA%');
select public._v('D', 'y la pública sigue vacía', (select instagram_webhook_url from public.app_settings limit 1) is null);
-- cliente nuevo
select public._t('D', 'solo el dueño guarda', 'authenticated', :E, $q$ select public.guardar_webhook_instagram('https://hooks.zapier.com/x') $q$, 'Solo el dueño');
select public._t('D', 'dirección que no es https', 'authenticated', :S, $q$ select public.guardar_webhook_instagram('http://hooks.zapier.com/x') $q$, 'https');
select public._t('D', 'dirección con espacios', 'authenticated', :S, $q$ select public.guardar_webhook_instagram('https://a b') $q$, 'https');
select public._t('D', 'el dueño la cambia', 'authenticated', :S, $q$ select public.guardar_webhook_instagram('https://hooks.zapier.com/hooks/catch/1/OTRA') $q$);
select public._v('D', 'cambió', (select instagram_webhook_url from public.app_settings_privado) like '%OTRA%');
select public._t('D', 'el dueño la quita (texto vacío)', 'authenticated', :S, $q$ select public.guardar_webhook_instagram('') $q$);
select public._v('D', 'quitada', (select instagram_webhook_url from public.app_settings_privado) is null);
select public._v('D', 'el cron lee de la tabla privada', pg_get_functiondef('public.publish_due_marketing_requests()'::regprocedure) like '%app_settings_privado%');

\echo
\echo '===== RESULTADO ====='
select fase, case when ok then 'PASS' else 'FAIL' end as estado, nombre, detalle from public._resultados where not ok order by n;
select fase, count(*) filter (where ok) as pasan, count(*) filter (where not ok) as fallan from public._resultados group by fase order by min(n);
do $$
declare v_fallan int; v_total int;
begin
  select count(*) filter (where not ok), count(*) into v_fallan, v_total from public._resultados;
  if v_fallan > 0 then raise exception '% de % pruebas FALLARON', v_fallan, v_total; end if;
  raise notice 'TODAS LAS PRUEBAS PASAN (%)', v_total;
end $$;
