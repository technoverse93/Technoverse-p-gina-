-- =====================================================================
-- AVISOS AL TELÉFONO (push) — que te avise aunque la app esté cerrada
-- =====================================================================
-- Hasta ahora el aviso de un mensaje nuevo era una notificación LOCAL: solo
-- salía mientras la app estaba abierta o recién dejada en segundo plano.
-- Android duerme la app a los minutos y se corta la conexión en vivo, así
-- que no llegaba nada. Esto lo arregla desde el servidor:
--
--  1) dispositivos_push: los teléfonos del personal que quieren avisos.
--     La app los registra (y los borra al cerrar sesión) con las dos
--     funciones de abajo; solo el personal puede. Nadie lee la tabla desde
--     la app: solo la función de Jarvis (service_role).
--  2) jarvis_llamar(tarea, datos): la misma puerta del proactivo, pero
--     pasando datos (el id del mensaje).
--  3) Un gatillo en chat_messages: cuando un CLIENTE escribe (no notas
--     internas ni respuestas del personal), le avisa a la función, que manda
--     el aviso a los teléfonos del personal. Si el aviso falla, el mensaje
--     del cliente se guarda igual: el gatillo nunca lo frena.
--
-- Necesita lo de migracion_jarvis_proactivo.sql (jarvis_cron, jarvis_llamar).
-- Es estructura: no toca ni borra datos existentes.
-- =====================================================================

create table if not exists public.dispositivos_push (
  token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  plataforma text not null default 'android',
  modelo text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists dispositivos_push_usuario_idx on public.dispositivos_push (user_id);
alter table public.dispositivos_push enable row level security; -- sin políticas: solo service_role

-- La app registra el teléfono de quien tiene la sesión (y solo el personal).
-- Si el teléfono cambió de cuenta, el aviso pasa a la cuenta nueva.
create or replace function public.registrar_dispositivo_push(p_token text, p_modelo text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'Solo el personal puede recibir avisos.'; end if;
  if coalesce(length(p_token), 0) < 40 then raise exception 'Token no válido.'; end if;
  insert into public.dispositivos_push (token, user_id, modelo)
  values (p_token, auth.uid(), left(p_modelo, 80))
  on conflict (token) do update set user_id = auth.uid(), modelo = left(p_modelo, 80), actualizado_en = now();
end $$;

-- Al cerrar sesión el teléfono deja de recibir los avisos de esa cuenta.
create or replace function public.quitar_dispositivo_push(p_token text)
returns void language sql security definer set search_path = public as $$
  delete from public.dispositivos_push where token = p_token and user_id = auth.uid();
$$;

revoke all on function public.registrar_dispositivo_push(text, text) from public, anon;
revoke all on function public.quitar_dispositivo_push(text) from public, anon;
grant execute on function public.registrar_dispositivo_push(text, text) to authenticated;
grant execute on function public.quitar_dispositivo_push(text) to authenticated;

-- La puerta del proactivo, con datos. (La clave anónima solo sirve para pasar
-- la puerta; la función compara además la llave de jarvis_cron.)
create or replace function public.jarvis_llamar(p_tarea text, p_datos jsonb)
returns bigint
language sql
security definer
set search_path = public, extensions
as $$
  select net.http_post(
    url := 'https://hzatdfrjcqiimgqxcwwh.supabase.co/functions/v1/asistente-ia',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh6YXRkZnJqY3FpaW1ncXhjd3doIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwNDk1ODksImV4cCI6MjA5OTYyNTU4OX0.mI199p1d-zMqQLZ86h-RFtg01Q4JJ8nWvfIBrQoX7Ic',
      'x-jarvis-cron', (select clave from public.jarvis_cron where id = 1)
    ),
    body := jsonb_build_object('accion', 'cron', 'tarea', p_tarea, 'datos', p_datos),
    timeout_milliseconds := 30000
  );
$$;
revoke all on function public.jarvis_llamar(text, jsonb) from public, anon, authenticated;

-- El gatillo: un cliente escribió → avisar al personal.
create or replace function public.chat_empujar()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  begin
    perform public.jarvis_llamar('push_chat', jsonb_build_object('mensaje', new.id));
  exception when others then
    null; -- nunca frena el mensaje del cliente
  end;
  return null;
end $$;
revoke all on function public.chat_empujar() from public, anon, authenticated;

drop trigger if exists trg_chat_empujar on public.chat_messages;
create trigger trg_chat_empujar
  after insert on public.chat_messages
  for each row
  when (new.sender = 'customer' and coalesce(new.is_internal_note, false) = false)
  execute function public.chat_empujar();
