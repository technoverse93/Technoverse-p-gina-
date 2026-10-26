-- =====================================================================
-- AVISOS WEB · el navegador avisa de un chat aunque esté cerrado (sin Firebase) · 2026-10-26
-- =====================================================================
-- QUÉ AGREGA. Los navegadores (Chrome en el teléfono o la compu, Edge, Firefox, Safari) traen su propio
-- servicio de avisos estándar (Web Push). El personal activa los avisos en su navegador desde el panel
-- (src/utils/avisosWeb.ts) y la función asistente-ia (avisosWeb.ts) le manda cada mensaje nuevo de un
-- cliente CIFRADO para ese navegador, junto con los teléfonos de migracion_chat_push.sql.
--
--   · avisos_web: una fila por navegador suscrito (dirección del servicio de avisos y sus dos claves
--     públicas). Nadie la lee ni la escribe desde la API: solo la función (service_role) y estas dos
--     funciones, y solo para la sesión propia.
--   · registrar_avisos_web(...): solo el personal; solo direcciones de los servicios de avisos conocidos
--     (Google, Mozilla, Microsoft, Apple) para que la función nunca le mande pedidos a otro sitio; hasta 10
--     navegadores por persona (el más viejo se descarta).
--   · quitar_avisos_web(endpoint): al apagarlos o cerrar sesión; cada quien solo los suyos.
--
-- CÓMO SE APLICA. Después de migracion_chat_push.sql (usa la misma puerta jarvis_llamar y el mismo gatillo:
-- este archivo no toca ninguno de los dos). Idempotente; es estructura, no toca datos existentes.
-- Probada con supabase/pruebas/avisos.sql.
-- =====================================================================

create table if not exists public.avisos_web (
  endpoint       text primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  p256dh         text not null,
  auth           text not null,
  agente         text,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint avisos_web_servicio_conocido check (
    char_length(endpoint) <= 1000
    and endpoint ~ '^https://(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)/'),
  -- p256dh: punto P-256 sin comprimir (65 bytes → 87 en base64url); auth: 16 bytes (→ 22).
  constraint avisos_web_claves check (p256dh ~ '^[A-Za-z0-9_-]{87}$' and auth ~ '^[A-Za-z0-9_-]{22}$'),
  constraint avisos_web_agente check (agente is null or char_length(agente) <= 120)
);
create index if not exists avisos_web_usuario_idx on public.avisos_web (user_id, actualizado_en desc);
alter table public.avisos_web enable row level security; -- sin políticas: solo service_role y las funciones de abajo
revoke all on public.avisos_web from anon, authenticated;

create or replace function public.registrar_avisos_web(p_endpoint text, p_p256dh text, p_auth text, p_agente text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_staff() then
    raise exception 'Solo el personal puede recibir avisos.' using errcode = '42501';
  end if;
  -- Las restricciones de la tabla validan la dirección y las claves (servicio conocido, largo exacto).
  insert into public.avisos_web (endpoint, user_id, p256dh, auth, agente)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth, left(p_agente, 120))
  on conflict (endpoint) do update
     set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth,
         agente = excluded.agente, actualizado_en = now();
  -- Hasta 10 navegadores por persona: el que hace más tiempo que no se renueva se descarta.
  delete from public.avisos_web
   where user_id = auth.uid()
     and endpoint not in (select endpoint from public.avisos_web where user_id = auth.uid()
                           order by actualizado_en desc limit 10);
end;
$$;

create or replace function public.quitar_avisos_web(p_endpoint text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.avisos_web where endpoint = p_endpoint and user_id = auth.uid();
$$;

revoke all on function public.registrar_avisos_web(text, text, text, text) from public, anon;
revoke all on function public.quitar_avisos_web(text) from public, anon;
grant execute on function public.registrar_avisos_web(text, text, text, text) to authenticated;
grant execute on function public.quitar_avisos_web(text) to authenticated;

-- REVERTIR:
--   drop function if exists public.quitar_avisos_web(text);
--   drop function if exists public.registrar_avisos_web(text, text, text, text);
--   drop table if exists public.avisos_web;
