-- =====================================================================
-- El archivo de conversaciones es del PANEL, no del cliente
-- =====================================================================
-- APLICADA en producción (2026-09-06).
--
-- POR QUÉ
-- ---------------------------------------------------------------------
-- `get_customer_chat` es el único camino por el que un cliente anónimo lee
-- su conversación, y hasta ahora le devolvía TODAS las de su token,
-- incluidas las cerradas hace meses. Eso contradecía el borrado: el
-- administrador cierra o borra una conversación para que deje de existir,
-- y el propio archivo del cliente era la puerta por la que volvía.
--
-- Ahora devuelve UNA sola: la más reciente. Las viejas no viajan al
-- aparato, así que no hay nada que recuperar ni nada que capturar. El
-- personal las sigue viendo completas desde el panel, que es donde el
-- historial tiene sentido: seguimiento de un caso, historial de cliente.
--
-- EFECTO SOBRE EL BORRADO
-- ---------------------------------------------------------------------
-- Si el administrador borra o cierra la conversación, esta función deja de
-- devolver esa fila. La pantalla del cliente se vacía en la siguiente
-- relectura —al abrir el chat, al volver a la aplicación, al reconectar el
-- canal y cada 30 segundos— sin recargar la página y sin vuelta atrás: la
-- fila ya no existe y los archivos adjuntos se borraron con la API de
-- Storage.
--
-- Lo demás queda igual: mismo filtro por token, mismos permisos, y las
-- notas internas del personal siguen sin salir nunca.
-- =====================================================================

create or replace function public.get_customer_chat(p_token uuid)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(conv), '[]'::jsonb)
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
    order by c.created_at desc
    limit 1
  ) t;
$function$;
