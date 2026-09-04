-- =====================================================================
-- ZERO TRUST · Etapa 3 — SUPERVISIÓN EN VIVO (espejo de sesión)
-- =====================================================================
-- Espejo del DOM del empleado, bajo demanda. Dos tablas:
--
--   supervision_state  : presencia + control. El empleado escribe su
--                        latido (ruta, entorno, last_seen); el superadmin
--                        escribe `watch` para pedir/soltar el espejo.
--   supervision_events : los lotes de eventos rrweb del empleado mientras
--                        está siendo observado.
--
-- SEGURIDAD (falla cerrado): el stream lo LEE solo el superadmin (RLS).
-- El empleado no puede activar su propio `watch` (un trigger lo revierte),
-- así que nadie se auto-observa ni observa a otro. El transporte es
-- postgres_changes con RLS —el mismo patrón de la auditoría de ingresos—,
-- no broadcast crudo, justamente para que la política mande sobre quién
-- recibe cada fila.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Presencia + control
-- ---------------------------------------------------------------------
create table if not exists public.supervision_state (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  ruta       text,
  entorno    text,
  last_seen  timestamptz not null default now(),
  watch      boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.supervision_state enable row level security;

-- El superadmin ve a todos; cada empleado ve SU fila (para saber si lo miran).
drop policy if exists supervision_state_select on public.supervision_state;
create policy supervision_state_select on public.supervision_state
  for select to authenticated
  using (public.is_superadmin() or user_id = auth.uid());

-- Escritura: staff sobre su propia fila; el superadmin sobre cualquiera.
drop policy if exists supervision_state_write on public.supervision_state;
create policy supervision_state_write on public.supervision_state
  for all to authenticated
  using (public.is_staff() and (user_id = auth.uid() or public.is_superadmin()))
  with check (public.is_staff() and (user_id = auth.uid() or public.is_superadmin()));

-- `watch` es del superadmin y de nadie más. Aunque el empleado escriba su
-- latido, el trigger le devuelve el valor anterior de watch.
create or replace function public.proteger_supervision_watch()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
begin
  if not public.is_superadmin() then
    new.watch := coalesce(old.watch, false);
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists proteger_supervision_watch_trg on public.supervision_state;
create trigger proteger_supervision_watch_trg
  before insert or update on public.supervision_state
  for each row execute function public.proteger_supervision_watch();

-- ---------------------------------------------------------------------
-- Stream de eventos rrweb
-- ---------------------------------------------------------------------
create table if not exists public.supervision_events (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  lote       jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_supervision_events_user_created
  on public.supervision_events (user_id, created_at);
alter table public.supervision_events enable row level security;

-- LEE solo el superadmin: por eso el espejo no puede filtrarse a nadie más.
drop policy if exists supervision_events_select on public.supervision_events;
create policy supervision_events_select on public.supervision_events
  for select to authenticated using (public.is_superadmin());

-- El empleado escribe SUS lotes, y solo los suyos.
drop policy if exists supervision_events_insert on public.supervision_events;
create policy supervision_events_insert on public.supervision_events
  for insert to authenticated with check (user_id = auth.uid() and public.is_staff());

-- Y limpia SUS lotes al terminar (no deja rastro pesado en la base).
drop policy if exists supervision_events_delete on public.supervision_events;
create policy supervision_events_delete on public.supervision_events
  for delete to authenticated using (user_id = auth.uid());

grant select, insert, update on public.supervision_state  to authenticated;
grant select, insert, delete on public.supervision_events to authenticated;

-- Realtime (idempotente)
do $$ begin alter publication supabase_realtime add table public.supervision_state;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.supervision_events;
exception when duplicate_object then null; when undefined_object then null; end $$;
