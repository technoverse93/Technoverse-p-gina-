-- =====================================================================
-- UBICACIÓN, TAMBIÉN PARA VISITANTES ANÓNIMOS DE LA TIENDA
-- =====================================================================
-- REVIERTE A PROPÓSITO una regla de privacidad anterior de este mismo
-- archivo (migracion_supervision_clientes.sql): "esta tabla NO tiene, ni
-- debe tener nunca, correo, nombre, IP ni user_id... el ÚNICO
-- identificador es el MODELO del aparato". Esa regla seguía valiendo
-- hasta ahora. El dueño pidió explícitamente que el aviso de inicio
-- pueda capturar la ubicación real (GPS) también de un cliente anónimo
-- que solo vino a ver el catálogo, entendiendo el costo: alguien que
-- nunca dio su nombre queda igual con su posición exacta guardada,
-- atada al aparato (no a una persona, pero sí a un lugar).
--
-- Se guarda SOLO si `preferences.location` quedó en true en el aviso de
-- consentimiento (ver seguridad/consentimiento.ts y utils/ubicacion.ts):
-- quien rechaza o no abre "Configurar" para prender ese interruptor
-- nunca dispara `getCurrentPosition`, así que nunca llega hasta aquí.
--
-- Mismo patrón que `visitante_latido`: el visitante NO escribe la tabla
-- directo, lo hace por esta función SECURITY DEFINER, así nunca puede
-- leer ni tocar la fila de otro.
-- =====================================================================

alter table public.supervision_visitantes
  add column if not exists lat numeric(9,6),
  add column if not exists lon numeric(9,6),
  add column if not exists precision_m numeric,
  add column if not exists ubicacion_at timestamptz;

create or replace function public.registrar_ubicacion_visitante(
  p_visita text, p_lat double precision, p_lon double precision, p_precision_m double precision
) returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if coalesce(btrim(p_visita), '') = '' then return; end if;
  if p_lat is null or p_lon is null then return; end if;
  -- Rango físico real: descarta basura antes de que llegue a la tabla.
  if p_lat < -90 or p_lat > 90 or p_lon < -180 or p_lon > 180 then return; end if;

  update public.supervision_visitantes
     set lat = p_lat,
         lon = p_lon,
         precision_m = p_precision_m,
         ubicacion_at = now()
   where visita = left(p_visita, 100);
  -- Si la fila del visitante todavía no existe (llegó la ubicación antes
  -- que el primer latido), no se inserta a ciegas: `visitante_latido` es
  -- quien crea la fila, con el resto de los campos completos.
end;
$$;
grant execute on function public.registrar_ubicacion_visitante(text, double precision, double precision, double precision) to anon, authenticated;
