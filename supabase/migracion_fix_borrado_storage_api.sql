-- =====================================================================
-- FIX: el borrado del chat dejó de funcionar del todo
-- =====================================================================
-- APLICADO Y VERIFICADO EN PRODUCCIÓN.
--
-- SÍNTOMA: "No se pudo cerrar. Direct deletion from storage tables is not
-- allowed. Use the Storage API instead." — y con eso dejó de poder
-- borrarse NADA: ni un mensaje, ni una conversación, ni la purga total.
--
-- CAUSA: la migración anterior (borrado total) hacía
-- `delete from storage.objects` dentro de las funciones. Supabase lo
-- PROHÍBE explícitamente con un trigger, así que la excepción abortaba la
-- función ENTERA — incluido el borrado de las filas del chat, que sí
-- funcionaba antes. Al querer borrar de más, se rompió lo que ya andaba.
--
-- CORRECCIÓN: las funciones ya no tocan storage. Borran las filas del chat
-- y DEVUELVEN las rutas de los archivos; el borrado real de los archivos lo
-- hace el cliente con la API de Storage (`.remove()`), que es la vía
-- permitida y para la que el personal ya tenía política de DELETE.
-- =====================================================================

drop function if exists public.borrar_mensaje_chat(text);
create function public.borrar_mensaje_chat(p_id text)
returns table (conversacion text, rutas text[])
language plpgsql security definer set search_path to 'public'
as $$
declare v_conv text; v_img text; v_vid text;
begin
  if not public.is_staff() then
    raise exception 'Solo el personal puede borrar un mensaje';
  end if;
  select m.conversation_id, m.image_url, m.video_url
    into v_conv, v_img, v_vid
    from public.chat_messages m where m.id = p_id;
  if v_conv is null then
    raise exception 'Ese mensaje ya no existe';
  end if;
  delete from public.chat_messages where id = p_id;
  return query
    select v_conv,
           array_remove(array[
             public.ruta_de_adjunto(v_img),
             public.ruta_de_adjunto(v_vid)
           ], null);
end;
$$;
grant execute on function public.borrar_mensaje_chat(text) to authenticated;

drop function if exists public.purgar_conversacion(text);
create function public.purgar_conversacion(p_id text)
returns table (mensajes bigint, rutas text[])
language plpgsql security definer set search_path to 'public'
as $$
declare v_msg bigint := 0; v_rutas text[] := '{}';
begin
  if not public.is_staff() then
    raise exception 'Solo el personal puede cerrar una conversación';
  end if;
  select coalesce(array_agg(r), '{}') into v_rutas from (
    select public.ruta_de_adjunto(m.image_url) as r
      from public.chat_messages m where m.conversation_id = p_id
    union all
    select public.ruta_de_adjunto(m.video_url)
      from public.chat_messages m where m.conversation_id = p_id
  ) t where r is not null;
  with borrados as (
    delete from public.chat_messages where conversation_id = p_id returning 1
  ) select count(*) into v_msg from borrados;
  delete from public.chat_conversations where id = p_id;
  return query select v_msg, v_rutas;
end;
$$;
grant execute on function public.purgar_conversacion(text) to authenticated;

drop function if exists public.purgar_chats();
create function public.purgar_chats()
returns table (mensajes bigint, conversaciones bigint, rutas text[])
language plpgsql security definer set search_path to 'public'
as $$
declare v_msg bigint := 0; v_conv bigint := 0; v_rutas text[] := '{}';
begin
  if not public.is_superadmin() then
    raise exception 'Solo el administrador supremo puede purgar los chats';
  end if;
  select coalesce(array_agg(r), '{}') into v_rutas from (
    select public.ruta_de_adjunto(m.image_url) as r from public.chat_messages m
    union all
    select public.ruta_de_adjunto(m.video_url) from public.chat_messages m
  ) t where r is not null;
  with borrados as (delete from public.chat_messages returning 1)
  select count(*) into v_msg from borrados;
  with borradas as (delete from public.chat_conversations returning 1)
  select count(*) into v_conv from borradas;
  return query select v_msg, v_conv, v_rutas;
end;
$$;
grant execute on function public.purgar_chats() to authenticated;
