-- =====================================================================
-- CRM · CANAL «WHATSAPP» · 2026-10-28
-- =====================================================================
-- QUÉ AGREGA: las ventas y consultas que llegan por WhatsApp (botón «Consultar por WhatsApp» del producto, el
-- carrito y los banners) se registran en el CRM con su propio canal, igual que el chat de la página o el taller.
--   · crm_leads.canal acepta 'whatsapp' (además de los 6 de siempre).
-- Lo que se le escribe por WhatsApp se anota en la línea de tiempo como «contacto» («WhatsApp: …»), que el personal
-- ya puede crear: no hace falta otro tipo de evento ni tocar su política.
--
-- QUÉ NO CAMBIA: los permisos (solo el personal crea y edita contactos; un visitante no), los demás canales y
-- tipos, y los datos existentes. No abre nada al público.
--
-- Idempotente: se puede correr dos veces.
-- =====================================================================

alter table public.crm_leads drop constraint if exists crm_leads_canal_check;
alter table public.crm_leads add constraint crm_leads_canal_check
  check (canal = any (array['chat_web', 'tienda_form', 'registro', 'pedido', 'taller', 'manual', 'whatsapp']));

-- =====================================================================
-- REVERTIR (solo si no quedó ningún contacto o evento 'whatsapp'):
--   alter table public.crm_leads drop constraint crm_leads_canal_check;
--   alter table public.crm_leads add constraint crm_leads_canal_check
--     check (canal = any (array['chat_web','tienda_form','registro','pedido','taller','manual']));
-- =====================================================================
