-- ===========================================================================
-- CADA ENTRADA A LA TIENDA QUEDA REGISTRADA (oct 2026)
-- ===========================================================================
-- YA EJECUTADO el 2026-10-13 en producción (autorizado por el dueño). Se deja
-- como referencia; sigue siendo seguro repetirlo.
--
-- Por qué: `visitor_fingerprints` y `supervision_visitantes` solo guardan la
-- ÚLTIMA vez que entró cada equipo y un contador de toda su vida (`visitas`).
-- Con eso es imposible contestar «¿cuántas veces entró el GFY-LX3 ayer?»: si el
-- equipo volvió a entrar hoy, ayer ni siquiera aparece. Javier contestaba con
-- cifras inventadas («386 veces ayer», que eran las de toda su vida).
--
-- Qué hace: una fila por entrada (huella + hora), que escribe `registrar_huella`
-- (la misma función que ya llama la tienda, como mucho cada 30 min por equipo).
-- Solo el superadmin la lee. Se limpia sola: lo de más de 180 días se borra.
-- Javier la usa apenas existe (herramienta visitantes_tienda); para los días
-- anteriores a hoy no hay datos y sigue diciendo que el conteo no se registraba.
--
-- Es seguro repetirlo: todo es «if not exists» / «create or replace».
-- ===========================================================================

create table if not exists public.visitor_visit_log (
  id       bigint generated always as identity primary key,
  huella   text not null,
  visto_en timestamptz not null default now()
);
create index if not exists visitor_visit_log_visto_en_idx on public.visitor_visit_log (visto_en desc);
create index if not exists visitor_visit_log_huella_idx on public.visitor_visit_log (huella, visto_en desc);

alter table public.visitor_visit_log enable row level security;
drop policy if exists "superadmin lee entradas" on public.visitor_visit_log;
create policy "superadmin lee entradas" on public.visitor_visit_log
  for select to authenticated using ((select public.is_superadmin()));

-- La misma función de siempre (mismos campos y mismo comportamiento), más el registro de la entrada.
-- El registro va en su propio bloque: si fallara, la huella se guarda igual.
create or replace function public.registrar_huella(p_huella text, p_datos jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ip    text;
  v_email text;
begin
  if p_huella is null or btrim(p_huella) = '' then return; end if;
  if length(p_huella) > 128 then return; end if;

  v_ip    := public.ip_del_solicitante();
  v_email := public.email_del_solicitante();

  insert into public.visitor_fingerprints as v (
    huella, ip, user_agent, navegador, version_navegador, sistema,
    version_sistema, dispositivo, tipo, plataforma, idioma, zona_horaria,
    pantalla, memoria_gb, nucleos, touch, origen, email, ultima_ruta, datos
  ) values (
    btrim(p_huella), v_ip,
    left(coalesce(p_datos ->> 'user_agent', ''), 512),
    p_datos ->> 'navegador', p_datos ->> 'version_navegador',
    p_datos ->> 'sistema', p_datos ->> 'version_sistema',
    p_datos ->> 'dispositivo', p_datos ->> 'tipo',
    p_datos ->> 'plataforma', p_datos ->> 'idioma', p_datos ->> 'zona_horaria',
    p_datos ->> 'pantalla',
    nullif(p_datos ->> 'memoria_gb', '')::numeric,
    nullif(p_datos ->> 'nucleos', '')::integer,
    nullif(p_datos ->> 'touch', '')::boolean,
    coalesce(p_datos ->> 'origen', 'web'), v_email,
    left(coalesce(p_datos ->> 'ruta', ''), 200),
    coalesce(p_datos, '{}'::jsonb)
  )
  on conflict (huella) do update set
    ultima_visita     = now(),
    visitas           = v.visitas + 1,
    ip                = coalesce(excluded.ip, v.ip),
    user_agent        = coalesce(nullif(excluded.user_agent, ''), v.user_agent),
    navegador         = coalesce(excluded.navegador, v.navegador),
    version_navegador = coalesce(excluded.version_navegador, v.version_navegador),
    sistema           = coalesce(excluded.sistema, v.sistema),
    version_sistema   = coalesce(excluded.version_sistema, v.version_sistema),
    dispositivo       = coalesce(excluded.dispositivo, v.dispositivo),
    tipo              = coalesce(excluded.tipo, v.tipo),
    plataforma        = coalesce(excluded.plataforma, v.plataforma),
    idioma            = coalesce(excluded.idioma, v.idioma),
    zona_horaria      = coalesce(excluded.zona_horaria, v.zona_horaria),
    pantalla          = coalesce(excluded.pantalla, v.pantalla),
    memoria_gb        = coalesce(excluded.memoria_gb, v.memoria_gb),
    nucleos           = coalesce(excluded.nucleos, v.nucleos),
    touch             = coalesce(excluded.touch, v.touch),
    origen            = coalesce(excluded.origen, v.origen),
    email             = coalesce(excluded.email, v.email),
    ultima_ruta       = coalesce(nullif(excluded.ultima_ruta, ''), v.ultima_ruta),
    datos             = coalesce(excluded.datos, v.datos);

  -- La entrada queda anotada (y de vez en cuando se limpia lo viejo).
  begin
    insert into public.visitor_visit_log (huella) values (btrim(p_huella));
    if random() < 0.02 then
      delete from public.visitor_visit_log where visto_en < now() - interval '180 days';
    end if;
  exception when others then
    null;
  end;
exception when others then
  return;
end;
$function$;
