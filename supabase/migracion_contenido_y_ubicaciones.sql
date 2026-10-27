-- =====================================================================
-- CONTENIDO DE LA TIENDA SOLO PARA LA GESTIÓN · UBICACIONES SIN ROL FALSO · 2026-10-27
-- =====================================================================
-- QUÉ CIERRA (auditoría del 2026-10-27 contra la base real):
--
--   1. CUALQUIER cuenta podía cambiar los textos de la tienda en vivo. `contenido_sitio` tenía
--      INSERT y UPDATE `to authenticated with check (true)`, y el registro de cuentas está abierto
--      y confirma el correo solo: un extraño se creaba una cuenta en segundos y reescribía los
--      textos que ve todo el que entra (los que el Worker deja dentro del HTML). En la app, editar la
--      página es solo de la gestión (superadmin y admin: `esGestion` en utils/roles.ts), que en la
--      base es `is_owner()`. Ahora escribir exige eso; leer sigue siendo público.
--
--   2. Un visitante podía anotar ubicaciones como «administrador» en `ubicaciones_compartidas`
--      (`registrar_ubicacion` solo miraba el texto que mandaba el navegador). Ahora un visitante
--      (`es_visitante()`, de migracion_blindaje_seguridad.sql) siempre queda como «cliente»; el
--      personal sigue anotando lo que corresponda.
--
-- QUÉ NO CAMBIA: la gestión edita la página igual que antes (mismas llamadas); la tienda lee el
-- contenido igual; el registro de ubicaciones de clientes y del panel funciona igual.
--
-- REQUISITO: aplicar DESPUÉS de migracion_blindaje_seguridad.sql (usa `es_visitante()`).
-- Idempotente: se puede correr dos veces.
-- =====================================================================

-- 1. contenido_sitio: escribir solo la gestión ------------------------------------------------
drop policy if exists contenido_sitio_insert on public.contenido_sitio;
create policy contenido_sitio_insert on public.contenido_sitio
  for insert to authenticated with check (public.is_owner());

drop policy if exists contenido_sitio_update on public.contenido_sitio;
create policy contenido_sitio_update on public.contenido_sitio
  for update to authenticated using (public.is_owner()) with check (public.is_owner());

-- 2. ubicaciones: un visitante nunca figura como «administrador» -------------------------------
create or replace function public.ubicaciones_rol_validar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.es_visitante() then
    new.rol := 'cliente';
  end if;
  return new;
end;
$$;
revoke all on function public.ubicaciones_rol_validar() from public, anon, authenticated;

drop trigger if exists trg_ubicaciones_rol on public.ubicaciones_compartidas;
create trigger trg_ubicaciones_rol
  before insert on public.ubicaciones_compartidas
  for each row execute function public.ubicaciones_rol_validar();

-- =====================================================================
-- REVERTIR (volver a lo de antes):
--   drop trigger if exists trg_ubicaciones_rol on public.ubicaciones_compartidas;
--   drop function if exists public.ubicaciones_rol_validar();
--   drop policy if exists contenido_sitio_insert on public.contenido_sitio;
--   create policy contenido_sitio_insert on public.contenido_sitio for insert to authenticated with check (true);
--   drop policy if exists contenido_sitio_update on public.contenido_sitio;
--   create policy contenido_sitio_update on public.contenido_sitio for update to authenticated using (true) with check (true);
-- =====================================================================
