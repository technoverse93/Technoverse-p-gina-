# Seguridad de Technoverse — cómo está blindado y qué falta

Última revisión: 2026-10-15. Lo que sigue es lo que **se verificó contra la base real** (funciones, políticas y buckets),
no una lista de buenas intenciones. «100 %» no existe: lo que se garantiza es que no hay secretos en el navegador, que el
privilegio mínimo se comprueba con pruebas automáticas y que salta una alerta (CI semanal) si algo se vuelve a abrir.

## Modelo

| Quién | Cómo entra | Qué puede |
|---|---|---|
| **Visitante** (sin sesión) y **cliente** (cuenta `Cliente`) | API pública de Supabase con la llave *publicable* (la del navegador, pública por diseño) | Solo lo que dejan las políticas RLS: leer el catálogo, **su** chat (por token), **sus** pedidos/facturas, y escribir pedidos, mensajes y telemetría **con tope y validación** |
| **Personal** (`empleado`, `admin`, `superadmin`) | Sesión + `is_staff()` / `is_owner()` / `is_superadmin()` | El panel. Ningún límite de visitante |
| **Servidor** (Edge Functions, cron, Worker) | `service_role` / secretos de entorno | Todo lo privilegiado. Las llaves viven **solo** en `Deno.env` / secretos de GitHub y Cloudflare |

`es_visitante()` (migración de blindaje) es la regla única: verdadero para quien llega por la API pública sin ser del
personal; falso para el servidor. Todo límite y toda validación de escrituras anónimas cuelga de ahí y de `limitar_uso()`.

## Reglas para código nuevo

1. **Ninguna llave secreta en el navegador ni en el repo.** `npm run secretos` lo comprueba (y el CI). Lo público por
   diseño: la llave `sb_publishable_…` y el JWT con `role: anon`. Llaves de IA, WhatsApp/Meta, Zapier, etc.: secretos de
   Supabase/Edge, nunca `VITE_…`. La dirección del webhook de Instagram vive en `app_settings_privado`.
2. **Toda función `SECURITY DEFINER`** lleva `set search_path = public` y se escribe a propósito para quién es: si es solo
   del personal, valida adentro **y** se le hace `revoke execute … from public, anon`; si es de mantenimiento, solo
   `service_role`. Las funciones de disparador (`returns trigger`) no se exponen a nadie.
3. **Nada de `with check (true)` en un `insert` público sin un disparador que valide** (largos, tipos, valores permitidos) y
   limite (`limitar_uso`). Ver `chat_messages_validar`, `orders_validar`, `client_profiles_validar`.
4. **Buckets**: tamaño máximo y tipos permitidos en el bucket, y la política de subida con una expresión regular del
   nombre. Los públicos no deben tener nombres adivinables (los PDF de comprobantes llevan sufijo aleatorio).
5. **Migraciones**: se escriben en `supabase/*.sql` (idempotentes, con bloque «REVERTIR»), con su prueba en
   `supabase/pruebas/`. **No se aplican a producción sin la confirmación expresa del dueño** (regla de CLAUDE.md).

## Cómo se prueba

```bash
npm run secretos       # sin secretos en el repo
npm run paletas        # contraste AA de las paletas
npm run probar-api     # con la llave pública: un anónimo no ve nada privado (solo lecturas; las funciones expuestas
                       # NO se pueden listar con esa llave: se revisan con el asesor de seguridad de Supabase)
# Migraciones de seguridad sobre un Postgres local (réplica mínima de la base):
createdb prueba
psql prueba -v ON_ERROR_STOP=1 -q -f supabase/pruebas/replica_minima.sql
psql prueba -v ON_ERROR_STOP=1 -q -f supabase/pruebas/blindaje_seguridad.sql
psql prueba -v ON_ERROR_STOP=1 -q -f supabase/pruebas/ajustes_privados.sql
psql prueba -v ON_ERROR_STOP=1 -q -f supabase/pruebas/banners_motor.sql
psql prueba -v ON_ERROR_STOP=1 -q -f supabase/pruebas/crm.sql
psql prueba -v ON_ERROR_STOP=1 -q -f supabase/pruebas/avisos.sql
```

El flujo `.github/workflows/seguridad.yml` corre todo eso en cada PR, en cada push a `main` y cada lunes.

## Lo que cerraron las migraciones (ver su encabezado)

`migracion_blindaje_seguridad.sql`: borrados de mantenimiento por anónimos, fabricación/alteración de comprobantes y su
bucket, vaciado del catálogo con `adjust_stock`, quema de cupones, escribir como «soporte» en el chat, escritura de
cualquier cliente en el bucket de marketing, saldo/reactivación en la ficha propia, escrituras anónimas sin tope,
funciones «solo personal» abiertas, funciones de disparador expuestas, `search_path`, políticas «nadie» y el error de
`admin_reset_security_pin`. `migracion_ajustes_privados.sql`: el webhook de Instagram ya no es legible por cualquiera.
`migracion_banners_motor.sql` (no es un agujero, es defensa en profundidad del motor de banners): un banner no puede
llevar un enlace `javascript:`/`data:`/`vbscript:`/`file:`/`blob:` ni textos gigantes (se aplica a lo que se guarde de ahora
en adelante), y las métricas de vistas/clics solo se suman por `banner_evento()` (SECURITY DEFINER, con tope por
persona/IP vía `limitar_uso` si el blindaje ya está aplicado); la tabla `banner_metricas` no admite escrituras desde la
API ni siquiera del personal, y solo el personal la lee. No guarda nada de la persona. Las cifras son orientativas.
`migracion_crm.sql` (CRM interno, también defensa por diseño): los datos de contacto (nombre, correo, teléfono, provincia)
quedan en tablas `crm_*` que SOLO lee y escribe el personal (borrar contactos: solo el dueño); un visitante únicamente
puede llamar a `crm_registrar_contacto()`, que no devuelve nada (no revela si un correo ya existe), solo admite 3 canales,
filtra las llaves del origen, tiene tope por persona/IP y nunca adelanta una etapa. La captación del chat, los pedidos, el
registro y el taller la hacen disparadores del servidor que atrapan sus errores (un fallo del CRM no frena la venta) e
ignoran al personal y a las cuentas anonimizadas; anonimizar una ficha (Ley 8968) borra su contacto del CRM. La firma de
notas y recordatorios la pone la base, no el navegador.
`migracion_chat_push.sql` y `migracion_avisos_web.sql` (avisos de chat con la app o el navegador cerrados): los teléfonos
(`dispositivos_push`) y navegadores (`avisos_web`) suscritos solo los anota el personal para su propia sesión y nadie los
lee desde la API (solo la función, con `service_role`). Un navegador solo puede anotar una dirección de los servicios de
avisos conocidos (Google, Mozilla, Microsoft, Apple), así la función nunca le manda pedidos a otro sitio; hasta 10 por
persona. El gatillo del chat solo pasa el id del mensaje (no el texto) por `jarvis_llamar`, que no se puede llamar desde la
API, y si avisar falla el mensaje del cliente se guarda igual. Los avisos web viajan cifrados para cada navegador
(RFC 8291): el servicio de avisos no puede leerlos. La llave privada VAPID es el secreto `VAPID_PRIVADA` de la función.

## Lo que queda (decisiones y trabajo pendiente)

- **Pedido servidor-autoritativo** (recomendado, aún no hecho): hoy el navegador calcula precios, IVA, cupón y stock y los
  manda; la base solo valida cordura (topes, correo, totales que cuadran). Lo robusto es una función `crear_pedido()` que
  recalcula todo desde `products` y descuenta stock, canjea el cupón y emite el comprobante en **una** transacción. Con
  eso desaparecen el vaciado de catálogo, la quema de cupones y los pedidos falsos. Es un cambio del flujo de compra:
  se hace aparte, con pruebas de compra completas.
- **Facturas ya emitidas** (13 al 2026-10-15): sus PDF están en un bucket público con nombre `FE-<consecutivo>.pdf`
  (adivinable). Los nuevos ya llevan sufijo aleatorio. Para los viejos: `scripts/renombrar-facturas-publicas.mjs`
  (necesita la llave de servicio, la corre el dueño) o pasar el bucket a privado con enlaces firmados.
- **Panel de Supabase (no se puede por SQL):** activar *Leaked password protection* (Auth → Providers → Email → «Prevent
  use of leaked passwords») y revisar los avisos del asesor de seguridad después de aplicar las migraciones.
- **Llave web de Firebase** (`AIza…`, si la APK la usa): pública por diseño, pero debe estar restringida por app/dominio y
  por API en la consola de Google Cloud.
- **Webhook de Zapier**: si alguna vez se configuró antes de `migracion_ajustes_privados.sql`, estuvo legible: rotarlo.
