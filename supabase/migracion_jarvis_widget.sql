-- =====================================================================
-- JARVIS · llaves del MINI-WIDGET del teléfono
-- =====================================================================
-- El dueño pidió (2026-10-05) que el mini-widget conteste SIN huella y sin
-- abrir la app, con acceso a todas las consultas («solo yo tengo acceso a
-- este teléfono»). Para eso, al activarlo desde la app se crea una llave
-- aleatoria que el teléfono guarda cifrada (Keystore de Android). Aquí solo
-- se guarda su huella SHA-256: con esta tabla no se puede reconstruir.
--
-- · La escribe solo la función asistente-ia (activar / revocar).
-- · El superadmin ve sus llaves (Ajustes → Mini-widget) para revocarlas.
-- · Por la puerta del widget solo se puede PREGUNTAR (sin acciones).
-- =====================================================================

create table if not exists public.ia_widget_llaves (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  hash        text not null unique,
  dispositivo text,
  modelo      text,
  creada_en   timestamptz not null default now(),
  ultimo_uso  timestamptz,
  usos        integer not null default 0,
  revocada_en timestamptz
);
create index if not exists ia_widget_llaves_user on public.ia_widget_llaves (user_id, creada_en desc);

alter table public.ia_widget_llaves enable row level security;
drop policy if exists ia_widget_llaves_leer on public.ia_widget_llaves;
create policy ia_widget_llaves_leer on public.ia_widget_llaves
  for select to authenticated using (user_id = auth.uid() and public.is_superadmin());
