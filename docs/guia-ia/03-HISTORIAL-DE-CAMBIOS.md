# HISTORIAL DE CAMBIOS Y PENDIENTES (octubre 2026)

Cada línea es un Pull Request ya fusionado a `main` del repo `technoverse93/Technoverse-p-gina-`.
Para ver el detalle: `gh pr view <número>` o `git log --oneline` en `/root/proyectos/Technoverse-p-gina-`.

## Seguridad y datos

| PR | Qué | Por qué |
|---|---|---|
| #279 | Dependencias: Capacitor 8.5.3, DOMPurify 3.4.17, Vite 6.4.5 | Fallas de seguridad críticas en `npm audit`. |
| #281 | Solo la gestión edita los textos de la tienda; ubicaciones sin rol falso | Cualquier cuenta nueva podía reescribir la tienda; un visitante se anotaba como «administrador». |
| #282 | Cupón restado en el comprobante; facturas inmutables; función de correo blindada | La factura salía por más de lo cobrado; el correo del negocio se podía usar para mandar spam. |
| (migraciones) | `blindaje_seguridad`, `ajustes_privados`, `banners_motor`, `pautas_y_crm`, `contenido_y_ubicaciones`, `facturas_inmutables`, `crm_whatsapp` | Aplicadas en producción con permiso del dueño y con prueba en `supabase/pruebas/`. |

## Tienda

| PR | Qué |
|---|---|
| #280 | Precios con formato único (₡520.000), un panel flotante a la vez, cookies que no tapan el chat. |
| #284 | **Navegador: siempre correo y contraseña** (sin huella/patrón); la APK sigue con huella o cara. |
| #285 | «Usar de banner» ya sube la pieza (error de permisos del bucket `marketing`); tarjeta de banner sin recorte ni velo; mapas que no se alejan con la rueda; sin repuestos a ₡0 en los selectores. |
| #286 | Piezas de pauta como banner: sin velo ni texto encimado, enteras en el teléfono; cookies por encima del lápiz de edición; el gestor rechaza enlaces a la misma portada. |
| #287 | Inventario con punto de miles; costo marcado obligatorio; banners fuera de la búsqueda; cookies detrás del carrito. |
| #288, #292 | Vitrina de la foto de producto con el color del tema y sombra suave (el dueño NO quiere fondo blanco). |
| #289 | (cerrado sin fusionar: vitrina siempre blanca — rechazada por el dueño). |
| #290 | **«Quitar fondo» preciso** (`src/utils/quitarFondo.ts`): huecos encerrados, colores claros con tinte, contorno sin halo. |
| #291 | **Toda foto de producto** pasa sola por quitar fondo + recorte de márgenes + compresión (`prepararFotoProducto`). |
| #293 | Banner de pauta: WhatsApp con el mensaje del producto y su precio. |
| #294, #295 | WhatsApp al instante (`src/utils/whatsapp.ts`): `intent://` nativo en Android; «Consultar por WhatsApp» en el detalle del producto. |
| #296 | «¿Preferís comprar por WhatsApp?» en el carrito desplegable. |
| #299 | **APK**: WhatsApp con el complemento nativo `TelefonoNativo` (el WebView no seguía `intent://`). Publicado por OTA. |

## Panel

| PR | Qué |
|---|---|
| #283 | Ciberseguridad: Bitácora con lo más nuevo primero; Visitantes con conteo de aparatos y columnas alineadas. |
| #297 | **CRM · vender por WhatsApp**: canal propio, alta rápida con la «Ref.», respuestas rápidas por WhatsApp, «Armar venta» (resumen + SINPE recibido → Cobros precargado), seguimiento a 48 h. |
| #298 | CRM: errores traducidos al español (antes salía el texto crudo de la base en inglés). |

## Fuera del repositorio (en la tablet)

- `~/.bashrc`: alias `tv`, arranque más rápido (respaldo `~/.bashrc.respaldo-antes-de-rendimiento`).
- `/data/data/com.termux/files/usr/bin/escritorio`: arreglo del widget (cerrojo con PID, avisos, no mata un
  escritorio abierto). Respaldo: `escritorio.respaldo-20261028-2050`.
- `~/vista-remota/`: intento de ver la tablet por internet (x11vnc + noVNC + túnel de Cloudflare + Worker `tablet`
  protegido con Cloudflare Access). **No quedó funcionando** (noVNC no conecta por el túnel). Recomendado: RustDesk
  o comprar un dominio propio.
- Instalada la APK `com.technoverse.admin` 1.578 y habilitado «instalar apps desconocidas» para la app Archivos.

## PENDIENTES / DECISIONES DEL DUEÑO

1. **Factura antes del SINPE en la tienda**: al tocar «Confirmar Pago y Generar Comprobante» se descuenta stock y se
   emite la factura sin verificar el pago. Propuesto: pedido «por verificar» y factura al confirmar el personal.
2. **Audífonos nuevos** (JBL Tune 310C, Sony WH-CH520, Galaxy Buds Core, Sony WH-CH720N, Sony WH-1000XM5): stock 1 y
   costo = 75 % del precio son **estimados**. Corregir en Inventario.
3. El teclado Marvo y los audífonos RM-560 tienen costo = precio (margen ₡0).
4. Categorías mal puestas: el iPhone 17 está en «Accesorios»; el teclado en «Audio».
5. Banners del iPhone creados en pruebas (hero «Llegó el nuevo iPhone 17» y tarjeta de cuadrícula): ¿se quedan?
6. **Respaldo automático de la base** (plan gratis sin copias; se perdieron las facturas 1-5): propuesto con GitHub
   Actions + `pg_dump` + Cloudflare R2.
7. **Facturación electrónica real ante Hacienda** (v4.4): necesita usuario del ATV y la llave `.p12`.
8. **Nota de crédito fiscal**: la «Nota de crédito» de Contabilidad devuelve stock y marca la venta como Devuelto, pero no emite comprobante fiscal (ver `05-ESTADO-Y-PENDIENTES.md`).
9. Dominio propio (correo que no cae en spam y acceso remoto a la tablet).
10. Doble factor (TOTP) para el personal y 2FA en Cloudflare.
11. Cédula automática (consulta a Hacienda) también en la compra de la tienda, con límite de uso.
12. El dueño compartió su contraseña del panel en el chat: **recomendar cambiarla**.

## Documentos publicados para el dueño (claude.ai, privados)

- «Propuestas Technoverse Octubre» (banners comparados con Extreme Tech e Intelec + mejores sistemas).
- «CRM Ventas por Chat» (5 opciones; el dueño aprobó todas con el cambio de que WhatsApp no vaya en cada tarjeta).
