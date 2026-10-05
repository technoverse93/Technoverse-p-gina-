-- =====================================================================
-- JARVIS · agenda del dueño (recordatorios y pendientes)
-- =====================================================================
-- Va DESPUÉS de migracion_jarvis_memoria.sql.
--
-- Jarvis como secretario: «recordame a las 3 llamar a Luis», «anotá que
-- hay que pedir pantallas», «¿qué tengo pendiente?», «ya hice lo de Luis».
--   · con `cuando`  = recordatorio: el teléfono avisa a esa hora.
--   · sin `cuando`  = pendiente: queda en la lista hasta marcarlo hecho.
-- Solo el superadmin, y cada uno ve únicamente lo suyo. No se borra nada:
-- lo hecho o cancelado cambia de estado.
-- =====================================================================

create table if not exists public.jarvis_agenda (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  texto      text not null check (length(texto) between 2 and 300),
  cuando     timestamptz,
  estado     text not null default 'pendiente' check (estado in ('pendiente','hecho','cancelado')),
  creado_en  timestamptz not null default now(),
  cerrado_en timestamptz
);
create index if not exists jarvis_agenda_user on public.jarvis_agenda (user_id, estado, cuando);
alter table public.jarvis_agenda enable row level security;
drop policy if exists jarvis_agenda_leer on public.jarvis_agenda;
create policy jarvis_agenda_leer on public.jarvis_agenda
  for select to authenticated using (user_id = auth.uid() and public.is_superadmin());
drop policy if exists jarvis_agenda_crear on public.jarvis_agenda;
create policy jarvis_agenda_crear on public.jarvis_agenda
  for insert to authenticated with check (user_id = auth.uid() and public.is_superadmin());
drop policy if exists jarvis_agenda_cambiar on public.jarvis_agenda;
create policy jarvis_agenda_cambiar on public.jarvis_agenda
  for update to authenticated using (user_id = auth.uid() and public.is_superadmin())
  with check (user_id = auth.uid() and public.is_superadmin());
