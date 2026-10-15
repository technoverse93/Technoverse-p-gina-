-- =====================================================================
-- AJUSTES PRIVADOS · el webhook de Instagram (Zapier) deja de ser público · 2026-10-15
-- =====================================================================
-- PROBLEMA. `app_settings` es de lectura pública (la tienda necesita el teléfono, la dirección, el
-- logo…) y `instagram_webhook_url` vive en esa misma fila: cualquiera con la llave pública del
-- navegador podía pedirla (`GET /rest/v1/app_settings?select=instagram_webhook_url`). Esa dirección
-- de un «Catch Hook» de Zapier es un secreto: quien la tiene publica en el Instagram del negocio.
-- (Hoy está vacía en producción: no hay nada filtrado todavía. Esto lo evita para cuando se configure.)
--
-- SOLUCIÓN. El valor pasa a una tabla PRIVADA (`app_settings_privado`, sin ningún acceso desde la API).
--   · Un disparador en `app_settings` desvía lo que llegue por la columna vieja a la tabla privada y
--     deja la columna pública en NULL: los clientes ya desplegados (APK/OTA viejos) siguen funcionando
--     sin cambios (guardar una dirección nueva sigue funcionando; solo dejan de poder LEERLA).
--   · El dueño la lee y la cambia con dos funciones (`leer_webhook_instagram`, `guardar_webhook_instagram`);
--     el personal solo ve si está configurada (`webhook_instagram_configurado`, sin la dirección).
--   · El cron que publica (`publish_due_marketing_requests`) la lee de la tabla privada.
--
-- CÓMO SE APLICA. Después de `migracion_blindaje_seguridad.sql`. Es compatible con los clientes viejos y
-- nuevos. Idempotente. Probada con supabase/pruebas/ajustes_privados.sql.
-- SI YA HABÍA UNA DIRECCIÓN CONFIGURADA: se conserva (se mueve a la tabla privada), pero estuvo pública
-- hasta ahora: rota el «Catch Hook» en Zapier y pega la nueva en Configuración.
-- =====================================================================

create table if not exists public.app_settings_privado (
  id                    boolean primary key default true check (id),
  instagram_webhook_url text
);
alter table public.app_settings_privado enable row level security;
revoke all on public.app_settings_privado from anon, authenticated;
drop policy if exists nadie on public.app_settings_privado;
create policy nadie on public.app_settings_privado for all to anon, authenticated using (false) with check (false);

-- Lo que ya hubiera en la columna pública se mueve a la privada y la pública se vacía.
insert into public.app_settings_privado (id, instagram_webhook_url)
select true, nullif(btrim(instagram_webhook_url), '') from public.app_settings limit 1
on conflict (id) do update
  set instagram_webhook_url = coalesce(excluded.instagram_webhook_url, public.app_settings_privado.instagram_webhook_url);
update public.app_settings set instagram_webhook_url = null where instagram_webhook_url is not null;

-- Desvío para los clientes que todavía escriben en la columna pública: la dirección (si viene no
-- vacía) va a la tabla privada y la columna pública queda siempre en NULL. Una columna vacía/NULL NO
-- borra la dirección guardada (un cliente viejo, que ya no la ve, reenvía NULL al guardar otros ajustes).
create or replace function public.app_settings_proteger_webhook()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(btrim(coalesce(new.instagram_webhook_url, '')), '') is not null then
    insert into public.app_settings_privado (id, instagram_webhook_url)
    values (true, btrim(new.instagram_webhook_url))
    on conflict (id) do update set instagram_webhook_url = excluded.instagram_webhook_url;
  end if;
  new.instagram_webhook_url := null;
  return new;
end;
$$;
revoke all on function public.app_settings_proteger_webhook() from public, anon, authenticated;

drop trigger if exists trg_app_settings_proteger_webhook on public.app_settings;
create trigger trg_app_settings_proteger_webhook
  before insert or update on public.app_settings
  for each row execute function public.app_settings_proteger_webhook();

-- El dueño lee la dirección completa (para mostrarla en Configuración).
create or replace function public.leer_webhook_instagram()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    return null;
  end if;
  return (select instagram_webhook_url from public.app_settings_privado limit 1);
end;
$$;

-- El personal solo necesita saber si hay una configurada (sin ver cuál).
create or replace function public.webhook_instagram_configurado()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    return false;
  end if;
  return exists (select 1 from public.app_settings_privado where nullif(btrim(coalesce(instagram_webhook_url, '')), '') is not null);
end;
$$;

-- El dueño la cambia (texto vacío = quitarla). Debe ser una dirección https.
create or replace function public.guardar_webhook_instagram(p_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text := nullif(btrim(coalesce(p_url, '')), '');
begin
  if not public.is_owner() then
    raise exception 'Solo el dueño puede cambiar el webhook de Instagram.' using errcode = '42501';
  end if;
  if v_url is not null and (v_url !~ '^https://[^\s]+$' or length(v_url) > 500) then
    raise exception 'La dirección del webhook debe ser https y no pasar de 500 caracteres.';
  end if;
  insert into public.app_settings_privado (id, instagram_webhook_url) values (true, v_url)
  on conflict (id) do update set instagram_webhook_url = excluded.instagram_webhook_url;
end;
$$;

revoke execute on function public.leer_webhook_instagram()        from public, anon;
revoke execute on function public.webhook_instagram_configurado() from public, anon;
revoke execute on function public.guardar_webhook_instagram(text) from public, anon;

-- El cron (cada 5 min) publica lo programado: ahora lee la dirección de la tabla privada.
create or replace function public.publish_due_marketing_requests()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  hook_url text;
  req record;
begin
  select instagram_webhook_url into hook_url from app_settings_privado limit 1;
  if hook_url is null or hook_url = '' then
    return;
  end if;

  for req in
    select * from marketing_requests
    where status = 'programado'
      and scheduled_at <= now()
      and image_url is not null
    order by scheduled_at
    limit 20
  loop
    begin
      perform net.http_post(
        url := hook_url,
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := jsonb_build_object(
          'media', jsonb_build_array(req.image_url),
          'caption', coalesce(req.caption, ''),
          'productId', req.product_id,
          'productName', req.product_name
        )
      );
      update marketing_requests
        set status = 'publicado', updated_at = now(), error_detail = null
        where id = req.id;
    exception when others then
      update marketing_requests
        set status = 'error', updated_at = now(), error_detail = SQLERRM
        where id = req.id;
    end;
  end loop;
end;
$$;

-- REVERTIR:
--   drop trigger if exists trg_app_settings_proteger_webhook on public.app_settings;
--   update public.app_settings set instagram_webhook_url = (select instagram_webhook_url from public.app_settings_privado limit 1);
--   y volver a la definición anterior de publish_due_marketing_requests (leía de app_settings).
