-- =====================================================================
-- KILL SWITCH — bloqueo y expulsión instantánea
-- =====================================================================
-- APLICADO Y VERIFICADO EN PRODUCCIÓN. Lo consumen:
--   · src/seguridad/killSwitch.ts            — la vigilancia en cada aparato
--   · src/components/admin/ConsolaBloqueos.tsx — el panel del Superadmin
--
-- Tres formas de bloquear: por cuenta (correo), por dirección IP o por
-- modelo de aparato. Cada bloqueo puede ser temporal (`hasta`) o para
-- siempre (`hasta` nulo).
--
-- CÓMO SE LOGRA QUE SEA INSTANTÁNEO, SIN FILTRAR NADA
-- ---------------------------------------------------------------------
-- Todos los clientes están unidos al canal común `system_bans`. Al
-- bloquear o liberar, el panel manda por ahí un aviso VACÍO —un simple
-- "revisá tu estado"— y cada cliente pregunta por SÍ MISMO con
-- `estoy_bloqueado()`. Si el aviso llevara la lista, cualquiera con el
-- canal abierto sabría a quién se bloqueó; así no viaja ni un dato.
--
-- La IP la lee el SERVIDOR de la cabecera del proxy, así que no se puede
-- falsear desde el navegador. El modelo lo declara el propio aparato: ese
-- bloqueo disuade, pero no es infalsificable.
-- =====================================================================

create table if not exists public.system_bans (
  id         bigint generated always as identity primary key,
  tipo       text not null check (tipo in ('email','ip','modelo')),
  valor      text not null,
  motivo     text,
  hasta      timestamptz,               -- null = para siempre
  activo     boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now()
);

-- Un mismo objetivo no puede tener dos bloqueos activos a la vez.
create unique index if not exists idx_system_bans_activo
  on public.system_bans (tipo, lower(valor)) where activo;
create index if not exists idx_system_bans_busqueda
  on public.system_bans (activo, tipo);

alter table public.system_bans enable row level security;

-- La LISTA la ve y la administra SOLO el superadmin. Quién está bloqueado
-- no es asunto de los demás.
drop policy if exists system_bans_admin on public.system_bans;
create policy system_bans_admin on public.system_bans
  for all to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

grant select, insert, update, delete on public.system_bans to authenticated;

-- ---------------------------------------------------------------------
-- Cada quien pregunta SOLO por sí mismo
-- ---------------------------------------------------------------------
-- Devuelve fila únicamente si QUIEN LLAMA está bloqueado, así que el
-- cliente jamás recibe la lista: solo su propio veredicto. Sirve también
-- para un visitante anónimo de la tienda, que no tiene sesión.
create or replace function public.estoy_bloqueado(p_modelo text default null)
returns table (motivo text, hasta timestamptz)
language plpgsql security definer set search_path to 'public','auth'
as $$
declare
  v_email text;
  v_ip    text;
begin
  select u.email into v_email from auth.users u where u.id = auth.uid();

  begin
    v_ip := split_part(
      current_setting('request.headers', true)::json ->> 'x-forwarded-for', ',', 1);
  exception when others then v_ip := null;
  end;

  return query
  select b.motivo, b.hasta
  from public.system_bans b
  where b.activo
    and (b.hasta is null or b.hasta > now())
    and (
         (b.tipo = 'email'  and v_email  is not null and lower(b.valor) = lower(v_email))
      or (b.tipo = 'ip'     and v_ip     is not null and b.valor = trim(v_ip))
      or (b.tipo = 'modelo' and p_modelo is not null and lower(b.valor) = lower(trim(p_modelo)))
    )
  limit 1;
end;
$$;
grant execute on function public.estoy_bloqueado(text) to anon, authenticated;
