-- ===========================================================================
-- CORRECCIÓN DE HALLAZGOS DE LA AUDITORÍA PRE-LANZAMIENTO (Alta prioridad)
-- ===========================================================================
-- YA EJECUTADO en la base. Queda como constancia.
--
-- Corrige dos hallazgos de la auditoría de seguridad, ambos con la misma
-- causa raíz: código escrito asumiendo que RLS protege todo, sin notar que
-- ciertos caminos NO pasan por RLS.
--
-- ---------------------------------------------------------------------------
-- HALLAZGO 1 — El baneo por dispositivo no aplicaba dentro de adjust_stock
-- ni issue_invoice
-- ---------------------------------------------------------------------------
-- `adjust_stock()` e `issue_invoice()` son SECURITY DEFINER, propiedad de
-- "postgres". En Postgres, un rol con privilegio BYPASSRLS —que "postgres"
-- tiene por defecto en Supabase— hace que CUALQUIER función SECURITY DEFINER
-- suya ignore las políticas RLS de las tablas que toca, sin importar cuán
-- estrictas sean esas políticas.
--
-- La política "bloqueo total por ip" (RESTRICTIVE, sobre orders/invoices/
-- products) sí bloquea correctamente una escritura DIRECTA a esas tablas vía
-- PostgREST. Pero el flujo real de venta no escribe directo: pasa por estas
-- dos funciones. Un dispositivo o cuenta baneada podía llamarlas
-- directamente con la llave pública "anon" —sin pasar por la interfaz— y
-- completar una compra o emitir una factura igual.
--
-- Se agrega la misma verificación (`solicitante_bloqueado()`) al inicio de
-- ambas, como una comprobación explícita en el código, ya que el bypass de
-- RLS no se puede evitar sin quitarles SECURITY DEFINER —y ambas lo
-- necesitan para operar con privilegios elevados (bloqueo de filas,
-- consecutivo atómico).
--
-- ---------------------------------------------------------------------------
-- HALLAZGO 2 — product_components escribible por cualquier cliente
-- ---------------------------------------------------------------------------
-- La política de escritura usaba `to authenticated ... with check(true)`.
-- "authenticated" en Supabase es cualquier cuenta con sesión, no solo el
-- Dueño: un cliente común podía insertar, editar o borrar vínculos entre
-- productos, repuestos e insumos vía la API REST directa, sin pasar por la
-- pantalla de administración. Se restringe a `is_staff()`.
-- ===========================================================================

create or replace function public.adjust_stock(p_items jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  item jsonb;
  v_id text;
  v_delta int;
  v_stock int;
  v_is_staff boolean := is_staff();
begin
  if public.solicitante_bloqueado() then
    raise exception 'DEVICE_BLOCKED';
  end if;

  for item in select * from jsonb_array_elements(p_items) loop
    v_id := item->>'id';
    v_delta := (item->>'delta')::int;
    if v_delta < 0 and not v_is_staff then
      raise exception 'FORBIDDEN_RESTOCK:%', v_id;
    end if;
    select stock into v_stock from public.products where id = v_id for update;
    if v_stock is null then
      raise exception 'PRODUCT_NOT_FOUND:%', v_id;
    end if;
    if v_delta > 0 and v_stock < v_delta then
      raise exception 'INSUFFICIENT_STOCK:%:%', v_id, v_stock;
    end if;
  end loop;

  for item in select * from jsonb_array_elements(p_items) loop
    v_id := item->>'id';
    v_delta := (item->>'delta')::int;
    update public.products set stock = stock - v_delta where id = v_id;
  end loop;
end;
$function$;

create or replace function public.issue_invoice(
  p_order_id text, p_tipo_doc text, p_customer_identification_type text,
  p_customer_identification text, p_customer_name text, p_customer_email text,
  p_medio_pago text, p_items jsonb, p_subtotal numeric, p_iva_total numeric,
  p_total numeric,
  p_garantia_meses smallint default null
)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
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
  if public.solicitante_bloqueado() then
    raise exception 'DEVICE_BLOCKED';
  end if;

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

drop policy if exists "componentes escritura autenticada" on public.product_components;
create policy "componentes escritura autenticada"
  on public.product_components for all
  to authenticated
  using (is_staff())
  with check (is_staff());

-- ===========================================================================
-- VERIFICACIÓN
-- ===========================================================================
select proname, prosecdef from pg_proc where proname in ('adjust_stock','issue_invoice');
select policyname, roles, qual, with_check from pg_policies where tablename = 'product_components';
