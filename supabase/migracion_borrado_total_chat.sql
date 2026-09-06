-- =====================================================================
-- BORRADO TOTAL DEL CHAT — la fila Y el archivo
-- =====================================================================
-- APLICADO Y VERIFICADO EN PRODUCCIÓN.
--
-- HUECO QUE ESTO CIERRA: al borrar un mensaje se quitaba la fila, pero la
-- FOTO O EL VIDEO seguían en el almacenamiento y su URL pública seguía
-- sirviendo el archivo. Cualquiera que la hubiera copiado —el cliente
-- incluido— podía seguir viéndolo. O sea: el borrado NO era total.
--
-- Ahora el archivo se borra en la misma operación. Se borra la fila de
-- storage.objects: para un bucket público, eso es lo que decide si la URL
-- entrega el archivo o responde que no existe.
-- =====================================================================

create or replace function public.ruta_de_adjunto(p_url text)
returns text language sql immutable as $$
  select case
    when p_url is null or p_url = '' then null
    when position('/chat-images/' in p_url) = 0 then null
    else split_part(split_part(p_url, '/chat-images/', 2), '?', 1)
  end;
$$;

-- 1) Un mensaje: se lleva su adjunto.
create or replace function public.borrar_mensaje_chat(p_id text)
returns table (conversacion text)
language plpgsql security definer set search_path to 'public','storage'
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
  delete from storage.objects
   where bucket_id = 'chat-images'
     and name in (public.ruta_de_adjunto(v_img), public.ruta_de_adjunto(v_vid));
  return query select v_conv;
end;
$$;
grant execute on function public.borrar_mensaje_chat(text) to authenticated;

-- 2) Una conversación: se lleva TODA su carpeta de adjuntos.
drop function if exists public.purgar_conversacion(text);
create function public.purgar_conversacion(p_id text)
returns table (mensajes bigint, archivos bigint)
language plpgsql security definer set search_path to 'public','storage'
as $$
declare v_msg bigint := 0; v_arch bigint := 0;
begin
  if not public.is_staff() then
    raise exception 'Solo el personal puede cerrar una conversación';
  end if;
  with borrados as (
    delete from public.chat_messages where conversation_id = p_id returning 1
  ) select count(*) into v_msg from borrados;
  delete from public.chat_conversations where id = p_id;
  with archivos as (
    delete from storage.objects
     where bucket_id = 'chat-images' and name like p_id || '/%' returning 1
  ) select count(*) into v_arch from archivos;
  return query select v_msg, v_arch;
end;
$$;
grant execute on function public.purgar_conversacion(text) to authenticated;

-- 3) La purga total: se lleva el bucket entero del chat.
drop function if exists public.purgar_chats();
create function public.purgar_chats()
returns table (mensajes bigint, conversaciones bigint, archivos bigint)
language plpgsql security definer set search_path to 'public','storage'
as $$
declare v_msg bigint := 0; v_conv bigint := 0; v_arch bigint := 0;
begin
  if not public.is_superadmin() then
    raise exception 'Solo el administrador supremo puede purgar los chats';
  end if;
  with borrados as (delete from public.chat_messages returning 1)
  select count(*) into v_msg from borrados;
  with borradas as (delete from public.chat_conversations returning 1)
  select count(*) into v_conv from borradas;
  with archivos as (
    delete from storage.objects where bucket_id = 'chat-images' returning 1
  ) select count(*) into v_arch from archivos;
  return query select v_msg, v_conv, v_arch;
end;
$$;
grant execute on function public.purgar_chats() to authenticated;
