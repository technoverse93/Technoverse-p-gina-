-- =====================================================================
-- BOTÓN NUCLEAR — purga total de chats
-- =====================================================================
-- APLICADO EN PRODUCCIÓN (la función; NO se ejecutó la purga).
-- Lo consume src/components/admin/ConsolaBloqueos.tsx.
--
-- Borra físicamente todos los mensajes y conversaciones. Solo el
-- superadmin, comprobado EN EL SERVIDOR: aunque alguien llamara la
-- función a mano desde la consola del navegador, sin ese rol no borra
-- nada.
--
-- Devuelve cuántas filas se llevó por delante, para que el panel pueda
-- decir exactamente qué pasó en vez de un "listo" a ciegas.
-- =====================================================================
create or replace function public.purgar_chats()
returns table (mensajes bigint, conversaciones bigint)
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_msg  bigint := 0;
  v_conv bigint := 0;
begin
  if not public.is_superadmin() then
    raise exception 'Solo el administrador supremo puede purgar los chats';
  end if;

  -- Mensajes primero: si hubiera clave foránea hacia la conversación,
  -- borrar al revés fallaría.
  with borrados as (delete from public.chat_messages returning 1)
  select count(*) into v_msg from borrados;

  with borradas as (delete from public.chat_conversations returning 1)
  select count(*) into v_conv from borradas;

  return query select v_msg, v_conv;
end;
$$;
grant execute on function public.purgar_chats() to authenticated;
