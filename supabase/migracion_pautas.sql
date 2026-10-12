-- =====================================================================
-- PAUTAS — la galería del Estudio de Phill
-- =====================================================================
-- Cada pieza de publicidad que se guarda en el Estudio (Marketing →
-- Estudio de pauta) queda aquí: la imagen final vive en el bucket público
-- «marketing» (ya existe) y esta tabla guarda lo demás: el título, el
-- formato, el producto, los textos (para volver a abrirla y editarla) y una
-- miniatura para verla en la lista sin bajar la imagen entera.
-- Solo el personal la ve y la maneja. Sin esta tabla el Estudio funciona
-- igual, pero la galería queda solo en cada aparato.
-- Es estructura: no toca ni borra datos existentes.
-- =====================================================================

create table if not exists public.pautas (
  id text primary key,
  creada_en timestamptz not null default now(),
  creada_por text,
  titulo text not null default '',
  formato text not null default 'cuadrado',
  estilo text not null default 'premium',
  producto_id text,
  producto_nombre text,
  imagen_url text,              -- la imagen final, en el bucket «marketing»
  miniatura text,               -- imagen chica (data URL) para la lista
  copy jsonb not null default '{}'::jsonb,   -- titular, texto para redes, hashtags…
  pieza jsonb not null default '{}'::jsonb,  -- lo editable (sin imágenes) para reabrirla
  estado text not null default 'borrador',   -- borrador · programada · banner
  request_id text,              -- la publicación de Instagram que se programó con ella
  banner_id text                -- el banner de la tienda que se hizo con ella
);
create index if not exists pautas_creada_idx on public.pautas (creada_en desc);

alter table public.pautas enable row level security;
drop policy if exists pautas_personal_todo on public.pautas;
create policy pautas_personal_todo on public.pautas
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());
