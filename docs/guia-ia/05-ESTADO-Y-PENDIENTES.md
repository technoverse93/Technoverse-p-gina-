# ESTADO ACTUAL Y PENDIENTES (foto del presente — se REESCRIBE cuando cambia)

> Última actualización: 2026-10-29, Claude Code (Claude Opus 5.5).
> Este archivo dice **dónde estamos parados hoy**. La historia está en `BITACORA.md` y `03-HISTORIAL-DE-CAMBIOS.md`.

## 1. Qué funciona hoy (verificado en la tablet real)

| Área | Estado |
|---|---|
| Tienda web | Publicada en https://technoverse-cr.technoversecr.workers.dev, 8 productos visibles (Audio 7, Accesorios 1). |
| Entrada | Web: correo + contraseña; cierre a los 5 min sin actividad. APK: huella/cara. |
| Banners | 2 activos: hero «Llegó el nuevo iPhone 17 Lavanda» (enlace a WhatsApp con mensaje) y tarjeta del iPhone en la cuadrícula (sin enlace). Ambos creados en pruebas: el dueño decide si quedan. |
| WhatsApp | Banner, detalle del producto, carrito y CRM abren WhatsApp en Chrome Android (~1 s) y en la APK (complemento nativo). |
| CRM | Canal WhatsApp activo; alta rápida con Ref.; «WhatsApp» y «Armar venta» en la ficha; seguimiento 48 h; métricas por canal. |
| Fotos | Toda foto de producto se limpia sola al subirla (quitar fondo + márgenes + compresión). |
| APK | 1.578 instalada en la tablet, con OTA `53ee732` (WhatsApp nativo). |
| Widget de Termux | Arreglado (no mata un escritorio abierto; avisa en pantalla). |
| Ventanas de Termux:X11 | Arreglado 29-oct: IZQ/DER ya no las meten bajo la barra; el vigía encaja ventanas nuevas, baja la capa azul y revive xfwm4. Redimensionar: tocar la esquina ◢ y arrastrar. |
| OpenCode | `opencode.json` con la guía, `/inicio` `/cierre` `/estado`; probado en la ventana real (icono OpenCode). |

## 2. Pendientes, ordenados por riesgo (las decisiones marcadas ⚑ son del dueño)

1. **6 funciones del servidor sin código en el repo** (`admin-login`, `admin-clientes`, `admin-force-password-reset`,
   `create-admin-user`, `webauthn`, `jarvis-widget`). Si se pierden, no hay cómo reconstruirlas. Cómo traerlas: ver
   `04-MAPA-DEL-SISTEMA.md` §7. No requiere permiso (es solo leer y guardar), pero revisar secretos antes de subir.
2. ⚑ **Respaldo automático de la base**: el plan gratis de Supabase no guarda copias (ya se perdieron las facturas
   1-5). Propuesta: GitHub Actions nocturno con `pg_dump` cifrado a Cloudflare R2 (10 GB gratis), prueba de
   restauración mensual en el CI. Necesita la cadena de conexión como secreto de GitHub.
3. ⚑ **La tienda emite la factura antes de que alguien vea el SINPE**: al tocar «Confirmar Pago y Generar
   Comprobante» se descuenta stock y se factura sin verificar. Propuesta: pedido «por verificar» y factura cuando
   el personal confirme (como ya hace «Armar venta» del CRM). Requiere migración (estados de `orders`).
4. ⚑ **Facturación electrónica real ante Hacienda** (formato vigente 4.4; hoy es registro interno v4.3). Necesita
   usuario del ATV y la llave criptográfica `.p12`.
5. ⚑ **Notas de crédito fiscales**: hoy existe «Nota de crédito» en Contabilidad (`handleIssueCreditNote` en `AdminPanel.tsx`): marca la venta como `Devuelto`, reintegra el stock y crea un pedido `NC-…` en `orders`, pero **no** emite un comprobante fiscal (no pasa por `issue_invoice` ni crea fila en `invoices` ni PDF). Falta la nota de crédito fiscal con consecutivo propio para anular una factura.
6. ⚑ **Datos de los audífonos**: stock 1 y costo = 75 % del precio son estimados. Teclado Marvo y audífonos RM-560
   tienen costo = precio. iPhone 17 está en «Accesorios» y el teclado en «Audio» (categorías mal puestas).
7. ~~Termux:X11~~: resuelto el 29-oct (ver `BITACORA.md`). Si el dueño vuelve a reportarlo, preguntale qué ventana y en qué momento (al abrirla, al girar la tablet, después del teclado).
8. ⚑ Dominio propio (correo de facturas que no cae en spam, acceso remoto a la tablet por Cloudflare Access).
9. ⚑ Doble factor (TOTP) para el personal; 2FA en la cuenta de Cloudflare.
10. ⚑ Cédula automática (Hacienda) también en la compra de la tienda, con `limitar_uso()`.
11. ⚑ El dueño compartió su contraseña del panel en un chat: recomendar cambiarla.
12. Acceso remoto a la tablet por internet (`~/vista-remota/`): no quedó funcionando. Recomendado RustDesk.

## 3. Recomendaciones dadas al dueño (para no repetirlas ni contradecirlas)

- Banners: máximo 5 en rotación; texto real (no horneado en la imagen) salvo piezas de pauta; medidas 1920×600 (PC)
  y 1080×810 (teléfono); WhatsApp discreto (no en cada tarjeta).
- Vender por chat con el CRM (documento «CRM Ventas por Chat»): el dueño aprobó las 5 opciones, con WhatsApp solo en
  el detalle del producto y el carrito. Todo implementado.
- Seguridad: no guardar secretos en el navegador; migraciones con prueba; nada de SQL en producción sin permiso.

## 4. Si el dueño pide algo nuevo

1. Leé `BITACORA.md` (última entrada) y este archivo.
2. Buscá en `04-MAPA-DEL-SISTEMA.md` §9 dónde se cambia lo que pide.
3. Hacé el cambio en una rama, `tsc` + `build`, PR, fusión, esperá Cloudflare, **probá en la tablet**.
4. Anotá en `BITACORA.md` y actualizá este archivo si cambió el estado.
