-- =====================================================================
-- JARVIS · cerebro (grafo de conocimiento) y «Detener» que no se guarda
-- =====================================================================
-- Va DESPUÉS de migracion_jarvis_memoria.sql.
--
-- · jarvis_nodos / jarvis_enlaces: lo que Jarvis aprende, como red. Cada
--   nodo tiene un RESUMEN de lo que sabe (es lo que usa al responder) y su
--   fuente (vos, inventario, taller, ventas, internet, conversación). Los
--   enlaces dicen cómo se relacionan («es parte de», «se vende en»…) y se
--   engrosan con el uso. Los escribe la función asistente-ia; el
--   superadmin los ve, los corrige y los borra desde el cerebro.
-- · ia_descartes: respuestas que el superadmin DETUVO. Un corte de
--   conexión ya no descarta nada; solo esto.
-- Nunca datos personales de clientes: viaja a Google.
-- =====================================================================

create table if not exists public.ia_descartes (
  id        uuid primary key,
  user_id   uuid not null references auth.users(id) on delete cascade,
  creado_en timestamptz not null default now()
);
alter table public.ia_descartes enable row level security;

create table if not exists public.jarvis_nodos (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  clave          text not null,
  etiqueta       text not null check (length(etiqueta) between 1 and 80),
  tipo           text not null default 'tema'
                 check (tipo in ('raiz','dominio','modulo','tema','dato','fuente','recuerdo')),
  resumen        text check (length(resumen) <= 1500),
  fuente         text,
  url            text,
  usos           integer not null default 0,
  ultimo_uso     timestamptz,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (user_id, clave)
);
create index if not exists jarvis_nodos_user on public.jarvis_nodos (user_id, actualizado_en desc);

create table if not exists public.jarvis_enlaces (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references auth.users(id) on delete cascade,
  origen    uuid not null references public.jarvis_nodos(id) on delete cascade,
  destino   uuid not null references public.jarvis_nodos(id) on delete cascade,
  relacion  text not null default 'relacionado',
  peso      integer not null default 1,
  creado_en timestamptz not null default now(),
  unique (origen, destino)
);
create index if not exists jarvis_enlaces_user on public.jarvis_enlaces (user_id);

alter table public.jarvis_nodos enable row level security;
alter table public.jarvis_enlaces enable row level security;
do $$
declare t text;
begin
  foreach t in array array['jarvis_nodos','jarvis_enlaces'] loop
    execute format('drop policy if exists %I on public.%I', t || '_leer', t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = auth.uid() and public.is_superadmin())', t || '_leer', t);
    execute format('drop policy if exists %I on public.%I', t || '_cambiar', t);
    execute format('create policy %I on public.%I for update to authenticated using (user_id = auth.uid() and public.is_superadmin()) with check (user_id = auth.uid() and public.is_superadmin())', t || '_cambiar', t);
    execute format('drop policy if exists %I on public.%I', t || '_borrar', t);
    execute format('create policy %I on public.%I for delete to authenticated using (user_id = auth.uid() and public.is_superadmin())', t || '_borrar', t);
  end loop;
end $$;

-- Lo que Jarvis ya recordaba entra al cerebro, bajo «Sobre vos».
insert into public.jarvis_nodos (user_id, clave, etiqueta, tipo, resumen)
select distinct user_id, 'raiz', 'Technoverse', 'raiz', 'Todo lo que Jarvis sabe del negocio.' from public.jarvis_memoria
on conflict (user_id, clave) do nothing;
insert into public.jarvis_nodos (user_id, clave, etiqueta, tipo)
select distinct user_id, 'dom:dueno', 'Sobre vos', 'dominio' from public.jarvis_memoria
on conflict (user_id, clave) do nothing;
insert into public.jarvis_nodos (user_id, clave, etiqueta, tipo, resumen, fuente, creado_en)
select user_id, 'rec:m:' || id, left(texto, 80), 'recuerdo', left(texto, 1500), 'vos', creada_en from public.jarvis_memoria
on conflict (user_id, clave) do nothing;
insert into public.jarvis_enlaces (user_id, origen, destino, relacion)
select r.user_id, r.id, d.id, 'contiene'
from public.jarvis_nodos r join public.jarvis_nodos d on d.user_id = r.user_id and d.clave = 'dom:dueno'
where r.clave = 'raiz'
on conflict (origen, destino) do nothing;
insert into public.jarvis_enlaces (user_id, origen, destino, relacion)
select n.user_id, d.id, n.id, 'prefiere'
from public.jarvis_nodos n join public.jarvis_nodos d on d.user_id = n.user_id and d.clave = 'dom:dueno'
where n.clave like 'rec:m:%'
on conflict (origen, destino) do nothing;
