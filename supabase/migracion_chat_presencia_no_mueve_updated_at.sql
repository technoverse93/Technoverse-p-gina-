-- =====================================================================
-- Chat: los avisos de presencia del visitante no mueven updated_at
-- =====================================================================
-- Aplicada en producción el 2026-10-01. Corrige un efecto de
-- migracion_chat_visto_ultima_conexion.sql: el aviso cada 20 s movía
-- updated_at y un chat resuelto volvía a entrar en "Resueltos · 1 día" solo
-- porque el cliente lo abrió. Ahora updated_at solo cambia si cambió algo
-- más que las marcas de presencia/lectura.
create or replace function public.set_chat_conversations_updated_at()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if (to_jsonb(new) - 'customer_last_read_at' - 'customer_last_seen_at' - 'updated_at')
     = (to_jsonb(old) - 'customer_last_read_at' - 'customer_last_seen_at' - 'updated_at') then
    new.updated_at := old.updated_at;
  else
    new.updated_at := now();
  end if;
  return new;
end;
$function$;
