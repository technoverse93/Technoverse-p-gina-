-- ===========================================================================
-- orders.payment_method — admitir "Efectivo"
-- ===========================================================================
-- YA EJECUTADO en la base. Queda como constancia.
--
-- ---------------------------------------------------------------------------
-- EL FALLO QUE ESTO CORRIGE
-- ---------------------------------------------------------------------------
-- Al crear el módulo de cobros se añadió "Efectivo" como medio de pago: se
-- amplió el tipo en TypeScript (`Order.paymentMethod`) y se ofreció el botón
-- en la pantalla… pero la RESTRICCIÓN DE LA BASE se quedó como estaba,
-- admitiendo solo 'SINPE' y 'Tarjeta'.
--
-- El resultado era el peor posible: el cobro se procesaba, el inventario se
-- descontaba, y al ir a guardar el pedido la base lo rechazaba con
--
--     new row for relation "orders" violates check constraint
--     "orders_payment_method_check"
--
-- Es decir, la venta ocurría y no quedaba registrada. Exactamente el mismo
-- síntoma que ya se había corregido en el código —el pedido que no llegaba a
-- los informes— pero por una causa distinta y una capa más abajo.
--
-- La lección, anotada para la próxima: ampliar un tipo en el frontend NO
-- amplía la restricción equivalente en la base. Si un valor nuevo va a
-- viajar a una columna con CHECK, hay que tocar los dos lados.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ SE CONSERVA "Tarjeta"
-- ---------------------------------------------------------------------------
-- La interfaz ya no la ofrece —no hay procesador de pagos contratado— pero
-- hay pedidos históricos registrados con ese medio. Quitarla de la
-- restricción rompería cualquier actualización futura sobre esas filas.
-- ===========================================================================

begin;

alter table public.orders drop constraint if exists orders_payment_method_check;

alter table public.orders
  add constraint orders_payment_method_check
  check (payment_method = any (array['SINPE'::text, 'Tarjeta'::text, 'Efectivo'::text]));

comment on constraint orders_payment_method_check on public.orders is
  'Medios de pago admitidos. Se añadió Efectivo para los cobros de mostrador del módulo de facturación. Tarjeta se conserva por los pedidos ya registrados con ese medio, aunque la interfaz ya no la ofrezca.';

commit;

-- ===========================================================================
-- VERIFICACIÓN — debe listar los tres valores
-- ===========================================================================
select pg_get_constraintdef(oid) as definicion
  from pg_constraint
 where conname = 'orders_payment_method_check';
