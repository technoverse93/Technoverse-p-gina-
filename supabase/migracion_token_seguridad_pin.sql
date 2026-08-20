-- =====================================================================
-- TOKEN DE SEGURIDAD DE 4 DÍGITOS — seguro maestro para cambio de
-- contraseña. Se guarda como HASH salteado (bcrypt vía pgcrypto), NUNCA
-- en texto plano: un PIN de 4 dígitos solo tiene 10.000 combinaciones,
-- así que aunque "hash" y "cifrado reversible" no son lo mismo, el hash
-- es la opción correcta aquí — nadie, ni con acceso a la base, puede leer
-- el PIN de vuelta, y la verificación real ocurre siempre en el servidor
-- (nunca se compara en el cliente).
-- =====================================================================

alter table public.profiles
  add column if not exists security_pin_hash text,
  add column if not exists security_pin_set_at timestamptz,
  add column if not exists security_pin_fails smallint not null default 0,
  add column if not exists security_pin_locked_until timestamptz;

comment on column public.profiles.security_pin_hash is 'Hash bcrypt del token de seguridad de 4 dígitos. Nunca se expone al cliente (ver REVOKE abajo) ni se compara fuera de verify_security_pin().';
comment on column public.profiles.security_pin_fails is 'Intentos fallidos consecutivos de verify_security_pin() desde el último éxito o bloqueo.';
comment on column public.profiles.security_pin_locked_until is 'Si está en el futuro, verify_security_pin() rechaza cualquier intento hasta esta hora (5 fallos = 15 minutos de bloqueo).';

-- Defensa en profundidad: aunque las políticas RLS de `profiles` dejen a
-- una persona leer su propia fila, estas columnas quedan fuera de
-- cualquier SELECT que haga el cliente (anon/authenticated), sea cual sea
-- la política de fila. Solo las funciones SECURITY DEFINER de abajo — que
-- corren como el dueño de la función, no como el rol del cliente — pueden
-- leerlas.
revoke select (security_pin_hash, security_pin_fails, security_pin_locked_until, security_pin_set_at)
  on public.profiles from authenticated, anon;

-- ---------------------------------------------------------------------
-- has_security_pin(): para que la app sepa si debe forzar la pantalla de
-- creación del token, sin exponer el hash.
-- ---------------------------------------------------------------------
create or replace function public.has_security_pin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select security_pin_hash is not null from public.profiles where id = auth.uid();
$$;

-- ---------------------------------------------------------------------
-- set_security_pin(): crea o reemplaza el token de ESTA cuenta (auth.uid()
-- — nunca se recibe un id de usuario por parámetro, así nadie puede fijar
-- el token de otra cuenta).
-- ---------------------------------------------------------------------
-- `extensions` en el search_path: pgcrypto (crypt/gen_salt) vive ahí en
-- Supabase, no en `public`. Sin esto, `gen_salt('bf')` falla con
-- "function gen_salt(unknown) does not exist" en cuanto alguien intenta
-- crear el token — el fallo real que se vio en producción.
create or replace function public.set_security_pin(p_pin text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'No autenticado.';
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    raise exception 'El token debe ser exactamente 4 dígitos.';
  end if;

  update public.profiles
     set security_pin_hash = crypt(p_pin, gen_salt('bf')),
         security_pin_set_at = now(),
         security_pin_fails = 0,
         security_pin_locked_until = null
   where id = v_uid;

  if not found then
    raise exception 'Perfil no encontrado.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- verify_security_pin(): compara el PIN contra el hash de ESTA cuenta.
-- Con bloqueo por intentos: 5 fallos consecutivos = 15 minutos de espera,
-- imprescindible con solo 10.000 combinaciones posibles.
-- ---------------------------------------------------------------------
-- Mismo motivo que set_security_pin(): crypt() también vive en `extensions`.
create or replace function public.verify_security_pin(p_pin text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_hash text;
  v_locked_until timestamptz;
  v_fails smallint;
begin
  if v_uid is null then
    raise exception 'No autenticado.';
  end if;

  select security_pin_hash, security_pin_locked_until, security_pin_fails
    into v_hash, v_locked_until, v_fails
    from public.profiles
   where id = v_uid
     for update;

  if v_hash is null then
    raise exception 'Token de seguridad no configurado.';
  end if;

  if v_locked_until is not null and v_locked_until > now() then
    raise exception 'Demasiados intentos fallidos. Espere % minuto(s) e intente de nuevo.',
      greatest(1, ceil(extract(epoch from (v_locked_until - now())) / 60));
  end if;

  if p_pin is not null and p_pin ~ '^[0-9]{4}$' and crypt(p_pin, v_hash) = v_hash then
    update public.profiles
       set security_pin_fails = 0, security_pin_locked_until = null
     where id = v_uid;
    return true;
  end if;

  v_fails := coalesce(v_fails, 0) + 1;
  if v_fails >= 5 then
    update public.profiles
       set security_pin_fails = 0, security_pin_locked_until = now() + interval '15 minutes'
     where id = v_uid;
    raise exception 'Demasiados intentos fallidos. Espere 15 minutos e intente de nuevo.';
  end if;

  update public.profiles set security_pin_fails = v_fails where id = v_uid;
  return false;
end;
$$;

-- Solo cuentas autenticadas pueden ejecutar estas funciones; el propio
-- cuerpo ya se limita a auth.uid(), pero se revoca explícitamente el
-- acceso anónimo por claridad y para que un futuro cambio de RLS no lo
-- abra por accidente.
revoke all on function public.has_security_pin() from anon;
revoke all on function public.set_security_pin(text) from anon;
revoke all on function public.verify_security_pin(text) from anon;
grant execute on function public.has_security_pin() to authenticated;
grant execute on function public.set_security_pin(text) to authenticated;
grant execute on function public.verify_security_pin(text) to authenticated;

-- Verificación
select column_name from information_schema.columns
 where table_schema='public' and table_name='profiles' and column_name like 'security_pin%'
 order by column_name;
select proname from pg_proc where proname in ('has_security_pin','set_security_pin','verify_security_pin');
