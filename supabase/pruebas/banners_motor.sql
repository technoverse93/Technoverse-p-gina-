-- =====================================================================
-- PRUEBAS de supabase/migracion_banners_motor.sql
-- =====================================================================
-- Se corre DESPUÉS de blindaje_seguridad.sql y ajustes_privados.sql (usa sus ayudantes _t y _v, los usuarios de
-- prueba, `limitar_uso` y la misma base de pruebas):
--   psql prueba -v ON_ERROR_STOP=1 -q -f supabase/pruebas/banners_motor.sql     # desde la raíz del repo
-- =====================================================================
truncate public._resultados;

\set A  '''{"role":"anon"}''::jsonb'
\set C  '''{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated","email":"cliente@correo.cr"}''::jsonb'
\set S  '''{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","email":"technoverse.admin@gmail.com"}''::jsonb'
\set E  '''{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated","email":"empleado@technoverse.cr"}''::jsonb'

-- Filas que ya existían ANTES de la migración (producción tiene la tabla vacía, pero otra instalación podría no) y
-- un enlace peligroso guardado antes de que existiera la defensa.
insert into public.banners (id, title, description, image_url, link, type, active, formato, oferta) values
  ('viejo-1', 'Banner de siempre', 'ya existía', 'https://tienda.cr/a.webp', '/tienda', 'General', true,  'hero',    null),
  ('viejo-2', 'Pausado',           null,         null,                       null,      'General', false, 'divisor', '-30%');

-- ---- ANTES: los huecos que la migración cierra existen ----
select public._t('ANTES', 'el formato cintillo no existía', 'authenticated', :S,
  $q$ insert into public.banners (id, title, type, formato) values ('cin-antes', 'x', 'General', 'cintillo') $q$, 'banners_formato_check');
select public._v('ANTES', 'no existe la columna cta',
  not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'banners' and column_name = 'cta'));
select public._t('ANTES', 'banner_evento no existía', 'anon', :A, $q$ select public.banner_evento('viejo-1', 'vista') $q$, 'does not exist');
select public._t('ANTES', 'un enlace javascript: SÍ se podía guardar', 'authenticated', :S,
  $q$ insert into public.banners (id, title, type, link) values ('js-antes', 'peligroso', 'General', 'javascript:alert(1)') $q$);

\i supabase/migracion_banners_motor.sql
\i supabase/migracion_banners_motor.sql

-- ---- DESPUÉS · compatibilidad ----
select public._v('D', 'las filas viejas siguen ahí, con prioridad 0 y sin botón ni estilo',
  (select count(*) from public.banners where id in ('viejo-1', 'viejo-2') and prioridad = 0 and cta is null and variante is null) = 2);
select public._v('D', 'la migración no se cayó por el enlace peligroso que ya estaba (NOT VALID)',
  exists (select 1 from public.banners where id = 'js-antes'));
select public._t('D', 'un cliente viejo (sin las columnas nuevas) sigue guardando', 'authenticated', :S,
  $q$ insert into public.banners (id, title, description, image_url, link, type, active, formato, oferta) values ('compat', 'x', 'y', null, '/tienda', 'General', true, 'grid', '2x1') $q$);
select public._v('D', 'y recibe prioridad 0 por defecto', (select prioridad from public.banners where id = 'compat') = 0);
select public._t('D', 'el enlace peligroso viejo hay que corregirlo para volver a guardar esa fila', 'authenticated', :S,
  $q$ update public.banners set title = 'otro' where id = 'js-antes' $q$, 'banners_link_sin_scripts');
select public._t('D', 'corregido el enlace se guarda', 'authenticated', :S,
  $q$ update public.banners set link = '/tienda', title = 'corregido' where id = 'js-antes' $q$);

-- ---- DESPUÉS · formatos y estilos nuevos ----
select public._t('D', 'el personal crea un cintillo con botón, estilo y prioridad', 'authenticated', :S,
  $q$ insert into public.banners (id, title, description, type, formato, cta, link, variante, prioridad) values ('cin-1', 'Envío gratis hoy', 'en compras de más de ₡30 000', 'General', 'cintillo', 'Ver más', '/tienda', 'acento2', 2) $q$);
select public._t('D', 'y una campaña', 'authenticated', :S,
  $q$ insert into public.banners (id, title, type, formato, oferta, cta, variante, prioridad) values ('camp-1', 'Semana del protector', 'General', 'campana', '-30%', 'Ver ofertas', 'oscuro', 1) $q$);
select public._v('D', 'quedaron guardados con sus valores',
  (select count(*) from public.banners where (id = 'cin-1' and formato = 'cintillo' and cta = 'Ver más' and variante = 'acento2' and prioridad = 2)
                                          or (id = 'camp-1' and formato = 'campana' and oferta = '-30%' and variante = 'oscuro' and prioridad = 1)) = 2);
select public._t('D', 'los cuatro estilos y «sin estilo» se aceptan', 'authenticated', :S,
  $q$ insert into public.banners (id, title, type, variante) values
        ('v-1', 'x', 'General', 'acento'), ('v-2', 'x', 'General', 'acento2'), ('v-3', 'x', 'General', 'suave'),
        ('v-4', 'x', 'General', 'oscuro'), ('v-5', 'x', 'General', null) $q$);
select public._t('D', 'un formato inventado se rechaza', 'authenticated', :S,
  $q$ insert into public.banners (id, title, type, formato) values ('mal-1', 'x', 'General', 'pantalla') $q$, 'banners_formato_check');
select public._t('D', 'un estilo inventado se rechaza', 'authenticated', :S,
  $q$ insert into public.banners (id, title, type, formato, variante) values ('mal-2', 'x', 'General', 'hero', 'rojo') $q$, 'banners_variante_check');
select public._t('D', 'título de 201 letras', 'authenticated', :S,
  $q$ insert into public.banners (id, title, type) values ('mal-3', repeat('a', 201), 'General') $q$, 'banners_largos_check');
select public._t('D', 'título de 200 letras', 'authenticated', :S,
  $q$ insert into public.banners (id, title, type) values ('ok-3', repeat('a', 200), 'General') $q$);
select public._t('D', 'botón de 61 letras', 'authenticated', :S,
  $q$ insert into public.banners (id, title, type, cta) values ('mal-4', 'x', 'General', repeat('b', 61)) $q$, 'banners_largos_check');
select public._t('D', 'descripción de 1001 letras', 'authenticated', :S,
  $q$ insert into public.banners (id, title, type, description) values ('mal-5', 'x', 'General', repeat('c', 1001)) $q$, 'banners_largos_check');
select public._t('D', 'etiqueta de oferta de 41 letras', 'authenticated', :S,
  $q$ insert into public.banners (id, title, type, oferta) values ('mal-6', 'x', 'General', repeat('d', 41)) $q$, 'banners_largos_check');

-- ---- DESPUÉS · enlaces ----
select public._t('D', 'enlace javascript: rechazado', 'authenticated', :S,
  $q$ insert into public.banners (id, title, type, link) values ('l-1', 'x', 'General', 'javascript:alert(document.cookie)') $q$, 'banners_link_sin_scripts');
select public._t('D', 'enlace JaVa<tab>ScRiPt: rechazado (los navegadores ignoran la tabulación)', 'authenticated', :S,
  $q$ insert into public.banners (id, title, type, link) values ('l-2', 'x', 'General', E'JaVa\tScRiPt:alert(1)') $q$, 'banners_link_sin_scripts');
select public._t('D', 'enlace con espacios al inicio rechazado', 'authenticated', :S,
  $q$ insert into public.banners (id, title, type, link) values ('l-3', 'x', 'General', E'  \n vbscript:x') $q$, 'banners_link_sin_scripts');
select public._t('D', 'enlace data: rechazado', 'authenticated', :S,
  $q$ insert into public.banners (id, title, type, link) values ('l-4', 'x', 'General', 'data:text/html,<script>alert(1)</script>') $q$, 'banners_link_sin_scripts');
select public._t('D', 'enlace blob: / file: rechazados', 'authenticated', :S,
  $q$ insert into public.banners (id, title, type, link) values ('l-5', 'x', 'General', 'blob:https://x.cr/abc'), ('l-6', 'x', 'General', 'file:///etc/passwd') $q$, 'banners_link_sin_scripts');
select public._t('D', 'https, ruta interna, tel: y mailto: se aceptan', 'authenticated', :S,
  $q$ insert into public.banners (id, title, type, link) values
        ('l-ok-1', 'x', 'General', 'https://tienda.cr/ofertas?x=1'), ('l-ok-2', 'x', 'General', '/tienda'),
        ('l-ok-3', 'x', 'General', 'tel:+50688888888'),               ('l-ok-4', 'x', 'General', 'mailto:ventas@technoverse.cr'),
        ('l-ok-5', 'x', 'General', 'https://x.cr/?a=data:b'),         ('l-ok-6', 'x', 'General', null) $q$);

-- ---- DESPUÉS · quién puede escribir banners (no cambió) ----
select public._t('D', 'un cliente no crea banners', 'authenticated', :C,
  $q$ insert into public.banners (id, title, type) values ('hack-1', 'x', 'General') $q$, 'row-level security');
select public._t('D', 'un anónimo tampoco', 'anon', :A,
  $q$ insert into public.banners (id, title, type) values ('hack-2', 'x', 'General') $q$, 'row-level security');
select public._t('D', 'un cliente intenta editar (no falla, pero no cambia nada)', 'authenticated', :C,
  $q$ update public.banners set title = 'hackeado' where id = 'viejo-1' $q$);
select public._v('D', 'el banner sigue igual', (select title from public.banners where id = 'viejo-1') = 'Banner de siempre');
select public._t('D', 'un anónimo lee los banners (la tienda los pide)', 'anon', :A,
  $q$ select 1 / (case when (select count(*) from public.banners) > 0 then 1 else 0 end) $q$);

-- ---- DESPUÉS · métricas: lo que cuenta ----
delete from public.limites_uso;
select public._t('D', 'un visitante suma una vista', 'anon', :A, $q$ select public.banner_evento('viejo-1', 'vista') $q$);
select public._v('D', 'vistas = 1, clics = 0',
  (select vistas from public.banner_metricas where banner_id = 'viejo-1') = 1 and (select clics from public.banner_metricas where banner_id = 'viejo-1') = 0);
select public._t('D', 'y un clic', 'anon', :A, $q$ select public.banner_evento('viejo-1', 'clic') $q$);
select public._t('D', 'un cliente con cuenta también cuenta', 'authenticated', :C, $q$ select public.banner_evento('viejo-1', 'vista') $q$);
select public._v('D', 'vistas = 2, clics = 1',
  (select vistas from public.banner_metricas where banner_id = 'viejo-1') = 2 and (select clics from public.banner_metricas where banner_id = 'viejo-1') = 1);
select public._t('D', 'el dueño probando su banner no suma', 'authenticated', :S, $q$ select public.banner_evento('viejo-1', 'vista') $q$);
select public._t('D', 'el empleado tampoco', 'authenticated', :E, $q$ select public.banner_evento('viejo-1', 'clic') $q$);
select public._v('D', 'siguen en 2 y 1',
  (select vistas from public.banner_metricas where banner_id = 'viejo-1') = 2 and (select clics from public.banner_metricas where banner_id = 'viejo-1') = 1);
select public._t('D', 'un tipo inventado se rechaza', 'anon', :A, $q$ select public.banner_evento('viejo-1', 'pago') $q$, 'no válido');
select public._t('D', 'tipo nulo se rechaza', 'anon', :A, $q$ select public.banner_evento('viejo-1', null) $q$, 'no válido');
select public._t('D', 'un banner que no existe no da error', 'anon', :A, $q$ select public.banner_evento('no-existe', 'vista') $q$);
select public._v('D', '…y no crea fila', not exists (select 1 from public.banner_metricas where banner_id = 'no-existe'));
select public._t('D', 'un id enorme no da error', 'anon', :A, $q$ select public.banner_evento(repeat('x', 500), 'vista') $q$);
select public._t('D', 'un banner pausado no suma', 'anon', :A, $q$ select public.banner_evento('viejo-2', 'vista') $q$);
select public._v('D', '…y no crea fila', not exists (select 1 from public.banner_metricas where banner_id = 'viejo-2'));

-- ---- DESPUÉS · métricas: quién las lee y quién las escribe ----
select public._t('D', 'un anónimo no lee las métricas', 'anon', :A, $q$ select * from public.banner_metricas $q$, 'permission denied');
select public._t('D', 'un cliente con cuenta ve 0 filas (la política solo deja al personal)', 'authenticated', :C,
  $q$ select 1 / (case when (select count(*) from public.banner_metricas) = 0 then 1 else 0 end) $q$);
select public._t('D', 'el personal las lee', 'authenticated', :E,
  $q$ select 1 / (case when (select vistas from public.banner_metricas where banner_id = 'viejo-1') = 2 then 1 else 0 end) $q$);
select public._t('D', 'un anónimo no escribe directo', 'anon', :A, $q$ insert into public.banner_metricas (banner_id, vistas) values ('viejo-1', 999) $q$, 'permission denied');
select public._t('D', 'un cliente tampoco', 'authenticated', :C, $q$ update public.banner_metricas set vistas = 999 $q$, 'permission denied');
select public._t('D', 'ni el dueño puede falsearlas (solo banner_evento suma)', 'authenticated', :S, $q$ update public.banner_metricas set vistas = 999 $q$, 'permission denied');
select public._t('D', 'ni borrarlas', 'authenticated', :S, $q$ delete from public.banner_metricas $q$, 'permission denied');
select public._v('D', 'la función no tiene búsqueda de esquema mutable',
  (select proconfig from pg_proc where oid = 'public.banner_evento(text,text)'::regprocedure) @> array['search_path=public']);
select public._v('D', 'nadie más que anon/authenticated/dueño la ejecuta (no está abierta a PUBLIC)',
  not exists (select 1 from information_schema.routine_privileges where routine_name = 'banner_evento' and grantee = 'PUBLIC'));

-- ---- DESPUÉS · borrar un banner borra sus métricas ----
insert into public.banners (id, title, type) values ('tmp-borrar', 'x', 'General');
select public._t('D', 'una vista del banner temporal', 'anon', :A, $q$ select public.banner_evento('tmp-borrar', 'vista') $q$);
select public._v('D', 'tiene su fila', exists (select 1 from public.banner_metricas where banner_id = 'tmp-borrar'));
select public._t('D', 'el personal quita el banner', 'authenticated', :S, $q$ delete from public.banners where id = 'tmp-borrar' $q$);
select public._v('D', 'y las métricas se van con él', not exists (select 1 from public.banner_metricas where banner_id = 'tmp-borrar'));

-- ---- DESPUÉS · tope por persona/IP (limitar_uso, del blindaje de seguridad) ----
delete from public.limites_uso;
select vistas as v0 from public.banner_metricas where banner_id = 'viejo-1' \gset
select public._t('D', '300 vistas seguidas desde la misma IP no dan error', 'anon', :A,
  $q$ select public.banner_evento('viejo-1', 'vista') from generate_series(1, 300) $q$, 'ok', '{"cf-connecting-ip":"203.0.113.9"}');
select public._v('D', 'solo se cuentan 240 (el tope de 10 minutos)',
  (select vistas from public.banner_metricas where banner_id = 'viejo-1') = :v0 + 240);
select public._t('D', 'otra IP no está topada', 'anon', :A,
  $q$ select public.banner_evento('viejo-1', 'vista') $q$, 'ok', '{"cf-connecting-ip":"203.0.113.10"}');
select public._v('D', 'esa sí suma', (select vistas from public.banner_metricas where banner_id = 'viejo-1') = :v0 + 241);

-- ---- DESPUÉS · sin el blindaje de seguridad todavía (limitar_uso no existe) ----
select pg_get_functiondef('public.limitar_uso(text,integer,integer)'::regprocedure) as def_limitar \gset
drop function public.limitar_uso(text, integer, integer);
select vistas as v1 from public.banner_metricas where banner_id = 'viejo-1' \gset
select public._t('D', 'sin limitar_uso la función sigue funcionando', 'anon', :A,
  $q$ select public.banner_evento('viejo-1', 'vista') $q$, 'ok', '{"cf-connecting-ip":"203.0.113.11"}');
select public._v('D', '…y cuenta (sin tope)', (select vistas from public.banner_metricas where banner_id = 'viejo-1') = :v1 + 1);
select :'def_limitar' \gexec
revoke all on function public.limitar_uso(text, integer, integer) from public, anon, authenticated;

-- ---- DESPUÉS · quien está bloqueado por IP no suma ----
create or replace function public.solicitante_bloqueado() returns boolean language sql stable as $$ select true $$;
select vistas as v2 from public.banner_metricas where banner_id = 'viejo-1' \gset
select public._t('D', 'un solicitante bloqueado no da error', 'anon', :A, $q$ select public.banner_evento('viejo-1', 'vista') $q$, 'ok', '{"cf-connecting-ip":"203.0.113.12"}');
select public._v('D', '…y no suma', (select vistas from public.banner_metricas where banner_id = 'viejo-1') = :v2);
create or replace function public.solicitante_bloqueado() returns boolean language sql stable as $$ select false $$;

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
