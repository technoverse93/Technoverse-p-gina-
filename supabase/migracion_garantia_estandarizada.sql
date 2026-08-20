-- =====================================================================
-- Estandarización de garantías: se quitan los 6 meses (orden explícita).
-- Quedan exactamente 1, 3 y 12 meses en TODO el sistema — la restricción
-- de la tabla y la validación de la función deben rechazar cualquier otro
-- valor, no solo el frontend.
-- =====================================================================

-- 1. La restricción de la tabla invoices
alter table public.invoices drop constraint if exists invoices_garantia_valida;
alter table public.invoices
  add constraint invoices_garantia_valida
  check (garantia_meses is null or garantia_meses in (1, 3, 12));

-- 2. La validación dentro de issue_invoice(): misma firma que ya existe
-- (ver migracion_issue_invoice_garantia.sql), solo se reemplaza el cuerpo.
create or replace function public.issue_invoice(
  p_order_id text, p_tipo_doc text, p_customer_identification_type text,
  p_customer_identification text, p_customer_name text, p_customer_email text,
  p_medio_pago text, p_items jsonb, p_subtotal numeric, p_iva_total numeric,
  p_total numeric, p_garantia_meses smallint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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

  update public.invoice_counters set last_number = v_next_number where tipo_doc = p_tipo_doc;

  v_consecutivo := lpad(v_next_number::text, 10, '0') || v_tipo_doc_padded || '0000000';
  v_fecha := to_char(now(), 'DDMMYY');

  select cedula, cedula_mostrar into v_emisor_cedula, v_emisor_cedula_mostrar
    from public.app_settings limit 1;

  v_emisor_cedula := lpad(coalesce(v_emisor_cedula, ''), 12, '0');

  v_clave := '506' || v_fecha ||
    lpad(v_emisor_cedula, 12, '0') ||
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
    'emisorCedulaMostrar', coalesce(v_emisor_cedula_mostrar, v_emisor_cedula),
    'garantiaMeses', p_garantia_meses
  );

  return v_result;
end;
$$;

-- =====================================================================
-- products.warranty: antes era texto libre, y por eso Inventario y
-- Facturación podían mostrar garantías en escalas totalmente distintas
-- (días en Inventario, meses en Facturación) que nunca coincidían. Se
-- estandariza al mismo trío de etiquetas que usa el desplegable de
-- Facturación. NULL/'' se permite: hay categorías (insumos, accesorios)
-- sin garantía configurada.
-- =====================================================================
alter table public.products drop constraint if exists products_warranty_valida;
alter table public.products
  add constraint products_warranty_valida
  check (warranty is null or warranty = '' or warranty in ('1 mes', '3 meses', '12 meses'));

-- Verificación
select conname, pg_get_constraintdef(oid) from pg_constraint
 where conname in ('invoices_garantia_valida', 'products_warranty_valida');
