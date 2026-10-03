-- ===========================================================================
-- issue_invoice — REPARACIÓN (oct 2026)
-- ===========================================================================
-- YA EJECUTADO en la base.
--
-- QUÉ PASABA: en producción quedó cargada una versión de `issue_invoice`
-- distinta a la de migracion_issue_invoice_garantia.sql (no salió de este
-- repositorio). Esa versión no rellenaba `numero_documento`, `security_code`
-- ni `emisor_cedula`, tres columnas NOT NULL de `invoices`. Cada cobro
-- fallaba al insertar el comprobante ("null value in column
-- numero_documento ... violates not-null constraint"), la transacción se
-- deshacía entera y, como nunca existía la fila, el correo jamás se enviaba.
-- Desde el 18 de agosto no se emitió ningún comprobante.
--
-- Se vuelve a la versión correcta, con la misma firma (CREATE OR REPLACE
-- basta) y la garantía alineada a la restricción vigente de la tabla
-- (1, 3 o 12 meses).
--
-- SEGUNDO ARREGLO: la función de correo anota el desenlace en
-- `invoices.email_status` con valores como 'sin_correo' o 'error: …', pero
-- la restricción solo admitía 'pendiente', 'enviado' y 'fallido'. Esa
-- anotación fallaba en silencio y el estado quedaba en 'pendiente' aunque
-- el envío hubiera fallado. Se amplía la restricción.
-- ===========================================================================

create or replace function public.issue_invoice(
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
  if p_garantia_meses is not null and p_garantia_meses not in (1,3,12) then
    raise exception 'Garantía inválida: % meses. Solo se admiten 1, 3 o 12.', p_garantia_meses;
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
  v_cedula_digitos := regexp_replace(v_cedula_digitos, '\D', '', 'g');
  v_cedula_emisor := lpad(v_cedula_digitos, 12, '0');

  update public.invoice_counters
    set last_number = last_number + 1
    where tipo_doc = p_tipo_doc
    returning last_number into v_next_number;
  if v_next_number is null then
    raise exception 'No existe contador de consecutivo para el tipo de documento %', p_tipo_doc;
  end if;

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

alter table public.invoices drop constraint if exists invoices_email_status_check;
alter table public.invoices add constraint invoices_email_status_check
  check (email_status in ('pendiente', 'enviado', 'fallido', 'sin_correo', 'sin_pdf', 'sin_credenciales')
         or email_status like 'error:%');
