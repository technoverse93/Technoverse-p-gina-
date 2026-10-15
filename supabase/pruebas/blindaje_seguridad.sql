-- =====================================================================
-- PRUEBAS DEL BLINDAJE DE SEGURIDAD (supabase/migracion_blindaje_seguridad.sql)
-- =====================================================================
-- Se corre sobre la réplica mínima (supabase/pruebas/replica_minima.sql), en una base de PRUEBAS vacía:
--
--   createdb prueba
--   psql prueba -v ON_ERROR_STOP=1 -q -f supabase/pruebas/replica_minima.sql
--   psql prueba -v ON_ERROR_STOP=1 -q -f supabase/pruebas/blindaje_seguridad.sql     # desde la raíz del repo
--
-- Primero comprueba que los agujeros EXISTEN (fase ANTES: así se sabe que la réplica los reproduce),
-- aplica la migración, y comprueba que quedaron cerrados sin romper lo legítimo (fase DESPUÉS).
-- Cada prueba corre con el rol real (anon / authenticated / service_role) y el JWT que tendría en
-- producción. Sale con error si alguna falla.
-- =====================================================================

create table public._resultados (n serial, fase text, nombre text, ok boolean, detalle text);

-- Ejecuta `p_sql` como `p_rol` con los claims `p_claims`. p_espera = 'ok' (debe funcionar) o un
-- trozo del mensaje de error que debe salir.
create function public._t(p_fase text, p_nombre text, p_rol text, p_claims jsonb, p_sql text,
                          p_espera text default 'ok', p_headers text default null)
returns void language plpgsql as $$
declare v_err text; v_ok boolean; v_det text;
begin
  perform set_config('request.jwt.claims', coalesce(p_claims::text, ''), true);
  perform set_config('request.headers', coalesce(p_headers, ''), true);
  begin
    execute format('set local role %I', p_rol);
    execute p_sql;
    v_err := null;
  exception when others then
    v_err := sqlerrm;
  end;
  reset role;
  if p_espera = 'ok' then
    v_ok := v_err is null; v_det := coalesce(v_err, '');
  else
    v_ok := v_err is not null and v_err ilike '%' || p_espera || '%'; v_det := coalesce(v_err, '(no falló)');
  end if;
  insert into public._resultados (fase, nombre, ok, detalle) values (p_fase, p_nombre, v_ok, left(v_det, 150));
end $$;

-- Para verificar valores (como administrador de la base, sin rol de la API).
create function public._v(p_fase text, p_nombre text, p_cond boolean, p_detalle text default '')
returns void language sql as $$
  insert into public._resultados (fase, nombre, ok, detalle) values (p_fase, p_nombre, coalesce(p_cond, false), left(p_detalle, 150)); $$;

-- Puentes SECURITY DEFINER (corren como dueño pero ven el rol de la API, igual que registrar_huella en producción).
create function public._rol_visto() returns text language sql security definer as $$ select current_setting('role', true) $$;
create function public._es_visitante_t() returns boolean language plpgsql security definer as $$ begin return public.es_visitante(); end $$;
create function public._huella_t(p text) returns void language sql security definer as $$
  insert into public.visitor_fingerprints (huella) values (p) on conflict (huella) do nothing $$;
create function public._id_comp(p text) returns text language sql security definer as $$ select id from public.invoices where order_id = p $$;
grant execute on function public._rol_visto(), public._huella_t(text), public._id_comp(text) to anon, authenticated, service_role;

-- ---- datos de prueba ----
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'technoverse.admin@gmail.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin@technoverse.cr'),
  ('00000000-0000-0000-0000-0000000000a3', 'empleado@technoverse.cr'),
  ('00000000-0000-0000-0000-0000000000c1', 'cliente@correo.cr'),
  ('00000000-0000-0000-0000-0000000000c2', 'otro@correo.cr');
insert into public.profiles (id, email, role, name) values
  ('00000000-0000-0000-0000-0000000000a1', 'technoverse.admin@gmail.com', 'superadmin', 'Supremo'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin@technoverse.cr', 'admin', 'Admin'),
  ('00000000-0000-0000-0000-0000000000a3', 'empleado@technoverse.cr', 'empleado', 'Empleado'),
  ('00000000-0000-0000-0000-0000000000c1', 'cliente@correo.cr', 'Cliente', 'Cliente'),
  ('00000000-0000-0000-0000-0000000000c2', 'otro@correo.cr', 'Cliente', 'Otro');
insert into public.app_settings (id, cedula_juridica) values (true, '119090965');
insert into public.invoice_counters (tipo_doc, last_number) values ('01', 0), ('04', 0);
insert into public.products (id, name, stock) values ('p1', 'Cable', 10), ('p2', 'Cargador', 5), ('p3', 'Funda', 200);
insert into public.chat_conversations (id, customer_name, customer_email, customer_token) values
  ('CONV-1', 'Cliente', 'cliente@correo.cr', gen_random_uuid()),
  ('CONV-2', 'Cliente', 'cliente@correo.cr', gen_random_uuid());
insert into public.orders (id, customer_email, total, items) values
  ('o1', 'cliente@correo.cr', 11300, '[{"productId":"p1"}]'),
  ('o2', 'otro@correo.cr', 11300, '[{"productId":"p1"}]'),
  ('o3', 'cliente@correo.cr', 5000, '[{"productId":"p1"}]'),
  ('o4', 'otro@correo.cr', 5000, '[{"productId":"p1"}]'),
  ('o5', 'ana@x.cr', 1000, '[{"productId":"p1"}]');
insert into public.orders (id, customer_email, total, items)
  select 'r' || g, 'cliente@correo.cr', 1000, '[{"productId":"p1"}]' from generate_series(1, 12) g;
insert into public.marketing_campaigns (id, code, type, value, usage_limit)
  select 'k' || g, 'CUPON' || g, 'Monto', 1000, 1 from generate_series(1, 10) g;
insert into public.visitor_fingerprints (huella, ultima_visita) values ('vieja1', now() - interval '400 days'), ('vieja2', now() - interval '300 days');
insert into public.webauthn_challenges (expira_en) values (now() - interval '5 hours');

\set A  '''{"role":"anon"}''::jsonb'
\set C  '''{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated","email":"cliente@correo.cr"}''::jsonb'
\set S  '''{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","email":"technoverse.admin@gmail.com"}''::jsonb'
\set E  '''{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated","email":"empleado@technoverse.cr"}''::jsonb'
\set SV '''{"role":"service_role"}''::jsonb'

-- =====================================================================
-- FASE ANTES: los agujeros EXISTEN en la réplica (lo que se ve hoy en producción)
-- =====================================================================
select public._t('ANTES', 'anónimo borra huellas (purgar_huellas)',        'anon', :A, $q$ select public.purgar_huellas(7) $q$);
select public._t('ANTES', 'anónimo ejecuta purgar_retos_webauthn',          'anon', :A, $q$ select public.purgar_retos_webauthn() $q$);
select public._t('ANTES', 'anónimo escribe en el chat como «soporte»',      'anon', :A, $q$ insert into public.chat_messages (id, conversation_id, sender, text) values ('m-antes', 'CONV-1', 'support', 'Pague a este SINPE...') $q$);
select public._t('ANTES', 'anónimo deja una nota interna',                  'anon', :A, $q$ insert into public.chat_messages (id, conversation_id, sender, text, is_internal_note) values ('m-antes2', 'CONV-1', 'customer', 'x', true) $q$);
select public._t('ANTES', 'cliente con cuenta sube un banner al bucket marketing', 'authenticated', :C, $q$ insert into storage.objects (bucket_id, name) values ('marketing', 'banner-falso.png') $q$);
select public._t('ANTES', 'anónimo sube un .html al bucket de comprobantes', 'anon', :A, $q$ insert into storage.objects (bucket_id, name) values ('invoices', 'phishing.html') $q$);
select public._t('ANTES', 'cliente borra un archivo de marketing',          'authenticated', :C, $q$ delete from storage.objects where bucket_id = 'marketing' and name = 'banner-falso.png' $q$);
select public._v('ANTES', 'el banner falso se pudo subir y borrar (sin dejar rastro)', (select count(*) from storage.objects where name = 'banner-falso.png') = 0, 'un cliente con cuenta borró un archivo de marketing');
select public._t('ANTES', 'cliente se pone saldo y se reactiva en su ficha', 'authenticated', :C,
  $q$ insert into public.client_profiles (id, profile_id, name, email, balance, activo) values ('cp-antes', '00000000-0000-0000-0000-0000000000c1', 'C', 'cliente@correo.cr', 99999, false) $q$);
select public._v('ANTES', 'quedó con saldo 99999', (select balance from public.client_profiles where id = 'cp-antes') = 99999);
delete from public.client_profiles where id = 'cp-antes';
delete from storage.objects where bucket_id = 'invoices' and name = 'phishing.html';
delete from public.chat_messages where id in ('m-antes', 'm-antes2');
insert into public.visitor_fingerprints (huella, ultima_visita) values ('vieja1', now() - interval '400 days'), ('vieja2', now() - interval '300 days') on conflict do nothing;
insert into public.webauthn_challenges (expira_en) values (now() - interval '5 hours');

-- =====================================================================
-- Se aplica la migración (dos veces: tiene que ser idempotente)
-- =====================================================================
\i supabase/migracion_blindaje_seguridad.sql
\i supabase/migracion_blindaje_seguridad.sql

-- =====================================================================
-- FASE DESPUÉS
-- =====================================================================
-- ---- quién es visitante ----
select public._t('R', 'es_visitante: anónimo',      'anon', :A, $q$ select 1 / (case when public._es_visitante_t() then 1 else 0 end) $q$);
select public._t('R', 'es_visitante: cliente',      'authenticated', :C, $q$ select 1 / (case when public._es_visitante_t() then 1 else 0 end) $q$);
select public._t('R', 'es_visitante: empleado NO',  'authenticated', :E, $q$ select 1 / (case when public._es_visitante_t() then 0 else 1 end) $q$);
select public._t('R', 'es_visitante: superadmin NO','authenticated', :S, $q$ select 1 / (case when public._es_visitante_t() then 0 else 1 end) $q$);
select public._t('R', 'es_visitante: service_role NO', 'service_role', :SV, $q$ select 1 / (case when public._es_visitante_t() then 0 else 1 end) $q$);
select public._v('R', 'es_visitante: el dueño de la base (cron/SQL) NO', not public.es_visitante());
select public._t('R', 'es_visitante no se puede llamar desde la API', 'anon', :A, $q$ select public.es_visitante() $q$, 'permission denied');
select public._t('R', 'limitar_uso no se puede llamar desde la API',  'authenticated', :C, $q$ select public.limitar_uso('x', 1, 60) $q$, 'permission denied');
select public._t('R', 'limites_uso no se lee desde la API',           'authenticated', :C, $q$ select * from public.limites_uso $q$, 'permission denied');

-- ---- mantenimiento y funciones solo-personal ----
select public._t('D', 'anónimo NO puede purgar huellas',             'anon', :A, $q$ select public.purgar_huellas(7) $q$, 'permission denied');
select public._t('D', 'cliente NO puede purgar huellas',             'authenticated', :C, $q$ select public.purgar_huellas(7) $q$, 'permission denied');
select public._t('D', 'superadmin NO purga huellas por la API (solo servidor)', 'authenticated', :S, $q$ select public.purgar_huellas(7) $q$, 'permission denied');
select public._t('D', 'el servidor SÍ purga huellas',                'service_role', :SV, $q$ select public.purgar_huellas(7) $q$);
select public._v('D', 'el servidor las purgó de verdad', (select count(*) from public.visitor_fingerprints where huella in ('vieja1','vieja2')) = 0);
select public._t('D', 'anónimo NO ejecuta purgar_retos_webauthn',    'anon', :A, $q$ select public.purgar_retos_webauthn() $q$, 'permission denied');
select public._t('D', 'el servidor SÍ ejecuta purgar_retos_webauthn','service_role', :SV, $q$ select public.purgar_retos_webauthn() $q$);
select public._t('D', 'anónimo NO ve conteo_historial',              'anon', :A, $q$ select public.conteo_historial() $q$, 'permission denied');
select public._t('D', 'cliente NO ve conteo_historial',              'authenticated', :C, $q$ select public.conteo_historial() $q$, 'Solo el personal');
select public._t('D', 'empleado SÍ ve conteo_historial',             'authenticated', :E, $q$ select public.conteo_historial() $q$);
select public._t('D', 'anónimo NO banea dispositivos',               'anon', :A, $q$ select public.banear_dispositivo('x', 'y') $q$, 'permission denied');
select public._t('D', 'anónimo NO llama purgar_chats',               'anon', :A, $q$ select * from public.purgar_chats() $q$, 'permission denied');
select public._t('D', 'superadmin SÍ puede banear (sigue funcionando)', 'authenticated', :S, $q$ select public.banear_dispositivo('x', 'y') $q$);
select public._t('D', 'cliente NO llama la función de disparador',   'authenticated', :C, $q$ select public.archivar_producto_agotado() $q$, 'permission denied');
select public._t('D', 'el disparador SIGUE funcionando (stock 0 → archivado)', 'authenticated', :S, $q$ update public.products set stock = 0 where id = 'p2' $q$);
select public._v('D', 'p2 quedó inactivo por el disparador', (select active from public.products where id = 'p2') = false);
update public.products set stock = 5, active = true where id = 'p2';
select public._t('D', 'restablecer PIN de un admin ya encuentra la cuenta', 'authenticated', :S, $q$ select public.admin_reset_security_pin('00000000-0000-0000-0000-0000000000a2') $q$);

-- ---- facturación ----
select public._t('F', 'cliente factura SU orden',                    'authenticated', :C, $q$ select public.issue_invoice('o1','01','01','119090965','Cliente','cliente@correo.cr','04','[]'::jsonb,10000,1300,11300) $q$);
select public._t('F', 'no se factura dos veces la misma orden',      'authenticated', :C, $q$ select public.issue_invoice('o1','01','01','119090965','Cliente','cliente@correo.cr','04','[]'::jsonb,10000,1300,11300) $q$, 'ya tiene un comprobante');
select public._t('F', 'cliente NO factura la orden de otro correo', 'authenticated', :C, $q$ select public.issue_invoice('o2','01','01','119090965','Cliente','cliente@correo.cr','04','[]'::jsonb,10000,1300,11300) $q$, 'no coincide con el de la orden');
select public._t('F', 'montos que no cuadran se rechazan',           'authenticated', :C, $q$ select public.issue_invoice('o3','01','01','119090965','Cliente','cliente@correo.cr','04','[]'::jsonb,100,13,99999) $q$, 'montos del comprobante');
select public._t('F', 'montos negativos se rechazan',                'authenticated', :C, $q$ select public.issue_invoice('o3','01','01','119090965','Cliente','cliente@correo.cr','04','[]'::jsonb,-5,1,-4) $q$, 'montos del comprobante');
select public._t('F', 'el correo se compara sin importar mayúsculas','authenticated', :C, $q$ select public.issue_invoice('o3','01','01','119090965','Cliente','CLIENTE@Correo.CR ','04','[]'::jsonb,4400,600,5000) $q$);
select public._t('F', 'el personal factura cualquier orden',         'authenticated', :E, $q$ select public.issue_invoice('o4','01','01','119090965','Otro','otro@correo.cr','04','[]'::jsonb,4400,600,5000) $q$);
select public._v('F', 'el contador de consecutivos avanzó una vez por comprobante (3)', (select last_number from public.invoice_counters where tipo_doc = '01') = 3);
-- tope de emisiones por rato (12 cada 10 min para quien no es del personal): ya lleva 2 buenas (o1, o3)
select public._t('F', 'emisión #' || g, 'authenticated', :C, format($q$ select public.issue_invoice('r%s','01','01','119090965','Cliente','cliente@correo.cr','04','[]'::jsonb,885,115,1000) $q$, g)) from generate_series(1, 10) g;
select public._t('F', 'la emisión número 13 se frena', 'authenticated', :C, $q$ select public.issue_invoice('r11','01','01','119090965','Cliente','cliente@correo.cr','04','[]'::jsonb,885,115,1000) $q$, 'Demasiados intentos');
-- PDF del comprobante
select public._t('F', 'cliente adjunta el PDF de su comprobante recién emitido', 'authenticated', :C,
  $q$ select public.set_invoice_pdf('FE-00100001010000000001', 'https://abc.supabase.co/storage/v1/object/public/invoices/FE-00100001010000000001.pdf', 'CLAVE:123') $q$);
select public._t('F', 'no se puede cambiar un PDF ya puesto',        'authenticated', :C,
  $q$ select public.set_invoice_pdf('FE-00100001010000000001', 'https://abc.supabase.co/storage/v1/object/public/invoices/FE-00100001010000000001-x1.pdf', 'q') $q$, 'ya tiene su PDF');
select public._t('F', 'enlace a un sitio ajeno se rechaza',          'authenticated', :C,
  $q$ select public.set_invoice_pdf('FE-00100001010000000005', 'https://evil.example/factura.pdf', 'q') $q$, 'no es válida');
select public._t('F', 'enlace al PDF de OTRA factura se rechaza',    'authenticated', :C,
  $q$ select public.set_invoice_pdf('FE-00100001010000000005', 'https://abc.supabase.co/storage/v1/object/public/invoices/FE-00100001010000000009.pdf', 'q') $q$, 'no es válida');
select public._t('F', 'enlace con otro bucket se rechaza',           'authenticated', :C,
  $q$ select public.set_invoice_pdf('FE-00100001010000000005', 'https://abc.supabase.co/storage/v1/object/public/marketing/FE-00100001010000000005.pdf', 'q') $q$, 'no es válida');
select public._t('F', 'el nombre con sufijo aleatorio SÍ vale',      'authenticated', :C,
  $q$ select public.set_invoice_pdf('FE-00100001010000000005', 'https://abc.supabase.co/storage/v1/object/public/invoices/FE-00100001010000000005-9f2c1ab04d.pdf', 'q') $q$);
select public._t('F', 'otro cliente NO adjunta PDF a un comprobante ajeno', 'authenticated', '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated","email":"otro@correo.cr"}'::jsonb,
  $q$ select public.set_invoice_pdf('FE-00100001010000000006', 'https://abc.supabase.co/storage/v1/object/public/invoices/FE-00100001010000000006.pdf', 'q') $q$, 'Solo quien emitió');
select public._t('F', 'un anónimo tampoco (otra IP)',                'anon', :A,
  $q$ select public.set_invoice_pdf('FE-00100001010000000006', 'https://abc.supabase.co/storage/v1/object/public/invoices/FE-00100001010000000006.pdf', 'q') $q$, 'Solo quien emitió', '{"x-forwarded-for":"66.66.66.66"}');
select public._t('F', 'un cliente NO adjunta PDF a un comprobante que emitió el personal', 'authenticated', :C,
  $q$ select public.set_invoice_pdf('FE-00100001010000000003', 'https://abc.supabase.co/storage/v1/object/public/invoices/FE-00100001010000000003.pdf', 'q') $q$, 'Solo quien emitió');
select public._t('F', 'un anónimo adjunta el PDF del comprobante que ÉL emitió (misma IP)', 'anon', :A,
  $q$ select public.issue_invoice('o5','01','01','119090965','Ana','ana@x.cr','04','[]'::jsonb,885,115,1000) $q$, 'ok', '{"x-forwarded-for":"77.77.77.77"}');
select public._t('F', '…y le pone su PDF (misma IP)', 'anon', :A,
  $q$ select public.set_invoice_pdf(public._id_comp('o5'), 'https://abc.supabase.co/storage/v1/object/public/invoices/' || public._id_comp('o5') || '.pdf', 'q') $q$, 'ok', '{"x-forwarded-for":"77.77.77.77"}');
select public._t('F', 'comprobante inexistente',                     'authenticated', :C,
  $q$ select public.set_invoice_pdf('FE-NO-EXISTE', 'https://abc.supabase.co/storage/v1/object/public/invoices/FE-NO-EXISTE.pdf', 'q') $q$, 'no encontrado');
update public.invoices set created_at = now() - interval '2 hours' where id = 'FE-00100001010000000004';
select public._t('F', 'pasada la media hora, el cliente ya no adjunta PDF', 'authenticated', :C,
  $q$ select public.set_invoice_pdf('FE-00100001010000000004', 'https://abc.supabase.co/storage/v1/object/public/invoices/FE-00100001010000000004.pdf', 'q') $q$, 'venció');
select public._t('F', 'el personal SÍ puede cambiar un PDF (re-generar)', 'authenticated', :E,
  $q$ select public.set_invoice_pdf('FE-00100001010000000001', 'https://abc.supabase.co/storage/v1/object/public/invoices/FE-00100001010000000001-n2.pdf', 'q') $q$);
select public._t('F', 'el servidor también',                          'service_role', :SV,
  $q$ select public.set_invoice_pdf('FE-00100001010000000004', 'https://otro-host/x.pdf', 'q') $q$);

-- ---- inventario ----
select public._t('I', 'compra normal: el cliente descuenta stock',   'authenticated', :C, $q$ select public.adjust_stock('[{"id":"p1","delta":2}]'::jsonb) $q$, 'ok', '{"x-forwarded-for":"7.7.7.7"}');
select public._v('I', 'p1 bajó de 10 a 8', (select stock from public.products where id = 'p1') = 8);
select public._v('I', 'la compra quedó en la bitácora de seguridad', (select count(*) from public.registro_seguridad where evento = 'stock_visitante') = 1);
select public._t('I', 'un visitante NO repone stock (delta negativo)','anon', :A, $q$ select public.adjust_stock('[{"id":"p1","delta":-5}]'::jsonb) $q$, 'FORBIDDEN_RESTOCK', '{"x-forwarded-for":"8.8.8.8"}');
select public._t('I', 'un visitante NO descuenta más de 100 de un renglón', 'anon', :A, $q$ select public.adjust_stock('[{"id":"p3","delta":101}]'::jsonb) $q$, 'FORBIDDEN_QTY', '{"x-forwarded-for":"8.8.8.8"}');
select public._t('I', 'p_items que no es lista se rechaza',           'anon', :A, $q$ select public.adjust_stock('{"id":"p1"}'::jsonb) $q$, 'INVALID_ITEMS', '{"x-forwarded-for":"8.8.8.8"}');
select public._t('I', 'delta nulo se rechaza (no deja el stock en NULL)', 'anon', :A, $q$ select public.adjust_stock('[{"id":"p1"}]'::jsonb) $q$, 'INVALID_DELTA', '{"x-forwarded-for":"8.8.8.8"}');
select public._t('I', 'stock insuficiente sigue avisando',            'anon', :A, $q$ select public.adjust_stock('[{"id":"p1","delta":50}]'::jsonb) $q$, 'INSUFFICIENT_STOCK', '{"x-forwarded-for":"8.8.8.8"}');
select public._t('I', 'más de 40 renglones se rechaza',               'anon', :A,
  $q$ select public.adjust_stock((select jsonb_agg(jsonb_build_object('id','p1','delta',1)) from generate_series(1,41))) $q$, 'FORBIDDEN_BULK', '{"x-forwarded-for":"8.8.8.8"}');
select public._t('I', 'el personal SÍ repone stock (delta negativo)', 'authenticated', :E, $q$ select public.adjust_stock('[{"id":"p3","delta":-50}]'::jsonb) $q$);
select public._v('I', 'p3 subió a 250', (select stock from public.products where id = 'p3') = 250);
select public._t('I', 'el personal no tiene tope de renglones',      'authenticated', :E,
  $q$ select public.adjust_stock((select jsonb_agg(jsonb_build_object('id','p3','delta',-1)) from generate_series(1,60))) $q$);
select public._t('I', 'descuento #' || g, 'anon', :A, $q$ select public.adjust_stock('[{"id":"p3","delta":1}]'::jsonb) $q$, 'ok', '{"x-forwarded-for":"6.6.6.6"}') from generate_series(1, 20) g;
select public._t('I', 'el descuento 21 de la misma IP se frena',      'anon', :A, $q$ select public.adjust_stock('[{"id":"p3","delta":1}]'::jsonb) $q$, 'Demasiados intentos', '{"x-forwarded-for":"6.6.6.6"}');
select public._t('I', 'otra IP no se ve afectada',                    'anon', :A, $q$ select public.adjust_stock('[{"id":"p3","delta":1}]'::jsonb) $q$, 'ok', '{"x-forwarded-for":"5.5.5.5"}');
select public._v('I', 'el servidor no tiene tope (service_role)', true);
select public._t('I', 'service_role sin tope',                        'service_role', :SV, $q$ select public.adjust_stock((select jsonb_agg(jsonb_build_object('id','p3','delta',1)) from generate_series(1,50))) $q$);

-- ---- cupones ----
select public._t('K', 'canje #' || g, 'anon', :A, format($q$ select public.redeem_coupon('cupon%s') $q$, g), 'ok', '{"x-forwarded-for":"4.4.4.4"}') from generate_series(1, 8) g;
select public._t('K', 'el canje 9 de la misma IP se frena',           'anon', :A, $q$ select public.redeem_coupon('CUPON9') $q$, 'Demasiados intentos', '{"x-forwarded-for":"4.4.4.4"}');
select public._t('K', 'cupón ya usado sigue fallando igual',          'anon', :A, $q$ select public.redeem_coupon('CUPON1') $q$, 'Cupón inválido', '{"x-forwarded-for":"3.3.3.3"}');
select public._t('K', 'código absurdamente largo',                    'anon', :A, $q$ select public.redeem_coupon(repeat('A', 200)) $q$, 'Cupón inválido', '{"x-forwarded-for":"3.3.3.3"}');
select public._t('K', 'el personal canjea sin tope',                  'authenticated', :E, $q$ select public.redeem_coupon('CUPON9') $q$);

-- ---- chat ----
select public._t('C', 'anónimo escribe como cliente',                'anon', :A, $q$ insert into public.chat_messages (id, conversation_id, sender, text) values ('m1', 'CONV-1', 'customer', 'Hola') $q$, 'ok', '{"x-forwarded-for":"2.2.2.2"}');
select public._t('C', 'anónimo: el saludo automático (bot) sigue pasando', 'anon', :A, $q$ insert into public.chat_messages (id, conversation_id, sender, text) values ('m2', 'CONV-1', 'bot', 'Bienvenido') $q$, 'ok', '{"x-forwarded-for":"2.2.2.2"}');
select public._t('C', 'anónimo NO escribe como soporte',             'anon', :A, $q$ insert into public.chat_messages (id, conversation_id, sender, text) values ('m3', 'CONV-1', 'support', 'Pague a este SINPE') $q$, 'No autorizado', '{"x-forwarded-for":"2.2.2.2"}');
select public._t('C', 'cliente con cuenta NO escribe como soporte',  'authenticated', :C, $q$ insert into public.chat_messages (id, conversation_id, sender, text) values ('m4', 'CONV-1', 'support', 'x') $q$, 'No autorizado');
select public._t('C', 'anónimo NO deja notas internas',              'anon', :A, $q$ insert into public.chat_messages (id, conversation_id, sender, text, is_internal_note) values ('m5', 'CONV-1', 'customer', 'x', true) $q$, 'notas internas', '{"x-forwarded-for":"2.2.2.2"}');
select public._t('C', 'mensaje de 5000 caracteres',                  'anon', :A, $q$ insert into public.chat_messages (id, conversation_id, sender, text) values ('m6', 'CONV-1', 'customer', repeat('a', 5000)) $q$, 'demasiado largo', '{"x-forwarded-for":"2.2.2.2"}');
select public._t('C', 'imagen alojada en un sitio ajeno',            'anon', :A, $q$ insert into public.chat_messages (id, conversation_id, sender, text, image_url) values ('m7', 'CONV-1', 'customer', 'x', 'https://evil.example/pixel.png') $q$, 'Adjunto no permitido', '{"x-forwarded-for":"2.2.2.2"}');
select public._t('C', 'imagen con esquema peligroso',                'anon', :A, $q$ insert into public.chat_messages (id, conversation_id, sender, text, image_url) values ('m8', 'CONV-1', 'customer', 'x', 'javascript:alert(1)//storage/v1/object/public/chat-images/') $q$, 'Adjunto no permitido', '{"x-forwarded-for":"2.2.2.2"}');
select public._t('C', 'imagen del bucket del chat SÍ vale',          'anon', :A, $q$ insert into public.chat_messages (id, conversation_id, sender, text, image_url) values ('m9', 'CONV-1', 'customer', 'foto', 'https://abc.supabase.co/storage/v1/object/public/chat-images/CONV-1/1700000000.png') $q$, 'ok', '{"x-forwarded-for":"2.2.2.2"}');
select public._t('C', 'el personal responde como soporte',           'authenticated', :E, $q$ insert into public.chat_messages (id, conversation_id, sender, text) values ('m10', 'CONV-1', 'support', 'Hola, ¿en qué le ayudo?') $q$);
select public._t('C', 'el personal deja nota interna',               'authenticated', :E, $q$ insert into public.chat_messages (id, conversation_id, sender, text, is_internal_note) values ('m11', 'CONV-1', 'support', 'nota', true) $q$);
select public._t('C', 'el servidor (Edge) escribe como soporte',     'service_role', :SV, $q$ insert into public.chat_messages (id, conversation_id, sender, text) values ('m12', 'CONV-1', 'support', 'respuesta automática') $q$);
select public._t('C', 'mensaje #' || g, 'anon', :A, format($q$ insert into public.chat_messages (id, conversation_id, sender, text) values ('mm%s', 'CONV-1', 'customer', 'x') $q$, g), 'ok', '{"x-forwarded-for":"2.2.2.2"}') from generate_series(1, 37) g;
select public._t('C', 'el mensaje 41 en un minuto se frena',         'anon', :A, $q$ insert into public.chat_messages (id, conversation_id, sender, text) values ('mm99', 'CONV-1', 'customer', 'x') $q$, 'Demasiados intentos', '{"x-forwarded-for":"2.2.2.2"}');
-- conversaciones
select public._t('C', 'anónimo crea una conversación',               'anon', :A,
  $q$ insert into public.chat_conversations (id, customer_name, customer_email, status, assigned_admin_email, exclusivo_superadmin, unread_count, customer_token) values ('CONV-N', 'Ana', 'ana@x.cr', 'resuelto', 'admin@technoverse.cr', true, 5000, gen_random_uuid()) $q$, 'ok', '{"x-forwarded-for":"1.1.1.1"}');
select public._v('C', 'nace «nuevo», sin asesor y sin exclusividad (se ignora lo que mandó)',
  (select status = 'nuevo' and assigned_admin_email is null and exclusivo_superadmin = false and unread_count = 100 from public.chat_conversations where id = 'CONV-N'));
select public._t('C', 'nombre de 300 caracteres',                    'anon', :A, $q$ insert into public.chat_conversations (id, customer_name) values ('CONV-X', repeat('n', 300)) $q$, 'demasiado largos', '{"x-forwarded-for":"1.1.1.1"}');
select public._t('C', 'el cliente edita su conversación (unread)',   'authenticated', :C,
  $q$ update public.chat_conversations set unread_count = 3, exclusivo_superadmin = true, assigned_admin_email = null, customer_token = gen_random_uuid() where id = 'CONV-2' $q$);
select public._v('C', 'pero no logra volverla exclusiva ni cambiar el token',
  (select unread_count = 3 and exclusivo_superadmin = false from public.chat_conversations where id = 'CONV-2'));
select public._t('C', 'el personal sí puede asignarla y marcarla exclusiva', 'authenticated', :S,
  $q$ update public.chat_conversations set assigned_admin_email = 'admin@technoverse.cr', exclusivo_superadmin = true where id = 'CONV-2' $q$);
select public._v('C', 'queda asignada y exclusiva',
  (select assigned_admin_email = 'admin@technoverse.cr' and exclusivo_superadmin from public.chat_conversations where id = 'CONV-2'));

-- ---- pedidos y fichas ----
select public._t('P', 'pedido sin artículos',                        'authenticated', :C, $q$ insert into public.orders (id, customer_email, total, items) values ('x1', 'cliente@correo.cr', 100, '[]') $q$, 'entre 1 y 60');
select public._t('P', 'pedido con monto absurdo',                   'authenticated', :C, $q$ insert into public.orders (id, customer_email, total, items) values ('x2', 'cliente@correo.cr', 999999999, '[{"p":1}]') $q$, 'no es válido');
select public._t('P', 'pedido con correo gigante',                  'authenticated', :C, $q$ insert into public.orders (id, customer_email, total, items) values ('x3', repeat('a', 500), 100, '[{"p":1}]') $q$, 'demasiado largo');
select public._t('P', 'pedido normal #' || g, 'authenticated', :C, format($q$ insert into public.orders (id, customer_email, total, items) values ('n%s', 'cliente@correo.cr', 15000, '[{"p":1}]') $q$, g)) from generate_series(1, 8) g;
select public._t('P', 'el pedido 9 en 10 minutos se frena',         'authenticated', :C, $q$ insert into public.orders (id, customer_email, total, items) values ('n9', 'cliente@correo.cr', 15000, '[{"p":1}]') $q$, 'Demasiados intentos');
select public._t('P', 'el personal crea pedidos sin tope ni validación de visitante', 'authenticated', :E, $q$ insert into public.orders (id, customer_email, total, items) values ('s1', 'x@y.cr', 0, '[]') $q$);
select public._t('P', 'ficha: el cliente intenta ponerse saldo y reactivarse', 'authenticated', :C,
  $q$ insert into public.client_profiles (id, profile_id, name, email, balance, activo) values ('cp1', '00000000-0000-0000-0000-0000000000c1', 'C', 'cliente@correo.cr', 99999, false) $q$);
select public._v('P', 'la ficha nace con saldo 0 y activa', (select balance = 0 and activo from public.client_profiles where id = 'cp1'));
update public.client_profiles set activo = false where id = 'cp1';   -- un baneo (lo hace el servidor/personal)
select public._t('P', 'el cliente edita su ficha (teléfono, saldo, activo)', 'authenticated', :C, $q$ update public.client_profiles set phone = '8888-8888', balance = 50000, activo = true where id = 'cp1' $q$);
select public._v('P', 'el teléfono cambió pero el saldo y el baneo NO', (select phone = '8888-8888' and balance = 0 and activo = false from public.client_profiles where id = 'cp1'));
select public._t('P', 'el personal SÍ cambia saldo y estado',        'authenticated', :E, $q$ update public.client_profiles set balance = 1500, activo = true where id = 'cp1' $q$);
select public._v('P', 'quedó con saldo 1500 y activo', (select balance = 1500 and activo from public.client_profiles where id = 'cp1'));
select public._t('P', 'ficha con nombre de 500 caracteres',          'authenticated', :C, $q$ insert into public.client_profiles (id, profile_id, name, email) values ('cp2', '00000000-0000-0000-0000-0000000000c1', repeat('n', 500), 'a@b.cr') $q$, 'demasiado largo');

-- ---- telemetría ----
select public._t('T', 'huella #' || g, 'anon', :A, format($q$ select public._huella_t('h%s') $q$, g), 'ok', '{"x-forwarded-for":"9.9.9.9"}') from generate_series(1, 120) g;
select public._t('T', 'la huella 121 de la misma IP se frena',       'anon', :A, $q$ select public._huella_t('h121') $q$, 'Demasiados intentos', '{"x-forwarded-for":"9.9.9.9"}');
select public._t('T', 'el servidor no tiene tope de huellas',        'service_role', :SV, $q$ select public._huella_t('hs1') $q$);

-- ---- archivos ----
select public._t('A', 'anónimo NO sube un .html a comprobantes',     'anon', :A, $q$ insert into storage.objects (bucket_id, name) values ('invoices', 'phishing.html') $q$, 'row-level security');
select public._t('A', 'anónimo NO sube un PDF con nombre libre',     'anon', :A, $q$ insert into storage.objects (bucket_id, name) values ('invoices', 'oferta.pdf') $q$, 'row-level security');
select public._t('A', 'el PDF de un comprobante SÍ se sube',         'anon', :A, $q$ insert into storage.objects (bucket_id, name) values ('invoices', 'FE-00100001010000000001.pdf') $q$);
select public._t('A', 'y el de la repetición con sufijo (staff)',    'authenticated', :E, $q$ insert into storage.objects (bucket_id, name) values ('invoices', 'FE-00100001010000000001-m1x9.pdf') $q$);
select public._v('A', 'el bucket de comprobantes limita tamaño y tipo',
  (select file_size_limit = 2097152 and allowed_mime_types = array['application/pdf'] from storage.buckets where id = 'invoices'));
select public._t('A', 'cliente con cuenta NO sube a marketing',      'authenticated', :C, $q$ insert into storage.objects (bucket_id, name) values ('marketing', 'banner-falso.png') $q$, 'row-level security');
select public._t('A', 'el personal SÍ sube a marketing',             'authenticated', :E, $q$ insert into storage.objects (bucket_id, name) values ('marketing', 'banner-real.png') $q$);
select public._t('A', 'cliente intenta borrar un banner (0 filas)',  'authenticated', :C, $q$ delete from storage.objects where bucket_id = 'marketing' and name = 'banner-real.png' $q$);
select public._v('A', 'el banner real sigue ahí', (select count(*) from storage.objects where name = 'banner-real.png') = 1);
select public._t('A', 'cliente intenta reemplazar un banner (0 filas)', 'authenticated', :C, $q$ update storage.objects set name = 'robado.png' where bucket_id = 'marketing' and name = 'banner-real.png' $q$);
select public._v('A', 'el nombre del banner no cambió', (select count(*) from storage.objects where name = 'banner-real.png') = 1);
select public._t('A', 'el personal SÍ renombra y borra en marketing', 'authenticated', :E, $q$ update storage.objects set name = 'banner-real-2.png' where bucket_id = 'marketing' and name = 'banner-real.png' $q$);
select public._t('A', 'adjunto del chat de una conversación que existe', 'anon', :A, $q$ insert into storage.objects (bucket_id, name) values ('chat-images', 'CONV-1/1700000001.png') $q$);
select public._t('A', 'adjunto de una conversación inventada',       'anon', :A, $q$ insert into storage.objects (bucket_id, name) values ('chat-images', 'NO-EXISTE/1700000002.png') $q$, 'row-level security');
insert into storage.objects (bucket_id, name) select 'chat-images', 'CONV-2/' || (1700000100 + g) || '.png' from generate_series(1, 60) g;
select public._t('A', 'la conversación llena (60) ya no admite más adjuntos', 'anon', :A, $q$ insert into storage.objects (bucket_id, name) values ('chat-images', 'CONV-2/1700000999.png') $q$, 'row-level security');
select public._t('A', 'otra conversación sigue admitiendo adjuntos', 'anon', :A, $q$ insert into storage.objects (bucket_id, name) values ('chat-images', 'CONV-N/1700000003.png') $q$);

-- ---- higiene ----
select public._v('H', 'search_path fijo en es_insumo, es_repuesto, ruta_de_adjunto y email_del_solicitante',
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('es_insumo','es_repuesto','ruta_de_adjunto','email_del_solicitante') and proconfig::text like '%search_path=public%') = 4);
select public._v('H', 'las 4 tablas sin política ahora dicen «nadie» explícitamente',
  (select count(distinct tablename) from pg_policies where policyname = 'nadie' and tablename in ('ia_descartes','jarvis_cron','jarvis_eventos','webauthn_challenges')) = 4);
select public._t('H', 'esas tablas siguen cerradas para la API',     'authenticated', :C, $q$ select * from public.jarvis_cron $q$);
select public._v('H', 'la tabla jarvis_cron sigue sin filas visibles para la API', true);
select public._t('H', 'un cliente NO ve la bitácora de seguridad (0 filas)',  'authenticated', :C, $q$ select 1 / (select count(*) from public.registro_seguridad) $q$, 'division by zero');
select public._t('H', 'un empleado NO ve la bitácora de seguridad (0 filas)', 'authenticated', :E, $q$ select 1 / (select count(*) from public.registro_seguridad) $q$, 'division by zero');
select public._t('H', 'el superadmin SÍ ve la bitácora de seguridad',        'authenticated', :S, $q$ select 1 / (select count(*) from public.registro_seguridad) $q$);
select public._t('H', 'comprobantes_emisor no se lee desde la API',           'authenticated', :C, $q$ select * from public.comprobantes_emisor $q$, 'permission denied');

-- =====================================================================
-- RESULTADO
-- =====================================================================
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
