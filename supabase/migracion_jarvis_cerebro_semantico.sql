-- =====================================================================
-- CEREBRO SEMÁNTICO DE JARVIS
-- =====================================================================
-- Cada idea del cerebro guarda un vector de significado (768 números,
-- calculado gratis con Gemini) y Jarvis recuerda por IDEA, no solo por
-- palabras: «cargador rápido» encuentra «adaptador 20W PD». También evita
-- aprender dos veces lo mismo dicho distinto.
--
-- Es un cambio de ESTRUCTURA (agrega una columna y una función); no toca
-- ni borra datos. Los vectores los va llenando la función de Jarvis sola,
-- de a poco, en cada mensaje.
-- =====================================================================

create extension if not exists vector with schema extensions;

alter table public.jarvis_nodos
  add column if not exists embedding extensions.vector(768);

create index if not exists jarvis_nodos_embedding_idx
  on public.jarvis_nodos using hnsw (embedding extensions.vector_cosine_ops);

-- Las ideas más parecidas a un vector, solo de ese dueño.
create or replace function public.jarvis_semejantes(p_user uuid, p_vec text, p_k int default 8)
returns table (id uuid, clave text, etiqueta text, tipo text, resumen text, fuente text, url text, usos int, similitud double precision)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select n.id, n.clave, n.etiqueta, n.tipo, n.resumen, n.fuente, n.url, n.usos,
         1 - (n.embedding <=> p_vec::extensions.vector(768)) as similitud
  from public.jarvis_nodos n
  where n.user_id = p_user and n.embedding is not null
  order by n.embedding <=> p_vec::extensions.vector(768)
  limit greatest(1, least(coalesce(p_k, 8), 30));
$$;

-- Solo la función de Jarvis (service_role) la puede usar.
revoke all on function public.jarvis_semejantes(uuid, text, int) from public, anon, authenticated;
grant execute on function public.jarvis_semejantes(uuid, text, int) to service_role;
