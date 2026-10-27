-- =====================================================================
-- PRUEBAS de supabase/migracion_contenido_y_ubicaciones.sql
-- =====================================================================
-- Se corre DESPUÉS de avisos.sql (usa sus ayudantes _t y _v, los usuarios de prueba y la misma base,
-- con el blindaje ya aplicado):
--   psql prueba -v ON_ERROR_STOP=1 -q -f supabase/pruebas/contenido_y_ubicaciones.sql   # desde la raíz del repo
-- =====================================================================
truncate public._resultados;

\set A  '''{"role":"anon"}''::jsonb'
\set C  '''{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated","email":"cliente@correo.cr"}''::jsonb'
\set S  '''{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","email":"technoverse.admin@gmail.com"}''::jsonb'
\set D  '''{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated","email":"admin@technoverse.cr"}''::jsonb'
\set E  '''{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated","email":"empleado@technoverse.cr"}''::jsonb'
\set IP '''{"x-forwarded-for":"10.6.0.1"}'''

-- La tabla tal como está en producción (migración original, con sus políticas abiertas).
\i supabase/migracion_contenido_sitio.sql
insert into public.contenido_sitio (clave, valor) values ('tienda.vacio_titulo', 'Pronto llegan novedades');

-- ---- ANTES: los agujeros existen ----
select public._t('ANTES', 'un cliente cualquiera cambia un texto de la tienda', 'authenticated', :C,
  $q$ update public.contenido_sitio set valor = 'TIENDA HACKEADA' where clave = 'tienda.vacio_titulo' $q$);
select public._v('ANTES', '…y el texto quedó cambiado', (select valor from public.contenido_sitio where clave = 'tienda.vacio_titulo') = 'TIENDA HACKEADA');
select public._t('ANTES', 'un cliente agrega textos nuevos', 'authenticated', :C,
  $q$ insert into public.contenido_sitio (clave, valor) values ('tienda.falsa', 'x') $q$);
select public._t('ANTES', 'un visitante anota una ubicación como administrador', 'anon', :A,
  $q$ insert into public.ubicaciones_compartidas (rol, lat, lon) values ('administrador', 9.9, -84.1) $q$, 'ok', :IP);
select public._v('ANTES', '…y queda como administrador', exists (select 1 from public.ubicaciones_compartidas where rol = 'administrador'));
update public.contenido_sitio set valor = 'Pronto llegan novedades' where clave = 'tienda.vacio_titulo';
delete from public.contenido_sitio where clave = 'tienda.falsa';
delete from public.ubicaciones_compartidas;

\i supabase/migracion_contenido_y_ubicaciones.sql

-- ---- C · contenido de la tienda ----
select public._t('C', 'un cliente intenta cambiar un texto', 'authenticated', :C,
  $q$ update public.contenido_sitio set valor = 'TIENDA HACKEADA' where clave = 'tienda.vacio_titulo' $q$);
select public._v('C', '…y el texto NO cambia', (select valor from public.contenido_sitio where clave = 'tienda.vacio_titulo') = 'Pronto llegan novedades');
select public._t('C', 'un cliente NO agrega textos', 'authenticated', :C,
  $q$ insert into public.contenido_sitio (clave, valor) values ('tienda.falsa', 'x') $q$, 'row-level security');
select public._t('C', 'un empleado NO edita la página (en la app tampoco puede)', 'authenticated', :E,
  $q$ insert into public.contenido_sitio (clave, valor) values ('tienda.empleado', 'x') $q$, 'row-level security');
select public._t('C', 'un visitante NO escribe', 'anon', :A,
  $q$ insert into public.contenido_sitio (clave, valor) values ('tienda.anon', 'x') $q$, 'row-level security');
select public._t('C', 'el admin edita un texto (upsert, como la app)', 'authenticated', :D,
  $q$ insert into public.contenido_sitio (clave, valor, tipo) values ('tienda.vacio_titulo', 'Nuevos ingresos', 'texto')
      on conflict (clave) do update set valor = excluded.valor $q$);
select public._v('C', '…y el texto cambia', (select valor from public.contenido_sitio where clave = 'tienda.vacio_titulo') = 'Nuevos ingresos');
select public._t('C', 'el superadmin agrega un texto nuevo', 'authenticated', :S,
  $q$ insert into public.contenido_sitio (clave, valor) values ('tienda.nuevo', 'Hola') $q$);
select public._t('C', 'un visitante sigue leyendo el contenido', 'anon', :A,
  $q$ select 1 / (select count(*)::int from public.contenido_sitio where clave = 'tienda.nuevo') $q$);

-- ---- U · ubicaciones ----
select public._t('U', 'un visitante anota su ubicación como «administrador»', 'anon', :A,
  $q$ insert into public.ubicaciones_compartidas (rol, lat, lon, contexto) values ('administrador', 9.9, -84.1, 'u-anon') $q$, 'ok', :IP);
select public._v('U', '…y queda como cliente', (select rol from public.ubicaciones_compartidas where contexto = 'u-anon') = 'cliente');
select public._t('U', 'un cliente con cuenta tampoco se hace pasar por administrador', 'authenticated', :C,
  $q$ insert into public.ubicaciones_compartidas (rol, lat, lon, contexto) values ('administrador', 9.9, -84.1, 'u-cli') $q$);
select public._v('U', '…queda como cliente', (select rol from public.ubicaciones_compartidas where contexto = 'u-cli') = 'cliente');
select public._t('U', 'el personal anota su ubicación de administrador', 'authenticated', :E,
  $q$ insert into public.ubicaciones_compartidas (rol, lat, lon, contexto) values ('administrador', 9.9, -84.1, 'u-staff') $q$);
select public._v('U', '…y se respeta', (select rol from public.ubicaciones_compartidas where contexto = 'u-staff') = 'administrador');

-- ---- R · se puede aplicar dos veces ----
\i supabase/migracion_contenido_y_ubicaciones.sql
select public._v('R', 'aplicar de nuevo no duplica el gatillo',
  (select count(*) from pg_trigger where tgrelid = 'public.ubicaciones_compartidas'::regclass and tgname = 'trg_ubicaciones_rol') = 1);

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
