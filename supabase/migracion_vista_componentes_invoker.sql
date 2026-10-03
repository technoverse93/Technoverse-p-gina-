-- ===========================================================================
-- v_product_components — deja de ser SECURITY DEFINER (oct 2026)
-- ===========================================================================
-- YA EJECUTADO en la base.
--
-- El revisor de Supabase la marcaba como CRÍTICA: una vista sin
-- `security_invoker` se ejecuta con los permisos de su dueño y se salta las
-- reglas RLS de `products` y `product_components`. Como además `anon` tenía
-- SELECT, cualquier visitante sin sesión podía leer por aquí el costo de cada
-- repuesto e insumo vinculado.
--
-- Ahora la vista respeta las reglas de quien consulta. Solo la usan
-- pantallas del personal (Inventario, Vinculación y el cálculo de margen en
-- Cobros), y el personal sigue viendo exactamente lo mismo: se comprobó con
-- una fila de prueba dentro de una transacción deshecha.
-- ===========================================================================

alter view public.v_product_components set (security_invoker = true);
revoke all on public.v_product_components from anon;
revoke insert, update, delete, truncate, references, trigger on public.v_product_components from authenticated;
