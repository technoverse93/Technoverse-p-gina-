-- =====================================================================
-- CRM INTERNO · contactos, embudo de 6 etapas, línea de tiempo, recordatorios, respuestas rápidas y segmentos · 2026-10-15
-- =====================================================================
-- QUÉ AGREGA. Un CRM ágil para una operación pequeña (startup / freelance), centrado en UNA ficha por
-- persona, que se arma SOLA con lo que ya pasa en la tienda:
--   · `crm_leads`            — el contacto (nombre, correo, teléfono, provincia aproximada), su etapa en el embudo
--                              (nuevo → conversación → cotización → pendiente de pago → venta cerrada → postventa),
--                              de dónde llegó (canal + campaña/UTM), etiquetas, responsable y valor estimado.
--   · `crm_eventos`          — la línea de tiempo de cada contacto (chat, pedidos, taller, cambios de etapa, notas,
--                              contactos hechos a mano). Lo automático lo escriben los disparadores; el personal solo
--                              agrega notas y contactos.
--   · `crm_recordatorios`    — seguimientos con fecha («llamar el jueves»). Mantienen `proximo_contacto` del contacto.
--   · `crm_respuestas_rapidas` — textos preparados para el chat (`{nombre}` se reemplaza por el nombre del cliente).
--   · `crm_segmentos`        — filtros guardados para dirigir promociones («compraron hace más de 60 días»).
--
-- CÓMO SE ARMA SOLO (captación unificada, del lado del servidor, así que no depende de la versión de la app):
--   · Una conversación nueva del chat de la página crea (o actualiza) al contacto por su correo.
--   · El primer mensaje de soporte lo pasa a «En conversación»; cada mensaje del cliente actualiza su «última
--     interacción».
--   · Registrarse como cliente de la tienda, hacer un pedido o ingresar un equipo al taller también lo crean o lo
--     actualizan, y lo ADELANTAN en el embudo (nunca lo hacen retroceder; lo que el personal mueve a mano se respeta).
--   · `crm_registrar_contacto()` — la llama la tienda para sumar de dónde llegó la persona (UTM / página de
--     origen), su teléfono y su provincia aproximada (solo si dio permiso). Es una función pública con tope por
--     persona/IP, valida todo y solo rellena lo que falta; nunca cambia etapa, notas ni etiquetas.
--   · Se ignoran las cuentas del personal y las cuentas anonimizadas por el derecho al olvido (Ley 8968); y si una
--     ficha de cliente se anonimiza, su contacto del CRM se borra.
--   Un fallo del CRM NUNCA frena el chat, el pedido, el registro ni el taller: los disparadores atrapan sus errores.
--
-- PRIVACIDAD Y SEGURIDAD. Nada de esto es legible ni escribible por un visitante: RLS solo para el personal
-- (borrar contactos: solo el dueño). El visitante solo puede llamar a `crm_registrar_contacto`, que devuelve nada
-- (no revela si un correo ya existe). No se guardan tarjetas ni datos de pago. Funciones con `search_path` fijo.
--
-- CÓMO SE APLICA. Entera, de una vez. Idempotente. Funciona con o sin la migración del blindaje de seguridad
-- (el tope por IP usa `limitar_uso` si existe). La primera vez, trae al CRM lo que ya existe (clientes, chats,
-- equipos del taller y pedidos). Probada con supabase/pruebas/crm.sql. Al pie, bloque «REVERTIR».
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. AYUDANTES PUROS
-- ---------------------------------------------------------------------

create or replace function public.crm_rango_etapa(p_etapa text)
returns integer language sql immutable set search_path = public as $$
  select case p_etapa when 'nuevo' then 1 when 'conversacion' then 2 when 'cotizacion' then 3
                      when 'pago_pendiente' then 4 when 'cerrado' then 5 when 'postventa' then 6 else 0 end;
$$;

create or replace function public.crm_nombre_etapa(p_etapa text)
returns text language sql immutable set search_path = public as $$
  select case p_etapa when 'nuevo' then 'Nuevo prospecto' when 'conversacion' then 'En conversación'
                      when 'cotizacion' then 'Cotización / interés' when 'pago_pendiente' then 'Pendiente de pago'
                      when 'cerrado' then 'Venta cerrada' when 'postventa' then 'Postventa' else p_etapa end;
$$;

-- De dónde vino la persona, en una palabra, a partir de lo que mandó la tienda.
create or replace function public.crm_fuente(p_origen jsonb)
returns text language sql immutable set search_path = public as $$
  select case
    when coalesce(p_origen ->> 'utm_medium', '') ~* '^(cpc|ppc|paid|paid[_ -]?social|pauta|ads?)$' then 'pauta'
    when coalesce(p_origen ->> 'utm_medium', '') ~* '^(e-?mail|correo|newsletter)$' then 'correo'
    when (coalesce(p_origen ->> 'utm_source', '') || ' ' || coalesce(p_origen ->> 'referrer', ''))
         ~* '(instagram|facebook|\yfb\y|tiktok|youtube|youtu\.be|twitter|\yx\.com|linkedin|pinterest|whatsapp|wa\.me|\ymeta\y)' then 'redes'
    when coalesce(p_origen ->> 'referrer', '') ~* '(google|bing|duckduckgo|yahoo|ecosia|brave)' then 'busqueda'
    when nullif(btrim(coalesce(p_origen ->> 'referrer', '')), '') is not null then 'referido'
    when nullif(btrim(coalesce(p_origen ->> 'utm_source', '')), '') is not null then 'referido'
    else 'directo' end;
$$;

create or replace function public.crm_etiquetas_validas(p_etiquetas text[])
returns boolean language sql immutable set search_path = public as $$
  select coalesce(bool_and(char_length(btrim(t)) between 1 and 30), true) from unnest(coalesce(p_etiquetas, '{}'::text[])) as t;
$$;

create or replace function public.crm_provincia_valida(p text)
returns text language sql immutable set search_path = public as $$
  select case when p in ('San José', 'Alajuela', 'Cartago', 'Heredia', 'Guanacaste', 'Puntarenas', 'Limón') then p end;
$$;

-- El checkout de la tienda, cuando alguien compra sin cuenta, le arma una ficha con un correo INVENTADO: su nombre
-- pegado + «@correo.cr» (ej. «anamora@correo.cr»). Ese correo no es de nadie: no debe entrar al CRM (rebotaría en una
-- promoción y partiría a la persona en dos contactos). El correo real viene en el pedido y en `crm_registrar_contacto`.
create or replace function public.crm_correo_inventado(p_nombre text, p_email text)
returns boolean language sql immutable set search_path = public as $$
  select nullif(btrim(coalesce(p_email, '')), '') is not null
     and lower(btrim(p_email)) = lower(regexp_replace(coalesce(p_nombre, ''), '\s+', '', 'g')) || '@correo.cr';
$$;


-- ---------------------------------------------------------------------
-- 1. TABLAS
-- ---------------------------------------------------------------------

create table if not exists public.crm_leads (
  id                 uuid        primary key default gen_random_uuid(),
  nombre             text        not null default '' check (char_length(nombre) <= 120),
  email              text        check (email is null or (char_length(email) <= 160 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  email_norm         text        generated always as (nullif(lower(btrim(email)), '')) stored,
  telefono           text        check (telefono is null or char_length(telefono) <= 30),
  -- Clave de comparación: los últimos 8 dígitos (el formato de Costa Rica), con o sin +506, guiones o espacios.
  telefono_norm      text        generated always as (
                       case when length(regexp_replace(coalesce(telefono, ''), '\D', '', 'g')) >= 8
                            then right(regexp_replace(coalesce(telefono, ''), '\D', '', 'g'), 8) end) stored,
  etapa              text        not null default 'nuevo'
                     check (etapa in ('nuevo', 'conversacion', 'cotizacion', 'pago_pendiente', 'cerrado', 'postventa')),
  etapa_cambiada_en  timestamptz not null default now(),
  canal              text        not null default 'manual'
                     check (canal in ('chat_web', 'tienda_form', 'registro', 'pedido', 'taller', 'manual')),
  -- Primer contacto: utm_source, utm_medium, utm_campaign, utm_content, referrer (solo el sitio), landing, producto.
  origen             jsonb       not null default '{}'::jsonb check (jsonb_typeof(origen) = 'object' and pg_column_size(origen) < 2000),
  fuente             text        generated always as (public.crm_fuente(origen)) stored,
  provincia          text        check (provincia is null or provincia in ('San José', 'Alajuela', 'Cartago', 'Heredia', 'Guanacaste', 'Puntarenas', 'Limón')),
  etiquetas          text[]      not null default '{}'::text[] check (cardinality(etiquetas) <= 20 and public.crm_etiquetas_validas(etiquetas)),
  valor_estimado     numeric(12, 2) not null default 0 check (valor_estimado >= 0),
  responsable        text        check (responsable is null or char_length(responsable) <= 160),
  cliente_id         text,                      -- client_profiles.id (sin llave foránea: la ficha puede anonimizarse)
  conversacion_id    text,                      -- la última conversación del chat
  proximo_contacto   timestamptz,               -- el recordatorio pendiente más cercano (lo mantiene un disparador)
  ultima_interaccion timestamptz not null default now(),
  mensajes           integer     not null default 0 check (mensajes >= 0),
  archivado          boolean     not null default false,
  creado_por         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint crm_leads_tiene_contacto check (email is not null or telefono is not null)
);
create unique index if not exists crm_leads_email_uq  on public.crm_leads (email_norm)    where email_norm is not null;
create unique index if not exists crm_leads_tel_uq    on public.crm_leads (telefono_norm) where telefono_norm is not null;
create index if not exists crm_leads_etapa_idx        on public.crm_leads (etapa) where not archivado;
create index if not exists crm_leads_ultima_idx       on public.crm_leads (ultima_interaccion desc);
create index if not exists crm_leads_proximo_idx      on public.crm_leads (proximo_contacto) where proximo_contacto is not null;

create table if not exists public.crm_eventos (
  id         bigint      generated always as identity primary key,
  lead_id    uuid        not null references public.crm_leads (id) on delete cascade,
  tipo       text        not null check (tipo in ('creado', 'etapa', 'nota', 'chat', 'pedido', 'taller', 'registro', 'formulario', 'recordatorio', 'contacto', 'sistema')),
  resumen    text        not null default '' check (char_length(resumen) <= 1000),
  datos      jsonb       not null default '{}'::jsonb check (pg_column_size(datos) < 4000),
  autor      text,
  created_at timestamptz not null default now()
);
create index if not exists crm_eventos_lead_idx on public.crm_eventos (lead_id, created_at desc);

create table if not exists public.crm_recordatorios (
  id          uuid        primary key default gen_random_uuid(),
  lead_id     uuid        not null references public.crm_leads (id) on delete cascade,
  vence       timestamptz not null,
  texto       text        not null check (char_length(btrim(texto)) between 1 and 300),
  hecho       boolean     not null default false,
  hecho_en    timestamptz,
  creado_por  text,
  created_at  timestamptz not null default now()
);
create index if not exists crm_recordatorios_lead_idx  on public.crm_recordatorios (lead_id);
create index if not exists crm_recordatorios_vence_idx on public.crm_recordatorios (vence) where not hecho;

create table if not exists public.crm_respuestas_rapidas (
  id         uuid        primary key default gen_random_uuid(),
  atajo      text        not null check (atajo ~ '^[a-z0-9_-]{2,24}$'),
  titulo     text        not null check (char_length(btrim(titulo)) between 1 and 80),
  texto      text        not null check (char_length(btrim(texto)) between 1 and 1500),
  orden      integer     not null default 0,
  activa     boolean     not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists crm_respuestas_atajo_uq on public.crm_respuestas_rapidas (atajo);

create table if not exists public.crm_segmentos (
  id          uuid        primary key default gen_random_uuid(),
  nombre      text        not null check (char_length(btrim(nombre)) between 1 and 60),
  filtro      jsonb       not null default '{}'::jsonb check (jsonb_typeof(filtro) = 'object' and pg_column_size(filtro) < 4000),
  creado_por  text,
  created_at  timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 2. ACCESO: solo el personal (borrar contactos y eventos: solo el dueño)
-- ---------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['crm_leads', 'crm_eventos', 'crm_recordatorios', 'crm_respuestas_rapidas', 'crm_segmentos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

grant select, insert, update         on public.crm_leads, public.crm_eventos to authenticated;
grant delete                         on public.crm_leads, public.crm_eventos to authenticated;
grant select, insert, update, delete on public.crm_recordatorios, public.crm_respuestas_rapidas, public.crm_segmentos to authenticated;
revoke update                        on public.crm_eventos from authenticated;     -- la línea de tiempo no se reescribe

drop policy if exists crm_leads_leer     on public.crm_leads;
drop policy if exists crm_leads_crear    on public.crm_leads;
drop policy if exists crm_leads_editar   on public.crm_leads;
drop policy if exists crm_leads_borrar   on public.crm_leads;
create policy crm_leads_leer   on public.crm_leads for select to authenticated using (public.is_staff());
create policy crm_leads_crear  on public.crm_leads for insert to authenticated with check (public.is_staff());
create policy crm_leads_editar on public.crm_leads for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy crm_leads_borrar on public.crm_leads for delete to authenticated using (public.is_owner());

drop policy if exists crm_eventos_leer   on public.crm_eventos;
drop policy if exists crm_eventos_crear  on public.crm_eventos;
drop policy if exists crm_eventos_borrar on public.crm_eventos;
create policy crm_eventos_leer   on public.crm_eventos for select to authenticated using (public.is_staff());
-- A mano el personal solo anota (nota) o registra un contacto hecho (contacto); el resto lo escribe el sistema.
create policy crm_eventos_crear  on public.crm_eventos for insert to authenticated with check (public.is_staff() and tipo in ('nota', 'contacto'));
create policy crm_eventos_borrar on public.crm_eventos for delete to authenticated using (public.is_owner());

drop policy if exists crm_recordatorios_todo on public.crm_recordatorios;
create policy crm_recordatorios_todo on public.crm_recordatorios for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists crm_respuestas_todo on public.crm_respuestas_rapidas;
create policy crm_respuestas_todo on public.crm_respuestas_rapidas for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists crm_segmentos_todo on public.crm_segmentos;
create policy crm_segmentos_todo on public.crm_segmentos for all to authenticated using (public.is_staff()) with check (public.is_staff());


-- ---------------------------------------------------------------------
-- 3. CAPTACIÓN: una sola función interna que crea o actualiza al contacto
-- ---------------------------------------------------------------------
-- Interna: nadie la llama desde la API (la usan los disparadores y `crm_registrar_contacto`).

create or replace function public.crm_capturar(
  p_nombre          text,
  p_email           text,
  p_telefono        text,
  p_canal           text,
  p_origen          jsonb       default '{}'::jsonb,
  p_provincia       text        default null,
  p_cliente_id      text        default null,
  p_conversacion_id text        default null,
  p_resumen         text        default null,
  p_etapa_minima    text        default null,
  p_fecha           timestamptz default null,
  p_datos           jsonb       default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email  text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_dig    text := regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g');
  v_tel    text := case when length(v_dig) >= 8 then right(v_dig, 8) end;
  v_nombre text := left(btrim(coalesce(p_nombre, '')), 120);
  v_prov   text := public.crm_provincia_valida(p_provincia);
  v_fecha  timestamptz := least(coalesce(p_fecha, now()), now());
  v_origen jsonb := case when jsonb_typeof(coalesce(p_origen, '{}'::jsonb)) = 'object' then coalesce(p_origen, '{}'::jsonb) else '{}'::jsonb end;
  v_viejo  public.crm_leads%rowtype;
  v_id     uuid;
  v_tipo   text := case p_canal when 'chat_web' then 'chat' when 'registro' then 'registro' when 'pedido' then 'pedido'
                                when 'taller' then 'taller' when 'tienda_form' then 'formulario' else 'sistema' end;
begin
  if p_canal is null or p_canal not in ('chat_web', 'tienda_form', 'registro', 'pedido', 'taller', 'manual') then
    return null;
  end if;
  -- Sin correo ni teléfono no hay forma de reconocer a la persona después: no se guarda nada.
  if v_email is null and v_tel is null then
    return null;
  end if;
  if v_email is not null and (char_length(v_email) > 160 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    if v_tel is null then return null; end if;
    v_email := null;
  end if;
  -- Ni el personal ni las cuentas anonimizadas (derecho al olvido) son contactos comerciales.
  if v_email is not null and (
       v_email ~ '^anonimo-[^@]*@technoverse\.com$'
       or exists (select 1 from public.profiles p where lower(p.email) = v_email and p.role in ('superadmin', 'admin', 'empleado'))) then
    return null;
  end if;

  -- Dos capturas de la misma persona a la vez (por ejemplo, el chat y el pedido) esperan su turno.
  perform pg_advisory_xact_lock(hashtext('crm:' || coalesce(v_email, v_tel)));

  if v_email is not null then
    select * into v_viejo from public.crm_leads where email_norm = v_email;
  end if;
  if v_viejo.id is null and v_tel is not null then
    select * into v_viejo from public.crm_leads where telefono_norm = v_tel;
  end if;

  if v_viejo.id is null then
    insert into public.crm_leads (nombre, email, telefono, canal, origen, provincia, cliente_id, conversacion_id,
                                  created_at, ultima_interaccion, creado_por)
    values (v_nombre, v_email, nullif(left(btrim(coalesce(p_telefono, '')), 30), ''), p_canal, v_origen, v_prov,
            p_cliente_id, p_conversacion_id, v_fecha, v_fecha, 'sistema')
    returning id into v_id;
    insert into public.crm_eventos (lead_id, tipo, resumen, datos, autor, created_at)
    values (v_id, 'creado', coalesce(nullif(btrim(p_resumen), ''), 'Nuevo contacto'), coalesce(p_datos, '{}'::jsonb) || jsonb_build_object('canal', p_canal), 'sistema', v_fecha);
  else
    v_id := v_viejo.id;
    -- Solo se RELLENA lo que falta: lo que el personal ya editó no se pisa, y el primer origen manda.
    update public.crm_leads l set
      nombre             = case when l.nombre = '' or lower(l.nombre) in ('cliente', 'visitante') then coalesce(nullif(v_nombre, ''), l.nombre) else l.nombre end,
      email              = coalesce(l.email, v_email),
      telefono           = case when l.telefono is null and v_tel is not null
                                 and not exists (select 1 from public.crm_leads x where x.telefono_norm = v_tel and x.id <> l.id)
                                then nullif(left(btrim(coalesce(p_telefono, '')), 30), '') else l.telefono end,
      provincia          = coalesce(l.provincia, v_prov),
      origen             = case when l.origen = '{}'::jsonb then v_origen else l.origen end,
      cliente_id         = coalesce(p_cliente_id, l.cliente_id),
      conversacion_id    = coalesce(p_conversacion_id, l.conversacion_id),
      ultima_interaccion = greatest(l.ultima_interaccion, v_fecha),
      archivado          = false
    where l.id = v_id;
    if nullif(btrim(coalesce(p_resumen, '')), '') is not null then
      insert into public.crm_eventos (lead_id, tipo, resumen, datos, autor, created_at)
      values (v_id, v_tipo, left(btrim(p_resumen), 1000), coalesce(p_datos, '{}'::jsonb), 'sistema', v_fecha);
    end if;
  end if;

  -- Adelanta en el embudo (nunca retrocede); el disparador del contacto anota el cambio como «sistema».
  if p_etapa_minima is not null and public.crm_rango_etapa(p_etapa_minima) > 0 then
    perform set_config('crm.auto', 'on', true);
    update public.crm_leads set etapa = p_etapa_minima
     where id = v_id and public.crm_rango_etapa(etapa) < public.crm_rango_etapa(p_etapa_minima);
    perform set_config('crm.auto', 'off', true);
  end if;

  return v_id;
end;
$$;
revoke all on function public.crm_capturar(text, text, text, text, jsonb, text, text, text, text, text, timestamptz, jsonb) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 4. DISPARADORES PROPIOS (autor sellado, historial de etapas, recordatorios)
-- ---------------------------------------------------------------------

-- Quién es el personal que está haciendo el cambio (nulo si lo hace el sistema).
create or replace function public.crm_actor()
returns text language sql stable security definer set search_path = public as $$
  select case when auth.uid() is not null and public.is_staff() then public.current_email() end;
$$;
revoke all on function public.crm_actor() from public, anon, authenticated;

-- El autor lo pone la base con la cuenta que escribe: nadie firma como otra persona. Es SECURITY INVOKER a propósito:
-- `current_user` es `authenticated` solo cuando una persona del personal escribe directo por la API; lo que hacen las
-- funciones del sistema (captación, disparadores) corre con otro rol y conserva su firma «sistema».
create or replace function public.crm_sellar_autor()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user = 'authenticated' and public.is_staff() then
    if tg_table_name = 'crm_eventos' then
      new.autor := public.current_email();
    elsif tg_op = 'INSERT' then
      new.creado_por := public.current_email();
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.crm_sellar_autor() from public, anon, authenticated;

drop trigger if exists trg_crm_eventos_autor on public.crm_eventos;
create trigger trg_crm_eventos_autor before insert on public.crm_eventos for each row execute function public.crm_sellar_autor();
drop trigger if exists trg_crm_recordatorios_autor on public.crm_recordatorios;
create trigger trg_crm_recordatorios_autor before insert on public.crm_recordatorios for each row execute function public.crm_sellar_autor();
drop trigger if exists trg_crm_leads_autor on public.crm_leads;
create trigger trg_crm_leads_autor before insert on public.crm_leads for each row execute function public.crm_sellar_autor();

-- Un contacto cambia: se actualiza la fecha y, si cambió de etapa, queda anotado en su línea de tiempo.
create or replace function public.crm_trg_lead_actualizado()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if new.etapa is distinct from old.etapa then
    new.etapa_cambiada_en := now();
    insert into public.crm_eventos (lead_id, tipo, resumen, datos, autor)
    values (new.id, 'etapa',
            'De «' || public.crm_nombre_etapa(old.etapa) || '» a «' || public.crm_nombre_etapa(new.etapa) || '»',
            jsonb_build_object('de', old.etapa, 'a', new.etapa),
            case when current_setting('crm.auto', true) = 'on' then 'sistema' else coalesce(public.crm_actor(), 'sistema') end);
  end if;
  return new;
end;
$$;
revoke all on function public.crm_trg_lead_actualizado() from public, anon, authenticated;
drop trigger if exists trg_crm_lead_actualizado on public.crm_leads;
create trigger trg_crm_lead_actualizado before update on public.crm_leads for each row execute function public.crm_trg_lead_actualizado();

-- Un contacto registrado a mano cuenta como interacción.
create or replace function public.crm_trg_evento_creado()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.tipo = 'contacto' then
    update public.crm_leads set ultima_interaccion = greatest(ultima_interaccion, new.created_at) where id = new.lead_id;
  end if;
  return new;
end;
$$;
revoke all on function public.crm_trg_evento_creado() from public, anon, authenticated;
drop trigger if exists trg_crm_evento_creado on public.crm_eventos;
create trigger trg_crm_evento_creado after insert on public.crm_eventos for each row execute function public.crm_trg_evento_creado();

-- Recordatorios: la hora de cumplido, el «próximo contacto» del contacto y la línea de tiempo.
create or replace function public.crm_trg_recordatorio_antes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.hecho and (tg_op = 'INSERT' or not old.hecho) then new.hecho_en := now();
  elsif not new.hecho then new.hecho_en := null;
  end if;
  return new;
end;
$$;
revoke all on function public.crm_trg_recordatorio_antes() from public, anon, authenticated;
drop trigger if exists trg_crm_recordatorio_antes on public.crm_recordatorios;
create trigger trg_crm_recordatorio_antes before insert or update on public.crm_recordatorios
  for each row execute function public.crm_trg_recordatorio_antes();

create or replace function public.crm_trg_recordatorio_despues()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_lead uuid := coalesce(new.lead_id, old.lead_id);
begin
  if tg_op = 'INSERT' then
    insert into public.crm_eventos (lead_id, tipo, resumen, datos, autor)
    values (new.lead_id, 'recordatorio', 'Recordatorio: ' || left(new.texto, 200), jsonb_build_object('vence', new.vence), coalesce(new.creado_por, 'sistema'));
  elsif tg_op = 'UPDATE' and new.hecho and not old.hecho then
    insert into public.crm_eventos (lead_id, tipo, resumen, datos, autor)
    values (new.lead_id, 'recordatorio', 'Cumplido: ' || left(new.texto, 200), '{}'::jsonb, coalesce(public.crm_actor(), 'sistema'));
  end if;
  update public.crm_leads
     set proximo_contacto = (select min(r.vence) from public.crm_recordatorios r where r.lead_id = v_lead and not r.hecho)
   where id = v_lead;
  return null;
end;
$$;
revoke all on function public.crm_trg_recordatorio_despues() from public, anon, authenticated;
drop trigger if exists trg_crm_recordatorio_despues on public.crm_recordatorios;
create trigger trg_crm_recordatorio_despues after insert or update or delete on public.crm_recordatorios
  for each row execute function public.crm_trg_recordatorio_despues();


-- ---------------------------------------------------------------------
-- 5. DISPARADORES SOBRE LO QUE YA PASA EN LA TIENDA (nunca frenan lo que los dispara)
-- ---------------------------------------------------------------------

-- 5.1 Conversación nueva en el chat de la página.
create or replace function public.crm_trg_chat_conversacion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    perform public.crm_capturar(new.customer_name, new.customer_email, null, 'chat_web', '{}'::jsonb, null, null, new.id,
                                'Inició una conversación en el chat de la página', 'nuevo', new.created_at,
                                jsonb_build_object('conversacion', new.id));
  exception when others then
    raise warning 'crm_trg_chat_conversacion: %', sqlerrm;
  end;
  return new;
end;
$$;
revoke all on function public.crm_trg_chat_conversacion() from public, anon, authenticated;
drop trigger if exists trg_crm_chat_conversacion on public.chat_conversations;
create trigger trg_crm_chat_conversacion after insert on public.chat_conversations
  for each row execute function public.crm_trg_chat_conversacion();

-- 5.2 Mensajes del chat: el del cliente avisa que hay movimiento; la primera respuesta de soporte pasa a «En conversación».
create or replace function public.crm_trg_chat_mensaje()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  begin
    select nullif(lower(btrim(coalesce(c.customer_email, ''))), '') into v_email
      from public.chat_conversations c where c.id = new.conversation_id;
    if v_email is not null then
      if new.sender = 'customer' then
        update public.crm_leads
           set ultima_interaccion = now(), mensajes = mensajes + 1, conversacion_id = new.conversation_id, archivado = false
         where email_norm = v_email;
      elsif new.sender = 'support' and not coalesce(new.is_internal_note, false) then
        perform set_config('crm.auto', 'on', true);
        update public.crm_leads
           set ultima_interaccion = now(), etapa = case when etapa = 'nuevo' then 'conversacion' else etapa end
         where email_norm = v_email;
        perform set_config('crm.auto', 'off', true);
      end if;
    end if;
  exception when others then
    raise warning 'crm_trg_chat_mensaje: %', sqlerrm;
  end;
  return new;
end;
$$;
revoke all on function public.crm_trg_chat_mensaje() from public, anon, authenticated;
drop trigger if exists trg_crm_chat_mensaje on public.chat_messages;
create trigger trg_crm_chat_mensaje after insert on public.chat_messages
  for each row execute function public.crm_trg_chat_mensaje();

-- 5.3 Registro de un cliente de la tienda; si su ficha se anonimiza (derecho al olvido), su contacto se borra.
create or replace function public.crm_trg_cliente()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if tg_op = 'UPDATE' and lower(coalesce(new.email, '')) ~ '^anonimo-[^@]*@technoverse\.com$'
       and lower(coalesce(old.email, '')) !~ '^anonimo-[^@]*@technoverse\.com$' then
      delete from public.crm_leads where cliente_id = old.id or email_norm = nullif(lower(btrim(coalesce(old.email, ''))), '');
    elsif tg_op = 'INSERT' then
      perform public.crm_capturar(new.name, case when public.crm_correo_inventado(new.name, new.email) then null else new.email end,
                                  new.phone, 'registro', '{}'::jsonb, new.province, new.id, null,
                                  'Se registró como cliente de la tienda', 'nuevo', new.created_at);
    else
      perform public.crm_capturar(new.name, case when public.crm_correo_inventado(new.name, new.email) then null else new.email end,
                                  new.phone, 'registro', '{}'::jsonb, new.province, new.id, null, null, null, null);
    end if;
  exception when others then
    raise warning 'crm_trg_cliente: %', sqlerrm;
  end;
  return new;
end;
$$;
revoke all on function public.crm_trg_cliente() from public, anon, authenticated;
drop trigger if exists trg_crm_cliente on public.client_profiles;
create trigger trg_crm_cliente after insert or update of name, email, phone, province on public.client_profiles
  for each row execute function public.crm_trg_cliente();

-- 5.4 Un pedido completado: venta cerrada.
create or replace function public.crm_trg_pedido()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if new.status = 'Completado' and nullif(btrim(coalesce(new.customer_email, '')), '') is not null then
      perform public.crm_capturar(new.customer_name, new.customer_email, null, 'pedido', '{}'::jsonb, null, new.customer_id, null,
                                  'Pedido ' || new.id || ' por ₡' || to_char(coalesce(new.total, 0), 'FM999G999G999G990'),
                                  'cerrado', new.created_at, jsonb_build_object('pedido', new.id, 'total', coalesce(new.total, 0)));
    end if;
  exception when others then
    raise warning 'crm_trg_pedido: %', sqlerrm;
  end;
  return new;
end;
$$;
revoke all on function public.crm_trg_pedido() from public, anon, authenticated;
drop trigger if exists trg_crm_pedido on public.orders;
create trigger trg_crm_pedido after insert on public.orders for each row execute function public.crm_trg_pedido();

-- 5.5 Equipo en el taller: según cómo va la reparación, el contacto avanza en el embudo.
create or replace function public.crm_trg_taller()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_etapa text;
begin
  begin
    v_etapa := case new.status
      when 'Pendiente' then 'conversacion'
      when 'Diagnosticada' then 'cotizacion' when 'Cotizada' then 'cotizacion' when 'Aprobada' then 'cotizacion'
      when 'En Reparación' then 'cotizacion' when 'Esperando repuestos' then 'cotizacion'
      when 'Lista' then 'pago_pendiente' when 'Entregada' then 'cerrado' else null end;
    if tg_op = 'INSERT' or new.status is distinct from old.status then
      perform public.crm_capturar(new.customer_name, new.customer_email, new.customer_phone, 'taller', '{}'::jsonb, null, new.customer_id, null,
                                  case when tg_op = 'INSERT'
                                       then 'Ingresó un equipo al taller (' || coalesce(new.ticket, new.id) || ')'
                                       else 'Reparación ' || coalesce(new.ticket, new.id) || ': ' || new.status end,
                                  v_etapa, new.created_at, jsonb_build_object('ticket', coalesce(new.ticket, new.id), 'estado', new.status));
    end if;
  exception when others then
    raise warning 'crm_trg_taller: %', sqlerrm;
  end;
  return new;
end;
$$;
revoke all on function public.crm_trg_taller() from public, anon, authenticated;
drop trigger if exists trg_crm_taller on public.repair_orders;
create trigger trg_crm_taller after insert or update of status on public.repair_orders
  for each row execute function public.crm_trg_taller();


-- ---------------------------------------------------------------------
-- 6. LA ÚNICA FUNCIÓN PÚBLICA: la tienda suma de dónde llegó la persona
-- ---------------------------------------------------------------------
-- No devuelve nada (no revela si el correo ya existe), solo acepta los 3 canales de una persona que se identifica
-- (chat, formulario, registro), valida todo, limita el uso y NUNCA adelanta la etapa: las ventas las cierran los
-- pedidos de verdad, no una llamada de la tienda.

create or replace function public.crm_registrar_contacto(
  p_nombre    text,
  p_email     text,
  p_telefono  text  default null,
  p_canal     text  default 'tienda_form',
  p_origen    jsonb default '{}'::jsonb,
  p_provincia text  default null,
  p_detalle   text  default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email   text  := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_origen  jsonb := '{}'::jsonb;
  v_llave   text;
  v_resumen text;
begin
  if p_canal is null or p_canal not in ('chat_web', 'tienda_form', 'registro') then
    return;
  end if;
  if v_email is not null and (char_length(v_email) > 160 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    return;
  end if;
  if v_email is null and nullif(btrim(coalesce(p_telefono, '')), '') is null then
    return;
  end if;

  -- Tope por persona/IP (si el blindaje de seguridad ya está aplicado). Pasado el tope, se descarta en silencio.
  begin
    if not coalesce(public.is_staff(), false) then
      perform public.limitar_uso('crm_contacto', 20, 600);
    end if;
  exception
    when undefined_function then null;
    when raise_exception then return;
  end;

  -- Del origen solo se aceptan las llaves conocidas, como texto corto: nada más entra a la base.
  if jsonb_typeof(coalesce(p_origen, '{}'::jsonb)) = 'object' then
    foreach v_llave in array array['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'referrer', 'landing', 'producto'] loop
      if jsonb_typeof(p_origen -> v_llave) = 'string' and nullif(btrim(p_origen ->> v_llave), '') is not null then
        v_origen := v_origen || jsonb_build_object(v_llave, left(btrim(p_origen ->> v_llave), 120));
      end if;
    end loop;
  end if;

  v_resumen := case p_canal
                 when 'chat_web'    then 'Escribió por el chat de la página'
                 when 'registro'    then 'Se registró en la tienda'
                 else                    'Dejó sus datos en la tienda' end
               || coalesce(' · ' || nullif(left(btrim(coalesce(p_detalle, '')), 140), ''), '');

  perform public.crm_capturar(left(btrim(coalesce(p_nombre, '')), 120), v_email, p_telefono, p_canal, v_origen,
                              p_provincia, null, null, v_resumen, 'nuevo');
exception when others then
  raise warning 'crm_registrar_contacto: %', sqlerrm;   -- la tienda no debe enterarse de un fallo del CRM
end;
$$;
revoke all on function public.crm_registrar_contacto(text, text, text, text, jsonb, text, text) from public;
grant execute on function public.crm_registrar_contacto(text, text, text, text, jsonb, text, text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 7. EN VIVO HACIA EL PANEL
-- ---------------------------------------------------------------------
do $$ begin alter publication supabase_realtime add table public.crm_leads;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.crm_recordatorios;
exception when duplicate_object then null; when undefined_object then null; end $$;


-- ---------------------------------------------------------------------
-- 8. PRIMERA VEZ: se trae al CRM lo que ya existe (solo si todavía no hay ningún contacto)
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  if exists (select 1 from public.crm_leads) then
    return;
  end if;

  -- Chats: la conversación más reciente de cada correo (con respuesta de soporte = «En conversación»).
  for r in
    select distinct on (lower(btrim(c.customer_email)))
           c.id, c.customer_name, c.customer_email, c.created_at,
           exists (select 1 from public.chat_messages m where m.conversation_id = c.id and m.sender = 'support' and not coalesce(m.is_internal_note, false)) as respondida
      from public.chat_conversations c
     where nullif(btrim(coalesce(c.customer_email, '')), '') is not null
     order by lower(btrim(c.customer_email)), c.created_at desc
  loop
    perform public.crm_capturar(r.customer_name, r.customer_email, null, 'chat_web', '{}'::jsonb, null, null, r.id,
                                'Conversación en el chat de la página', case when r.respondida then 'conversacion' else 'nuevo' end, r.created_at);
  end loop;

  -- Clientes registrados.
  for r in select id, name, email, phone, province, created_at from public.client_profiles order by created_at loop
    perform public.crm_capturar(r.name, case when public.crm_correo_inventado(r.name, r.email) then null else r.email end,
                                r.phone, 'registro', '{}'::jsonb, r.province, r.id, null,
                                'Se registró como cliente de la tienda', 'nuevo', r.created_at);
  end loop;

  -- Taller: el equipo más reciente de cada persona.
  for r in
    select distinct on (coalesce(lower(btrim(o.customer_email)), o.customer_phone))
           o.id, o.ticket, o.customer_id, o.customer_name, o.customer_email, o.customer_phone, o.status, o.created_at
      from public.repair_orders o
     where nullif(btrim(coalesce(o.customer_email, '')), '') is not null or nullif(btrim(coalesce(o.customer_phone, '')), '') is not null
     order by coalesce(lower(btrim(o.customer_email)), o.customer_phone), o.created_at desc
  loop
    perform public.crm_capturar(r.customer_name, r.customer_email, r.customer_phone, 'taller', '{}'::jsonb, null, r.customer_id, null,
                                'Equipo en el taller (' || coalesce(r.ticket, r.id) || '): ' || r.status,
                                case r.status when 'Pendiente' then 'conversacion'
                                              when 'Diagnosticada' then 'cotizacion' when 'Cotizada' then 'cotizacion' when 'Aprobada' then 'cotizacion'
                                              when 'En Reparación' then 'cotizacion' when 'Esperando repuestos' then 'cotizacion'
                                              when 'Lista' then 'pago_pendiente' when 'Entregada' then 'cerrado' end,
                                r.created_at, jsonb_build_object('ticket', coalesce(r.ticket, r.id), 'estado', r.status));
  end loop;

  -- Pedidos completados: venta cerrada, con el resumen de lo comprado.
  for r in
    select lower(btrim(o.customer_email)) as correo, max(o.customer_name) as nombre, max(o.customer_id) as cliente,
           count(*) as n, coalesce(sum(o.total), 0) as total, max(o.created_at) as ultimo
      from public.orders o
     where o.status = 'Completado' and nullif(btrim(coalesce(o.customer_email, '')), '') is not null
     group by lower(btrim(o.customer_email))
  loop
    perform public.crm_capturar(r.nombre, r.correo, null, 'pedido', '{}'::jsonb, null, r.cliente, null,
                                r.n || (case when r.n = 1 then ' pedido' else ' pedidos' end) || ' por ₡' || to_char(r.total, 'FM999G999G999G990'),
                                'cerrado', r.ultimo, jsonb_build_object('pedidos', r.n, 'total', r.total));
  end loop;

  -- Respuestas rápidas de partida (el personal las edita o las borra).
  insert into public.crm_respuestas_rapidas (atajo, titulo, texto, orden)
  select * from (values
    ('hola',        'Saludo',                   '¡Hola {nombre}! Gracias por escribirnos a Technoverse. ¿En qué te podemos ayudar?', 1),
    ('cotizar',     'Pedir datos para cotizar', 'Claro {nombre}. Para cotizarte necesito la marca y el modelo del equipo y qué falla presenta. Con eso te paso el precio y el tiempo estimado.', 2),
    ('pagos',       'Formas de pago',           'Aceptamos SINPE Móvil, tarjeta y efectivo. Cuando confirmés, te paso el detalle para que todo quede registrado.', 3),
    ('garantia',    'Garantía',                 'Todas las reparaciones llevan garantía de al menos 3 meses, según la Ley 7472, sobre la pieza y la mano de obra del trabajo realizado.', 4),
    ('seguimiento', 'Seguimiento',              'Hola {nombre}, te escribo para saber cómo te fue con tu compra o reparación. ¿Todo funcionando bien?', 5),
    ('gracias',     'Agradecimiento',           '¡Gracias por tu compra, {nombre}! Cualquier duda con tu equipo, escribinos por acá.', 6)
  ) as v (atajo, titulo, texto, orden)
  on conflict do nothing;
end $$;


-- REVERTIR (borra el CRM entero; los chats, pedidos y clientes no se tocan):
--   drop trigger if exists trg_crm_chat_conversacion on public.chat_conversations;
--   drop trigger if exists trg_crm_chat_mensaje      on public.chat_messages;
--   drop trigger if exists trg_crm_cliente           on public.client_profiles;
--   drop trigger if exists trg_crm_pedido            on public.orders;
--   drop trigger if exists trg_crm_taller            on public.repair_orders;
--   drop function if exists public.crm_registrar_contacto(text, text, text, text, jsonb, text, text);
--   drop table if exists public.crm_segmentos, public.crm_respuestas_rapidas, public.crm_recordatorios,
--                        public.crm_eventos, public.crm_leads cascade;
--   drop function if exists public.crm_capturar(text, text, text, text, jsonb, text, text, text, text, text, timestamptz, jsonb),
--     public.crm_actor(), public.crm_sellar_autor(), public.crm_trg_lead_actualizado(), public.crm_trg_evento_creado(),
--     public.crm_trg_recordatorio_antes(), public.crm_trg_recordatorio_despues(), public.crm_trg_chat_conversacion(),
--     public.crm_trg_chat_mensaje(), public.crm_trg_cliente(), public.crm_trg_pedido(), public.crm_trg_taller(),
--     public.crm_rango_etapa(text), public.crm_nombre_etapa(text), public.crm_fuente(jsonb),
--     public.crm_etiquetas_validas(text[]), public.crm_provincia_valida(text), public.crm_correo_inventado(text, text);
