-- ===========================================================================
-- BLOQUEOS, LISTA BLANCA, PENALIZADOS Y APARATOS: SOLO SUPERADMIN (oct 2026)
-- ===========================================================================
-- PENDIENTE: se corre a mano en el SQL Editor de Supabase (la herramienta
-- automática pidió aprobación). Al confirmarlo, cambiar a "YA EJECUTADO".
--
-- Hasta ahora estas cuatro tablas y las cuatro funciones de baneo exigían
-- `is_staff()`: cualquier persona del personal podía leerlas y cambiarlas
-- llamando a la base directamente, aunque la app ya no le mostrara nada.
-- Pasan a exigir `is_superadmin()`, la misma barrera de Ubicaciones,
-- Supervisión, Ingresos y la consola de Bloqueos.
--
-- LO QUE NO CAMBIA: el bloqueo automático por intentos fallidos
-- (`registrar_intento_login`) y las comprobaciones de si una IP, un aparato
-- o una cuenta están bloqueados (`acceso_bloqueado`, `estado_acceso_ip`,
-- `dispositivo_bloqueado`, `usuario_penalizado`, `ip_bloqueada_total`) son
-- SECURITY DEFINER y no pasan por estas reglas: siguen funcionando igual
-- para todos.
-- ===========================================================================

-- ---- banned_ips ----
drop policy if exists "staff lee bloqueos"   on public.banned_ips;
drop policy if exists "staff crea bloqueos"  on public.banned_ips;
drop policy if exists "staff edita bloqueos" on public.banned_ips;
drop policy if exists "staff borra bloqueos" on public.banned_ips;
create policy "superadmin lee bloqueos"   on public.banned_ips for select using (public.is_superadmin());
create policy "superadmin crea bloqueos"  on public.banned_ips for insert with check (public.is_superadmin());
create policy "superadmin edita bloqueos" on public.banned_ips for update using (public.is_superadmin()) with check (public.is_superadmin());
create policy "superadmin borra bloqueos" on public.banned_ips for delete using (public.is_superadmin());

-- ---- ip_whitelist ----
drop policy if exists "staff lee blanca"   on public.ip_whitelist;
drop policy if exists "staff crea blanca"  on public.ip_whitelist;
drop policy if exists "staff edita blanca" on public.ip_whitelist;
drop policy if exists "staff borra blanca" on public.ip_whitelist;
create policy "superadmin lee blanca"   on public.ip_whitelist for select using (public.is_superadmin());
create policy "superadmin crea blanca"  on public.ip_whitelist for insert with check (public.is_superadmin());
create policy "superadmin edita blanca" on public.ip_whitelist for update using (public.is_superadmin()) with check (public.is_superadmin());
create policy "superadmin borra blanca" on public.ip_whitelist for delete using (public.is_superadmin());

-- ---- blocked_users_list ----
drop policy if exists "dueño gestiona penalizados" on public.blocked_users_list;
create policy "superadmin gestiona penalizados" on public.blocked_users_list
  for all using ((select public.is_superadmin())) with check ((select public.is_superadmin()));

-- ---- banned_devices ----
drop policy if exists "dueño gestiona dispositivos baneados" on public.banned_devices;
create policy "superadmin gestiona dispositivos baneados" on public.banned_devices
  for all using ((select public.is_superadmin())) with check ((select public.is_superadmin()));

-- ---- Funciones de baneo manual ----
-- Se cambia solo la primera comprobación de cada una; el resto del cuerpo
-- queda idéntico.
do $$
declare
  f text;
  def text;
begin
  foreach f in array array['banear_cliente_total', 'banear_dispositivo', 'levantar_baneo_cliente', 'levantar_dispositivo'] loop
    select pg_get_functiondef(p.oid) into def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = f;
    if def is null then raise exception 'No existe la función %', f; end if;
    if position('if not public.is_staff() then raise exception ''No autorizado''; end if;' in def) = 0 then
      raise exception 'La función % no tiene la comprobación esperada; no se toca.', f;
    end if;
    def := replace(def,
      'if not public.is_staff() then raise exception ''No autorizado''; end if;',
      'if not public.is_superadmin() then raise exception ''Solo el superadmin puede bloquear o desbloquear.''; end if;');
    execute def;
  end loop;
end $$;
