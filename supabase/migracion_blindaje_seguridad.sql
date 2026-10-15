-- =====================================================================
-- BLINDAJE DE SEGURIDAD · 2026-10-15
-- =====================================================================
-- QUÉ CIERRA. Auditoría de lo que hoy puede hacer CUALQUIER visitante (sin sesión) o
-- cualquier cliente con cuenta, contra la base real:
--
--   1. Cualquiera podía BORRAR telemetría: `purgar_huellas()` y `purgar_retos_webauthn()`
--      eran ejecutables por el rol anónimo. Nadie las llama (ni el panel ni un cron).
--   2. Cualquiera podía FABRICAR o ALTERAR comprobantes: `issue_invoice()` no comprobaba
--      que los montos cuadraran ni que el correo fuera el de la orden, y `set_invoice_pdf()` dejaba
--      cambiar el enlace del PDF de CUALQUIER factura (un enlace de phishing en una factura
--      real). Y el bucket `invoices` aceptaba subir cualquier archivo, de cualquier tamaño.
--   3. Cualquiera podía VACIAR el catálogo: `adjust_stock()` descontaba existencias a un
--      visitante sin pedido ni límite (y al llegar a 0 el producto se archiva solo).
--   4. Cualquiera podía QUEMAR cupones adivinando códigos (`redeem_coupon`, sin límite).
--   5. Cualquiera podía escribir en el chat como «soporte» o como nota interna: la política
--      de inserción era `with check (true)`.
--   6. El bucket `marketing` (banners y piezas de la tienda) lo podía escribir y BORRAR
--      cualquier cliente con cuenta: la política no pedía ser personal.
--   7. Un cliente podía ponerse saldo (`client_profiles.balance`) o reactivarse tras un baneo
--      (`activo`) editando su propia ficha.
--   8. Escrituras anónimas sin tope (pedidos, perfiles, chats, huellas, ubicaciones) y
--      adjuntos de chat sin cupo por conversación.
--   9. Funciones «solo personal» con la puerta abierta a anónimos (validan por dentro, pero
--      no tenían por qué ser invocables desde afuera) y 5 funciones de disparador expuestas.
--  10. Higiene: `search_path` fijo en 4 funciones, políticas «nadie» explícitas en las 4
--      tablas que tenían RLS sin ninguna política, y un error de `admin_reset_security_pin`
--      (buscaba el rol «Dueño», que ya no existe: el restablecimiento nunca encontraba cuenta).
--
-- QUÉ NO CAMBIA. Nada de lo que hace el PERSONAL (superadmin, admin, empleado) ni el SERVIDOR
-- (service_role, cron, el editor SQL): todos los límites y validaciones valen solo para
-- `es_visitante()` = quien llega por la API pública sin ser del personal. El flujo de compra
-- de un cliente tampoco cambia: mismos pasos, mismas llamadas; solo se rechaza lo que ningún
-- cliente de verdad haría (ver cada bloque).
--
-- CÓMO SE APLICA. Entera, de una vez, con el editor SQL o `apply_migration`. Es idempotente
-- (se puede correr dos veces). Es compatible con TODOS los clientes ya desplegados (web, APK y
-- OTA viejos), no hace falta esperar a ninguna publicación. La parte de `app_settings`
-- (webhook de Instagram) va APARTE, en `migracion_ajustes_privados.sql`, porque sí exige que
-- el cliente nuevo ya esté repartido.
--
-- CÓMO SE DESHACE. Al pie, bloque «REVERTIR».
--
-- PROBADA en un Postgres 16 local con las funciones, políticas y tablas reales (réplica) y con
-- los roles anon / authenticated / service_role: ver supabase/pruebas/blindaje_seguridad.sql.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. UTILIDADES: quién es «visitante», tope de uso por rato y bitácora
-- ---------------------------------------------------------------------

-- Bitácora mínima de seguridad (solo la leen los administradores; la escriben las funciones).
create table if not exists public.registro_seguridad (
  id      bigserial primary key,
  ts      timestamptz not null default now(),
  evento  text        not null,
  quien   text,
  detalle jsonb       not null default '{}'::jsonb
);
create index if not exists registro_seguridad_ts_idx on public.registro_seguridad (ts desc);
alter table public.registro_seguridad enable row level security;
revoke all on public.registro_seguridad from anon, authenticated;
revoke all on sequence public.registro_seguridad_id_seq from anon, authenticated;
drop policy if exists registro_seguridad_leer on public.registro_seguridad;
create policy registro_seguridad_leer on public.registro_seguridad
  for select to authenticated using (public.is_superadmin());
grant select on public.registro_seguridad to authenticated;

-- Contador de uso por persona (o por IP) y ventana de tiempo.
create table if not exists public.limites_uso (
  clave   text        not null,
  ventana timestamptz not null,
  n       integer     not null default 1,
  primary key (clave, ventana)
);
alter table public.limites_uso enable row level security;
revoke all on public.limites_uso from anon, authenticated;
drop policy if exists nadie on public.limites_uso;
create policy nadie on public.limites_uso for all to anon, authenticated using (false) with check (false);

-- Quién emitió cada comprobante pedido por un visitante (su id de usuario o, sin sesión, su IP):
-- solo esa misma persona puede adjuntarle el PDF. Se borra solo lo de hace más de un día.
create table if not exists public.comprobantes_emisor (
  invoice_id text        primary key,
  quien      text        not null,
  creado     timestamptz not null default now()
);
alter table public.comprobantes_emisor enable row level security;
revoke all on public.comprobantes_emisor from anon, authenticated;
drop policy if exists nadie on public.comprobantes_emisor;
create policy nadie on public.comprobantes_emisor for all to anon, authenticated using (false) with check (false);

-- ¿Quien llama es un VISITANTE? Verdadero para quien entra por la API pública (rol anon o
-- authenticated) sin ser del personal. Falso para el servidor: service_role, el cron y el
-- editor SQL no tienen esos roles, así que nunca quedan limitados.
create or replace function public.es_visitante()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(nullif(current_setting('role', true), ''), 'none') in ('anon', 'authenticated')
     and not coalesce(public.is_staff(), false);
$$;

-- Tope de usos por rato: `limitar_uso('clave', 30, 600)` = como mucho 30 veces cada 10 minutos
-- por persona (su id de usuario) o, si no ha iniciado sesión, por IP. Al pasarse lanza un error
-- con un texto que el cliente ya sabe mostrar. Las llamadas que FALLAN por otra razón no cuentan
-- (la transacción las deshace): el tope castiga lo que se logra, que es lo que importa.
create or replace function public.limitar_uso(p_clave text, p_max integer, p_segundos integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seg     integer     := greatest(coalesce(p_segundos, 60), 1);
  v_ventana timestamptz := to_timestamp(floor(extract(epoch from now()) / v_seg) * v_seg);
  v_quien   text        := coalesce(auth.uid()::text, public.ip_del_solicitante(), 'anonimo');
  v_n       integer;
begin
  insert into public.limites_uso as l (clave, ventana, n)
  values (p_clave || ':' || v_quien, v_ventana, 1)
  on conflict (clave, ventana) do update set n = l.n + 1
  returning l.n into v_n;

  if v_n > p_max then
    raise exception 'Demasiados intentos seguidos. Espere unos minutos e intente de nuevo.'
      using errcode = 'P0001', detail = p_clave;
  end if;

  -- Limpieza oportunista (1 de cada 100 llamadas): lo de hace más de un día ya no sirve.
  if random() < 0.01 then
    delete from public.limites_uso where ventana < now() - interval '1 day';
  end if;
end;
$$;

revoke all on function public.es_visitante() from public, anon, authenticated;
revoke all on function public.limitar_uso(text, integer, integer) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 1. MANTENIMIENTO Y FUNCIONES «SOLO PERSONAL»
-- ---------------------------------------------------------------------

-- 1.1 Borrados de mantenimiento: solo el servidor (cron / Edge con service_role).
revoke execute on function public.purgar_huellas(integer)     from public, anon, authenticated;
revoke execute on function public.purgar_retos_webauthn()     from public, anon, authenticated;
grant  execute on function public.purgar_huellas(integer)     to service_role;
grant  execute on function public.purgar_retos_webauthn()     to service_role;

-- 1.2 Los conteos del historial son para el personal (el panel de Seguridad los pide ya con sesión).
create or replace function public.conteo_historial()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Solo el personal puede ver estos conteos.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'accesos_total',      (select count(*) from public.login_audit_logs),
    'accesos_90',         (select count(*) from public.login_audit_logs where ocurrido_en < now() - interval '90 days'),
    'accesos_30',         (select count(*) from public.login_audit_logs where ocurrido_en < now() - interval '30 days'),
    'accesos_mas_viejo',  (select min(ocurrido_en) from public.login_audit_logs),
    'bitacora_total',     (select count(*) from public.audit_logs),
    'bitacora_90',        (select count(*) from public.audit_logs where created_at < now() - interval '90 days'),
    'huellas_total',      (select count(*) from public.visitor_fingerprints)
  );
end;
$$;
revoke execute on function public.conteo_historial() from public, anon;

-- 1.3 Funciones que el panel llama CON sesión y que ya validan por dentro (superadmin o
--     personal): se les quita también la puerta de entrada anónima. Un visitante ahora recibe
--     «permiso denegado» en vez de llegar a la validación.
revoke execute on function public.banear_cliente_total(text, text, boolean) from public, anon;
revoke execute on function public.banear_dispositivo(text, text)            from public, anon;
revoke execute on function public.levantar_baneo_cliente(text)              from public, anon;
revoke execute on function public.levantar_dispositivo(text)                from public, anon;
revoke execute on function public.purgar_bitacora(integer)                  from public, anon;
revoke execute on function public.purgar_chats()                            from public, anon;
revoke execute on function public.purgar_conversacion(text)                 from public, anon;
revoke execute on function public.borrar_mensaje_chat(text)                 from public, anon;
revoke execute on function public.admin_list_duenos()                       from public, anon;
revoke execute on function public.admin_reset_security_pin(uuid)            from public, anon;
revoke execute on function public.dlp_fijar(uuid, boolean, boolean)         from public, anon;
revoke execute on function public.dlp_listar()                              from public, anon;
revoke execute on function public.visitante_mirar(text, boolean)            from public, anon;

-- 1.4 Funciones de DISPARADOR (RETURNS trigger): las ejecuta la base al guardar una fila, no
--     necesitan ser invocables por nadie. (Postgres no revisa EXECUTE al disparar el trigger.)
revoke execute on function public.archivar_producto_agotado()   from public, anon, authenticated;
revoke execute on function public.forzar_rol_inmutable()        from public, anon, authenticated;
revoke execute on function public.proteger_columnas_pin()       from public, anon, authenticated;
revoke execute on function public.proteger_supervision_watch()  from public, anon, authenticated;
revoke execute on function public.sellar_dlp_whitelist()        from public, anon, authenticated;

-- 1.5 Error de fondo: «restablecer el PIN de otra cuenta» buscaba el rol 'Dueño', que ya no
--     existe (ver admin_list_duenos, que lista role = 'admin'): siempre respondía «Cuenta no
--     encontrada». Misma función, el filtro correcto.
create or replace function public.admin_reset_security_pin(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.es_admin_supremo() then
    raise exception 'Solo el administrador supremo puede restablecer el PIN de otra cuenta.';
  end if;
  update public.profiles
     set security_pin_hash = null,
         security_pin_set_at = null,
         security_pin_fails = 0,
         security_pin_locked_until = null
   where id = p_user_id
     and role = 'admin';
  if not found then
    raise exception 'Cuenta no encontrada.';
  end if;
end;
$$;
revoke execute on function public.admin_reset_security_pin(uuid) from public, anon;


-- ---------------------------------------------------------------------
-- 2. FACTURACIÓN: solo se factura lo que corresponde
-- ---------------------------------------------------------------------

-- 2.1 El PDF de un comprobante. El personal puede cambiarlo siempre. Un cliente solo puede dejar
--     el PDF de un comprobante que ÉL MISMO emitió hace menos de 30 minutos y que todavía no lo tiene,
--     y solo si apunta al archivo de ESE comprobante en el bucket `invoices`: ya no se puede desviar
--     el enlace de una factura (los números son consecutivos, o sea adivinables) a un sitio ajeno.
create or replace function public.set_invoice_pdf(p_invoice_id text, p_pdf_url text, p_qr_data text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pdf_actual text;
  v_creado     timestamptz;
begin
  select i.pdf_url, i.created_at into v_pdf_actual, v_creado from public.invoices i where i.id = p_invoice_id;
  if not found then
    raise exception 'Comprobante no encontrado.';
  end if;

  if length(coalesce(p_pdf_url, '')) > 500 or length(coalesce(p_qr_data, '')) > 2000 then
    raise exception 'Los datos del comprobante son demasiado largos.';
  end if;

  if public.es_visitante() then
    if coalesce(v_pdf_actual, '') <> '' then
      raise exception 'Este comprobante ya tiene su PDF.';
    end if;
    if v_creado < now() - interval '30 minutes' then
      raise exception 'El plazo para adjuntar el PDF de este comprobante venció.';
    end if;
    if not exists (
      select 1 from public.comprobantes_emisor e
       where e.invoice_id = p_invoice_id
         and e.quien = coalesce(auth.uid()::text, public.ip_del_solicitante(), 'anonimo')
    ) then
      raise exception 'Solo quien emitió el comprobante puede adjuntarle su PDF.';
    end if;
    if p_pdf_url is null
       or p_pdf_url !~ '^https://[A-Za-z0-9.-]+/storage/v1/object/public/invoices/FE-[0-9]{20}(-[a-z0-9]{1,32})?\.pdf$'
       or position(p_invoice_id in p_pdf_url) = 0 then
      raise exception 'La dirección del PDF no es válida.';
    end if;
  end if;

  update public.invoices set pdf_url = p_pdf_url, qr_data = p_qr_data where id = p_invoice_id;
end;
$$;

-- 2.2 Emitir un comprobante. Igual que antes (mismo cuerpo), más lo que faltaba: un cliente solo
--     factura la orden SUYA (el correo del comprobante es el de la orden), con montos que cuadran
--     (total = subtotal + IVA) y razonables, y con un tope de emisiones por rato.
create or replace function public.issue_invoice(
  p_order_id text, p_tipo_doc text, p_customer_identification_type text, p_customer_identification text,
  p_customer_name text, p_customer_email text, p_medio_pago text, p_items jsonb,
  p_subtotal numeric, p_iva_total numeric, p_total numeric, p_garantia_meses smallint default null::smallint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orden public.orders;
  v_cedula_digitos text;
  v_cedula_emisor text;
  v_next_number bigint;
  v_numero_documento text;
  v_consecutivo text;
  v_fecha text;
  v_security_code text;
  v_clave text;
  v_invoice_id text;
begin
  if p_tipo_doc not in ('01','04') then
    raise exception 'Tipo de documento inválido: %', p_tipo_doc;
  end if;
  if p_customer_identification_type not in ('01','02','03','04') then
    raise exception 'Tipo de identificación inválido: %', p_customer_identification_type;
  end if;
  if p_medio_pago not in ('01','02','04') then
    raise exception 'Medio de pago inválido: %', p_medio_pago;
  end if;
  if p_garantia_meses is not null and p_garantia_meses not in (1,3,12) then
    raise exception 'Garantía inválida: % meses. Solo se admiten 1, 3 o 12.', p_garantia_meses;
  end if;

  select * into v_orden from public.orders where id = p_order_id;
  if not found then
    raise exception 'La orden % no existe.', p_order_id;
  end if;
  if exists (select 1 from public.invoices where order_id = p_order_id) then
    raise exception 'La orden % ya tiene un comprobante emitido.', p_order_id;
  end if;

  if public.es_visitante() then
    if lower(btrim(coalesce(v_orden.customer_email, ''))) <> lower(btrim(coalesce(p_customer_email, ''))) then
      raise exception 'El correo del comprobante no coincide con el de la orden.';
    end if;
    if p_subtotal is null or p_iva_total is null or p_total is null
       or p_subtotal < 0 or p_iva_total < 0 or p_total <= 0 or p_total > 100000000
       or abs((p_subtotal + p_iva_total) - p_total) > 1 then
      raise exception 'Los montos del comprobante no son válidos.';
    end if;
    perform public.limitar_uso('emitir_comprobante', 12, 600);
  end if;

  select cedula_juridica into v_cedula_digitos from public.app_settings limit 1;
  if v_cedula_digitos is null or length(regexp_replace(v_cedula_digitos, '\D', '', 'g')) = 0 then
    raise exception 'Configure la identificación del emisor en Ajustes antes de emitir comprobantes.';
  end if;
  v_cedula_digitos := regexp_replace(v_cedula_digitos, '\D', '', 'g');
  v_cedula_emisor := lpad(v_cedula_digitos, 12, '0');

  update public.invoice_counters
    set last_number = last_number + 1
    where tipo_doc = p_tipo_doc
    returning last_number into v_next_number;
  if v_next_number is null then
    raise exception 'No existe contador de consecutivo para el tipo de documento %', p_tipo_doc;
  end if;

  v_numero_documento := lpad(v_next_number::text, 10, '0');
  v_consecutivo := '001' || '00001' || p_tipo_doc || v_numero_documento;
  v_fecha := to_char(now(), 'DDMMYY');
  v_security_code := lpad(floor(random() * 100000000)::text, 8, '0');
  v_clave := '506' || v_fecha || v_cedula_emisor || v_consecutivo || '1' || v_security_code;
  v_invoice_id := 'FE-' || v_consecutivo;

  insert into public.invoices (
    id, order_id, clave, consecutivo, tipo_doc, sucursal, terminal, numero_documento,
    situacion, security_code, emisor_cedula, customer_identification_type, customer_identification,
    customer_name, customer_email, medio_pago, items, subtotal, iva_total, total, garantia_meses
  ) values (
    v_invoice_id, p_order_id, v_clave, v_consecutivo, p_tipo_doc, '001', '00001', v_numero_documento,
    '1', v_security_code, v_cedula_emisor, p_customer_identification_type, coalesce(p_customer_identification, ''),
    p_customer_name, p_customer_email, p_medio_pago, coalesce(p_items, '[]'::jsonb), p_subtotal, p_iva_total, p_total,
    p_garantia_meses
  );

  if public.es_visitante() then
    insert into public.comprobantes_emisor (invoice_id, quien)
    values (v_invoice_id, coalesce(auth.uid()::text, public.ip_del_solicitante(), 'anonimo'));
    if random() < 0.02 then
      delete from public.comprobantes_emisor where creado < now() - interval '1 day';
    end if;
  end if;

  return jsonb_build_object(
    'id', v_invoice_id, 'clave', v_clave, 'consecutivo', v_consecutivo,
    'emisorCedula', v_cedula_emisor,
    'emisorCedulaMostrar', v_cedula_digitos,
    'garantiaMeses', p_garantia_meses,
    'securityCode', v_security_code, 'fecha', v_fecha
  );
end;
$$;


-- ---------------------------------------------------------------------
-- 3. INVENTARIO Y CUPONES: topes para quien no es del personal
-- ---------------------------------------------------------------------

-- Mismo cuerpo de siempre; para un visitante se suma: máximo 40 renglones y 100 unidades por
-- renglón por llamada, y 20 llamadas cada 10 minutos. Cada descuento de un visitante queda en la
-- bitácora de seguridad (así un vaciado de catálogo no pasa inadvertido). El personal (reposición
-- con delta negativo, cobros, taller) no tiene ningún tope.
create or replace function public.adjust_stock(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  v_id text;
  v_delta int;
  v_stock int;
  v_is_staff boolean := is_staff();
  v_visitante boolean := public.es_visitante();
  v_resultado jsonb := '[]'::jsonb;
begin
  if public.solicitante_bloqueado() then
    raise exception 'DEVICE_BLOCKED';
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'INVALID_ITEMS';
  end if;

  if v_visitante then
    if jsonb_array_length(p_items) > 40 then
      raise exception 'FORBIDDEN_BULK';
    end if;
    perform public.limitar_uso('ajustar_stock', 20, 600);
  end if;

  for item in select * from jsonb_array_elements(p_items) loop
    v_id := item->>'id';
    v_delta := (item->>'delta')::int;
    if v_delta is null then
      raise exception 'INVALID_DELTA:%', v_id;
    end if;
    if v_delta < 0 and not v_is_staff then
      raise exception 'FORBIDDEN_RESTOCK:%', v_id;
    end if;
    if v_visitante and v_delta > 100 then
      raise exception 'FORBIDDEN_QTY:%', v_id;
    end if;
    select stock into v_stock from public.products where id = v_id for update;
    if v_stock is null then
      raise exception 'PRODUCT_NOT_FOUND:%', v_id;
    end if;
    if v_delta > 0 and v_stock < v_delta then
      raise exception 'INSUFFICIENT_STOCK:%:%', v_id, v_stock;
    end if;
  end loop;

  for item in select * from jsonb_array_elements(p_items) loop
    v_id := item->>'id';
    v_delta := (item->>'delta')::int;
    update public.products set stock = stock - v_delta where id = v_id
      returning stock into v_stock;
    v_resultado := v_resultado || jsonb_build_object('id', v_id, 'delta', v_delta, 'stock_resultante', v_stock);
  end loop;

  if v_visitante then
    insert into public.registro_seguridad (evento, quien, detalle)
    values ('stock_visitante',
            coalesce(auth.uid()::text, public.ip_del_solicitante(), 'anonimo'),
            jsonb_build_object('items', p_items));
  end if;

  return v_resultado;
end;
$$;

-- Canjear un cupón: igual que antes, más un tope de 8 intentos cada 10 minutos por persona/IP
-- (adivinar códigos para quemarlos deja de ser práctico) y un largo máximo de código.
create or replace function public.redeem_coupon(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.marketing_campaigns;
begin
  if public.es_visitante() then
    if length(coalesce(p_code, '')) > 40 then
      raise exception 'Cupón inválido, ya fue usado, está inactivo o venció.';
    end if;
    perform public.limitar_uso('canjear_cupon', 8, 600);
  end if;

  update public.marketing_campaigns
    set used = used + 1,
        active = false
    where code = upper(trim(p_code))
      and active = true
      and used < usage_limit
      and expires_at > now()
    returning * into v_row;

  if v_row.id is null then
    raise exception 'Cupón inválido, ya fue usado, está inactivo o venció.';
  end if;

  return jsonb_build_object('id', v_row.id, 'code', v_row.code, 'type', v_row.type, 'value', v_row.value);
end;
$$;


-- ---------------------------------------------------------------------
-- 4. CHAT: nadie se hace pasar por soporte
-- ---------------------------------------------------------------------

-- Mensajes. Un visitante solo escribe como «customer» (o «bot», que es el saludo automático que
-- ya arma el navegador del cliente), nunca como «support», ni deja notas internas; el texto tiene
-- un largo máximo; los adjuntos solo pueden apuntar al bucket del chat de ESTE proyecto (no a un
-- sitio ajeno que registre quién abre el chat); y hay un tope de 40 mensajes por minuto.
create or replace function public.chat_messages_validar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ruta constant text := '/storage/v1/object/public/chat-images/';
begin
  if not public.es_visitante() then
    return new;
  end if;

  if coalesce(new.sender, '') not in ('customer', 'bot') then
    raise exception 'No autorizado: un visitante solo escribe como cliente.' using errcode = '42501';
  end if;
  if coalesce(new.is_internal_note, false) then
    raise exception 'No autorizado: las notas internas son del personal.' using errcode = '42501';
  end if;
  if length(coalesce(new.text, '')) > 4000 then
    raise exception 'El mensaje es demasiado largo (máximo 4000 caracteres).';
  end if;
  if (new.image_url is not null and (new.image_url !~ '^https://' or position(v_ruta in new.image_url) = 0))
     or (new.video_url is not null and (new.video_url !~ '^https://' or position(v_ruta in new.video_url) = 0))
     or (new.audio_url is not null and (new.audio_url !~ '^https://' or position(v_ruta in new.audio_url) = 0)) then
    raise exception 'Adjunto no permitido.';
  end if;

  perform public.limitar_uso('chat_mensaje', 40, 60);
  return new;
end;
$$;

drop trigger if exists trg_chat_messages_validar on public.chat_messages;
create trigger trg_chat_messages_validar
  before insert on public.chat_messages
  for each row execute function public.chat_messages_validar();

-- Conversaciones. Un visitante no puede asignársela a un asesor, marcarla «exclusiva del
-- superadmin», ni cambiarle el token: esos campos se ignoran en silencio (no se rompe nada del
-- navegador del cliente, que a veces los reenvía tal cual los vio). Al crearla: nombre y correo con
-- largo máximo y tope de 10 conversaciones nuevas cada 10 minutos.
create or replace function public.chat_conversations_validar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.es_visitante() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.status := 'nuevo';
    new.assigned_admin_email := null;
    new.exclusivo_superadmin := false;
    new.unread_count := least(greatest(coalesce(new.unread_count, 0), 0), 100);
    if length(coalesce(new.customer_name, '')) > 120 or length(coalesce(new.customer_email, '')) > 160 then
      raise exception 'El nombre o el correo son demasiado largos.';
    end if;
    perform public.limitar_uso('crear_chat', 10, 600);
  else
    new.assigned_admin_email := old.assigned_admin_email;
    new.exclusivo_superadmin := old.exclusivo_superadmin;
    new.customer_token := old.customer_token;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_chat_conversations_validar on public.chat_conversations;
create trigger trg_chat_conversations_validar
  before insert or update on public.chat_conversations
  for each row execute function public.chat_conversations_validar();


-- ---------------------------------------------------------------------
-- 5. PEDIDOS Y FICHAS DE CLIENTE
-- ---------------------------------------------------------------------

-- Pedidos de la tienda: entre 1 y 60 artículos, montos razonables, largos máximos y un tope de 8
-- pedidos cada 10 minutos. (Lo que hace el personal —cobros, taller— no pasa por aquí.)
create or replace function public.orders_validar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.es_visitante() then
    return new;
  end if;

  if jsonb_typeof(new.items) is distinct from 'array' or jsonb_array_length(new.items) not between 1 and 60 then
    raise exception 'El pedido debe tener entre 1 y 60 artículos.';
  end if;
  if coalesce(new.total, 0) < 0 or coalesce(new.total, 0) > 100000000
     or coalesce(new.subtotal, 0) < 0 or coalesce(new.subtotal, 0) > 100000000 then
    raise exception 'El monto del pedido no es válido.';
  end if;
  if length(coalesce(new.customer_email, '')) > 160 or length(coalesce(new.customer_name, '')) > 160
     or length(coalesce(new.payment_details::text, '')) > 4000 then
    raise exception 'Algún dato del pedido es demasiado largo.';
  end if;

  perform public.limitar_uso('crear_pedido', 8, 600);
  return new;
end;
$$;

drop trigger if exists trg_orders_validar on public.orders;
create trigger trg_orders_validar
  before insert on public.orders
  for each row execute function public.orders_validar();

-- Fichas de cliente: el saldo (`balance`) y el estado (`activo`) no los fija el cliente. Al crear la
-- ficha arrancan en 0 y «activo»; al editarla se conservan los que ya tenía (un cliente baneado ya
-- no puede reactivarse editando su propia ficha). Largos máximos y tope de 10 fichas nuevas cada
-- 10 minutos. El personal sigue pudiendo cambiar todo.
create or replace function public.client_profiles_validar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.es_visitante() then
    return new;
  end if;

  if length(coalesce(new.name, '')) > 120 or length(coalesce(new.email, '')) > 160
     or length(coalesce(new.phone, '')) > 40 or length(coalesce(new.address_detail, '')) > 400
     or length(coalesce(new.notes, '')) > 1000 or length(coalesce(new.cards_tokenized::text, '')) > 4000 then
    raise exception 'Algún dato de la ficha es demasiado largo.';
  end if;

  if tg_op = 'INSERT' then
    new.balance := 0;
    new.activo := true;
    perform public.limitar_uso('crear_perfil', 10, 600);
  else
    new.balance := old.balance;
    new.activo := old.activo;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_client_profiles_validar on public.client_profiles;
create trigger trg_client_profiles_validar
  before insert or update on public.client_profiles
  for each row execute function public.client_profiles_validar();

-- Telemetría anónima (huellas y ubicaciones): tope por persona/IP para que no se pueda inundar la
-- base. En las huellas, `registrar_huella` ya traga cualquier error, así que al pasarse el tope
-- simplemente no anota (el navegador no ve ningún fallo).
create or replace function public.telemetria_limitar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.es_visitante() then
    perform public.limitar_uso('telemetria_' || tg_table_name, 120, 600);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_visitor_fingerprints_limitar on public.visitor_fingerprints;
create trigger trg_visitor_fingerprints_limitar
  before insert on public.visitor_fingerprints
  for each row execute function public.telemetria_limitar();

drop trigger if exists trg_ubicaciones_limitar on public.ubicaciones_compartidas;
create trigger trg_ubicaciones_limitar
  before insert on public.ubicaciones_compartidas
  for each row execute function public.telemetria_limitar();

revoke all on function public.chat_messages_validar()       from public, anon, authenticated;
revoke all on function public.chat_conversations_validar()  from public, anon, authenticated;
revoke all on function public.orders_validar()              from public, anon, authenticated;
revoke all on function public.client_profiles_validar()     from public, anon, authenticated;
revoke all on function public.telemetria_limitar()          from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 6. ARCHIVOS (storage)
-- ---------------------------------------------------------------------

-- 6.1 Comprobantes: solo se sube un PDF con nombre de comprobante (FE-… 20 dígitos, con sufijo
--     opcional), de hasta 2 MB. Antes: cualquier archivo, de cualquier tamaño, con cualquier nombre.
drop policy if exists invoices_storage_insert_public on storage.objects;
create policy invoices_storage_insert_public on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'invoices' and name ~ '^FE-[0-9]{20}(-[a-z0-9]{1,32})?\.pdf$');

update storage.buckets
   set file_size_limit = 2097152,
       allowed_mime_types = array['application/pdf']
 where id = 'invoices';

-- 6.2 Banners y piezas de marketing: solo el personal escribe (antes, cualquier cliente con cuenta
--     podía subir, reemplazar y borrar). Leer sigue siendo público: es lo que muestra la tienda.
drop policy if exists marketing_staff_insert on storage.objects;
create policy marketing_staff_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'marketing' and public.is_staff());

drop policy if exists marketing_staff_update on storage.objects;
create policy marketing_staff_update on storage.objects
  for update to authenticated
  using (bucket_id = 'marketing' and public.is_staff())
  with check (bucket_id = 'marketing' and public.is_staff());

drop policy if exists marketing_staff_delete on storage.objects;
create policy marketing_staff_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'marketing' and public.is_staff());

-- 6.3 Adjuntos del chat: como mucho 60 archivos por conversación (una conversación se crea gratis;
--     sin cupo, una sola podía acumular archivos de 25 MB sin fin).
create or replace function public.chat_adjuntos_cupo(p_conv text)
returns boolean
language sql
stable
security definer
set search_path = public, storage
as $$
  select count(*) < 60
    from storage.objects o
   where o.bucket_id = 'chat-images'
     and o.name like replace(replace(replace(coalesce(p_conv, ''), '\', '\\'), '%', '\%'), '_', '\_') || '/%';
$$;

drop policy if exists chat_images_insert_cliente on storage.objects;
create policy chat_images_insert_cliente on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'chat-images'
    and name ~ '^[^/]+/[0-9]+\.[A-Za-z0-9]{1,5}$'
    and public.conversacion_existe(split_part(name, '/', 1))
    and public.chat_adjuntos_cupo(split_part(name, '/', 1))
  );


-- ---------------------------------------------------------------------
-- 7. HIGIENE
-- ---------------------------------------------------------------------

-- search_path fijo en las 4 funciones que lo tenían suelto (aviso del asesor de Supabase).
alter function public.es_insumo(text)             set search_path = public;
alter function public.es_repuesto(text)           set search_path = public;
alter function public.ruta_de_adjunto(text)       set search_path = public;
alter function public.email_del_solicitante()     set search_path = public;

-- Las 4 tablas que tenían RLS sin ninguna política (solo las toca el servidor): se deja escrito
-- que nadie más entra. No cambia nada de lo que ocurre hoy; solo lo vuelve explícito.
drop policy if exists nadie on public.ia_descartes;
create policy nadie on public.ia_descartes for all to anon, authenticated using (false) with check (false);
drop policy if exists nadie on public.jarvis_cron;
create policy nadie on public.jarvis_cron for all to anon, authenticated using (false) with check (false);
drop policy if exists nadie on public.jarvis_eventos;
create policy nadie on public.jarvis_eventos for all to anon, authenticated using (false) with check (false);
drop policy if exists nadie on public.webauthn_challenges;
create policy nadie on public.webauthn_challenges for all to anon, authenticated using (false) with check (false);


-- =====================================================================
-- REVERTIR (por si hiciera falta volver atrás; cada bloque es independiente)
-- =====================================================================
-- Funciones: devolver las puertas
--   grant execute on function public.purgar_huellas(integer), public.purgar_retos_webauthn(),
--     public.conteo_historial() to anon, authenticated;
--   grant execute on function public.banear_cliente_total(text, text, boolean), … to anon;
-- Disparadores y topes:
--   drop trigger if exists trg_chat_messages_validar on public.chat_messages;
--   drop trigger if exists trg_chat_conversations_validar on public.chat_conversations;
--   drop trigger if exists trg_orders_validar on public.orders;
--   drop trigger if exists trg_client_profiles_validar on public.client_profiles;
--   drop trigger if exists trg_visitor_fingerprints_limitar on public.visitor_fingerprints;
--   drop trigger if exists trg_ubicaciones_limitar on public.ubicaciones_compartidas;
-- issue_invoice / set_invoice_pdf / adjust_stock / redeem_coupon: volver a la definición anterior
--   (están en el historial de migraciones de Supabase y, resumidas, en este archivo: quitar los
--   bloques «if public.es_visitante() then … end if;»).
-- Archivos:
--   drop policy invoices_storage_insert_public on storage.objects;
--   create policy invoices_storage_insert_public on storage.objects for insert to public
--     with check (bucket_id = 'invoices');
--   update storage.buckets set file_size_limit = null, allowed_mime_types = null where id = 'invoices';
--   (marketing: quitar «and public.is_staff()» de las tres políticas; chat-images: quitar el cupo.)
