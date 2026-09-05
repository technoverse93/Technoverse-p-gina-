-- =====================================================================
-- HOTFIX · supervisión instantánea, lista de admins e IP en los ingresos
-- =====================================================================
-- Ya APLICADO en producción. Se deja aquí como registro de lo que cambió
-- en la base, igual que el resto de migraciones del proyecto.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) La lista de administradores volvía CERO
-- ---------------------------------------------------------------------
-- `admin_list_duenos` seguía filtrando role = 'Dueño'. La migración de
-- roles Zero Trust (Etapa 1) reclasificó esas cuentas a 'admin', así que
-- la consulta no encontraba a nadie y el panel decía "no hay ninguno"
-- aunque existieran administradores reales.
create or replace function public.admin_list_duenos()
returns table(id uuid, email text, name text, tiene_pin boolean)
language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not public.es_admin_supremo() then
    raise exception 'Solo el administrador supremo puede ver este panel.';
  end if;
  return query
    select p.id, p.email, p.name, (p.security_pin_hash is not null)
      from public.profiles p
     where p.role = 'admin'   -- antes 'Dueño': ese rol ya no existe
     order by p.email;
end;
$function$;

-- ---------------------------------------------------------------------
-- 2) IP pública en el registro de ingresos
-- ---------------------------------------------------------------------
alter table public.security_login_events
  add column if not exists ip text;

-- La IP se toma de las cabeceras que pone el borde de Supabase, del lado
-- del SERVIDOR: el cliente no puede falsearla desde el cuerpo de la
-- llamada. `x-forwarded-for` puede traer una cadena de saltos y el
-- primero es el visitante.
create or replace function public.ip_de_la_peticion()
returns text language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_headers json;
  v_ip text;
begin
  begin
    v_headers := current_setting('request.headers', true)::json;
  exception when others then
    return null;
  end;
  if v_headers is null then return null; end if;

  v_ip := coalesce(
    v_headers->>'cf-connecting-ip',
    v_headers->>'x-real-ip',
    split_part(coalesce(v_headers->>'x-forwarded-for', ''), ',', 1)
  );
  v_ip := nullif(btrim(coalesce(v_ip, '')), '');
  return left(v_ip, 60);
end;
$$;

create or replace function public.registrar_ingreso(p_entorno text, p_dispositivo text)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare v_email text;
begin
  if auth.uid() is null then return; end if;
  select email into v_email from auth.users where id = auth.uid();
  insert into public.security_login_events (user_id, email, entorno, dispositivo, ip)
  values (
    auth.uid(),
    coalesce(v_email, ''),
    case when lower(coalesce(p_entorno, '')) = 'apk' then 'apk' else 'web' end,
    nullif(left(coalesce(p_dispositivo, ''), 200), ''),
    public.ip_de_la_peticion()
  );
end;
$function$;

-- ---------------------------------------------------------------------
-- 3) El espejo deja de pasar por la base (latencia)
-- ---------------------------------------------------------------------
-- Autorización de Broadcast para los canales `espejo:<user_id>`. La
-- privacidad la sostiene esta RLS, igual que antes la sostenía la de la
-- tabla: unirse/recibir solo el superadmin o el dueño del canal; enviar,
-- únicamente al propio.
drop policy if exists espejo_unirse on realtime.messages;
create policy espejo_unirse on realtime.messages
  for select to authenticated
  using (
    realtime.topic() like 'espejo:%'
    and (
      public.is_superadmin()
      or realtime.topic() = 'espejo:' || auth.uid()::text
    )
  );

drop policy if exists espejo_enviar on realtime.messages;
create policy espejo_enviar on realtime.messages
  for insert to authenticated
  with check (
    realtime.topic() = 'espejo:' || auth.uid()::text
  );

-- ---------------------------------------------------------------------
-- 4) Botón "Actualizar": retirar fichas de presencia colgadas
-- ---------------------------------------------------------------------
-- Faltaba el GRANT de DELETE, así que el superadmin no podía quitar de la
-- lista a quien ya había cerrado sesión.
grant delete on public.supervision_state to authenticated;

drop policy if exists supervision_state_delete on public.supervision_state;
create policy supervision_state_delete on public.supervision_state
  for delete to authenticated
  using (public.is_superadmin() or user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 5) Reactividad global del inventario
-- ---------------------------------------------------------------------
-- La aplicación sincroniza `marketing_requests` (está en TABLE_CONFIGS y
-- se suscribe a sus cambios), pero la tabla NO estaba en la publicación
-- de Realtime: los eventos no salían nunca de Postgres, así que esa
-- pestaña solo se actualizaba al recargar.
do $$ begin alter publication supabase_realtime add table public.marketing_requests;
exception when duplicate_object then null; when undefined_object then null; end $$;
