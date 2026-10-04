-- =====================================================================
-- JARVIS · memoria, tono y valoraciones (fase 2)
-- =====================================================================
-- Va DESPUÉS de migracion_jarvis_acciones.sql.
--
-- · jarvis_memoria: lo que Jarvis recuerda del dueño (preferencias, datos
--   del negocio, su forma de pedir las cosas). Se inyecta en cada
--   conversación. Nunca datos de clientes: viaja a Google. El dueño la ve,
--   la edita y la borra desde Ajustes.
-- · ia_mensajes.valoracion: 👍 / 👎 de cada respuesta. Las buenas sirven
--   de ejemplo de estilo; las malas, de «esto no».
-- · ia_ajustes.tono: formal / tico moderado / tico suelto.
-- =====================================================================

create table if not exists public.jarvis_memoria (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  texto      text not null check (length(texto) between 3 and 300),
  tipo       text not null default 'preferencia'
             check (tipo in ('preferencia','negocio','forma_de_hablar')),
  origen     text not null default 'explicita' check (origen in ('explicita','sugerida','manual')),
  creada_en  timestamptz not null default now()
);
create index if not exists jarvis_memoria_user on public.jarvis_memoria (user_id, creada_en desc);
alter table public.jarvis_memoria enable row level security;
drop policy if exists jarvis_memoria_leer on public.jarvis_memoria;
create policy jarvis_memoria_leer on public.jarvis_memoria
  for select to authenticated using (user_id = auth.uid() and public.is_superadmin());
drop policy if exists jarvis_memoria_cambiar on public.jarvis_memoria;
create policy jarvis_memoria_cambiar on public.jarvis_memoria
  for update to authenticated using (user_id = auth.uid() and public.is_superadmin())
  with check (user_id = auth.uid() and public.is_superadmin());
drop policy if exists jarvis_memoria_borrar on public.jarvis_memoria;
create policy jarvis_memoria_borrar on public.jarvis_memoria
  for delete to authenticated using (user_id = auth.uid() and public.is_superadmin());
drop policy if exists jarvis_memoria_crear on public.jarvis_memoria;
create policy jarvis_memoria_crear on public.jarvis_memoria
  for insert to authenticated with check (user_id = auth.uid() and public.is_superadmin());

alter table public.ia_mensajes
  add column if not exists valoracion      smallint check (valoracion in (-1, 1)),
  add column if not exists nota_valoracion text;

alter table public.ia_ajustes
  add column if not exists tono text not null default 'tico_moderado';
do $$ begin
  alter table public.ia_ajustes add constraint ia_ajustes_tono_valido
    check (tono in ('formal','tico_moderado','tico_suelto'));
exception when duplicate_object then null; end $$;
