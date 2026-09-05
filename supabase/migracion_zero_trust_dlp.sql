-- =====================================================================
-- ZERO TRUST · Etapa 4 — DLP (prevención de fuga por capturas)
-- =====================================================================
-- ⚠️  BORRADOR · TODAVÍA NO APLICADO EN PRODUCCIÓN ⚠️
--
-- A diferencia del resto de migraciones de esta carpeta, esta NO se ha
-- ejecutado contra la base. La Etapa 4 quedó PAUSADA a mitad, cuando
-- llegó la orden de hotfixes de supervisión, y solo alcanzó a escribirse
-- este esquema. No hay nada de código que lo use todavía: ni escudo web,
-- ni panel de lista blanca, ni FLAG_SECURE en la APK.
--
-- Queda aquí para no perder el diseño. Antes de aplicarlo hay que
-- retomar la Etapa 4 completa.
-- =====================================================================
-- Regla base: NADIE puede capturar pantalla (DENY ALL). El Superadmin
-- habilita excepciones por cuenta y por capa (web / APK). Una cuenta sin
-- fila —o con ambas capas en falso— queda bloqueada: falla cerrado.
--
--   dlp_whitelist : las excepciones vigentes. La escribe SOLO el
--                   superadmin. Cada quien LEE su propia fila para que su
--                   escudo (web/APK) sepa si debe levantarse o no.
--
-- El escudo web (bloqueo de PrintScreen, @media print en blanco, DOM en
-- negro al perder foco) DISUADE pero no blinda —una foto con otro teléfono
-- siempre es posible—. En la APK sí hay bloqueo real vía FLAG_SECURE, que
-- se activa/desactiva según esta misma lista. La honestidad de esa
-- diferencia está documentada en la maqueta aprobada por el dueño.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Lista blanca de capturas (las EXCEPCIONES a DENY ALL)
-- ---------------------------------------------------------------------
create table if not exists public.dlp_whitelist (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  allow_web  boolean not null default false,
  allow_apk  boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.dlp_whitelist enable row level security;

-- LEE: el superadmin ve toda la lista; cada quien ve SU fila (y solo esa)
-- para que su propio escudo sepa si está autorizado. Sin fila = bloqueado.
drop policy if exists dlp_whitelist_select on public.dlp_whitelist;
create policy dlp_whitelist_select on public.dlp_whitelist
  for select to authenticated
  using (public.is_superadmin() or user_id = auth.uid());

-- ESCRIBE: solo el superadmin administra la lista. El resto nunca puede
-- levantarse su propia restricción.
drop policy if exists dlp_whitelist_write on public.dlp_whitelist;
create policy dlp_whitelist_write on public.dlp_whitelist
  for all to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

-- Sella la metadata del lado del servidor (quién y cuándo).
create or replace function public.sellar_dlp_whitelist()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
drop trigger if exists sellar_dlp_whitelist_trg on public.dlp_whitelist;
create trigger sellar_dlp_whitelist_trg
  before insert or update on public.dlp_whitelist
  for each row execute function public.sellar_dlp_whitelist();

grant select, insert, update, delete on public.dlp_whitelist to authenticated;

-- ---------------------------------------------------------------------
-- RPC · listar la matriz de permisos (solo superadmin)
-- ---------------------------------------------------------------------
-- Devuelve TODO el personal (admin + empleado + superadmin) con su estado
-- de captura por capa, tomando el correo autoritativo de auth.users. Así
-- el panel dibuja una fila por cuenta aunque todavía no tenga excepción,
-- reflejando la regla DENY ALL por defecto.
create or replace function public.dlp_listar()
returns table (user_id uuid, email text, rol text, allow_web boolean, allow_apk boolean)
language sql security definer set search_path to 'public','auth'
as $$
  select p.id,
         coalesce(u.email, p.email)    as email,
         p.role::text                  as rol,
         coalesce(w.allow_web, false)  as allow_web,
         coalesce(w.allow_apk, false)  as allow_apk
  from public.profiles p
  left join auth.users u          on u.id = p.id
  left join public.dlp_whitelist w on w.user_id = p.id
  where public.is_superadmin()
    and p.role in ('superadmin','admin','empleado')
  order by (p.role = 'superadmin') desc, coalesce(u.email, p.email);
$$;
grant execute on function public.dlp_listar() to authenticated;

-- ---------------------------------------------------------------------
-- RPC · fijar el permiso de una cuenta (solo superadmin)
-- ---------------------------------------------------------------------
-- Centraliza la semántica DENY-por-defecto: si ambas capas quedan en
-- falso, se BORRA la fila (la cuenta vuelve a la regla base) en vez de
-- dejar basura. El correo se toma de auth.users, no del cliente.
create or replace function public.dlp_fijar(p_user_id uuid, p_web boolean, p_apk boolean)
returns void
language plpgsql security definer set search_path to 'public','auth'
as $$
declare v_email text;
begin
  if not public.is_superadmin() then
    raise exception 'Solo el administrador supremo puede cambiar la lista de capturas';
  end if;

  if coalesce(p_web, false) = false and coalesce(p_apk, false) = false then
    delete from public.dlp_whitelist where user_id = p_user_id;
    return;
  end if;

  select email into v_email from auth.users where id = p_user_id;
  insert into public.dlp_whitelist (user_id, email, allow_web, allow_apk)
    values (p_user_id, v_email, coalesce(p_web, false), coalesce(p_apk, false))
    on conflict (user_id) do update
      set allow_web = excluded.allow_web,
          allow_apk = excluded.allow_apk,
          email     = excluded.email;
end;
$$;
grant execute on function public.dlp_fijar(uuid, boolean, boolean) to authenticated;

-- Realtime: el escudo de cada empleado y el panel del superadmin reaccionan
-- al instante cuando se cambia un permiso (idempotente).
do $$ begin alter publication supabase_realtime add table public.dlp_whitelist;
exception when duplicate_object then null; when undefined_object then null; end $$;
