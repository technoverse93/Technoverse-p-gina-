-- =====================================================================
-- CONTENIDO EDITABLE DEL SITIO — el respaldo del "modo edición" (lapicito)
-- =====================================================================
-- Guarda los textos (y a futuro colores/íconos) que un administrador
-- edita haciendo clic directamente sobre la tienda. Cada pieza tiene una
-- CLAVE estable (ej. 'tienda.titulo_catalogo'); si no hay fila para una
-- clave, la app usa el texto por defecto que trae escrito en el código.
--
-- Es contenido PÚBLICO (se muestra a cualquiera que abra la tienda), así
-- que cualquiera lo LEE. Solo un administrador autenticado lo escribe.
-- =====================================================================

create table if not exists public.contenido_sitio (
  clave      text primary key,
  valor      text,
  tipo       text not null default 'texto' check (tipo in ('texto', 'color', 'icono')),
  updated_at timestamptz not null default now(),
  updated_by text
);
alter table public.contenido_sitio enable row level security;

-- Lectura pública: es lo que se pinta en la tienda.
drop policy if exists contenido_sitio_lectura on public.contenido_sitio;
create policy contenido_sitio_lectura on public.contenido_sitio
  for select to anon, authenticated using (true);

-- Escritura solo para administradores autenticados (los clientes son anónimos).
drop policy if exists contenido_sitio_insert on public.contenido_sitio;
create policy contenido_sitio_insert on public.contenido_sitio
  for insert to authenticated with check (true);

drop policy if exists contenido_sitio_update on public.contenido_sitio;
create policy contenido_sitio_update on public.contenido_sitio
  for update to authenticated using (true) with check (true);

grant select on public.contenido_sitio to anon, authenticated;
grant insert, update on public.contenido_sitio to authenticated;

-- Un cambio se refleja al instante en todas las pestañas abiertas.
do $$ begin
  alter publication supabase_realtime add table public.contenido_sitio;
exception when duplicate_object then null; when undefined_object then null; end $$;
