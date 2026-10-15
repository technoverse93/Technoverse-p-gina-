-- =====================================================================
-- MOTOR DE BANNERS · cintillo, campañas, botón, estilo, prioridad y métricas · 2026-10-15
-- =====================================================================
-- QUÉ AGREGA. La tabla `banners` ya tenía cuatro formatos (hero, divisor, grid, popup). El motor nuevo
-- (src/components/store/BannersTienda.tsx, src/components/admin/GestorBanners.tsx) suma:
--   · dos formatos más: 'cintillo' (franja de una línea con el mensaje del día) y 'campana' (tarjetas
--     de campaña con la oferta destacada);
--   · `cta`       — texto del botón («Ver ofertas»);
--   · `variante`  — el estilo, siempre con colores del tema (acento, acento2, suave, oscuro): sigue a las
--                   paletas de marca y al modo claro/oscuro, nunca un color fijo;
--   · `prioridad` — el orden entre banners del mismo formato (menor = primero);
--   · `banner_metricas` — cuántas veces se VIO y se TOCÓ cada banner. Solo dos números por banner:
--                   no se guarda nada de la persona (ni IP, ni dispositivo, ni correo).
--
-- CÓMO SE REGISTRAN LAS MÉTRICAS. La tienda llama `banner_evento(id, 'vista' | 'clic')`:
--   · es la ÚNICA forma de sumar (la tabla no admite escrituras desde la API, ni siquiera del personal),
--   · ignora al personal logueado (probar un banner no cuenta), a quien está bloqueado por IP, a los
--     banners que no existen o están pausados, y los tipos que no sean 'vista' o 'clic',
--   · pone un tope por persona/IP (240 eventos cada 10 minutos) con `limitar_uso` si el blindaje de
--     seguridad ya está aplicado (si todavía no, sigue funcionando sin el tope),
--   · son cifras ORIENTATIVAS (para saber qué banner funciona), no se usan para decidir nada solo.
--   El personal las lee con `select` sobre `banner_metricas` (la política solo deja pasar al personal).
--
-- CLIENTES VIEJOS. Cambio aditivo: las columnas nuevas tienen valor por defecto y un cliente viejo (APK/OTA
-- anteriores) que no las manda sigue guardando y leyendo banners igual. El panel nuevo, mientras esta
-- migración no esté aplicada, funciona con los cuatro formatos de siempre y avisa qué falta.
--
-- ENDURECIMIENTO. Topes de largo y un enlace que no puede ser `javascript:`, `data:` ni similares (NOT VALID:
-- se aplican a lo que se guarde de ahora en adelante, no revisan lo que ya hubiera).
--
-- CÓMO SE APLICA. Después de `migracion_banners_formato.sql` (ya aplicada). Idempotente. No requiere que el
-- blindaje de seguridad esté aplicado. Probada con supabase/pruebas/banners_motor.sql.
-- =====================================================================

-- ---- columnas nuevas ----
alter table public.banners
  add column if not exists cta       text,
  add column if not exists variante  text,
  add column if not exists prioridad integer not null default 0;

-- ---- formatos: los cuatro de antes + cintillo y campaña ----
alter table public.banners drop constraint if exists banners_formato_check;
alter table public.banners
  add constraint banners_formato_check
  check (formato in ('hero', 'divisor', 'grid', 'popup', 'cintillo', 'campana'));

-- ---- estilos: solo los que la app entiende ----
alter table public.banners drop constraint if exists banners_variante_check;
alter table public.banners
  add constraint banners_variante_check
  check (variante is null or variante in ('acento', 'acento2', 'suave', 'oscuro'));

-- ---- topes de largo (lo que la pantalla muestra y lo que el Worker deja dentro del HTML) ----
alter table public.banners drop constraint if exists banners_largos_check;
alter table public.banners
  add constraint banners_largos_check
  check (char_length(coalesce(title, ''))       <= 200
     and char_length(coalesce(description, '')) <= 1000
     and char_length(coalesce(oferta, ''))      <= 40
     and char_length(coalesce(cta, ''))         <= 60
     and char_length(coalesce(link, ''))        <= 2000) not valid;

-- ---- el enlace del banner no puede ejecutar código (javascript:, data:, vbscript:, file:, blob:) ----
-- Los navegadores ignoran espacios, tabuladores y saltos de línea dentro del esquema («java\tscript:»):
-- se quitan antes de mirar.
alter table public.banners drop constraint if exists banners_link_sin_scripts;
alter table public.banners
  add constraint banners_link_sin_scripts
  check (link is null
         or regexp_replace(link, '[[:space:][:cntrl:]]', '', 'g') !~* '^(javascript|data|vbscript|file|blob):') not valid;

-- ---- métricas: dos números por banner ----
create table if not exists public.banner_metricas (
  banner_id text primary key references public.banners(id) on delete cascade,
  vistas    bigint not null default 0 check (vistas >= 0),
  clics     bigint not null default 0 check (clics >= 0),
  ultimo    timestamptz
);
alter table public.banner_metricas enable row level security;
-- Nadie escribe desde la API (solo `banner_evento`, que corre con permisos propios). Leer: el personal.
revoke all on public.banner_metricas from anon, authenticated;
grant select on public.banner_metricas to authenticated;
drop policy if exists banner_metricas_personal_lee on public.banner_metricas;
create policy banner_metricas_personal_lee on public.banner_metricas
  for select to authenticated using (public.is_staff());

-- ---- anotar un evento ----
create or replace function public.banner_evento(p_id text, p_tipo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_tipo is null or p_tipo not in ('vista', 'clic') then
    raise exception 'Tipo de evento de banner no válido.' using errcode = '22023';
  end if;
  if p_id is null or char_length(p_id) > 120 then
    return;
  end if;

  -- El personal que prueba o edita no suma; tampoco quien está bloqueado por IP.
  if coalesce(public.is_staff(), false) then
    return;
  end if;
  if public.solicitante_bloqueado() then
    return;
  end if;

  -- Tope por persona/IP. Si se pasa, el evento simplemente no se cuenta (sin error: es solo una cifra).
  -- Si el blindaje de seguridad todavía no está aplicado, `limitar_uso` no existe y se sigue sin tope.
  begin
    perform public.limitar_uso('banner_evento', 240, 600);
  exception
    when undefined_function then null;
    when raise_exception then return;
  end;

  insert into public.banner_metricas as m (banner_id, vistas, clics, ultimo)
  select b.id,
         case when p_tipo = 'vista' then 1 else 0 end,
         case when p_tipo = 'clic'  then 1 else 0 end,
         now()
    from public.banners b
   where b.id = p_id
     and b.active is not false
  on conflict (banner_id) do update
     set vistas = m.vistas + excluded.vistas,
         clics  = m.clics  + excluded.clics,
         ultimo = excluded.ultimo;
end;
$$;

revoke all on function public.banner_evento(text, text) from public;
grant execute on function public.banner_evento(text, text) to anon, authenticated;

-- REVERTIR (no borra banners; lo nuevo desaparece):
--   drop function if exists public.banner_evento(text, text);
--   drop table if exists public.banner_metricas;
--   alter table public.banners
--     drop constraint if exists banners_link_sin_scripts, drop constraint if exists banners_largos_check,
--     drop constraint if exists banners_variante_check, drop constraint if exists banners_formato_check;
--   (antes: pasar a 'hero' o borrar los banners 'cintillo' y 'campana'; después: volver a poner
--    banners_formato_check con los cuatro formatos de migracion_banners_formato.sql)
--   alter table public.banners drop column if exists cta, drop column if exists variante, drop column if exists prioridad;
