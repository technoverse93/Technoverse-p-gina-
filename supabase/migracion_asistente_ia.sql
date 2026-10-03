-- ===========================================================================
-- ASISTENTE IA DEL PANEL (oct 2026)
-- ===========================================================================
-- Chat de consulta para el personal, con IA gratuita: Gemini (Google) como
-- principal y Groq como respaldo. Todo lo que habla con las IA pasa por la
-- Edge Function `asistente-ia`, que usa service_role; desde la app el
-- personal solo LEE sus propias conversaciones.
--
--   ia_ajustes        una fila: límites y quién puede usarlo (superadmin)
--   ia_conversaciones las conversaciones de cada persona (privadas)
--   ia_mensajes       los mensajes, con tokens y proveedor que respondió
--   ia_uso_diario     cuántos mensajes y tokens usó cada persona cada día
--
-- PRIVACIDAD: cada quien lee solo lo suyo. El superadmin NO lee
-- conversaciones ajenas; solo ve el uso (ia_uso_diario).
-- ===========================================================================

create table if not exists public.ia_ajustes (
  id smallint primary key default 1 check (id = 1),
  limite_diario integer not null default 60 check (limite_diario between 1 and 2000),
  busqueda boolean not null default true,
  respaldo boolean not null default true,
  -- 'personal' = todo el personal · 'gestion' = superadmin y admins · 'super' = solo el superadmin
  acceso text not null default 'personal' check (acceso in ('personal', 'gestion', 'super')),
  actualizado_en timestamptz not null default now()
);
insert into public.ia_ajustes (id) values (1) on conflict (id) do nothing;

create table if not exists public.ia_conversaciones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  titulo text not null default 'Conversación nueva',
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists ia_conversaciones_user on public.ia_conversaciones (user_id, actualizado_en desc);

create table if not exists public.ia_mensajes (
  id uuid primary key default gen_random_uuid(),
  conversacion_id uuid not null references public.ia_conversaciones(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rol text not null check (rol in ('user', 'assistant')),
  texto text not null,
  fuentes jsonb not null default '[]'::jsonb,
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  proveedor text,
  modelo text,
  busco boolean not null default false,
  creado_en timestamptz not null default now()
);
create index if not exists ia_mensajes_conv on public.ia_mensajes (conversacion_id, creado_en);

create table if not exists public.ia_uso_diario (
  user_id uuid not null references auth.users(id) on delete cascade,
  dia date not null default (now() at time zone 'America/Costa_Rica')::date,
  mensajes integer not null default 0,
  tokens integer not null default 0,
  gemini integer not null default 0,
  groq integer not null default 0,
  primary key (user_id, dia)
);

alter table public.ia_ajustes enable row level security;
alter table public.ia_conversaciones enable row level security;
alter table public.ia_mensajes enable row level security;
alter table public.ia_uso_diario enable row level security;

-- Ajustes: cualquiera del personal los lee (para saber su límite); solo el
-- superadmin los cambia.
drop policy if exists "ia ajustes lectura" on public.ia_ajustes;
create policy "ia ajustes lectura" on public.ia_ajustes for select using (public.is_staff());
drop policy if exists "ia ajustes superadmin" on public.ia_ajustes;
create policy "ia ajustes superadmin" on public.ia_ajustes for update using (public.is_superadmin()) with check (public.is_superadmin());

-- Conversaciones y mensajes: cada quien lo suyo. Borrar sí, escribir no:
-- los mensajes los escribe solo la función del servidor.
drop policy if exists "ia conv propias" on public.ia_conversaciones;
create policy "ia conv propias" on public.ia_conversaciones for select using (user_id = auth.uid());
drop policy if exists "ia conv borrar propias" on public.ia_conversaciones;
create policy "ia conv borrar propias" on public.ia_conversaciones for delete using (user_id = auth.uid());
drop policy if exists "ia msg propios" on public.ia_mensajes;
create policy "ia msg propios" on public.ia_mensajes for select using (user_id = auth.uid());

-- Uso: cada quien el suyo; el superadmin el de todos (sin contenido).
drop policy if exists "ia uso propio o superadmin" on public.ia_uso_diario;
create policy "ia uso propio o superadmin" on public.ia_uso_diario for select using (user_id = auth.uid() or public.is_superadmin());

-- Uso de hoy de todo el personal, con el correo, para la pantalla de Ajustes.
create or replace function public.ia_uso_de_hoy()
returns table (email text, mensajes integer, tokens integer, es_super boolean)
language sql stable security definer set search_path to 'public'
as $$
  select p.email, coalesce(u.mensajes, 0), coalesce(u.tokens, 0), p.role = 'superadmin'
    from public.profiles p
    left join public.ia_uso_diario u
      on u.user_id = p.id and u.dia = (now() at time zone 'America/Costa_Rica')::date
   where public.is_superadmin() and p.role in ('superadmin', 'admin', 'empleado')
   order by coalesce(u.mensajes, 0) desc, p.email;
$$;
revoke all on function public.ia_uso_de_hoy() from public, anon;
grant execute on function public.ia_uso_de_hoy() to authenticated;
