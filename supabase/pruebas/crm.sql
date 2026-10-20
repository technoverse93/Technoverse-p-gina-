-- =====================================================================
-- PRUEBAS de supabase/migracion_crm.sql
-- =====================================================================
-- Se corre DESPUÉS de blindaje_seguridad.sql (usa sus ayudantes _t y _v, los usuarios de prueba, `limitar_uso` y la misma
-- base de pruebas):
--   psql prueba -v ON_ERROR_STOP=1 -q -f supabase/pruebas/crm.sql     # desde la raíz del repo
-- Primero deja datos que YA existen antes de la migración (para comprobar que se traen al CRM), aplica la migración
-- (dos veces: es idempotente) y prueba captación, embudo, permisos, función pública, límites y derecho al olvido.
-- =====================================================================
truncate public._resultados;
truncate public.chat_conversations, public.client_profiles, public.orders, public.repair_orders cascade;
truncate public.limites_uso;

\set A  '''{"role":"anon"}''::jsonb'
\set C  '''{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated","email":"cliente@correo.cr"}''::jsonb'
\set S  '''{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","email":"technoverse.admin@gmail.com"}''::jsonb'
\set E  '''{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated","email":"empleado@technoverse.cr"}''::jsonb'

-- ---- lo que ya existía ANTES de la migración ----
insert into public.client_profiles (id, name, email, phone, province, notes, created_at) values
  ('cp-ana',    'Ana Mora',         'Ana@Correo.cr',                    '+506 8888-1111', 'Heredia', null, now() - interval '40 days'),
  ('cp-olvido', 'CLIENTE ANÓNIMO',  'anonimo-cp-olvido@technoverse.com', '+506 0000 0000', null,      null, now() - interval '30 days'),
  -- Compró sin cuenta: el checkout le inventó el correo (nombre pegado + @correo.cr).
  ('cp-fab',    'Gina Mora',        'ginamora@correo.cr',               '+506 8300-1234', null,      'Cliente registrado automáticamente desde checkout.', now() - interval '10 days');
insert into public.chat_conversations (id, customer_name, customer_email, created_at) values
  ('CONV-A', 'Ana Mora',           'ana@correo.cr',           now() - interval '41 days'),
  ('CONV-B', 'Beto',               'beto@correo.cr',          now() - interval '5 days'),
  ('CONV-C', 'Sin correo',         '',                        now() - interval '5 days'),
  ('CONV-E', 'Empleado probando',  'empleado@technoverse.cr', now() - interval '2 days');
insert into public.chat_messages (id, conversation_id, sender, text, is_internal_note) values
  ('cm1', 'CONV-A', 'customer', 'Hola', false),
  ('cm2', 'CONV-A', 'support',  'Hola Ana', false),
  ('cm4', 'CONV-B', 'customer', '¿Precio?', false),
  ('cm5', 'CONV-B', 'support',  'nota interna: no tiene respuesta pública', true);
insert into public.orders (id, customer_id, customer_name, customer_email, total, items, status, created_at) values
  ('FAC-1', 'cp-carla', 'Carla Ruiz', 'carla@correo.cr',          45000, '[{"p":1}]', 'Completado', now() - interval '20 days'),
  ('FAC-2', 'cp-carla', 'Carla Ruiz', 'Carla@Correo.cr',          30000, '[{"p":1}]', 'Completado', now() - interval '3 days'),
  ('NC-1',  'cp-dani',  'Dani',       'dani@correo.cr',            9000, '[{"p":1}]', 'Devuelto',   now() - interval '3 days'),
  ('FAC-3', null,       'Empleado',   'empleado@technoverse.cr',    100, '[{"p":1}]', 'Completado', now());
insert into public.repair_orders (id, ticket, customer_id, customer_name, customer_email, customer_phone, status, created_at) values
  ('GT-1', 'TKT-1', 'cp-elena', 'Elena',         'elena@correo.cr', '8777-2222',      'Lista',     now() - interval '4 days'),
  ('GT-2', 'TKT-2', null,       'Solo Teléfono', null,              '+506 8899-5566', 'Pendiente', now() - interval '1 day');

-- ---- ANTES ----
select public._v('ANTES', 'no existe la tabla de contactos', to_regclass('public.crm_leads') is null);
select public._t('ANTES', 'la función pública no existe', 'anon', :A,
  $q$ select public.crm_registrar_contacto('X', 'x@correo.cr') $q$, 'does not exist');

\i supabase/migracion_crm.sql
\i supabase/migracion_crm.sql

-- ---- D1 · lo que ya existía se trae al CRM (una sola vez) ----
select public._v('D1', 'se trajeron 6 contactos (sin personal, sin anonimizados, sin pedidos devueltos, sin chats sin correo)',
  (select count(*) from public.crm_leads) = 6, (select string_agg(coalesce(email, telefono), ',') from public.crm_leads));
select public._v('D1', 'Gina (compró sin cuenta): entra solo por su teléfono, sin el correo inventado del checkout',
  exists (select 1 from public.crm_leads where telefono_norm = '83001234' and email is null and cliente_id = 'cp-fab')
  and not exists (select 1 from public.crm_leads where email_norm = 'ginamora@correo.cr'));
select public._v('D1', 'Ana: en conversación (el soporte respondió), con su provincia, teléfono y ficha',
  exists (select 1 from public.crm_leads where email_norm = 'ana@correo.cr' and etapa = 'conversacion' and provincia = 'Heredia'
          and telefono like '%8888-1111%' and cliente_id = 'cp-ana' and canal = 'chat_web'));
select public._v('D1', 'Beto: solo una nota interna de soporte → sigue como prospecto nuevo',
  exists (select 1 from public.crm_leads where email_norm = 'beto@correo.cr' and etapa = 'nuevo'));
select public._v('D1', 'Carla: venta cerrada, con el resumen de sus 2 pedidos',
  exists (select 1 from public.crm_leads l join public.crm_eventos e on e.lead_id = l.id
           where l.email_norm = 'carla@correo.cr' and l.etapa = 'cerrado' and e.resumen like '2 pedidos%'));
select public._v('D1', 'Elena (taller, equipo listo): pendiente de pago',
  exists (select 1 from public.crm_leads where email_norm = 'elena@correo.cr' and etapa = 'pago_pendiente' and canal = 'taller'));
select public._v('D1', 'quien dejó solo el teléfono también es un contacto (sin correo, por su teléfono)',
  exists (select 1 from public.crm_leads where email is null and telefono_norm = '88995566' and etapa = 'conversacion'));
select public._v('D1', 'el personal y las cuentas anonimizadas no son contactos',
  not exists (select 1 from public.crm_leads where email_norm in ('empleado@technoverse.cr', 'dani@correo.cr') or email_norm like 'anonimo-%'));
select public._v('D1', 'cada contacto tiene su evento de creación', not exists (select 1 from public.crm_leads l where not exists (select 1 from public.crm_eventos e where e.lead_id = l.id and e.tipo = 'creado')));
select public._v('D1', 'sin origen: todos «directo»', (select count(distinct fuente) from public.crm_leads) = 1 and (select min(fuente) from public.crm_leads) = 'directo');
select public._v('D1', 'las 6 respuestas rápidas de partida', (select count(*) from public.crm_respuestas_rapidas) = 6);
select public._v('D1', 'aplicar de nuevo no duplica nada', (select count(*) from public.crm_leads) = 6 and (select count(*) from public.crm_respuestas_rapidas) = 6);

-- ---- D2 · quién puede qué ----
select public._t('D2', 'un anónimo no lee contactos', 'anon', :A, $q$ select * from public.crm_leads $q$, 'permission denied');
select public._t('D2', 'ni la línea de tiempo', 'anon', :A, $q$ select * from public.crm_eventos $q$, 'permission denied');
select public._t('D2', 'ni los recordatorios', 'anon', :A, $q$ select * from public.crm_recordatorios $q$, 'permission denied');
select public._t('D2', 'ni las respuestas rápidas', 'anon', :A, $q$ select * from public.crm_respuestas_rapidas $q$, 'permission denied');
select public._t('D2', 'ni los segmentos', 'anon', :A, $q$ select * from public.crm_segmentos $q$, 'permission denied');
select public._t('D2', 'un anónimo no crea contactos directo', 'anon', :A, $q$ insert into public.crm_leads (nombre, email) values ('Mal', 'mal@correo.cr') $q$, 'permission denied');
select public._t('D2', 'un cliente con cuenta ve 0 contactos (la política solo deja al personal)', 'authenticated', :C,
  $q$ select 1 / (case when (select count(*) from public.crm_leads) = 0 then 1 else 0 end) $q$);
select public._t('D2', 'un cliente no crea contactos', 'authenticated', :C, $q$ insert into public.crm_leads (nombre, email) values ('Mal', 'mal2@correo.cr') $q$, 'row-level security');
select id as lead_ana from public.crm_leads where email_norm = 'ana@correo.cr' \gset
select public._t('D2', 'un cliente no escribe en la línea de tiempo', 'authenticated', :C,
  format($q$ insert into public.crm_eventos (lead_id, tipo, resumen) values (%L, 'nota', 'x') $q$, :'lead_ana'), 'row-level security');
select public._t('D2', 'el empleado ve los 6 contactos', 'authenticated', :E,
  $q$ select 1 / (case when (select count(*) from public.crm_leads) = 6 then 1 else 0 end) $q$);
select public._t('D2', 'el empleado NO borra contactos (solo el dueño): no falla pero no borra', 'authenticated', :E,
  $q$ delete from public.crm_leads where email_norm = 'beto@correo.cr' $q$);
select public._v('D2', 'Beto sigue ahí', exists (select 1 from public.crm_leads where email_norm = 'beto@correo.cr'));
select public._t('D2', 'nadie reescribe la línea de tiempo', 'authenticated', :S, $q$ update public.crm_eventos set resumen = 'otra cosa' $q$, 'permission denied');
select public._t('D2', 'a mano solo se anota «nota» o «contacto»', 'authenticated', :E,
  $q$ insert into public.crm_eventos (lead_id, tipo, resumen) select id, 'etapa', 'falso' from public.crm_leads limit 1 $q$, 'row-level security');
select public._t('D2', 'el empleado anota una nota firmando como otra persona', 'authenticated', :E,
  $q$ insert into public.crm_eventos (lead_id, tipo, resumen, autor) select id, 'nota', 'Pidió descuento', 'admin@otro.cr' from public.crm_leads where email_norm = 'beto@correo.cr' $q$);
select public._v('D2', 'la nota quedó firmada por quien la escribió, no por quien dijo ser',
  exists (select 1 from public.crm_eventos where resumen = 'Pidió descuento' and autor = 'empleado@technoverse.cr'));
select public._t('D2', 'anónimo no ejecuta la captación interna', 'anon', :A, $q$ select public.crm_capturar('X', 'x@correo.cr', null, 'manual') $q$, 'permission denied');
select public._t('D2', 'ni un cliente con cuenta', 'authenticated', :C, $q$ select public.crm_capturar('X', 'x@correo.cr', null, 'manual') $q$, 'permission denied');
select public._t('D2', 'las funciones de disparador no se exponen', 'authenticated', :C, $q$ select public.crm_trg_pedido() $q$, 'permission denied');
select public._v('D2', 'toda función SECURITY DEFINER del CRM fija su search_path',
  not exists (select 1 from pg_proc p where p.proname like 'crm\_%' and p.pronamespace = 'public'::regnamespace and p.prosecdef
                and not coalesce(p.proconfig @> array['search_path=public'], false)));

-- ---- D3 · captación automática (chat, mensajes, clientes, pedidos, taller) ----
select public._t('D3', 'un anónimo abre una conversación en el chat', 'anon', :A,
  $q$ insert into public.chat_conversations (id, customer_name, customer_email, customer_token) values ('CONV-CRM1', 'Fabio', 'Fabio@Correo.cr', gen_random_uuid()) $q$, 'ok', '{"x-forwarded-for":"10.1.0.1"}');
select public._v('D3', 'Fabio quedó como prospecto nuevo del chat', exists (select 1 from public.crm_leads where email_norm = 'fabio@correo.cr' and etapa = 'nuevo' and canal = 'chat_web' and conversacion_id = 'CONV-CRM1'));
select public._t('D3', 'Fabio escribe un mensaje', 'anon', :A,
  $q$ insert into public.chat_messages (id, conversation_id, sender, text) values ('crm-m1', 'CONV-CRM1', 'customer', 'Hola, ¿tienen cargadores?') $q$, 'ok', '{"x-forwarded-for":"10.1.0.1"}');
select public._v('D3', 'su contador de mensajes sube', (select mensajes from public.crm_leads where email_norm = 'fabio@correo.cr') = 1);
select public._t('D3', 'una nota interna del personal no lo mueve de etapa', 'authenticated', :E,
  $q$ insert into public.chat_messages (id, conversation_id, sender, text, is_internal_note) values ('crm-m2', 'CONV-CRM1', 'support', 'nota', true) $q$);
select public._v('D3', 'sigue como nuevo', (select etapa from public.crm_leads where email_norm = 'fabio@correo.cr') = 'nuevo');
select public._t('D3', 'el personal le responde', 'authenticated', :E,
  $q$ insert into public.chat_messages (id, conversation_id, sender, text) values ('crm-m3', 'CONV-CRM1', 'support', 'Hola Fabio, sí tenemos') $q$);
select public._v('D3', 'pasa a «En conversación»', (select etapa from public.crm_leads where email_norm = 'fabio@correo.cr') = 'conversacion');
select public._v('D3', 'y el cambio lo anotó el sistema', exists (select 1 from public.crm_eventos e join public.crm_leads l on l.id = e.lead_id
  where l.email_norm = 'fabio@correo.cr' and e.tipo = 'etapa' and e.autor = 'sistema' and e.resumen like '%En conversación%'));
select public._t('D3', 'un chat con el correo del personal no crea contacto', 'anon', :A,
  $q$ insert into public.chat_conversations (id, customer_name, customer_email, customer_token) values ('CONV-CRM2', 'Probando', 'Empleado@Technoverse.cr', gen_random_uuid()) $q$, 'ok', '{"x-forwarded-for":"10.1.0.2"}');
select public._v('D3', '…no hay contacto del personal', not exists (select 1 from public.crm_leads where email_norm = 'empleado@technoverse.cr'));

insert into public.client_profiles (id, name, email, phone, province) values ('cp-hugo', 'Hugo Salas', 'hugo@correo.cr', null, null);
select public._v('D3', 'registrarse como cliente crea el contacto', exists (select 1 from public.crm_leads where email_norm = 'hugo@correo.cr' and canal = 'registro' and cliente_id = 'cp-hugo'));
update public.client_profiles set phone = '+506 8123-4567', province = 'Cartago' where id = 'cp-hugo';
select public._v('D3', 'al completar su ficha se rellena su teléfono y provincia', exists (select 1 from public.crm_leads where email_norm = 'hugo@correo.cr' and telefono_norm = '81234567' and provincia = 'Cartago'));
select public._t('D3', 'un cliente con cuenta hace un pedido', 'authenticated', :C,
  $q$ insert into public.orders (id, customer_id, customer_name, customer_email, total, items) values ('FAC-CRM1', 'cp-c1', 'Cliente Uno', 'cliente@correo.cr', 15000, '[{"p":1}]') $q$);
select public._v('D3', 'el pedido cierra la venta', exists (select 1 from public.crm_leads where email_norm = 'cliente@correo.cr' and etapa = 'cerrado' and canal = 'pedido'));
update public.crm_leads set etapa = 'postventa' where email_norm = 'cliente@correo.cr';
insert into public.orders (id, customer_id, customer_name, customer_email, total, items) values ('FAC-CRM2', 'cp-c1', 'Cliente Uno', 'cliente@correo.cr', 9000, '[{"p":1}]');
select public._v('D3', 'un pedido nuevo no lo regresa de «Postventa»', (select etapa from public.crm_leads where email_norm = 'cliente@correo.cr') = 'postventa');
insert into public.orders (id, customer_id, customer_name, customer_email, total, items, status) values ('NC-CRM1', 'cp-x', 'Devuelto', 'devuelto@correo.cr', 9000, '[{"p":1}]', 'Devuelto');
select public._v('D3', 'un pedido devuelto no crea contacto', not exists (select 1 from public.crm_leads where email_norm = 'devuelto@correo.cr'));

insert into public.repair_orders (id, ticket, customer_name, customer_email, customer_phone, status) values ('GT-CRM1', 'TKT-C1', 'Iris', 'iris@correo.cr', '8555-0001', 'Pendiente');
select public._v('D3', 'un equipo en el taller crea el contacto «en conversación»', exists (select 1 from public.crm_leads where email_norm = 'iris@correo.cr' and etapa = 'conversacion' and canal = 'taller'));
update public.repair_orders set status = 'Cotizada' where id = 'GT-CRM1';
select public._v('D3', 'cotizada → cotización', (select etapa from public.crm_leads where email_norm = 'iris@correo.cr') = 'cotizacion');
update public.repair_orders set status = 'Lista' where id = 'GT-CRM1';
select public._v('D3', 'lista → pendiente de pago', (select etapa from public.crm_leads where email_norm = 'iris@correo.cr') = 'pago_pendiente');
update public.repair_orders set status = 'Entregada' where id = 'GT-CRM1';
select public._v('D3', 'entregada → venta cerrada', (select etapa from public.crm_leads where email_norm = 'iris@correo.cr') = 'cerrado');
update public.repair_orders set status = 'Cancelada' where id = 'GT-CRM1';
select public._v('D3', 'cancelada no mueve la etapa', (select etapa from public.crm_leads where email_norm = 'iris@correo.cr') = 'cerrado');

-- Un fallo del CRM nunca frena lo que lo dispara.
create function public._crm_falla() returns trigger language plpgsql as $$ begin raise exception 'falla a propósito'; end $$;
create trigger _crm_falla before insert on public.crm_leads for each row execute function public._crm_falla();
select public._t('D3', 'aunque el CRM falle, el chat se crea igual', 'anon', :A,
  $q$ insert into public.chat_conversations (id, customer_name, customer_email, customer_token) values ('CONV-CRM3', 'Joel', 'joel@correo.cr', gen_random_uuid()) $q$, 'ok', '{"x-forwarded-for":"10.1.0.3"}');
select public._t('D3', 'aunque el CRM falle, el pedido se crea igual', 'authenticated', :C,
  $q$ insert into public.orders (id, customer_id, customer_name, customer_email, total, items) values ('FAC-CRM3', 'cp-c1', 'Cliente Uno', 'joel2@correo.cr', 5000, '[{"p":1}]') $q$);
select public._v('D3', '…la conversación y el pedido están, y el contacto no', exists (select 1 from public.chat_conversations where id = 'CONV-CRM3')
  and exists (select 1 from public.orders where id = 'FAC-CRM3') and not exists (select 1 from public.crm_leads where email_norm in ('joel@correo.cr', 'joel2@correo.cr')));
drop trigger _crm_falla on public.crm_leads;
drop function public._crm_falla();

-- ---- D4 · la única función pública: de dónde llegó la persona ----
select public._t('D4', 'la tienda registra a Ivan con su origen', 'anon', :A,
  $q$ select public.crm_registrar_contacto('Ivan Rojas', 'Ivan@Correo.cr', '8999-1000', 'tienda_form',
        '{"utm_source":"instagram","utm_medium":"cpc","utm_campaign":"verano","evil":"x","referrer":"l.instagram.com","landing":"/tienda"}'::jsonb, 'Alajuela', 'Cargador USB-C') $q$, 'ok', '{"x-forwarded-for":"10.2.0.1"}');
select public._v('D4', 'Ivan es un contacto nuevo, de la tienda, como prospecto nuevo',
  exists (select 1 from public.crm_leads where email_norm = 'ivan@correo.cr' and etapa = 'nuevo' and canal = 'tienda_form' and provincia = 'Alajuela' and telefono_norm = '89991000'));
select public._v('D4', 'solo quedaron las llaves conocidas del origen', (select not (origen ? 'evil') and origen ? 'utm_campaign' and origen ? 'landing' from public.crm_leads where email_norm = 'ivan@correo.cr'));
select public._v('D4', 'viene de pauta (utm_medium=cpc)', (select fuente from public.crm_leads where email_norm = 'ivan@correo.cr') = 'pauta');
select public._v('D4', 'el interés quedó en su línea de tiempo o en su creación', exists (select 1 from public.crm_eventos e join public.crm_leads l on l.id = e.lead_id where l.email_norm = 'ivan@correo.cr' and e.resumen like '%Cargador USB-C%'));
select public._t('D4', 'vuelve con otros datos: solo se rellena lo que faltaba', 'anon', :A,
  $q$ select public.crm_registrar_contacto('Otro Nombre', 'ivan@correo.cr', '8000-0000', 'chat_web', '{"utm_source":"google","referrer":"google.com"}'::jsonb, 'Limón') $q$, 'ok', '{"x-forwarded-for":"10.2.0.1"}');
select public._v('D4', 'no pisa nombre, teléfono, provincia ni origen', exists (select 1 from public.crm_leads
  where email_norm = 'ivan@correo.cr' and nombre = 'Ivan Rojas' and telefono_norm = '89991000' and provincia = 'Alajuela' and fuente = 'pauta'));
select public._t('D4', 'desde la tienda no se puede adelantar una etapa', 'anon', :A,
  $q$ select public.crm_registrar_contacto('Fabio', 'fabio@correo.cr', null, 'registro', '{}'::jsonb) $q$, 'ok', '{"x-forwarded-for":"10.2.0.1"}');
select public._v('D4', 'Fabio sigue donde lo dejó el personal', (select etapa from public.crm_leads where email_norm = 'fabio@correo.cr') = 'conversacion');
select public._t('D4', 'un canal inventado (por ejemplo «pedido») no hace nada y no da error', 'anon', :A,
  $q$ select public.crm_registrar_contacto('Falso', 'falso@correo.cr', null, 'pedido') $q$, 'ok', '{"x-forwarded-for":"10.2.0.1"}');
select public._t('D4', 'un correo inválido tampoco', 'anon', :A, $q$ select public.crm_registrar_contacto('Falso', 'esto no es un correo', null, 'chat_web') $q$, 'ok', '{"x-forwarded-for":"10.2.0.1"}');
select public._t('D4', 'sin correo ni teléfono tampoco', 'anon', :A, $q$ select public.crm_registrar_contacto('Nadie', null, null, 'chat_web') $q$, 'ok', '{"x-forwarded-for":"10.2.0.1"}');
select public._t('D4', 'el correo del personal tampoco', 'anon', :A, $q$ select public.crm_registrar_contacto('Staff', 'Empleado@technoverse.cr', null, 'chat_web') $q$, 'ok', '{"x-forwarded-for":"10.2.0.1"}');
select public._t('D4', 'ni el de una cuenta anonimizada', 'anon', :A, $q$ select public.crm_registrar_contacto('Olvido', 'anonimo-zzz@technoverse.com', null, 'chat_web') $q$, 'ok', '{"x-forwarded-for":"10.2.0.1"}');
select public._v('D4', 'ninguno de esos creó contacto', not exists (select 1 from public.crm_leads where email_norm in ('falso@correo.cr', 'empleado@technoverse.cr') or email_norm like 'anonimo-%' or nombre in ('Nadie', 'Falso')));
select public._t('D4', 'textos larguísimos se recortan, no se rechazan', 'anon', :A,
  $q$ select public.crm_registrar_contacto(repeat('N', 400), 'largo@correo.cr', null, 'chat_web', jsonb_build_object('utm_source', repeat('u', 500)), 'Marte') $q$, 'ok', '{"x-forwarded-for":"10.2.0.2"}');
select public._v('D4', 'nombre a 120, origen a 120 y provincia inválida descartada', exists (select 1 from public.crm_leads
  where email_norm = 'largo@correo.cr' and char_length(nombre) = 120 and char_length(origen ->> 'utm_source') = 120 and provincia is null));
select public._t('D4', 'Gina compra: el checkout manda su correo REAL y su teléfono', 'anon', :A,
  $q$ select public.crm_registrar_contacto('Gina Mora', 'Gina@Real.cr', '8300 1234', 'tienda_form', '{"utm_source":"google","referrer":"google.com"}'::jsonb, 'Cartago') $q$, 'ok', '{"x-forwarded-for":"10.2.0.3"}');
select public._v('D4', '…se une a su ficha del checkout (mismo teléfono): un solo contacto, ahora con su correo, provincia y origen',
  (select count(*) from public.crm_leads where telefono_norm = '83001234' or email_norm = 'gina@real.cr') = 1
  and exists (select 1 from public.crm_leads where telefono_norm = '83001234' and email_norm = 'gina@real.cr' and provincia = 'Cartago' and fuente = 'busqueda' and cliente_id = 'cp-fab'));
select public._t('D4', 'su pedido (con ese correo real) la cierra como venta en el mismo contacto', 'authenticated', :C,
  $q$ insert into public.orders (id, customer_id, customer_name, customer_email, total, items) values ('FAC-CRM-G', 'cp-fab', 'Gina Mora', 'gina@real.cr', 21000, '[{"p":1}]') $q$);
select public._v('D4', '…sigue siendo un contacto y está en «Venta cerrada»', (select count(*) from public.crm_leads where telefono_norm = '83001234' or email_norm = 'gina@real.cr') = 1
  and exists (select 1 from public.crm_leads where email_norm = 'gina@real.cr' and etapa = 'cerrado'));
select public._t('D4', 'solo con teléfono también sirve', 'anon', :A, $q$ select public.crm_registrar_contacto('Paola', null, '+506 8444-7777', 'tienda_form') $q$, 'ok', '{"x-forwarded-for":"10.2.0.2"}');
select public._v('D4', 'Paola quedó por su teléfono', exists (select 1 from public.crm_leads where email is null and telefono_norm = '84447777'));
select public._t('D4', 'otra persona con el mismo teléfono (distinto formato) es la misma', 'anon', :A, $q$ select public.crm_registrar_contacto('Paola M.', 'paola@correo.cr', '8444 7777', 'chat_web') $q$, 'ok', '{"x-forwarded-for":"10.2.0.2"}');
select public._v('D4', '…se unió a Paola: un solo contacto y ahora con correo', (select count(*) from public.crm_leads where telefono_norm = '84447777') = 1
  and exists (select 1 from public.crm_leads where telefono_norm = '84447777' and email_norm = 'paola@correo.cr'));

delete from public.limites_uso;
select public._t('D4', '25 contactos seguidos desde la misma IP no dan error', 'anon', :A,
  $q$ select public.crm_registrar_contacto('Masivo ' || g, 'masivo' || g || '@correo.cr', null, 'chat_web') from generate_series(1, 25) g $q$, 'ok', '{"x-forwarded-for":"10.2.0.99"}');
select public._v('D4', 'solo se aceptaron 20 (el tope de 10 minutos)', (select count(*) from public.crm_leads where email_norm like 'masivo%@correo.cr') = 20);
select public._t('D4', 'otra IP no está topada', 'anon', :A, $q$ select public.crm_registrar_contacto('Libre', 'libre@correo.cr', null, 'chat_web') $q$, 'ok', '{"x-forwarded-for":"10.2.0.98"}');
select public._v('D4', '…y sí entra', exists (select 1 from public.crm_leads where email_norm = 'libre@correo.cr'));

select pg_get_functiondef('public.limitar_uso(text,integer,integer)'::regprocedure) as def_limitar \gset
drop function public.limitar_uso(text, integer, integer);
select public._t('D4', 'sin limitar_uso (blindaje aún sin aplicar) la función sigue funcionando', 'anon', :A,
  $q$ select public.crm_registrar_contacto('Sin Tope', 'sintope@correo.cr', null, 'chat_web') $q$, 'ok', '{"x-forwarded-for":"10.2.0.97"}');
select public._v('D4', '…y registra', exists (select 1 from public.crm_leads where email_norm = 'sintope@correo.cr'));
select :'def_limitar' \gexec
revoke all on function public.limitar_uso(text, integer, integer) from public, anon, authenticated;

-- ---- D5 · embudo, recordatorios y reglas de la ficha ----
select public._t('D5', 'el empleado mueve a Beto a «Cotización»', 'authenticated', :E, $q$ update public.crm_leads set etapa = 'cotizacion' where email_norm = 'beto@correo.cr' $q$);
select public._v('D5', 'queda anotado con su firma y la hora del cambio', exists (select 1 from public.crm_eventos e join public.crm_leads l on l.id = e.lead_id
  where l.email_norm = 'beto@correo.cr' and e.tipo = 'etapa' and e.autor = 'empleado@technoverse.cr' and e.resumen = 'De «Nuevo prospecto» a «Cotización / interés»')
  and (select etapa_cambiada_en from public.crm_leads where email_norm = 'beto@correo.cr') > now() - interval '1 minute');
select public._t('D5', 'una etapa inventada se rechaza', 'authenticated', :E, $q$ update public.crm_leads set etapa = 'ganado' where email_norm = 'beto@correo.cr' $q$, 'crm_leads_etapa_check');
select public._t('D5', 'el empleado agenda un recordatorio', 'authenticated', :E,
  $q$ insert into public.crm_recordatorios (lead_id, vence, texto, creado_por) select id, now() + interval '2 days', 'Llamar para cerrar', 'otro@x.cr' from public.crm_leads where email_norm = 'beto@correo.cr' $q$);
select public._t('D5', 'y otro más cercano', 'authenticated', :E,
  $q$ insert into public.crm_recordatorios (lead_id, vence, texto) select id, now() + interval '1 day', 'Enviar cotización' from public.crm_leads where email_norm = 'beto@correo.cr' $q$);
select public._v('D5', 'el próximo contacto es el más cercano', (select proximo_contacto from public.crm_leads where email_norm = 'beto@correo.cr')
  between now() + interval '23 hours' and now() + interval '25 hours');
select public._v('D5', 'el recordatorio quedó firmado por quien lo creó', exists (select 1 from public.crm_recordatorios where texto = 'Llamar para cerrar' and creado_por = 'empleado@technoverse.cr'));
select public._t('D5', 'se marca como hecho el más cercano', 'authenticated', :E, $q$ update public.crm_recordatorios set hecho = true where texto = 'Enviar cotización' $q$);
select public._v('D5', 'ahora el próximo es el otro, y el hecho tiene su hora', (select proximo_contacto from public.crm_leads where email_norm = 'beto@correo.cr')
  between now() + interval '47 hours' and now() + interval '49 hours' and (select hecho_en from public.crm_recordatorios where texto = 'Enviar cotización') is not null);
select public._t('D5', 'sin recordatorios pendientes no hay próximo contacto', 'authenticated', :E, $q$ update public.crm_recordatorios set hecho = true $q$);
select public._v('D5', '…queda vacío', (select proximo_contacto from public.crm_leads where email_norm = 'beto@correo.cr') is null);
select public._v('D5', 'y todo quedó en la línea de tiempo', (select count(*) from public.crm_eventos e join public.crm_leads l on l.id = e.lead_id where l.email_norm = 'beto@correo.cr' and e.tipo = 'recordatorio') >= 4);
select public._t('D5', 'un recordatorio sin texto', 'authenticated', :E, $q$ insert into public.crm_recordatorios (lead_id, vence, texto) select id, now(), '   ' from public.crm_leads limit 1 $q$, 'crm_recordatorios_texto_check');
select public._t('D5', 'un contacto hecho a mano cuenta como interacción', 'authenticated', :E,
  $q$ insert into public.crm_eventos (lead_id, tipo, resumen, created_at) select id, 'contacto', 'Lo llamé: pidió esperar', now() from public.crm_leads where email_norm = 'elena@correo.cr' $q$);
select public._v('D5', '…y sube su última interacción', (select ultima_interaccion from public.crm_leads where email_norm = 'elena@correo.cr') > now() - interval '1 minute');
select public._t('D5', 'el personal crea un contacto a mano', 'authenticated', :E,
  $q$ insert into public.crm_leads (nombre, email, telefono, canal, etiquetas, valor_estimado, responsable) values ('Manual Uno', 'manual1@correo.cr', '8100-0001', 'manual', array['mayorista', 'vip'], 150000, 'empleado@technoverse.cr') $q$);
select public._v('D5', 'firmado por quien lo creó', (select creado_por from public.crm_leads where email_norm = 'manual1@correo.cr') = 'empleado@technoverse.cr');
select public._t('D5', 'mismo correo con otras mayúsculas: duplicado', 'authenticated', :E, $q$ insert into public.crm_leads (nombre, email) values ('Dup', 'MANUAL1@correo.cr') $q$, 'duplicate key');
select public._t('D5', 'mismo teléfono con otro formato: duplicado', 'authenticated', :E, $q$ insert into public.crm_leads (nombre, telefono) values ('Dup', '+506 8100 0001') $q$, 'duplicate key');
select public._t('D5', 'sin correo ni teléfono', 'authenticated', :E, $q$ insert into public.crm_leads (nombre) values ('Nadie') $q$, 'crm_leads_tiene_contacto');
select public._t('D5', 'correo con forma inválida', 'authenticated', :E, $q$ insert into public.crm_leads (nombre, email) values ('X', 'sin-arroba') $q$, 'crm_leads_email_check');
select public._t('D5', '21 etiquetas', 'authenticated', :E, $q$ insert into public.crm_leads (nombre, email, etiquetas) values ('X', 'et21@correo.cr', (select array_agg('t' || g) from generate_series(1, 21) g)) $q$, 'crm_leads_etiquetas_check');
select public._t('D5', 'una etiqueta de 31 letras', 'authenticated', :E, $q$ insert into public.crm_leads (nombre, email, etiquetas) values ('X', 'et31@correo.cr', array[repeat('e', 31)]) $q$, 'crm_leads_etiquetas_check');
select public._t('D5', 'valor negativo', 'authenticated', :E, $q$ insert into public.crm_leads (nombre, email, valor_estimado) values ('X', 'neg@correo.cr', -1) $q$, 'crm_leads_valor_estimado_check');
select public._t('D5', 'provincia inventada', 'authenticated', :E, $q$ insert into public.crm_leads (nombre, email, provincia) values ('X', 'prov@correo.cr', 'Atlantis') $q$, 'crm_leads_provincia_check');
select public._t('D5', 'respuesta rápida nueva', 'authenticated', :E, $q$ insert into public.crm_respuestas_rapidas (atajo, titulo, texto) values ('horario', 'Horario', 'Atendemos de lunes a sábado.') $q$);
select public._t('D5', 'atajo repetido', 'authenticated', :E, $q$ insert into public.crm_respuestas_rapidas (atajo, titulo, texto) values ('horario', 'Otra', 'x') $q$, 'duplicate key');
select public._t('D5', 'atajo con mayúsculas o espacios', 'authenticated', :E, $q$ insert into public.crm_respuestas_rapidas (atajo, titulo, texto) values ('Hola Mundo', 'x', 'x') $q$, 'crm_respuestas_rapidas_atajo_check');
select public._t('D5', 'un segmento guardado', 'authenticated', :E, $q$ insert into public.crm_segmentos (nombre, filtro) values ('Sin compra en 60 días', '{"etapa":["cerrado"],"inactivoDias":60}'::jsonb) $q$);
select public._t('D5', 'un segmento cuyo filtro no es un objeto', 'authenticated', :E, $q$ insert into public.crm_segmentos (nombre, filtro) values ('Malo', '[1,2]'::jsonb) $q$, 'crm_segmentos_filtro_check');
select public._t('D5', 'un cliente con cuenta no ve los segmentos', 'authenticated', :C, $q$ select 1 / (case when (select count(*) from public.crm_segmentos) = 0 then 1 else 0 end) $q$);

-- ---- D6 · derecho al olvido y borrado en cascada ----
select public._v('D6', 'Ana tiene ficha, eventos y está en el CRM', exists (select 1 from public.crm_leads where email_norm = 'ana@correo.cr') and (select count(*) from public.crm_eventos e join public.crm_leads l on l.id = e.lead_id where l.email_norm = 'ana@correo.cr') >= 1);
update public.client_profiles set name = 'CLIENTE ANÓNIMO (DERECHO AL OLVIDO)', email = 'anonimo-cp-ana@technoverse.com', phone = '+506 0000 0000' where id = 'cp-ana';
select public._v('D6', 'al anonimizar su ficha, su contacto del CRM se borra (con su línea de tiempo)', not exists (select 1 from public.crm_leads where cliente_id = 'cp-ana' or email_norm = 'ana@correo.cr')
  and not exists (select 1 from public.crm_eventos e where not exists (select 1 from public.crm_leads l where l.id = e.lead_id)));
select public._t('D6', 'un mensaje nuevo del chat de Ana no la vuelve a crear', 'anon', :A,
  $q$ insert into public.chat_messages (id, conversation_id, sender, text) values ('crm-m9', 'CONV-A', 'customer', 'Sigo aquí') $q$, 'ok', '{"x-forwarded-for":"10.3.0.1"}');
select public._v('D6', '…sigue sin contacto', not exists (select 1 from public.crm_leads where email_norm = 'ana@correo.cr'));
select public._t('D6', 'el dueño borra un contacto', 'authenticated', :S, $q$ delete from public.crm_leads where email_norm = 'beto@correo.cr' $q$);
select public._v('D6', '…y con él se van sus eventos y recordatorios', not exists (select 1 from public.crm_leads where email_norm = 'beto@correo.cr')
  and not exists (select 1 from public.crm_recordatorios r where not exists (select 1 from public.crm_leads l where l.id = r.lead_id)));

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
