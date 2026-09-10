-- =====================================================================
-- PANEL DE UBICACIÓN INTERNO — ubicaciones compartidas por consentimiento
-- =====================================================================
-- Reemplaza el "abrir Google Maps en otra pestaña" por un mapa DENTRO del
-- panel. Guarda la ubicación que una persona comparte A PROPÓSITO —el
-- navegador o la APK le pide el permiso nativo, ella acepta o niega— para
-- que el administrador la vea en un mapa embebido.
--
-- REGLA, ESCRITA EN EL ESQUEMA:
--   · La ubicación entra SOLO por `registrar_ubicacion`, que es
--     `security definer`: quien la manda (cliente anónimo o admin) NUNCA
--     puede leer la tabla ni ver la de otro. Mismo patrón que
--     `visitante_latido` / `registrar_huella`.
--   · LEERLA es exclusivo del administrador supremo (`is_superadmin()`).
--   · Es un dato que la persona entregó por su cuenta; el que quiera se
--     puede borrar con el botón "Quitar" (DELETE, también solo supremo).
-- =====================================================================

create table if not exists public.ubicaciones_compartidas (
  id          uuid primary key default gen_random_uuid(),
  rol         text not null default 'cliente' check (rol in ('cliente', 'administrador')),
  nombre      text,
  email       text,
  lat         double precision not null,
  lon         double precision not null,
  precision_m integer,
  provincia   text,
  contexto    text,                       -- 'checkout' | 'panel' | ...
  device_id   text,
  created_at  timestamptz not null default now()
);
alter table public.ubicaciones_compartidas enable row level security;

-- Solo el superadmin puede LEER las ubicaciones.
drop policy if exists ubicaciones_select on public.ubicaciones_compartidas;
create policy ubicaciones_select on public.ubicaciones_compartidas
  for select to authenticated
  using (public.is_superadmin());

-- Solo el superadmin puede borrar una ubicación (botón "Quitar").
drop policy if exists ubicaciones_delete on public.ubicaciones_compartidas;
create policy ubicaciones_delete on public.ubicaciones_compartidas
  for delete to authenticated
  using (public.is_superadmin());

grant select, delete on public.ubicaciones_compartidas to authenticated;

-- ---------------------------------------------------------------------
-- Registro consentido de una ubicación (cliente anónimo o admin)
-- ---------------------------------------------------------------------
-- Nadie escribe la tabla directo: entra por aquí. Así quien comparte no
-- puede leer a otros ni marcar filas ajenas. Valida el rango de las
-- coordenadas para que una lectura corrupta del GPS no ensucie el mapa.
create or replace function public.registrar_ubicacion(
  p_rol       text,
  p_nombre    text,
  p_email     text,
  p_lat       double precision,
  p_lon       double precision,
  p_precision integer,
  p_provincia text,
  p_contexto  text,
  p_device    text
) returns uuid
language plpgsql security definer set search_path to 'public'
as $$
declare v_id uuid;
begin
  if p_lat is null or p_lon is null then return null; end if;
  if p_lat < -90 or p_lat > 90 or p_lon < -180 or p_lon > 180 then return null; end if;

  insert into public.ubicaciones_compartidas
    (rol, nombre, email, lat, lon, precision_m, provincia, contexto, device_id)
  values (
    case when lower(coalesce(p_rol, '')) = 'administrador' then 'administrador' else 'cliente' end,
    nullif(left(coalesce(p_nombre, ''), 120), ''),
    nullif(left(coalesce(p_email, ''), 160), ''),
    p_lat, p_lon,
    case when p_precision is null then null else greatest(0, p_precision) end,
    nullif(left(coalesce(p_provincia, ''), 40), ''),
    nullif(left(coalesce(p_contexto, ''), 40), ''),
    nullif(left(coalesce(p_device, ''), 100), '')
  )
  returning id into v_id;

  return v_id;
end;
$$;
grant execute on function public.registrar_ubicacion(
  text, text, text, double precision, double precision, integer, text, text, text
) to anon, authenticated;

-- El panel se refresca en vivo cuando entra una ubicación nueva.
do $$ begin
  alter publication supabase_realtime add table public.ubicaciones_compartidas;
exception when duplicate_object then null; when undefined_object then null; end $$;
