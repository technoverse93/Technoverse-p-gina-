-- =====================================================================
-- JARVIS (PHILL): TAREAS EN SEGUNDO PLANO — encargos que hace solo
-- =====================================================================
-- «Phill, investigá los precios de los cargadores y decime a cuánto
-- conviene venderlos», «armame el cierre del día»: Phill lo deja como un
-- encargo, lo hace por su cuenta (aunque la app esté cerrada) y te avisa al
-- terminar con una notificación y el resultado en el chat.
--
--   · jarvis_tareas: cada encargo, su plan de pasos y su resultado. Solo la
--     persona dueña (superadmin) la lee; las escrituras las hace la función.
--   · Una tarea programada (pg_cron) cada 2 minutos retoma lo que quedó a
--     medias (el trabajo arranca solo en cuanto se pide; esto es la red de
--     seguridad por si la función se cortó).
-- En segundo plano Phill SOLO consulta e investiga: no cambia nada del
-- sistema (cobrar, bloquear, editar…) porque no hay quién confirme.
-- Es estructura y una tarea programada: no toca ni borra datos existentes.
-- =====================================================================

create table if not exists public.jarvis_tareas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversacion_id uuid references public.ia_conversaciones(id) on delete set null,
  titulo text not null,
  instruccion text not null,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'corriendo', 'lista', 'error', 'cancelada')),
  -- [{ n, objetivo, estado: 'pendiente'|'hecho'|'fallo', resultado, ms }]
  plan jsonb not null default '[]'::jsonb,
  resultado text,
  error text,
  intentos int not null default 0,
  creada_en timestamptz not null default now(),
  empezada_en timestamptz,
  terminada_en timestamptz,
  actualizada_en timestamptz not null default now(),
  -- «llave» de quien la está trabajando: si vence, otra pasada la retoma.
  bloqueada_hasta timestamptz
);
create index if not exists jarvis_tareas_usuario_idx on public.jarvis_tareas (user_id, creada_en desc);
create index if not exists jarvis_tareas_trabajo_idx on public.jarvis_tareas (estado, creada_en)
  where estado in ('pendiente', 'corriendo');

alter table public.jarvis_tareas enable row level security;

drop policy if exists jarvis_tareas_ver on public.jarvis_tareas;
create policy jarvis_tareas_ver on public.jarvis_tareas
  for select to authenticated
  using (user_id = auth.uid() and public.is_superadmin());

-- Lo único que la persona puede hacer desde la app: cancelar un encargo suyo que sigue en curso.
drop policy if exists jarvis_tareas_cancelar on public.jarvis_tareas;
create policy jarvis_tareas_cancelar on public.jarvis_tareas
  for update to authenticated
  using (user_id = auth.uid() and public.is_superadmin() and estado in ('pendiente', 'corriendo'))
  with check (user_id = auth.uid() and estado = 'cancelada');

-- En vivo hacia la app (la tarjeta del chat muestra el avance).
do $$ begin
  alter publication supabase_realtime add table public.jarvis_tareas;
exception when duplicate_object then null; end $$;

-- Red de seguridad: cada 2 minutos se retoma lo pendiente o lo que se cortó a medias
-- (necesita la llave de jarvis_cron y la función jarvis_llamar de migracion_jarvis_proactivo.sql).
select cron.schedule('jarvis-tareas', '*/2 * * * *', $$ select public.jarvis_llamar('tareas') $$);
