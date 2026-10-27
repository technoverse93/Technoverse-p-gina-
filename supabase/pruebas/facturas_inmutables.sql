-- =====================================================================
-- PRUEBAS de supabase/migracion_facturas_inmutables.sql
-- =====================================================================
-- Se corre DESPUÉS de contenido_y_ubicaciones.sql (usa _t y _v, los usuarios de prueba y la misma base):
--   psql prueba -v ON_ERROR_STOP=1 -q -f supabase/pruebas/facturas_inmutables.sql   # desde la raíz del repo
-- =====================================================================
truncate public._resultados;

\set A  '''{"role":"anon"}''::jsonb'
\set S  '''{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","email":"technoverse.admin@gmail.com"}''::jsonb'
\set E  '''{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated","email":"empleado@technoverse.cr"}''::jsonb'

-- Como estaba en producción: el personal podía borrar y editar.
grant select, update, delete on public.invoices to authenticated;
drop policy if exists invoices_staff_delete on public.invoices;
create policy invoices_staff_delete on public.invoices for delete using (public.is_staff());
drop policy if exists invoices_staff_update on public.invoices;
create policy invoices_staff_update on public.invoices for update using (public.is_staff());
insert into public.invoices (id, order_id, clave, consecutivo, tipo_doc, numero_documento, security_code, emisor_cedula,
                             customer_identification_type, customer_name, medio_pago)
select 'FE-INMUTABLE-1', 'ORD-INMUTABLE-1', 'CLAVE-1', '00100001019999999991', '01', '9999999991', '12345678', '000119090965',
       '01', 'Cliente Prueba', '04'
where not exists (select 1 from public.invoices where id = 'FE-INMUTABLE-1');

-- ---- ANTES ----
select public._t('ANTES', 'un empleado le cambia la clave a un comprobante', 'authenticated', :E,
  $q$ update public.invoices set clave = 'ALTERADA' where id = 'FE-INMUTABLE-1' $q$);
select public._v('ANTES', '…y queda cambiada', (select clave from public.invoices where id = 'FE-INMUTABLE-1') = 'ALTERADA');
update public.invoices set clave = 'CLAVE-1' where id = 'FE-INMUTABLE-1';

\i supabase/migracion_facturas_inmutables.sql

-- ---- F · nadie borra ni edita desde la API ----
select public._t('F', 'un empleado NO edita un comprobante', 'authenticated', :E,
  $q$ update public.invoices set clave = 'ALTERADA' where id = 'FE-INMUTABLE-1' $q$, 'permission denied');
select public._t('F', 'ni el superadmin', 'authenticated', :S,
  $q$ update public.invoices set clave = 'ALTERADA' where id = 'FE-INMUTABLE-1' $q$, 'permission denied');
select public._t('F', 'un empleado NO borra un comprobante', 'authenticated', :E,
  $q$ delete from public.invoices where id = 'FE-INMUTABLE-1' $q$, 'permission denied');
select public._t('F', 'un visitante tampoco', 'anon', :A,
  $q$ delete from public.invoices where id = 'FE-INMUTABLE-1' $q$, 'permission denied');
select public._v('F', 'el comprobante sigue intacto', (select clave from public.invoices where id = 'FE-INMUTABLE-1') = 'CLAVE-1');
select public._t('F', 'el personal sigue LEYENDO los comprobantes', 'authenticated', :E,
  $q$ select 1 / (select count(*)::int from public.invoices where id = 'FE-INMUTABLE-1') $q$);
select public._t('F', 'el servidor (service_role) sí anota el estado del correo', 'service_role', null,
  $q$ update public.invoices set email_status = 'enviado' where id = 'FE-INMUTABLE-1' $q$);

-- ---- R · se puede aplicar dos veces ----
\i supabase/migracion_facturas_inmutables.sql
select public._v('R', 'sin políticas de borrar ni editar',
  not exists (select 1 from pg_policies where tablename = 'invoices' and cmd in ('DELETE', 'UPDATE')));

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
