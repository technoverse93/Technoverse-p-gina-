-- ===========================================================================
-- issue_invoice — guarda la garantía y devuelve la cédula sin relleno
-- ===========================================================================
-- YA EJECUTADO en la base. Queda como constancia de qué se corrió, y para
-- poder reproducirlo si algún día hay que rehacer el proyecto.
--
-- Corre DESPUÉS de migracion_insumos_vinculacion.sql, que es quien crea la
-- columna `invoices.garantia_meses` que esto rellena.
--
-- ---------------------------------------------------------------------------
-- DOS CORRECCIONES
-- ---------------------------------------------------------------------------
-- 1. LA GARANTÍA NO SE GUARDABA. La función no recibía el plazo, así que la
--    columna nueva se habría quedado siempre en NULL. Ahora entra por
--    parámetro y se valida contra los mismos cuatro valores (1, 3, 6, 12)
--    que acepta la restricción de la tabla.
--
-- 2. LA CÉDULA SALÍA IMPRESA CON CEROS DELANTE. La clave de Hacienda exige
--    12 posiciones para el emisor, así que la función rellenaba con ceros
--    —correcto— pero devolvía ESE valor al PDF. Con una cédula física de 9
--    dígitos, el comprobante mostraba "Cédula 000119090965" en vez de
--    "119090965".
--
--    Ahora se devuelven las dos formas: `emisorCedula` (rellena, para la
--    clave) y `emisorCedulaMostrar` (tal cual se configuró, para imprimir).
--
-- ---------------------------------------------------------------------------
-- POR QUÉ DROP Y NO "CREATE OR REPLACE"
-- ---------------------------------------------------------------------------
-- El parámetro nuevo cambia la firma, y CREATE OR REPLACE exige que la firma
-- coincida. Sin el DROP quedarían DOS versiones de la función, y toda llamada
-- con once argumentos —las que hace hoy el checkout— fallaría por ambigüedad.
--
-- Va dentro de una transacción para que, si algo falla, la función anterior
-- siga en pie y la emisión de comprobantes no quede rota.
--
-- El parámetro nuevo lleva DEFAULT NULL: las llamadas existentes de once
-- argumentos siguen funcionando exactamente igual.
--
-- Los permisos (EXECUTE para anon y authenticated) los repone Supabase por
-- sus privilegios por defecto del esquema public. Se verifican al final.
-- ===========================================================================

begin;

drop function if exists public.issue_invoice(text,text,text,text,text,text,text,jsonb,numeric,numeric,numeric);

create function public.issue_invoice(
  p_order_id text, p_tipo_doc text, p_customer_identification_type text,
  p_customer_identification text, p_customer_name text, p_customer_email text,
  p_medio_pago text, p_items jsonb, p_subtotal numeric, p_iva_total numeric,
  p_total numeric,
  p_garantia_meses smallint default null
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_cedula_digitos text;
  v_cedula_emisor text;
  v_next_number bigint;
  v_numero_documento text;
  v_consecutivo text;
  v_fecha text;
  v_security_code text;
  v_clave text;
  v_invoice_id text;
begin
  if p_tipo_doc not in ('01','04') then
    raise exception 'Tipo de documento inválido: %', p_tipo_doc;
  end if;
  if p_customer_identification_type not in ('01','02','03','04') then
    raise exception 'Tipo de identificación inválido: %', p_customer_identification_type;
  end if;
  if p_medio_pago not in ('01','02','04') then
    raise exception 'Medio de pago inválido: %', p_medio_pago;
  end if;
  if p_garantia_meses is not null and p_garantia_meses not in (1,3,6,12) then
    raise exception 'Garantía inválida: % meses. Solo se admiten 1, 3, 6 o 12.', p_garantia_meses;
  end if;
  if not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'La orden % no existe.', p_order_id;
  end if;
  if exists (select 1 from public.invoices where order_id = p_order_id) then
    raise exception 'La orden % ya tiene un comprobante emitido.', p_order_id;
  end if;

  select cedula_juridica into v_cedula_digitos from public.app_settings limit 1;
  if v_cedula_digitos is null or length(regexp_replace(v_cedula_digitos, '\D', '', 'g')) = 0 then
    raise exception 'Configure la identificación del emisor en Ajustes antes de emitir comprobantes.';
  end if;

  -- Dos formas del mismo dato, y la distinción importa:
  --   · v_cedula_digitos  = tal cual se configuró, solo dígitos. Es la que
  --     se IMPRIME en el comprobante.
  --   · v_cedula_emisor   = rellena a 12 con ceros. La clave de Hacienda
  --     exige exactamente 12 posiciones para el emisor.
  -- Antes solo existía la segunda y era la que viajaba al PDF, así que una
  -- cédula física de 9 dígitos salía impresa como 000119090965.
  v_cedula_digitos := regexp_replace(v_cedula_digitos, '\D', '', 'g');
  v_cedula_emisor := lpad(v_cedula_digitos, 12, '0');

  update public.invoice_counters
    set last_number = last_number + 1
    where tipo_doc = p_tipo_doc
    returning last_number into v_next_number;

  v_numero_documento := lpad(v_next_number::text, 10, '0');
  v_consecutivo := '001' || '00001' || p_tipo_doc || v_numero_documento;
  v_fecha := to_char(now(), 'DDMMYY');
  v_security_code := lpad(floor(random() * 100000000)::text, 8, '0');
  v_clave := '506' || v_fecha || v_cedula_emisor || v_consecutivo || '1' || v_security_code;
  v_invoice_id := 'FE-' || v_consecutivo;

  insert into public.invoices (
    id, order_id, clave, consecutivo, tipo_doc, sucursal, terminal, numero_documento,
    situacion, security_code, emisor_cedula, customer_identification_type, customer_identification,
    customer_name, customer_email, medio_pago, items, subtotal, iva_total, total, garantia_meses
  ) values (
    v_invoice_id, p_order_id, v_clave, v_consecutivo, p_tipo_doc, '001', '00001', v_numero_documento,
    '1', v_security_code, v_cedula_emisor, p_customer_identification_type, coalesce(p_customer_identification, ''),
    p_customer_name, p_customer_email, p_medio_pago, coalesce(p_items, '[]'::jsonb), p_subtotal, p_iva_total, p_total,
    p_garantia_meses
  );

  return jsonb_build_object(
    'id', v_invoice_id, 'clave', v_clave, 'consecutivo', v_consecutivo,
    'emisorCedula', v_cedula_emisor,
    'emisorCedulaMostrar', v_cedula_digitos,
    'garantiaMeses', p_garantia_meses,
    'securityCode', v_security_code, 'fecha', v_fecha
  );
end;
$function$;

commit;

-- ===========================================================================
-- VERIFICACIÓN
-- ===========================================================================
-- La firma debe terminar en "p_garantia_meses smallint":
select proname, pg_get_function_identity_arguments(oid) as firma
  from pg_proc where proname = 'issue_invoice';

-- anon y authenticated deben poder ejecutarla, o el checkout deja de emitir:
select grantee, privilege_type
  from information_schema.routine_privileges
 where routine_schema = 'public' and routine_name = 'issue_invoice'
 order by grantee;
