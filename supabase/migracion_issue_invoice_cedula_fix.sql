-- ===========================================================================
-- FIX: issue_invoice() leía columnas que NO existen en app_settings
-- ===========================================================================
-- La migración `garantia_estandarizada_1_3_12` (20 ago) redefinió
-- `issue_invoice` con:
--
--     select cedula, cedula_mostrar into ... from app_settings
--
-- pero `app_settings` solo tiene `cedula_juridica` (ver
-- emisor_identificacion.sql: el nombre es histórico y no se renombra). Como
-- plpgsql resuelve las columnas al EJECUTAR, la función se creó sin error y
-- falla en CADA cobro con "column "cedula" does not exist". La única factura
-- guardada en producción es anterior a esa migración.
--
-- Este arreglo lee `cedula_juridica`, conserva todo lo demás tal cual y no
-- toca datos. La identificación se guarda tal como se configuró para
-- mostrarla en el comprobante, y para la clave de Hacienda se limpia a solo
-- dígitos y se rellena a 12 posiciones.
-- ===========================================================================

create or replace function public.issue_invoice(
  p_order_id text, p_tipo_doc text, p_customer_identification_type text,
  p_customer_identification text, p_customer_name text, p_customer_email text,
  p_medio_pago text, p_items jsonb, p_subtotal numeric, p_iva_total numeric,
  p_total numeric, p_garantia_meses smallint default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_fecha text;
  v_consecutivo text;
  v_clave text;
  v_next_number bigint;
  v_tipo_doc_padded text;
  v_emisor_cedula text;
  v_emisor_cedula_mostrar text;
  v_result jsonb;
  v_invoice_id text;
begin
  if p_garantia_meses is not null and p_garantia_meses not in (1,3,12) then
    raise exception 'Garantía inválida: % meses. Solo se admiten 1, 3 o 12.', p_garantia_meses;
  end if;

  v_tipo_doc_padded := lpad(p_tipo_doc, 2, '0');

  select last_number + 1 into v_next_number
    from public.invoice_counters
   where tipo_doc = p_tipo_doc
     for update;

  if v_next_number is null then
    raise exception 'No existe contador de consecutivo para el tipo de documento %', p_tipo_doc;
  end if;

  -- La identificación del emisor se lee ANTES de gastar el consecutivo: si
  -- falta, se rechaza sin quemar un número fiscal.
  select cedula_juridica into v_emisor_cedula_mostrar
    from public.app_settings limit 1;

  v_emisor_cedula := regexp_replace(coalesce(v_emisor_cedula_mostrar, ''), '\D', '', 'g');
  if v_emisor_cedula = '' then
    raise exception 'Falta la identificación del emisor en la configuración de la empresa.';
  end if;
  v_emisor_cedula := lpad(v_emisor_cedula, 12, '0');

  update public.invoice_counters set last_number = v_next_number where tipo_doc = p_tipo_doc;

  v_consecutivo := lpad(v_next_number::text, 10, '0') || v_tipo_doc_padded || '0000000';
  v_fecha := to_char(now(), 'DDMMYY');

  v_clave := '506' || v_fecha ||
    v_emisor_cedula ||
    lpad(v_next_number::text, 10, '0') ||
    v_tipo_doc_padded ||
    lpad(floor(random() * 100000000)::text, 8, '0') ||
    '1';

  v_invoice_id := 'FE-' || v_consecutivo;

  insert into public.invoices (
    id, clave, consecutivo, order_id, tipo_doc,
    customer_identification_type, customer_identification,
    customer_name, customer_email, medio_pago, items, subtotal, iva_total, total, garantia_meses
  ) values (
    v_invoice_id, v_clave, v_consecutivo, p_order_id, p_tipo_doc,
    p_customer_identification_type, p_customer_identification,
    p_customer_name, p_customer_email, p_medio_pago, coalesce(p_items, '[]'::jsonb), p_subtotal, p_iva_total, p_total,
    p_garantia_meses
  );

  v_result := jsonb_build_object(
    'id', v_invoice_id,
    'clave', v_clave,
    'consecutivo', v_consecutivo,
    'emisorCedula', v_emisor_cedula,
    'emisorCedulaMostrar', coalesce(nullif(v_emisor_cedula_mostrar, ''), v_emisor_cedula),
    'garantiaMeses', p_garantia_meses
  );

  return v_result;
end;
$function$;
