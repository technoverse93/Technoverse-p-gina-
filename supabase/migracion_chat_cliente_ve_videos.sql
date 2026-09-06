-- =====================================================================
-- El cliente no veía los videos de su propio chat
-- =====================================================================
-- APLICADA en producción (2026-09-06).
--
-- `get_customer_chat` es el único camino por el que un cliente anónimo lee
-- su conversación: la RLS le cierra el SELECT directo sobre la tabla para
-- que nadie pueda leer chats ajenos, así que todo lo que ese RPC no
-- devuelva, para él sencillamente no existe.
--
-- El jsonb de cada mensaje armaba `image_url` pero se olvidaba de
-- `video_url`. Consecuencia: un video enviado por el administrador —o por
-- el propio cliente— viajaba bien, se guardaba bien y quedaba bien en el
-- panel, pero en la pantalla del cliente aparecía como un mensaje vacío.
--
-- No cambia nada más: mismos permisos, mismo filtro por token, misma
-- exclusión de las notas internas del personal.
-- =====================================================================

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
          'image_url', m.image_url, 'video_url', m.video_url,
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
