-- =====================================================================
-- JARVIS · acciones del superadmin con confirmación
-- =====================================================================
-- Jarvis (el Asistente IA del superadmin) no ejecuta nada directo: cuando
-- se le pide una acción, el servidor la PREPARA y la guarda aquí. Se
-- ejecuta solo cuando el superadmin toca «Confirmar» en la tarjeta, una
-- sola vez, antes de que venza (5 minutos), con su propia sesión.
--
-- Nadie escribe en esta tabla desde el navegador: no hay políticas de
-- insert/update/delete. Solo la función `asistente-ia` (service role),
-- después de verificar quién llama. El superadmin puede LEER las suyas
-- (para ver el estado de cada tarjeta al reabrir una conversación).
-- =====================================================================

create table if not exists public.ia_acciones (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  conversacion_id uuid references public.ia_conversaciones(id) on delete set null,
  accion          text not null,                       -- 'bloquear_acceso'
  args            jsonb not null default '{}'::jsonb,   -- lo que pidió la IA, validado
  objetivo        jsonb not null default '{}'::jsonb,   -- lo que encontró el servidor
  tarjeta         jsonb not null default '{}'::jsonb,   -- lo que se muestra en pantalla
  opciones        jsonb,                                -- lo que eligió el superadmin
  estado          text not null default 'propuesta'
                  check (estado in ('propuesta','ejecutando','ejecutada','fallida','cancelada','vencida','deshecha')),
  resultado       jsonb,
  creada_en       timestamptz not null default now(),
  vence_en        timestamptz not null default now() + interval '5 minutes',
  ejecutada_en    timestamptz,
  deshacer_hasta  timestamptz
);
create index if not exists ia_acciones_user on public.ia_acciones (user_id, creada_en desc);
create index if not exists ia_acciones_conv on public.ia_acciones (conversacion_id);
alter table public.ia_acciones enable row level security;
drop policy if exists ia_acciones_leer on public.ia_acciones;
create policy ia_acciones_leer on public.ia_acciones
  for select to authenticated
  using (user_id = auth.uid() and public.is_superadmin());

-- Cada respuesta recuerda con qué velocidad y en qué modo se dio.
alter table public.ia_mensajes
  add column if not exists perfil  text,
  add column if not exists persona text,
  add column if not exists ms      integer;

-- ---------------------------------------------------------------------
-- Cerrar la sesión de otra persona en todos sus equipos.
-- ---------------------------------------------------------------------
create or replace function public.revocar_sesiones(p_user uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  if not public.is_superadmin() then
    raise exception 'Solo el superadmin puede cerrar sesiones de otras personas';
  end if;
  if p_user = auth.uid() then
    raise exception 'No podés cerrar tu propia sesión desde Jarvis';
  end if;
  if exists (select 1 from public.profiles p where p.id = p_user and p.role = 'superadmin') then
    raise exception 'No se puede cerrar la sesión de otro superadmin';
  end if;
  delete from auth.refresh_tokens r
   where r.session_id in (select s.id from auth.sessions s where s.user_id = p_user);
  delete from auth.sessions s where s.user_id = p_user;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.revocar_sesiones(uuid) from public, anon;
grant execute on function public.revocar_sesiones(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Sesiones abiertas de una persona (por correo o nombre), solo superadmin.
-- ---------------------------------------------------------------------
create or replace function public.sesiones_de(p_buscar text)
returns table (persona uuid, correo text, nombre text, rol text, sesion uuid,
               creada timestamptz, actividad timestamptz, agente text, ip text)
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_superadmin() then
    raise exception 'Solo el superadmin';
  end if;
  return query
  select p.id, p.email, p.name, p.role, s.id, s.created_at,
         coalesce(s.refreshed_at at time zone 'UTC', s.updated_at, s.created_at),
         s.user_agent, host(s.ip)
    from public.profiles p
    join auth.sessions s on s.user_id = p.id
   where length(trim(coalesce(p_buscar, ''))) >= 3
     and (p.email ilike '%' || trim(p_buscar) || '%' or p.name ilike '%' || trim(p_buscar) || '%')
   order by 7 desc
   limit 60;
end $$;
revoke all on function public.sesiones_de(text) from public, anon;
grant execute on function public.sesiones_de(text) to authenticated;

-- ---------------------------------------------------------------------
-- ¿Sigue viva mi sesión? Lo pregunta cada panel cuando el Kill Switch
-- avisa «revisá tu sesión»: si se la cerraron, vuelve al inicio.
-- ---------------------------------------------------------------------
create or replace function public.mi_sesion_vigente()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select case
    when auth.uid() is null or coalesce(auth.jwt() ->> 'session_id', '') = '' then true
    else exists (select 1 from auth.sessions s where s.id = (auth.jwt() ->> 'session_id')::uuid)
  end;
$$;
revoke all on function public.mi_sesion_vigente() from public;
grant execute on function public.mi_sesion_vigente() to anon, authenticated;
