-- ===========================================================================
-- adjust_stock() ahora devuelve confirmación de cada renglón tocado
-- ===========================================================================
-- Ya ejecutada en producción (proyecto hzatdfrjcqiimgqxcwwh) el 2026-08-13.
--
-- ---------------------------------------------------------------------------
-- QUÉ PROBLEMA CIERRA
-- ---------------------------------------------------------------------------
-- Se encontraron ventas reales (FAC-260812-SGIM0, FAC-260813-752AN) donde
-- la factura salió bien pero el inventario del repuesto/insumo usado se
-- quedó exactamente igual, sin ningún movimiento de salida registrado.
--
-- adjust_stock() probado directamente en SQL contra un producto real
-- funciona perfecto: baja el stock exactamente como debe. El hueco no
-- está en la resta en sí — está en que la función devolvía `void`, así
-- que quien la llama (processSaleAtomic, en src/utils/transactions.ts)
-- no tenía forma de comprobar que los artículos que CREÍA haber enviado
-- de verdad llegaron y se procesaron. Un carrito vacío por cualquier
-- causa del lado del cliente pasaba como éxito silencioso, exactamente
-- igual que un carrito con todo bien: la factura se emite en ambos
-- casos, y solo el segundo debería.
--
-- ---------------------------------------------------------------------------
-- QUÉ CAMBIA
-- ---------------------------------------------------------------------------
-- Ahora devuelve un jsonb con un renglón por cada artículo que
-- REALMENTE tocó: {id, delta, stock_resultante}. processSaleAtomic (y
-- processRepairAtomic) comparan la cantidad de renglones devueltos
-- contra la cantidad de artículos pedidos; si no coinciden, lanzan un
-- error y bloquean la venta/reparación entera ANTES de emitir ningún
-- comprobante, en vez de dejar pasar el hueco en silencio como hasta
-- ahora. Un carrito vacío sigue siendo válido (trabajos de puro
-- diagnóstico o mano de obra): ahí se piden 0 artículos, se devuelven 0
-- renglones, la cuenta cuadra y no bloquea nada.
-- ===========================================================================

drop function if exists public.adjust_stock(jsonb);

create function public.adjust_stock(p_items jsonb)
returns jsonb
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
  v_resultado jsonb := '[]'::jsonb;
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
    update public.products set stock = stock - v_delta where id = v_id
      returning stock into v_stock;
    v_resultado := v_resultado || jsonb_build_object('id', v_id, 'delta', v_delta, 'stock_resultante', v_stock);
  end loop;

  return v_resultado;
end;
$function$;

-- ===========================================================================
-- VERIFICACIÓN
-- ===========================================================================
select public.adjust_stock('[]'::jsonb);
-- Debe devolver [] (jsonb vacío), sin error.
