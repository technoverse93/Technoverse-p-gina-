-- =====================================================================
-- COMPROBANTES INMUTABLES DESDE LA API · 2026-10-27
-- =====================================================================
-- QUÉ CIERRA. `invoices` tenía `invoices_staff_delete` e `invoices_staff_update` (para CUALQUIER
-- miembro del personal, también un empleado): desde el navegador se podía BORRAR un comprobante fiscal o
-- cambiarle montos, clave, consecutivo o cliente. Así desaparecieron los comprobantes 1 a 5 de la serie
-- 01 (los contadores marcan 7 y solo existen el 6 y el 7): un hueco en el consecutivo fiscal.
-- Un comprobante no se borra ni se edita: se anula con una nota de crédito.
--
-- La app NO escribe en `invoices` directamente: emite con `issue_invoice()`, adjunta el PDF con
-- `set_invoice_pdf()` (ambas SECURITY DEFINER) y el estado del correo lo anota la función
-- `send-invoice-email` con service_role. Ninguno de esos caminos usa estas políticas, así que nada cambia
-- para la app. Leer sigue igual (el cliente sus comprobantes, el personal todos).
--
-- Idempotente. Probada con supabase/pruebas/facturas_inmutables.sql.
-- =====================================================================

drop policy if exists invoices_staff_delete on public.invoices;
drop policy if exists invoices_staff_update on public.invoices;
revoke insert, update, delete on public.invoices from anon, authenticated;

-- =====================================================================
-- REVERTIR:
--   grant update, delete on public.invoices to authenticated;
--   create policy invoices_staff_delete on public.invoices for delete using (public.is_staff());
--   create policy invoices_staff_update on public.invoices for update using (public.is_staff());
-- =====================================================================
