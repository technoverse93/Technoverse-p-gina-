-- =====================================================================
-- ZERO TRUST · Etapa 2 — AUDITORÍA DE INGRESOS
-- =====================================================================
-- Registra cada autenticación exitosa (web o APK) para que el Superadmin
-- la vea en vivo: correo del operador, hora exacta y entorno. Depende del
-- modelo de rol de la Etapa 1 (is_superadmin()).
--
-- El registro NO se hace por INSERT directo del cliente —eso permitiría
-- inventar ingresos falsos— sino por una función SECURITY DEFINER que
-- sella la fila con la identidad REAL de quien llama (auth.uid()). Y solo
-- el superadmin puede LEER la tabla (RLS). Realtime respeta esa misma RLS,
-- así que el feed en vivo solo llega a la sesión del superadmin.
-- =====================================================================

create table if not exists public.security_login_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete set null,
  email       text not null,
  entorno     text not null check (entorno in ('web', 'apk')),
  dispositivo text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_login_events_created
  on public.security_login_events (created_at desc);

alter table public.security_login_events enable row level security;

-- LECTURA: exclusiva del superadmin. Realtime hereda esta política, así
-- que nadie más recibe el feed aunque se suscriba al canal.
drop policy if exists login_events_select_superadmin on public.security_login_events;
create policy login_events_select_superadmin
  on public.security_login_events for select to authenticated
  using (public.is_superadmin());

-- Nada de escritura directa: el único camino es la RPC de abajo.
revoke insert, update, delete on public.security_login_events from authenticated, anon;
grant select on public.security_login_events to authenticated;  -- RLS lo acota al supremo

-- Registro sellado con la identidad real. El cliente solo aporta el
-- entorno y una cadena de dispositivo; el correo y el user_id salen de
-- auth.uid(), no de lo que mande el cliente, así que no se puede firmar
-- un ingreso a nombre de otro.
create or replace function public.registrar_ingreso(p_entorno text, p_dispositivo text)
returns void language plpgsql security definer set search_path to 'public'
as $$
declare v_email text;
begin
  if auth.uid() is null then return; end if;
  select email into v_email from auth.users where id = auth.uid();
  insert into public.security_login_events (user_id, email, entorno, dispositivo)
  values (
    auth.uid(),
    coalesce(v_email, ''),
    case when lower(coalesce(p_entorno, '')) = 'apk' then 'apk' else 'web' end,
    nullif(left(coalesce(p_dispositivo, ''), 200), '')
  );
end;
$$;

revoke all on function public.registrar_ingreso(text, text) from anon;
grant execute on function public.registrar_ingreso(text, text) to authenticated;

-- Alta en la publicación de Realtime (idempotente).
do $$
begin
  alter publication supabase_realtime add table public.security_login_events;
exception
  when duplicate_object then null;
  when undefined_object then null;  -- por si la publicación no existiera
end $$;
