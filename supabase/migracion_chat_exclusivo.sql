-- ===========================================================================
-- CHAT EXCLUSIVO DE SUPERADMIN
-- ===========================================================================
-- YA EJECUTADO en la base.
--
-- Un chat marcado como exclusivo deja de existir para el resto del personal:
-- no lo ven en la bandeja, no reciben sus mensajes en tiempo real (Realtime
-- respeta RLS) y no pueden leerlo, escribir ni cambiarlo. Solo el
-- superadmin. El cliente sigue escribiendo igual: su acceso va por el
-- token de su aparato (get_customer_chat), que no pasa por estas reglas.
--
-- Es la MISMA barrera de rol que Ubicaciones y Bloqueos: `is_superadmin()`,
-- evaluada en el servidor. Ocultar el botón en la app es solo cortesía.
--
-- Se hace con políticas RESTRICTIVAS: se suman (con AND) a las que ya
-- existen, así que ninguna política permisiva vieja —por ejemplo la que
-- deja actualizar conversaciones sin asignar— puede abrir un hueco.
--
-- Lo que NO es: cifrado de extremo a extremo. Los mensajes siguen
-- guardados en la base como siempre; lo que cambia es quién puede leerlos.
-- ===========================================================================

alter table public.chat_conversations
  add column if not exists exclusivo_superadmin boolean not null default false;

-- Un aparte para que las políticas de mensajes no repitan la subconsulta y
-- para no depender de que quien pregunta pueda leer la conversación.
create or replace function public.chat_es_exclusivo(p_conversation_id text)
returns boolean language sql stable security definer set search_path to 'public'
as $$
  select coalesce((select exclusivo_superadmin from public.chat_conversations where id = p_conversation_id), false);
$$;

drop policy if exists "chat exclusivo superadmin" on public.chat_conversations;
create policy "chat exclusivo superadmin" on public.chat_conversations
  as restrictive for all to public
  using (not exclusivo_superadmin or not public.is_staff() or public.is_superadmin())
  -- Solo el superadmin puede dejar una conversación marcada como exclusiva.
  with check (not exclusivo_superadmin or not public.is_staff() or public.is_superadmin());

drop policy if exists "chat exclusivo superadmin" on public.chat_messages;
create policy "chat exclusivo superadmin" on public.chat_messages
  as restrictive for all to public
  using (not public.is_staff() or public.is_superadmin() or not public.chat_es_exclusivo(conversation_id))
  with check (not public.is_staff() or public.is_superadmin() or not public.chat_es_exclusivo(conversation_id));

-- Marcar y desmarcar: solo el superadmin, y queda en la bitácora del
-- servidor quién lo hizo y cuándo (updated_at).
create or replace function public.chat_marcar_exclusivo(p_id text, p_exclusivo boolean)
returns void language plpgsql security definer set search_path to 'public'
as $$
begin
  if not public.is_superadmin() then
    raise exception 'Solo el superadmin puede cambiar la exclusividad de un chat.';
  end if;
  update public.chat_conversations
     set exclusivo_superadmin = p_exclusivo, updated_at = now()
   where id = p_id;
end;
$$;
revoke all on function public.chat_marcar_exclusivo(text, boolean) from public, anon;
grant execute on function public.chat_marcar_exclusivo(text, boolean) to authenticated;
