-- =====================================================================
-- SALUD DE JARVIS — ¿está respondiendo bien?
-- =====================================================================
-- 1) jarvis_eventos: cada respuesta de Jarvis (quién respondió, cuánto
--    tardó en empezar y en terminar, qué IAs fallaron antes, si el revisor
--    la corrigió), cada vez que ninguna IA pudo, y las pruebas diarias.
--    Solo la función de Jarvis la lee y escribe (RLS sin políticas); el
--    panel la ve a través de la función, solo para el superadmin.
-- 2) Prueba diaria a las 6:45 a. m. (CR): prueba cada IA y herramienta, y
--    si algo falla deja un aviso (antes del resumen de las 7:00).
-- Necesita lo de migracion_jarvis_proactivo.sql (la función jarvis_llamar).
-- Es estructura y una tarea programada: no toca ni borra datos existentes.
-- =====================================================================

create table if not exists public.jarvis_eventos (
  id bigint generated always as identity primary key,
  creado_en timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete set null,
  tipo text not null,            -- respuesta · sin_servicio · error · prueba
  componente text,               -- pruebas: ia:groq, ia:principal, internet, paginas, vectores, base
  modo text,
  perfil text,
  proveedor text,
  modelo text,
  ok boolean not null default true,
  ms integer,                    -- lo que esperó el dueño (hasta la respuesta final)
  primer_ms integer,             -- hasta que apareció la primera letra
  ia_ms integer,                 -- lo que tardó la IA que respondió
  revision text,                 -- aprobada · corregida
  revisor text,
  fallos jsonb not null default '[]'::jsonb,
  herramientas jsonb not null default '[]'::jsonb,
  tokens integer,
  detalle text
);
create index if not exists jarvis_eventos_tipo_fecha_idx on public.jarvis_eventos (tipo, creado_en desc);
alter table public.jarvis_eventos enable row level security;

-- Tarea (hora en UTC: Costa Rica es UTC-6).
select cron.schedule('jarvis-pruebas', '45 12 * * *', $$ select public.jarvis_llamar('pruebas') $$);
