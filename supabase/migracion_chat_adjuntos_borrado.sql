-- =====================================================================
-- CHAT: adjuntos del cliente, video, y borrado selectivo
-- =====================================================================
-- APLICADO Y VERIFICADO EN PRODUCCIÓN.
--
-- Tres cosas:
--   1. Los mensajes pueden llevar VIDEO además de imagen.
--   2. EL CLIENTE puede subir. Antes la política del bucket exigía
--      `is_staff()`: por eso al cliente le fallaba en silencio. Ahora
--      también el visitante anónimo, pero SOLO dentro de la carpeta de una
--      conversación que ya existe.
--   3. Borrado fino: cerrar UNA conversación, o borrar UN mensaje para
--      todos — la alternativa al botón nuclear, que se lleva todo.
-- =====================================================================

alter table public.chat_messages add column if not exists video_url text;

-- Tope y tipos, del lado del SERVIDOR. Sin esto, abrir la subida al
-- cliente permitiría empujar cualquier cosa de cualquier tamaño.
update storage.buckets
   set file_size_limit = 26214400,   -- 25 MB
       allowed_mime_types = array[
         'image/jpeg','image/png','image/webp','image/gif','image/heic',
         'video/mp4','video/webm','video/quicktime'
       ]
 where id = 'chat-images';

drop policy if exists chat_images_insert_cliente on storage.objects;
create policy chat_images_insert_cliente on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'chat-images'
    and exists (
      select 1 from public.chat_conversations c
       where c.id = split_part(name, '/', 1)
    )
  );

-- Cerrar UNA conversación (la variante fina del botón nuclear).
create or replace function public.purgar_conversacion(p_id text)
returns table (mensajes bigint)
language plpgsql security definer set search_path to 'public'
as $$
declare v_msg bigint := 0;
begin
  if not public.is_staff() then
    raise exception 'Solo el personal puede cerrar una conversación';
  end if;
  with borrados as (
    delete from public.chat_messages where conversation_id = p_id returning 1
  )
  select count(*) into v_msg from borrados;
  delete from public.chat_conversations where id = p_id;
  return query select v_msg;
end;
$$;
grant execute on function public.purgar_conversacion(text) to authenticated;

-- Borrar UN mensaje para todos (del cliente o del propio admin). Devuelve
-- la conversación a la que pertenecía, para avisar solo a quien toca.
create or replace function public.borrar_mensaje_chat(p_id text)
returns table (conversacion text)
language plpgsql security definer set search_path to 'public'
as $$
declare v_conv text;
begin
  if not public.is_staff() then
    raise exception 'Solo el personal puede borrar un mensaje';
  end if;
  select m.conversation_id into v_conv from public.chat_messages m where m.id = p_id;
  if v_conv is null then
    raise exception 'Ese mensaje ya no existe';
  end if;
  delete from public.chat_messages where id = p_id;
  return query select v_conv;
end;
$$;
grant execute on function public.borrar_mensaje_chat(text) to authenticated;
