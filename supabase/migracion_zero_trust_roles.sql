-- =====================================================================
-- ZERO TRUST · MODELO DE ROL INMUTABLE (Etapa 1)
-- =====================================================================
-- Introduce los tres niveles del proyecto Zero Trust —superadmin, admin,
-- empleado— sobre el modelo anterior, que solo tenía 'Dueño' | 'Cliente'.
--
-- REGLA GRABADA EN PIEDRA: el rol `superadmin` pertenece EXCLUSIVAMENTE al
-- correo technoverse.admin@gmail.com. Ninguna otra cuenta puede tenerlo,
-- por más que se intente por REST, por SQL directo o por el trigger de
-- Auth: un trigger BEFORE lo revierte por la fuerza.
--
-- ---------------------------------------------------------------------
-- POR QUÉ NADIE PIERDE ACCESO
-- ---------------------------------------------------------------------
-- Hoy `is_staff()` e `is_owner()` son LITERALMENTE lo mismo: role='Dueño'.
-- No existe tier de empleado. El mapeo conserva los poderes actuales:
--
--   technoverse.admin@gmail.com : Dueño → superadmin   (gana la raíz)
--   britannymora5@gmail.com     : Dueño → admin        (mismos poderes)
--   chinchillaj45@gmail.com     : Dueño → admin        (mismos poderes)
--   (4 cuentas Cliente)         : Cliente → Cliente     (sin cambio)
--
--   is_owner()  = role IN ('superadmin','admin')     ← lo que 'Dueño' daba
--   is_staff()  = role IN ('superadmin','admin','empleado')
--
-- Así los dos admin conservan EXACTAMENTE lo que tenían (is_owner sigue
-- verdadero para ellos), el supremo solo suma, y `empleado` nace como
-- tier nuevo SIN cuentas: no cambia el acceso de nadie que ya exista.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Ampliar el dominio de `role` y reclasificar las cuentas existentes.
--    El CHECK se abre ANTES de escribir los valores nuevos.
-- ---------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;

update public.profiles p
   set role = case
     when lower(coalesce((select u.email from auth.users u where u.id = p.id), p.email))
          = 'technoverse.admin@gmail.com' then 'superadmin'
     when p.role = 'Dueño' then 'admin'
     else p.role
   end
 where p.role in ('Dueño');

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('superadmin', 'admin', 'empleado', 'Cliente'));

-- Las cuentas nuevas siguen naciendo como Cliente (registro desde la
-- tienda). handle_new_user() no fija rol: se apoya en este DEFAULT.
alter table public.profiles alter column role set default 'Cliente';

-- ---------------------------------------------------------------------
-- 2) Redefinir los gates. is_owner() abarca el nivel de gestión (lo que
--    'Dueño' gateaba); is_staff() abarca a cualquiera que trabaje aquí.
-- ---------------------------------------------------------------------
create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from public.profiles
     where id = auth.uid() and role in ('superadmin', 'admin')
  );
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from public.profiles
     where id = auth.uid() and role in ('superadmin', 'admin', 'empleado')
  );
$$;

-- Nuevo: el nivel raíz, por ROL. La identidad de verdad sigue siendo el
-- correo (es_admin_supremo(), que ya existe y no se toca), pero tener el
-- gate también por rol evita un SELECT a auth.users en las RLS calientes.
create or replace function public.is_superadmin()
returns boolean language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from public.profiles
     where id = auth.uid() and role = 'superadmin'
  );
$$;

revoke all on function public.is_superadmin() from anon;
grant execute on function public.is_superadmin() to authenticated;

-- ---------------------------------------------------------------------
-- 3) INMUTABILIDAD: trigger BEFORE que fuerza el rol correcto pase lo que
--    pase. La identidad se resuelve contra auth.users por id —nunca contra
--    profiles.email, que es un espejo y podría manipularse— así que aunque
--    alguien lograra un UPDATE directo, no puede autoconcederse la raíz.
-- ---------------------------------------------------------------------
create or replace function public.forzar_rol_inmutable()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
declare
  v_email text;
begin
  v_email := lower(coalesce(
    (select u.email from auth.users u where u.id = new.id),
    new.email, ''
  ));

  if v_email = 'technoverse.admin@gmail.com' then
    -- El correo supremo SIEMPRE es superadmin. No hay forma de degradarlo.
    new.role := 'superadmin';
  elsif new.role = 'superadmin' then
    -- Cualquier OTRA cuenta que intente ser superadmin baja a admin. Este
    -- es el cierre contra la escalada de privilegios que pide la orden.
    new.role := 'admin';
  end if;

  return new;
end;
$$;

drop trigger if exists forzar_rol_inmutable_trigger on public.profiles;
create trigger forzar_rol_inmutable_trigger
  before insert or update on public.profiles
  for each row execute function public.forzar_rol_inmutable();

-- ---------------------------------------------------------------------
-- 4) Verificación
-- ---------------------------------------------------------------------
select email, role from public.profiles order by role, email;
