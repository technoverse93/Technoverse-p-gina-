-- =====================================================================
-- SUPERVISIÓN DE CLIENTES EN LA TIENDA (por modelo de aparato)
-- =====================================================================
-- Ya APLICADO en producción. Se deja como registro, igual que el resto
-- de migraciones del proyecto.
--
-- Extiende el espejo a quien navega la tienda, tenga sesión o no.
--
-- REGLA DE PRIVACIDAD, ESCRITA EN EL ESQUEMA:
-- esta tabla NO tiene, ni debe tener nunca, correo, nombre, IP ni
-- user_id. El ÚNICO identificador es el MODELO del aparato ("Honor X6b",
-- "SM-A125M", "Tablet"...). Aunque el visitante tenga sesión iniciada,
-- aquí no se guarda quién es: se ve "un Honor X6b está en /tienda",
-- nunca "Fulano está en /tienda".
--
-- ALCANCE: el espejo solo reproduce NUESTRA propia página; rrweb no ve
-- —ni puede ver— nada fuera de la aplicación.
-- =====================================================================

create table if not exists public.supervision_visitantes (
  visita     text primary key,          -- id aleatorio del aparato, sin identidad
  modelo     text,                      -- ÚNICO identificador permitido
  tipo       text,                      -- Móvil / Tablet / Escritorio
  entorno    text,                      -- web | apk
  ruta       text,
  last_seen  timestamptz not null default now(),
  watch      boolean not null default false
);
alter table public.supervision_visitantes enable row level security;

-- Solo el superadmin puede LEER la lista de visitantes.
drop policy if exists supervision_visitantes_select on public.supervision_visitantes;
create policy supervision_visitantes_select on public.supervision_visitantes
  for select to authenticated
  using (public.is_superadmin());

-- Solo el superadmin puede borrar fichas colgadas (botón "Actualizar").
drop policy if exists supervision_visitantes_delete on public.supervision_visitantes;
create policy supervision_visitantes_delete on public.supervision_visitantes
  for delete to authenticated
  using (public.is_superadmin());

grant select, delete on public.supervision_visitantes to authenticated;

-- ---------------------------------------------------------------------
-- Latido del visitante (anónimo o con sesión)
-- ---------------------------------------------------------------------
-- El visitante NO escribe la tabla directamente: lo hace por esta
-- función, igual que `registrar_huella`. Así nunca puede leer a otros ni
-- ponerse `watch` a sí mismo.
--
-- Devuelve el `watch` vigente: es la forma de que el visitante sepa si
-- debe transmitir, sin darle permiso de lectura sobre la tabla.
create or replace function public.visitante_latido(
  p_visita text, p_modelo text, p_tipo text, p_entorno text, p_ruta text
) returns boolean
language plpgsql security definer set search_path to 'public'
as $$
declare v_watch boolean;
begin
  if coalesce(btrim(p_visita), '') = '' then return false; end if;

  insert into public.supervision_visitantes (visita, modelo, tipo, entorno, ruta, last_seen)
  values (
    left(p_visita, 100),
    nullif(left(coalesce(p_modelo, ''), 80), ''),
    nullif(left(coalesce(p_tipo, ''), 20), ''),
    case when lower(coalesce(p_entorno, '')) = 'apk' then 'apk' else 'web' end,
    nullif(left(coalesce(p_ruta, ''), 200), ''),
    now()
  )
  on conflict (visita) do update
    set modelo = excluded.modelo,
        tipo = excluded.tipo,
        entorno = excluded.entorno,
        ruta = excluded.ruta,
        last_seen = now()
  returning watch into v_watch;

  return coalesce(v_watch, false);
end;
$$;
grant execute on function public.visitante_latido(text, text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- El superadmin pide o suelta el espejo de un visitante
-- ---------------------------------------------------------------------
create or replace function public.visitante_mirar(p_visita text, p_watch boolean)
returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if not public.is_superadmin() then
    raise exception 'Solo el administrador supremo puede supervisar visitantes';
  end if;
  update public.supervision_visitantes
     set watch = coalesce(p_watch, false)
   where visita = p_visita;
end;
$$;
grant execute on function public.visitante_mirar(text, boolean) to authenticated;

do $$ begin alter publication supabase_realtime add table public.supervision_visitantes;
exception when duplicate_object then null; when undefined_object then null; end $$;

-- ---------------------------------------------------------------------
-- Canal del espejo de un visitante: `espejo:v:<id-aparato>`
-- ---------------------------------------------------------------------
-- El visitante puede ser ANÓNIMO, así que no hay auth.uid() con el que
-- atarlo a su canal como se hace con el personal. El identificador del
-- canal es el id aleatorio del aparato, que no se puede adivinar ni
-- enumerar.
--
-- Compromiso asumido, dicho claro: alguien que YA conociera ese id
-- aleatorio podría unirse a ese canal. Lo que ahí viaja es el espejo de
-- nuestra propia tienda pública, sin datos personales, y el id no se
-- publica en ninguna parte. Se acepta a cambio de poder ver también a
-- los visitantes anónimos, que es lo que se pidió.
drop policy if exists espejo_visitante_unirse on realtime.messages;
create policy espejo_visitante_unirse on realtime.messages
  for select to anon, authenticated
  using (realtime.topic() like 'espejo:v:%');

drop policy if exists espejo_visitante_enviar on realtime.messages;
create policy espejo_visitante_enviar on realtime.messages
  for insert to anon, authenticated
  with check (realtime.topic() like 'espejo:v:%');
