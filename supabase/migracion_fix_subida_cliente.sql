-- =====================================================================
-- FIX: el cliente seguía sin poder mandar fotos
-- =====================================================================
-- APLICADO Y VERIFICADO EN PRODUCCIÓN.
--
-- LA POLÍTICA ANTERIOR SE SABOTEABA A SÍ MISMA. Comprobaba que la
-- conversación existiera con:
--
--     exists (select 1 from public.chat_conversations where id = ...)
--
-- ...y esa subconsulta corre CON LOS PERMISOS DE QUIEN SUBE. La RLS de
-- `chat_conversations` solo deja leer a `is_staff()` o al dueño del correo
-- (`chat_conv_select_own_or_staff`), y un cliente ANÓNIMO no cumple
-- ninguna de las dos: el `exists` devolvía falso y la subida se denegaba
-- SIEMPRE. Por eso el botón parecía no hacer nada.
--
-- La comprobación pasa a una función SECURITY DEFINER, que sí puede mirar
-- la tabla. Y se exige además una FORMA estricta de ruta —
-- <conversación>/<número>.<ext>— para que nadie pueda inventar árboles de
-- archivos dentro del bucket.
--
-- Queda dicho el límite: quien conociera un id de conversación podría
-- subir a esa carpeta. Los ids son largos y aleatorios, el bucket tiene
-- tope de 25 MB y solo acepta imagen/video, así que el daño posible es
-- acotado; pero no es una comprobación de identidad.
-- =====================================================================

create or replace function public.conversacion_existe(p_id text)
returns boolean
language sql security definer stable set search_path to 'public'
as $$
  select exists (select 1 from public.chat_conversations where id = p_id);
$$;
grant execute on function public.conversacion_existe(text) to anon, authenticated;

drop policy if exists chat_images_insert_cliente on storage.objects;
create policy chat_images_insert_cliente on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'chat-images'
    -- Exactamente dos segmentos, el segundo un número con extensión.
    and name ~ '^[^/]+/[0-9]+\.[A-Za-z0-9]{1,5}$'
    and public.conversacion_existe(split_part(name, '/', 1))
  );
