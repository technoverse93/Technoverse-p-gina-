-- =====================================================================
-- Chat con visitantes: "Visto" y "Última vez conectado"
-- =====================================================================
-- Aplicada en producción el 2026-09-30 (autorizada por el dueño).
-- Aditiva: dos columnas NULL en chat_conversations y una función acotada
-- por token para que el visitante reporte su lectura/presencia sin ampliar
-- la RLS (la política chat_conv_customer_update_unclaimed no deja al cliente
-- actualizar una conversación ya asignada a un empleado).

alter table public.chat_conversations
  add column if not exists customer_last_read_at timestamptz,
  add column if not exists customer_last_seen_at timestamptz;

create or replace function public.chat_visitante_presente(
  p_id text,
  p_token uuid,
  p_leyo boolean default false
) returns void
language sql
security definer
set search_path = public
as $$
  update public.chat_conversations
     set customer_last_seen_at = now(),
         customer_last_read_at = case when p_leyo then now() else customer_last_read_at end
   where id = p_id
     and customer_token = p_token;
$$;

revoke all on function public.chat_visitante_presente(text, uuid, boolean) from public;
grant execute on function public.chat_visitante_presente(text, uuid, boolean) to anon, authenticated;
