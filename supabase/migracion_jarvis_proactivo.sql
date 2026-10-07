-- =====================================================================
-- JARVIS PROACTIVO — te habla primero
-- =====================================================================
-- 1) jarvis_avisos: lo que Jarvis te avisa solo (chats esperando,
--    existencias en el mínimo, seguridad, ventas bajas, resumen de la
--    mañana). La app los recibe en vivo y los notifica en el teléfono.
-- 2) jarvis_cron: una llave aleatoria que solo ve la base. Las tareas
--    programadas la mandan y la función la compara: nadie de afuera puede
--    disparar estas tareas.
-- 3) Tareas programadas (pg_cron):
--      · cada 15 min ......... vigilar
--      · 7:00 a. m. (CR) ...... resumen de la mañana
--      · 2:30 a. m. (CR) ...... repaso del cerebro (ordenar y vectorizar)
-- Es estructura y tareas: no toca ni borra datos existentes.
-- =====================================================================

create table if not exists public.jarvis_avisos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tipo text not null,
  clave text not null,
  titulo text not null,
  cuerpo text not null,
  nivel text not null default 'info',
  destino text,
  creado_en timestamptz not null default now(),
  leido_en timestamptz,
  unique (user_id, clave)
);
create index if not exists jarvis_avisos_usuario_idx on public.jarvis_avisos (user_id, creado_en desc);

alter table public.jarvis_avisos enable row level security;
drop policy if exists jarvis_avisos_ver on public.jarvis_avisos;
create policy jarvis_avisos_ver on public.jarvis_avisos for select using (auth.uid() = user_id);
drop policy if exists jarvis_avisos_marcar on public.jarvis_avisos;
create policy jarvis_avisos_marcar on public.jarvis_avisos for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- En vivo hacia la app.
do $$ begin
  alter publication supabase_realtime add table public.jarvis_avisos;
exception when duplicate_object then null; end $$;

-- La llave de las tareas programadas (solo service_role la puede leer: RLS sin políticas).
create table if not exists public.jarvis_cron (
  id int primary key default 1 check (id = 1),
  clave text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
);
alter table public.jarvis_cron enable row level security;
insert into public.jarvis_cron (id) values (1) on conflict (id) do nothing;

-- Llama a la función de Jarvis con la llave (la clave anónima solo sirve para pasar la puerta).
create or replace function public.jarvis_llamar(p_tarea text)
returns bigint
language sql
security definer
set search_path = public, extensions
as $$
  select net.http_post(
    url := 'https://hzatdfrjcqiimgqxcwwh.supabase.co/functions/v1/asistente-ia',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh6YXRkZnJqY3FpaW1ncXhjd3doIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwNDk1ODksImV4cCI6MjA5OTYyNTU4OX0.mI199p1d-zMqQLZ86h-RFtg01Q4JJ8nWvfIBrQoX7Ic',
      'x-jarvis-cron', (select clave from public.jarvis_cron where id = 1)
    ),
    body := jsonb_build_object('accion', 'cron', 'tarea', p_tarea),
    timeout_milliseconds := 120000
  );
$$;
revoke all on function public.jarvis_llamar(text) from public, anon, authenticated;

-- Tareas (horas en UTC: Costa Rica es UTC-6).
select cron.schedule('jarvis-vigilar', '*/15 * * * *', $$ select public.jarvis_llamar('vigilar') $$);
select cron.schedule('jarvis-resumen', '0 13 * * *', $$ select public.jarvis_llamar('resumen') $$);
select cron.schedule('jarvis-repaso', '30 8 * * *', $$ select public.jarvis_llamar('repaso') $$);
