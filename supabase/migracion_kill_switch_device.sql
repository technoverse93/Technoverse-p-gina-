-- =====================================================================
-- KILL SWITCH · bloqueo por APARATO FÍSICO + arranque instantáneo del espejo
-- =====================================================================
-- APLICADO Y VERIFICADO EN PRODUCCIÓN. Amplía el Kill Switch (ver
-- migracion_kill_switch.sql) con un cuarto objetivo, y abre el canal del
-- espejo para que el Superadmin pueda pedir una foto inmediata.
-- =====================================================================

-- 1) Cuarto objetivo: el aparato físico concreto (huella nativa/web),
--    distinto de 'modelo' que alcanza a TODOS los equipos de ese modelo.
alter table public.system_bans drop constraint if exists system_bans_tipo_check;
alter table public.system_bans add constraint system_bans_tipo_check
  check (tipo in ('email','ip','modelo','device'));

-- 2) La consulta recibe también la huella del aparato.
drop function if exists public.estoy_bloqueado(text);
create or replace function public.estoy_bloqueado(
  p_modelo text default null,
  p_device text default null
)
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
      or (b.tipo = 'device' and p_device is not null and b.valor = trim(p_device))
    )
  limit 1;
end;
$$;
grant execute on function public.estoy_bloqueado(text, text) to anon, authenticated;

-- 3) El Superadmin puede MANDAR por el canal del espejo (no solo el dueño),
--    para pedir "volcá tu DOM ahora" y arrancar el espejo al instante.
drop policy if exists espejo_enviar on realtime.messages;
create policy espejo_enviar on realtime.messages
  for insert to authenticated
  with check (
    realtime.topic() = 'espejo:' || auth.uid()::text
    or (realtime.topic() like 'espejo:%' and public.is_superadmin())
  );

-- 4) El latido del personal deja el modelo exacto y la huella del aparato.
alter table public.supervision_state add column if not exists modelo text;
alter table public.supervision_state add column if not exists device text;
