-- =====================================================================
-- PRUEBAS de supabase/migracion_chat_push.sql y supabase/migracion_avisos_web.sql
-- =====================================================================
-- Se corre DESPUÉS de crm.sql (usa sus ayudantes _t y _v, los usuarios de prueba y la misma base):
--   psql prueba -v ON_ERROR_STOP=1 -q -f supabase/pruebas/avisos.sql     # desde la raíz del repo
-- =====================================================================
truncate public._resultados;

\set A  '''{"role":"anon"}''::jsonb'
\set C  '''{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated","email":"cliente@correo.cr"}''::jsonb'
\set S  '''{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","email":"technoverse.admin@gmail.com"}''::jsonb'
\set D  '''{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated","email":"admin@technoverse.cr"}''::jsonb'
\set E  '''{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated","email":"empleado@technoverse.cr"}''::jsonb'
\set IP '''{"x-forwarded-for":"10.5.0.1"}'''

-- Lo que en producción ya existe: la llave de jarvis_cron y pg_net. Aquí, net.http_post es un doble que anota
-- cada llamada (url, cabeceras y cuerpo) en vez de salir a internet.
alter table public.jarvis_cron add column if not exists clave text;
insert into public.jarvis_cron (id, clave) values (1, 'clave-de-prueba');
create schema if not exists net;
create table net._llamadas (n serial, url text, headers jsonb, body jsonb);
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}',
                              timeout_milliseconds int default 5000)
returns bigint language plpgsql as $$
declare v bigint;
begin
  insert into net._llamadas (url, headers, body) values (url, headers, body) returning n into v;
  return v;
end $$;
insert into public.chat_conversations (id, customer_name, customer_email, customer_token) values
  ('CONV-PUSH', 'Marta', 'marta@correo.cr', gen_random_uuid());

-- Claves con la forma real de una suscripción (65 y 16 bytes en base64url).
\set K  '''B''||repeat(''Q'',86)'
\set AU 'repeat(''a'',22)'

-- ---- ANTES: nada de esto existe ----
select public._v('ANTES', 'no existe la tabla de teléfonos', not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'dispositivos_push'));
select public._v('ANTES', 'no existe la tabla de navegadores', not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'avisos_web'));
select public._t('ANTES', 'un cliente escribe…', 'anon', :A,
  $q$ insert into public.chat_messages (id, conversation_id, sender, text) values ('push-0', 'CONV-PUSH', 'customer', 'Hola') $q$, 'ok', :IP);
select public._v('ANTES', '…y nadie se entera (no se avisa a la función)', not exists (select 1 from net._llamadas));

\i supabase/migracion_chat_push.sql
\i supabase/migracion_avisos_web.sql

-- ---- P1 · el gatillo del chat ----
select public._t('P1', 'un cliente escribe', 'anon', :A,
  $q$ insert into public.chat_messages (id, conversation_id, sender, text) values ('push-1', 'CONV-PUSH', 'customer', '¿Tienen cargadores?') $q$, 'ok', :IP);
select public._v('P1', 'se le avisa a la función con push_chat y el id del mensaje',
  exists (select 1 from net._llamadas where body ->> 'accion' = 'cron' and body ->> 'tarea' = 'push_chat' and body -> 'datos' ->> 'mensaje' = 'push-1'));
select public._v('P1', 'a la función correcta y con la llave de jarvis_cron',
  (select bool_and(url = 'https://hzatdfrjcqiimgqxcwwh.supabase.co/functions/v1/asistente-ia' and headers ->> 'x-jarvis-cron' = 'clave-de-prueba') from net._llamadas));
select public._v('P1', 'el aviso no lleva el texto del mensaje (la función lo lee con sus permisos)',
  not exists (select 1 from net._llamadas where body::text like '%cargadores%'));
select public._t('P1', 'el personal contesta', 'authenticated', :E,
  $q$ insert into public.chat_messages (id, conversation_id, sender, text) values ('push-2', 'CONV-PUSH', 'support', 'Sí, tenemos') $q$);
select public._t('P1', 'una nota interna', 'authenticated', :E,
  $q$ insert into public.chat_messages (id, conversation_id, sender, text, is_internal_note) values ('push-3', 'CONV-PUSH', 'customer', 'nota', true) $q$);
select public._v('P1', 'ni la respuesta del personal ni la nota interna avisan', (select count(*) from net._llamadas) = 1);
-- Si avisar falla, el mensaje del cliente se guarda igual.
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}',
                                         timeout_milliseconds int default 5000)
returns bigint language plpgsql as $$ begin raise exception 'sin red'; end $$;
select public._t('P1', 'con la red caída el cliente escribe igual', 'anon', :A,
  $q$ insert into public.chat_messages (id, conversation_id, sender, text) values ('push-4', 'CONV-PUSH', 'customer', 'Hola de nuevo') $q$, 'ok', :IP);
select public._v('P1', '…y su mensaje queda guardado', exists (select 1 from public.chat_messages where id = 'push-4'));
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}',
                                         timeout_milliseconds int default 5000)
returns bigint language plpgsql as $$
declare v bigint;
begin
  insert into net._llamadas (url, headers, body) values (url, headers, body) returning n into v;
  return v;
end $$;
select public._t('P1', 'la puerta jarvis_llamar no se abre desde la API (visitante)', 'anon', :A, $q$ select public.jarvis_llamar('push_chat', '{}'::jsonb) $q$, 'permission denied');
select public._t('P1', '…ni con una sesión del personal', 'authenticated', :S, $q$ select public.jarvis_llamar('push_chat', '{}'::jsonb) $q$, 'permission denied');
select public._v('P1', 'la función del gatillo no la ejecuta nadie de la API',
  not has_function_privilege('anon', 'public.chat_empujar()', 'execute') and not has_function_privilege('authenticated', 'public.chat_empujar()', 'execute'));
select public._v('P1', 'las funciones nuevas fijan search_path',
  (select bool_and(coalesce(array_to_string(proconfig, ','), '') like '%search_path=%') from pg_proc where proname in
     ('registrar_dispositivo_push', 'quitar_dispositivo_push', 'jarvis_llamar', 'chat_empujar', 'registrar_avisos_web', 'quitar_avisos_web') and prosecdef));

-- ---- P2 · teléfonos (APK) ----
select public._t('P2', 'el personal registra su teléfono', 'authenticated', :E, $q$ select public.registrar_dispositivo_push(repeat('t', 60), 'Galaxy A12') $q$);
select public._v('P2', '…a su nombre', (select user_id from public.dispositivos_push where token = repeat('t', 60)) = '00000000-0000-0000-0000-0000000000a3');
select public._t('P2', 'un cliente no puede', 'authenticated', :C, $q$ select public.registrar_dispositivo_push(repeat('c', 60), 'X') $q$, 'Solo el personal');
select public._t('P2', 'un visitante tampoco', 'anon', :A, $q$ select public.registrar_dispositivo_push(repeat('v', 60), 'X') $q$, 'permission denied');
select public._t('P2', 'un token cortito no sirve', 'authenticated', :E, $q$ select public.registrar_dispositivo_push('corto', 'X') $q$, 'Token no válido');
select public._t('P2', 'nadie ve la tabla desde la API (ni el dueño)', 'authenticated', :S,
  $q$ select 1 / (case when (select count(*) from public.dispositivos_push) = 0 then 1 else 0 end) $q$);
select public._t('P2', 'ni escribe directo en ella', 'authenticated', :S,
  $q$ insert into public.dispositivos_push (token, user_id) values (repeat('x', 60), '00000000-0000-0000-0000-0000000000a1') $q$, 'row-level security');
select public._t('P2', 'otro no puede quitar mi teléfono', 'authenticated', :S, $q$ select public.quitar_dispositivo_push(repeat('t', 60)) $q$);
select public._v('P2', '…sigue registrado', exists (select 1 from public.dispositivos_push where token = repeat('t', 60)));
select public._t('P2', 'yo sí lo quito (cerrar sesión)', 'authenticated', :E, $q$ select public.quitar_dispositivo_push(repeat('t', 60)) $q$);
select public._v('P2', '…y ya no está', not exists (select 1 from public.dispositivos_push where token = repeat('t', 60)));

-- ---- P3 · navegadores (avisos web) ----
select public._t('P3', 'el personal activa los avisos en Chrome', 'authenticated', :E,
  format($q$ select public.registrar_avisos_web('https://fcm.googleapis.com/fcm/send/abc:123', %s, %s, 'Chrome') $q$, quote_literal(:K), quote_literal(:AU)));
select public._v('P3', '…a su nombre', (select user_id from public.avisos_web where endpoint = 'https://fcm.googleapis.com/fcm/send/abc:123') = '00000000-0000-0000-0000-0000000000a3');
select public._t('P3', 'Firefox también', 'authenticated', :E,
  format($q$ select public.registrar_avisos_web('https://updates.push.services.mozilla.com/wpush/v2/x', %s, %s) $q$, quote_literal(:K), quote_literal(:AU)));
select public._t('P3', 'Edge también', 'authenticated', :E,
  format($q$ select public.registrar_avisos_web('https://wns2-par02p.notify.windows.com/w/?token=x', %s, %s) $q$, quote_literal(:K), quote_literal(:AU)));
select public._t('P3', 'Safari también', 'authenticated', :E,
  format($q$ select public.registrar_avisos_web('https://web.push.apple.com/QGx', %s, %s) $q$, quote_literal(:K), quote_literal(:AU)));
select public._t('P3', 'un cliente no puede', 'authenticated', :C,
  format($q$ select public.registrar_avisos_web('https://fcm.googleapis.com/fcm/send/cli', %s, %s) $q$, quote_literal(:K), quote_literal(:AU)), 'Solo el personal');
select public._t('P3', 'un visitante tampoco', 'anon', :A,
  format($q$ select public.registrar_avisos_web('https://fcm.googleapis.com/fcm/send/vis', %s, %s) $q$, quote_literal(:K), quote_literal(:AU)), 'permission denied');
select public._t('P3', 'una dirección que no es de un servicio de avisos (la función le mandaría pedidos)', 'authenticated', :E,
  format($q$ select public.registrar_avisos_web('https://atacante.example.com/fcm.googleapis.com/', %s, %s) $q$, quote_literal(:K), quote_literal(:AU)), 'avisos_web_servicio_conocido');
select public._t('P3', 'un servicio conocido pero sin https', 'authenticated', :E,
  format($q$ select public.registrar_avisos_web('http://fcm.googleapis.com/fcm/send/x', %s, %s) $q$, quote_literal(:K), quote_literal(:AU)), 'avisos_web_servicio_conocido');
select public._t('P3', 'un dominio que solo se parece', 'authenticated', :E,
  format($q$ select public.registrar_avisos_web('https://fcm.googleapis.com.atacante.cr/x', %s, %s) $q$, quote_literal(:K), quote_literal(:AU)), 'avisos_web_servicio_conocido');
select public._t('P3', 'claves con otro largo', 'authenticated', :E,
  format($q$ select public.registrar_avisos_web('https://fcm.googleapis.com/fcm/send/k', %s, %s) $q$, quote_literal(left(:K, 86)), quote_literal(:AU)), 'avisos_web_claves');
select public._t('P3', 'claves con caracteres de más', 'authenticated', :E,
  format($q$ select public.registrar_avisos_web('https://fcm.googleapis.com/fcm/send/k', %s, %s) $q$, quote_literal(:K), quote_literal(left(:AU, 21) || '=')), 'avisos_web_claves');
select public._t('P3', 'el mismo navegador con otra cuenta del personal pasa a esa cuenta', 'authenticated', :S,
  format($q$ select public.registrar_avisos_web('https://fcm.googleapis.com/fcm/send/abc:123', %s, %s) $q$, quote_literal(:K), quote_literal(:AU)));
select public._v('P3', '…ahora es del dueño', (select user_id from public.avisos_web where endpoint = 'https://fcm.googleapis.com/fcm/send/abc:123') = '00000000-0000-0000-0000-0000000000a1');
select public._t('P3', 'nadie ve la tabla desde la API (ni el dueño)', 'authenticated', :S, $q$ select count(*) from public.avisos_web $q$, 'permission denied');
select public._t('P3', 'ni escribe directo en ella', 'authenticated', :S,
  format($q$ insert into public.avisos_web (endpoint, user_id, p256dh, auth) values ('https://fcm.googleapis.com/fcm/send/d', '00000000-0000-0000-0000-0000000000a1', %s, %s) $q$, quote_literal(:K), quote_literal(:AU)), 'permission denied');
select public._t('P3', 'otro no puede quitar mi navegador', 'authenticated', :E, $q$ select public.quitar_avisos_web('https://fcm.googleapis.com/fcm/send/abc:123') $q$);
select public._v('P3', '…sigue activo', exists (select 1 from public.avisos_web where endpoint = 'https://fcm.googleapis.com/fcm/send/abc:123'));
select public._t('P3', 'yo sí lo apago', 'authenticated', :S, $q$ select public.quitar_avisos_web('https://fcm.googleapis.com/fcm/send/abc:123') $q$);
select public._v('P3', '…y ya no está', not exists (select 1 from public.avisos_web where endpoint = 'https://fcm.googleapis.com/fcm/send/abc:123'));
-- Hasta 10 navegadores por persona: con 10 ya anotados (los más viejos primero), uno más descarta el más viejo.
insert into public.avisos_web (endpoint, user_id, p256dh, auth, actualizado_en)
select 'https://fcm.googleapis.com/fcm/send/viejo-' || g, '00000000-0000-0000-0000-0000000000a2', 'B' || repeat('Q', 86), repeat('a', 22), now() - (20 - g) * interval '1 day'
  from generate_series(1, 10) g;
select public._t('P3', 'el navegador número 11', 'authenticated', :D,
  format($q$ select public.registrar_avisos_web('https://fcm.googleapis.com/fcm/send/nuevo', %s, %s) $q$, quote_literal(:K), quote_literal(:AU)));
select public._v('P3', '…quedan 10 y se fue el más viejo',
  (select count(*) from public.avisos_web where user_id = '00000000-0000-0000-0000-0000000000a2') = 10
  and not exists (select 1 from public.avisos_web where endpoint = 'https://fcm.googleapis.com/fcm/send/viejo-1')
  and exists (select 1 from public.avisos_web where endpoint = 'https://fcm.googleapis.com/fcm/send/nuevo'));
select public._v('P3', 'el tope es por persona: los de otros no se tocan',
  (select count(*) from public.avisos_web where user_id = '00000000-0000-0000-0000-0000000000a3') = 3);

-- ---- P3b · la llave VAPID del servidor ----
select public._t('P3b', 'nadie lee la llave del servidor desde la API (ni el dueño)', 'authenticated', :S, $q$ select privada from public.avisos_web_llave $q$, 'permission denied');
select public._t('P3b', 'ni un visitante', 'anon', :A, $q$ select privada from public.avisos_web_llave $q$, 'permission denied');
insert into public.avisos_web_llave (publica, privada) values (:K, '{"x":"a","y":"b","d":"c"}');
select public._t('P3b', 'la función (service_role) sí la lee', 'service_role', null, $q$ select 1 / (select count(*)::int from public.avisos_web_llave) $q$);
select public._t('P3b', 'una segunda llave no entra', 'service_role', null, $q$ insert into public.avisos_web_llave (id, publica, privada) values (2, 'B' || repeat('Q', 86), '{}') $q$, 'avisos_web_llave_id_check');

-- ---- P4 · se puede aplicar dos veces ----
\i supabase/migracion_chat_push.sql
\i supabase/migracion_avisos_web.sql
select public._v('P4', 'aplicar de nuevo no borra nada ni duplica el gatillo',
  (select count(*) from public.avisos_web) = 13
  and (select count(*) from pg_trigger where tgrelid = 'public.chat_messages'::regclass and tgname = 'trg_chat_empujar') = 1);

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
