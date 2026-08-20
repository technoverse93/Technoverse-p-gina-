-- =====================================================================
-- GESTIÓN SUPREMA: cambio de PIN en 3 pasos, panel de administración de
-- cuentas Dueño, y cierre de un hueco real en los permisos de `profiles`
-- =====================================================================
-- Depende de supabase/migracion_token_seguridad_pin.sql (columnas
-- security_pin_* y las funciones has/set/verify_security_pin).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) change_security_pin(): cambio de PIN con el código ANTERIOR como
--    requisito, no solo el correo del admin supremo.
-- ---------------------------------------------------------------------
-- Antes, "cambiar el PIN" era solo set_security_pin() otra vez — sin
-- pedir el código viejo, cualquiera con el correo supremo podía
-- reemplazar el PIN sin demostrar que lo conocía. Esta función exige
-- verificar el PIN anterior PRIMERO (reutilizando verify_security_pin,
-- con su mismo bloqueo por intentos fallidos) y solo si eso da bien
-- llama a set_security_pin() con el nuevo. No duplica el hash ni el
-- bloqueo: los reutiliza tal cual.
create or replace function public.change_security_pin(p_pin_actual text, p_pin_nuevo text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ok boolean;
begin
  v_ok := public.verify_security_pin(p_pin_actual);
  if not v_ok then
    raise exception 'El código anterior no es correcto.';
  end if;
  perform public.set_security_pin(p_pin_nuevo);
end;
$$;

revoke all on function public.change_security_pin(text, text) from anon;
grant execute on function public.change_security_pin(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 2) Panel de Gestión Supremo: listar cuentas Dueño y restablecer el
--    PIN de cualquiera de ellas. Restringido en el propio servidor al
--    correo exacto technoverse.admin@gmail.com — la pantalla que lo usa
--    también se oculta en el cliente, pero la regla que de verdad manda
--    es esta, aquí.
-- ---------------------------------------------------------------------
create or replace function public.es_admin_supremo()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select lower(coalesce((select email from auth.users where id = auth.uid()), '')) = 'technoverse.admin@gmail.com';
$$;

revoke all on function public.es_admin_supremo() from anon;
grant execute on function public.es_admin_supremo() to authenticated;

-- Devuelve las cuentas con rol Dueño (administradores) para el panel de
-- gestión. Nunca expone `security_pin_hash`, solo si está configurado o
-- no (`tiene_pin`).
create or replace function public.admin_list_duenos()
returns table (id uuid, email text, name text, tiene_pin boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.es_admin_supremo() then
    raise exception 'Solo el administrador supremo puede ver este panel.';
  end if;
  return query
    select p.id, p.email, p.name, (p.security_pin_hash is not null)
      from public.profiles p
     where p.role = 'Dueño'
     order by p.email;
end;
$$;

revoke all on function public.admin_list_duenos() from anon;
grant execute on function public.admin_list_duenos() to authenticated;

-- Restablece (borra) el PIN de OTRA cuenta Dueño: la deja sin PIN, así
-- que en su próximo ingreso el sistema la fuerza a crear uno nuevo por
-- el flujo normal de primer ingreso (ver CrearTokenModal / App.tsx). El
-- admin supremo nunca llega a ver ni a escribir el PIN de otra persona:
-- solo puede forzar que se vuelva a crear.
create or replace function public.admin_reset_security_pin(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.es_admin_supremo() then
    raise exception 'Solo el administrador supremo puede restablecer el PIN de otra cuenta.';
  end if;
  update public.profiles
     set security_pin_hash = null,
         security_pin_set_at = null,
         security_pin_fails = 0,
         security_pin_locked_until = null
   where id = p_user_id
     and role = 'Dueño';
  if not found then
    raise exception 'Cuenta no encontrada.';
  end if;
end;
$$;

revoke all on function public.admin_reset_security_pin(uuid) from anon;
grant execute on function public.admin_reset_security_pin(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3) EL HUECO REAL: `profiles` tenía GRANT de TABLA completa (SELECT,
--    UPDATE, INSERT, DELETE) para `authenticated` Y `anon` desde antes
--    de este proyecto — no lo creó ninguna migración de aquí, ya estaba.
-- ---------------------------------------------------------------------
-- Eso es lo que dejaba inservible el `revoke select (...) on
-- public.profiles from authenticated, anon` de la migración del token:
-- en Postgres, un REVOKE a nivel de COLUMNA no gana contra un GRANT
-- vigente a nivel de TABLA sobre esa misma columna — el privilegio se
-- concede si CUALQUIERA de los dos lo permite. `security_pin_hash`
-- seguía siendo legible Y ESCRIBIBLE de forma directa (un UPDATE común
-- de PostgREST, sin pasar por ninguna función de aquí), filtrado solo
-- por RLS. Y las políticas de `profiles` son:
--
--   profiles_select_own_or_staff: id = auth.uid() OR is_staff()
--   profiles_update_own_or_owner: id = auth.uid() OR is_owner()
--
-- con is_staff() e is_owner() definidas HOY como, literalmente, "role =
-- 'Dueño'" — sin distinguir al supremo del resto. Es decir: cualquier
-- cuenta Dueño (no solo la suprema) podía leer el hash del PIN de
-- CUALQUIER otra cuenta Dueño (para intentar romperlo sin conexión —
-- bcrypt es lento, pero 10.000 combinaciones son pocas) y, peor,
-- podía escribir `security_pin_hash = null` de otra cuenta directamente
-- por REST, sin pasar por `set_security_pin()` ni por el filtro de
-- `technoverse.admin@gmail.com` que se acaba de construir arriba. El
-- "solo el administrador supremo" de este proyecto no era real hasta
-- este bloque.
--
-- La corrección real: revocar el GRANT de TABLA completo (no hay ningún
-- UPDATE/INSERT directo del lado del cliente en todo el código fuente
-- —se verificó—, así que no hace falta reconceder ninguna columna para
-- esos dos) y volver a conceder SELECT solo en las columnas que sí se
-- leen desde el cliente.
revoke select, update, insert on public.profiles from authenticated, anon;
grant select (id, email, name, role, created_at) on public.profiles to authenticated, anon;

-- Segunda barrera, independiente de los GRANT: un trigger que revierte
-- cualquier cambio a las 4 columnas de PIN que no venga de DENTRO de una
-- de las funciones SECURITY DEFINER de arriba. Esas funciones son
-- propiedad de `postgres`, y mientras se ejecutan `current_user` pasa a
-- ser `postgres` — una petición normal de PostgREST llega como
-- `authenticated` o `anon`. Así, aunque en el futuro alguien agregue sin
-- querer un GRANT nuevo o una política más permisiva, estas 4 columnas
-- quedan protegidas igual.
create or replace function public.proteger_columnas_pin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_user <> 'postgres' then
    new.security_pin_hash := old.security_pin_hash;
    new.security_pin_set_at := old.security_pin_set_at;
    new.security_pin_fails := old.security_pin_fails;
    new.security_pin_locked_until := old.security_pin_locked_until;
  end if;
  return new;
end;
$$;

drop trigger if exists proteger_columnas_pin_trigger on public.profiles;
create trigger proteger_columnas_pin_trigger
  before update on public.profiles
  for each row
  execute function public.proteger_columnas_pin();

-- Verificación
select proname from pg_proc
 where proname in ('change_security_pin', 'es_admin_supremo', 'admin_list_duenos', 'admin_reset_security_pin', 'proteger_columnas_pin');
