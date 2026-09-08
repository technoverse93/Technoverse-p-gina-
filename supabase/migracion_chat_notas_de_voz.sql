-- =====================================================================
-- CHAT: notas de voz (audio) además de foto y video
-- =====================================================================
-- Tres piezas, y las tres hacen falta: si se aplica solo una, el audio
-- viaja pero no se ve, o se ve pero el servidor lo rechaza.
--
--   1. La columna donde vive la URL del audio.
--   2. Los tipos MIME de audio en el bucket. Sin esto el servidor corta
--      la subida al final, con un error técnico que a la persona no le
--      dice nada ("mime type ... is not supported").
--   3. `get_customer_chat`, que es el ÚNICO camino por el que un cliente
--      anónimo lee su conversación (la RLS le cierra el SELECT directo).
--      Todo lo que ese RPC no devuelva, para él no existe — es
--      exactamente el fallo que tuvieron los videos en su momento, y por
--      eso se corrige aquí de una vez.
--
-- FORMATOS: `audio/webm` es lo que graba Chrome/Android con MediaRecorder;
-- `audio/mp4` y `audio/aac` los usan otros motores; `audio/mpeg` y
-- `audio/ogg` se admiten por si el archivo llega desde la galería.
--
-- No cambia permisos ni políticas: la política de subida del cliente
-- sigue siendo la misma (solo dentro de la carpeta de SU conversación) y
-- el tope de 25 MB del bucket queda igual.
-- =====================================================================

alter table public.chat_messages add column if not exists audio_url text;

update storage.buckets
   set allowed_mime_types = array[
         'image/jpeg','image/png','image/webp','image/gif','image/heic',
         'video/mp4','video/webm','video/quicktime',
         'audio/webm','audio/mp4','audio/mpeg','audio/ogg','audio/aac'
       ]
 where id = 'chat-images';

create or replace function public.get_customer_chat(p_token uuid)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(conv order by (conv->>'created_at') desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', c.id,
      'customer_name', c.customer_name,
      'customer_email', c.customer_email,
      'status', c.status,
      'unread_count', c.unread_count,
      'assigned_admin_email', c.assigned_admin_email,
      'created_at', c.created_at,
      'messages', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', m.id, 'sender', m.sender, 'text', m.text, 'created_at', m.created_at,
          'image_url', m.image_url, 'video_url', m.video_url, 'audio_url', m.audio_url,
          'is_internal_note', m.is_internal_note
        ) order by m.created_at asc)
        from public.chat_messages m
        where m.conversation_id = c.id and m.is_internal_note is not true
      ), '[]'::jsonb)
    ) as conv
    from public.chat_conversations c
    where p_token is not null and c.customer_token = p_token
  ) t;
$function$;
