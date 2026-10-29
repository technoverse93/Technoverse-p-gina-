-- =====================================================================
-- PRUEBAS de supabase/migracion_crm_whatsapp.sql
-- =====================================================================
-- Se corre DESPUÉS de crm.sql (usa sus ayudantes _t y _v, los usuarios de prueba y la base con el CRM aplicado):
--   psql prueba -v ON_ERROR_STOP=1 -q -f supabase/pruebas/crm_whatsapp.sql   # desde la raíz del repo
-- =====================================================================
truncate public._resultados;

\set A  '''{"role":"anon"}''::jsonb'
\set C  '''{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated","email":"cliente@correo.cr"}''::jsonb'
\set E  '''{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated","email":"empleado@technoverse.cr"}''::jsonb'

-- ---- ANTES: el canal no existe ----
select public._t('ANTES', 'el personal NO puede crear un contacto de WhatsApp todavía', 'authenticated', :E,
  $q$ insert into public.crm_leads (nombre, telefono, canal) values ('Antes WA', '8100-9000', 'whatsapp') $q$, 'violates check constraint');

\i supabase/migracion_crm_whatsapp.sql

-- ---- W · el canal y el evento ----
select public._t('W', 'el personal crea un contacto que llegó por WhatsApp', 'authenticated', :E,
  $q$ insert into public.crm_leads (nombre, telefono, canal, etapa) values ('María WA', '8812-3344', 'whatsapp', 'conversacion') $q$);
select public._v('W', '…y queda con su canal', exists (select 1 from public.crm_leads where nombre = 'María WA' and canal = 'whatsapp'));
select public._t('W', 'el personal anota en la línea de tiempo que le escribió por WhatsApp (como «contacto»)', 'authenticated', :E,
  $q$ insert into public.crm_eventos (lead_id, tipo, resumen) select id, 'contacto', 'WhatsApp: /hola' from public.crm_leads where nombre = 'María WA' $q$);
select public._v('W', '…y el evento quedó', exists (select 1 from public.crm_eventos e join public.crm_leads l on l.id = e.lead_id where l.nombre = 'María WA' and e.tipo = 'contacto' and e.resumen like 'WhatsApp:%'));
select public._t('W', 'los canales de siempre siguen valiendo', 'authenticated', :E,
  $q$ insert into public.crm_leads (nombre, email, canal) values ('Manual WA', 'manualwa@correo.cr', 'manual') $q$);
select public._t('W', 'un canal inventado sigue rechazado', 'authenticated', :E,
  $q$ insert into public.crm_leads (nombre, telefono, canal) values ('Falso', '8100-9001', 'telegram') $q$, 'violates check constraint');

-- ---- P · los permisos no cambian ----
select public._t('P', 'un visitante NO crea contactos de WhatsApp', 'anon', :A,
  $q$ insert into public.crm_leads (nombre, telefono, canal) values ('Visitante WA', '8100-9002', 'whatsapp') $q$, 'permission denied');
select public._t('P', 'un cliente con cuenta tampoco', 'authenticated', :C,
  $q$ insert into public.crm_leads (nombre, telefono, canal) values ('Cliente WA', '8100-9003', 'whatsapp') $q$, 'row-level security');

-- ---- R · se puede aplicar dos veces ----
\i supabase/migracion_crm_whatsapp.sql
select public._v('R', 'aplicar de nuevo deja una sola regla de canal',
  (select count(*) from pg_constraint where conname = 'crm_leads_canal_check') = 1);

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
