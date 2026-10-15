-- =====================================================================
-- RÉPLICA MÍNIMA de la base de Technoverse para PROBAR migraciones en un Postgres local
-- =====================================================================
-- No es la base real: es lo justo (roles de Supabase, auth.*, storage.*, las tablas, funciones y
-- políticas que tocan las migraciones de seguridad) con los mismos nombres y las mismas definiciones
-- que tiene producción hoy. Sirve para correr `supabase/pruebas/blindaje_seguridad.sql` sin tocar la
-- base de verdad. Úsese SOLO en una base de pruebas vacía.
--
--   createdb prueba && psql prueba -v ON_ERROR_STOP=1 -f supabase/pruebas/replica_minima.sql
-- =====================================================================

-- ---- roles de Supabase ----
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon')          then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role')  then create role service_role nologin bypassrls; end if;
end $$;
grant anon, authenticated, service_role to current_user;

-- ---- auth ----
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''), nullif(current_setting('request.jwt.claims', true), ''))::jsonb $$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(current_setting('request.jwt.claim.role', true), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')) $$;

-- ---- storage ----
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, created_at timestamptz default now());
alter table storage.objects enable row level security;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('invoices', 'invoices', true, null, null),
  ('marketing', 'marketing', true, 8388608, array['image/png','image/jpeg','image/webp','video/mp4']),
  ('chat-images', 'chat-images', true, 26214400, array['image/jpeg','image/png']),
  ('productos', 'productos', true, 3145728, array['image/webp'])
on conflict do nothing;

-- ---- privilegios por defecto, como en Supabase ----
grant usage on schema public, auth, storage to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
grant all on all tables in schema storage to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;

-- ---- tablas (solo las columnas que usan las funciones y políticas bajo prueba) ----
create table public.profiles (id uuid primary key, email text, role text, name text,
  security_pin_hash text, security_pin_set_at timestamptz, security_pin_fails int default 0, security_pin_locked_until timestamptz);
create table public.products (id text primary key, sku text, name text, category text, price numeric default 0, cost numeric default 0,
  image_url text, stock int not null default 0, active boolean default true);
create table public.app_settings (id boolean primary key default true, cedula_juridica text, company_phone text, company_address text,
  workshop_address text, pickup_hours text, max_stock_limit int default 50, store_logo text, instagram_webhook_url text);
create table public.marketing_campaigns (id text primary key, code text not null unique, type text, value numeric default 0,
  usage_limit int default 0, used int default 0, applicable_category text, active boolean default true,
  created_at timestamptz not null default now(), expires_at timestamptz not null default (now() + interval '60 days'));
create table public.orders (id text primary key, customer_id text, customer_name text, customer_email text,
  items jsonb not null default '[]'::jsonb, subtotal numeric default 0, membership_discount numeric default 0, shipping_cost numeric default 0,
  tax_amount numeric default 0, total numeric default 0, payment_method text, payment_details jsonb default '{}'::jsonb,
  status text not null default 'Completado', created_at timestamptz not null default now());
create table public.invoice_counters (tipo_doc text primary key, last_number bigint not null default 0);
create table public.invoices (id text primary key, order_id text not null, clave text not null, consecutivo text not null, tipo_doc text not null,
  sucursal text not null default '001', terminal text not null default '00001', numero_documento text not null, situacion text not null default '1',
  security_code text not null, emisor_cedula text not null, customer_identification_type text not null, customer_identification text not null default '',
  customer_name text not null, customer_email text, medio_pago text not null, items jsonb not null default '[]'::jsonb,
  subtotal numeric not null default 0, iva_total numeric not null default 0, total numeric not null default 0, pdf_url text, qr_data text,
  email_status text not null default 'pendiente', created_at timestamptz not null default now(), garantia_meses smallint);
create table public.chat_conversations (id text primary key, customer_name text, customer_email text,
  status text default 'nuevo' check (status in ('nuevo','pendiente','resuelto')), unread_count int default 0,
  created_at timestamptz not null default now(), assigned_admin_email text, customer_token uuid, updated_at timestamptz not null default now(),
  customer_last_read_at timestamptz, customer_last_seen_at timestamptz, exclusivo_superadmin boolean not null default false);
create table public.chat_messages (id text primary key, conversation_id text references public.chat_conversations(id) on delete cascade,
  sender text check (sender in ('customer','support','bot')), text text, created_at timestamptz not null default now(),
  image_url text, is_internal_note boolean not null default false, video_url text, audio_url text);
create table public.client_profiles (id text primary key, profile_id uuid, name text not null, email text not null, phone text, province text,
  address_detail text, cards_tokenized jsonb default '[]'::jsonb, balance numeric default 0, notes text, pickup_in_person boolean default false,
  created_at timestamptz not null default now(), activo boolean not null default true);
create table public.banners (id text primary key, title text, description text, image_url text, link text, type text, active boolean default true,
  start_date date, end_date date, formato text not null default 'hero', oferta text,
  constraint banners_formato_check check (formato in ('hero', 'divisor', 'grid', 'popup')),
  constraint banners_type_check check (type in ('Servicios', 'Repuestos', 'Soporte', 'General')));
create table public.visitor_fingerprints (huella text primary key, ip text, email text, ultima_visita timestamptz not null default now(), visitas int default 1);
create table public.blocked_users_list (email text, huella text, levantado_en timestamptz);
create table public.ubicaciones_compartidas (id uuid primary key default gen_random_uuid(), rol text, nombre text, email text, lat double precision,
  lon double precision, precision_m int, provincia text, contexto text, device_id text, created_at timestamptz default now());
create table public.login_audit_logs (ocurrido_en timestamptz default now());
create table public.audit_logs (created_at timestamptz default now());
create table public.webauthn_challenges (expira_en timestamptz);
create table public.ia_descartes (id int);
create table public.jarvis_cron (id int);
create table public.jarvis_eventos (id int);
alter table public.webauthn_challenges enable row level security;
alter table public.ia_descartes enable row level security;
alter table public.jarvis_cron enable row level security;
alter table public.jarvis_eventos enable row level security;

-- ---- funciones de apoyo (definiciones reales de producción) ----
create function public.is_staff() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('superadmin', 'admin', 'empleado')); $$;
create function public.is_owner() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('superadmin', 'admin')); $$;
create function public.is_superadmin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'superadmin'); $$;
create function public.current_email() returns text language sql stable security definer set search_path = public as $$
  select email from public.profiles where id = auth.uid(); $$;
create function public.es_admin_supremo() returns boolean language sql stable security definer set search_path = public as $$
  select lower(coalesce((select email from auth.users where id = auth.uid()), '')) = 'technoverse.admin@gmail.com'; $$;
create function public.email_del_solicitante() returns text language sql stable as $$
  select nullif(lower(btrim(coalesce(auth.jwt() ->> 'email', ''))), ''); $$;
create function public.ip_del_solicitante() returns text language plpgsql stable security definer set search_path = public as $$
declare v_cabeceras json; v_ip text;
begin
  begin v_cabeceras := nullif(current_setting('request.headers', true), '')::json;
  exception when others then return null; end;
  if v_cabeceras is null then return null; end if;
  v_ip := v_cabeceras ->> 'cf-connecting-ip';
  if v_ip is null or btrim(v_ip) = '' then v_ip := split_part(coalesce(v_cabeceras ->> 'x-forwarded-for', ''), ',', 1); end if;
  return nullif(btrim(coalesce(v_ip, '')), '');
end; $$;
create function public.solicitante_bloqueado() returns boolean language sql stable as $$ select false $$;
create function public.conversacion_existe(p_id text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.chat_conversations where id = p_id); $$;
create function public.chat_es_exclusivo(p_conversation_id text) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select exclusivo_superadmin from public.chat_conversations where id = p_conversation_id), false); $$;
create function public.ruta_de_adjunto(p_url text) returns text language sql immutable as $$
  select case when p_url is null or p_url = '' then null when position('/chat-images/' in p_url) = 0 then null
    else split_part(split_part(p_url, '/chat-images/', 2), '?', 1) end; $$;
create function public.es_insumo(categoria text) returns boolean language sql immutable as $$
  select coalesce(trim(categoria), '') = any (array['Temperado','Mica','Otro insumo']); $$;
create function public.es_repuesto(categoria text) returns boolean language sql immutable as $$
  select coalesce(trim(categoria), '') = any (array['LCD','Batería','Repuestos']); $$;

-- ---- funciones que la migración cambia o cierra (definiciones de ANTES; solo importan firma y tipo) ----
create function public.purgar_huellas(p_dias integer default 180) returns integer language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  delete from public.visitor_fingerprints f where f.ultima_visita < now() - make_interval(days => greatest(coalesce(p_dias, 180), 7))
    and not exists (select 1 from public.blocked_users_list b where b.levantado_en is null and (b.email = lower(coalesce(f.email, '')) or b.huella = f.huella));
  get diagnostics v = row_count; return v;
end; $$;
create function public.purgar_retos_webauthn() returns integer language plpgsql security definer set search_path = public as $$
declare v integer;
begin delete from public.webauthn_challenges where expira_en < now() - interval '1 hour'; get diagnostics v = row_count; return v; end; $$;
create function public.conteo_historial() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('accesos_total', (select count(*) from public.login_audit_logs)); $$;
create function public.adjust_stock(p_items jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
begin return '[]'::jsonb; end; $$;
create function public.redeem_coupon(p_code text) returns jsonb language plpgsql security definer set search_path = public as $$
begin return '{}'::jsonb; end; $$;
create function public.set_invoice_pdf(p_invoice_id text, p_pdf_url text, p_qr_data text) returns void language plpgsql security definer set search_path = public as $$
begin update public.invoices set pdf_url = p_pdf_url, qr_data = p_qr_data where id = p_invoice_id; end; $$;
create function public.issue_invoice(p_order_id text, p_tipo_doc text, p_customer_identification_type text, p_customer_identification text,
  p_customer_name text, p_customer_email text, p_medio_pago text, p_items jsonb, p_subtotal numeric, p_iva_total numeric, p_total numeric,
  p_garantia_meses smallint default null::smallint) returns jsonb language plpgsql security definer set search_path = public as $$
begin return '{}'::jsonb; end; $$;
create function public.admin_reset_security_pin(p_user_id uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.es_admin_supremo() then raise exception 'Solo el administrador supremo puede restablecer el PIN de otra cuenta.'; end if;
  update public.profiles set security_pin_hash = null where id = p_user_id and role = 'Dueño';
  if not found then raise exception 'Cuenta no encontrada.'; end if;
end; $$;

-- funciones «solo personal» (el cuerpo no importa para las pruebas de permisos)
create function public.banear_cliente_total(p_email text, p_motivo text default null, p_bloquear_user_agent boolean default false) returns jsonb language sql security definer as $$ select '{}'::jsonb $$;
create function public.banear_dispositivo(p_device text, p_motivo text default null) returns jsonb language sql security definer as $$ select '{}'::jsonb $$;
create function public.levantar_baneo_cliente(p_email text) returns jsonb language sql security definer as $$ select '{}'::jsonb $$;
create function public.levantar_dispositivo(p_device text) returns jsonb language sql security definer as $$ select '{}'::jsonb $$;
create function public.purgar_bitacora(p_dias integer default null) returns integer language sql security definer as $$ select 0 $$;
create function public.purgar_chats() returns table(mensajes bigint, conversaciones bigint, rutas text[]) language sql security definer as $$ select 0::bigint, 0::bigint, '{}'::text[] $$;
create function public.purgar_conversacion(p_id text) returns table(mensajes bigint, rutas text[]) language sql security definer as $$ select 0::bigint, '{}'::text[] $$;
create function public.borrar_mensaje_chat(p_id text) returns table(conversacion text, rutas text[]) language sql security definer as $$ select ''::text, '{}'::text[] $$;
create function public.admin_list_duenos() returns table(id uuid, email text, name text, tiene_pin boolean) language sql security definer as $$ select null::uuid, ''::text, ''::text, false $$;
create function public.dlp_fijar(p_user_id uuid, p_web boolean, p_apk boolean) returns void language sql security definer as $$ select $$;
create function public.dlp_listar() returns table(user_id uuid, email text, rol text, allow_web boolean, allow_apk boolean) language sql security definer as $$ select null::uuid, ''::text, ''::text, false, false $$;
create function public.visitante_mirar(p_visita text, p_watch boolean) returns void language sql security definer as $$ select $$;

-- funciones de disparador
create function public.archivar_producto_agotado() returns trigger language plpgsql security definer set search_path = public as $$
begin if new.stock <= 0 and new.active is distinct from false then new.active := false; end if; return new; end; $$;
create function public.forzar_rol_inmutable() returns trigger language plpgsql security definer as $$ begin return new; end; $$;
create function public.proteger_columnas_pin() returns trigger language plpgsql security definer as $$ begin return new; end; $$;
create function public.proteger_supervision_watch() returns trigger language plpgsql security definer as $$ begin return new; end; $$;
create function public.sellar_dlp_whitelist() returns trigger language plpgsql security definer as $$ begin return new; end; $$;
create trigger trg_archivar_producto_agotado before insert or update on public.products for each row execute function public.archivar_producto_agotado();

-- ---- RLS y políticas (las de producción) ----
alter table public.products enable row level security;
create policy products_public_read on public.products for select using ((active is distinct from false) or public.is_staff());
create policy products_staff_update on public.products for update using (public.is_staff()) with check (public.is_staff());
create policy products_staff_write on public.products for insert with check (public.is_staff());
alter table public.orders enable row level security;
create policy orders_insert_public on public.orders for insert with check (true);
create policy orders_select_own_or_staff on public.orders for select using ((customer_email = public.current_email()) or public.is_staff());
create policy orders_staff_update on public.orders for update using (public.is_staff());
alter table public.invoices enable row level security;
create policy invoices_select_own_or_staff on public.invoices for select using ((customer_email = public.current_email()) or public.is_staff());
alter table public.client_profiles enable row level security;
create policy clients_insert_public on public.client_profiles for insert with check (true);
create policy clients_select_own_or_staff on public.client_profiles for select using ((profile_id = (select auth.uid())) or (email = public.current_email()) or public.is_staff());
create policy clients_update_own_or_staff on public.client_profiles for update using ((profile_id = (select auth.uid())) or public.is_staff());
alter table public.chat_conversations enable row level security;
create policy chat_conv_insert_public on public.chat_conversations for insert with check (true);
create policy chat_conv_select_own_or_staff on public.chat_conversations for select using (public.is_staff() or (customer_email = public.current_email()));
create policy chat_conv_customer_update_unclaimed on public.chat_conversations for update using (assigned_admin_email is null) with check (assigned_admin_email is null);
create policy chat_conv_staff_update on public.chat_conversations for update using (public.is_staff());
alter table public.chat_messages enable row level security;
create policy chat_msg_insert_public on public.chat_messages for insert with check (true);
create policy chat_msg_select_own_or_staff on public.chat_messages for select using (public.is_staff() or exists (select 1 from public.chat_conversations c where c.id = chat_messages.conversation_id and c.customer_email = public.current_email()));
alter table public.visitor_fingerprints enable row level security;
alter table public.ubicaciones_compartidas enable row level security;
create policy ubic_insert on public.ubicaciones_compartidas for insert with check (true);
alter table public.marketing_campaigns enable row level security;
create policy marketing_staff_all on public.marketing_campaigns for all using (public.is_staff()) with check (public.is_staff());
alter table public.banners enable row level security;
create policy banners_public_read on public.banners for select using (true);
create policy banners_staff_write on public.banners for insert with check (public.is_staff());
create policy banners_staff_update on public.banners for update using (public.is_staff());
create policy banners_staff_delete on public.banners for delete using (public.is_staff());
alter table public.app_settings enable row level security;
create policy settings_public_read on public.app_settings for select using (true);
create policy settings_owner_write on public.app_settings for update using (public.is_owner());

-- políticas de storage (las de producción)
create policy invoices_storage_insert_public on storage.objects for insert with check (bucket_id = 'invoices');
create policy marketing_staff_insert on storage.objects for insert to authenticated with check (bucket_id = 'marketing');
create policy marketing_staff_update on storage.objects for update to authenticated using (bucket_id = 'marketing') with check (bucket_id = 'marketing');
create policy marketing_staff_delete on storage.objects for delete to authenticated using (bucket_id = 'marketing');
create policy chat_images_insert_cliente on storage.objects for insert to anon, authenticated
  with check ((bucket_id = 'chat-images') and (name ~ '^[^/]+/[0-9]+\.[A-Za-z0-9]{1,5}$') and public.conversacion_existe(split_part(name, '/', 1)));
create policy marketing_lectura on storage.objects for select using (bucket_id = 'marketing');
create policy chat_images_select_staff on storage.objects for select using (bucket_id = 'chat-images' and public.is_staff());
