-- ===========================================================================
-- ASISTENTE IA · FASE 2: consultas al sistema (oct 2026)
-- ===========================================================================
-- El asistente puede LEER inventario, facturación, taller y (solo el
-- superadmin) errores del sistema. Las consultas las hace la Edge Function
-- `asistente-ia` con la sesión de quien pregunta, así que valen las mismas
-- reglas de acceso que en el panel; nunca devuelven datos de clientes.
--
--   ia_ajustes.modulos      qué módulos puede consultar (los cambia el superadmin)
--   ia_mensajes.consultas   qué consultó cada respuesta (las tarjetas del chat)
--   ia_uso_diario.consultas cuántas consultas por módulo hizo cada persona hoy
--   ia_consultas_de_hoy()   el total por módulo, para la pantalla de Ajustes
-- ===========================================================================

alter table public.ia_ajustes
  add column if not exists modulos jsonb not null
  default '{"inventario": true, "facturacion": true, "taller": true, "errores": true}'::jsonb;

alter table public.ia_mensajes
  add column if not exists consultas jsonb not null default '[]'::jsonb;

alter table public.ia_uso_diario
  add column if not exists consultas jsonb not null default '{}'::jsonb;

-- Consultas de hoy por módulo (sin qué se preguntó), solo para el superadmin.
create or replace function public.ia_consultas_de_hoy()
returns table (modulo text, consultas integer)
language sql stable security definer set search_path to 'public'
as $$
  select c.key, sum((c.value)::int)::int
    from public.ia_uso_diario u, jsonb_each_text(u.consultas) c
   where public.is_superadmin()
     and u.dia = (now() at time zone 'America/Costa_Rica')::date
   group by c.key
   order by 2 desc;
$$;
revoke all on function public.ia_consultas_de_hoy() from public, anon;
grant execute on function public.ia_consultas_de_hoy() to authenticated;
