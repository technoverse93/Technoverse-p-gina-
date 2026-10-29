# BITÁCORA COMPARTIDA (Claude Code ⇄ OpenCode ⇄ cualquier IA)

> **Para qué**: que ninguna IA quede varada. Quien trabaje en este proyecto (Claude, OpenCode con cualquier
> modelo, u otra IA) **lee esta bitácora al empezar** y **anota una entrada al terminar**. Si Claude vuelve después
> de que OpenCode trabajó (o al revés), lee las entradas nuevas y sigue exactamente donde quedó el otro.
>
> **Reglas de la bitácora**
> 1. Las entradas van **al final**, en orden de fecha. **Nunca** borres ni reescribas entradas viejas: si algo
>    resultó mal, agregá una entrada nueva que lo corrija.
> 2. Escribí solo hechos comprobados: qué se pidió, qué se cambió (archivos y PR), qué se probó y cómo, qué falló,
>    qué quedó pendiente. Nada inventado. Si no lo probaste, decí «sin probar».
> 3. Nunca escribas contraseñas, llaves ni tokens.
> 4. La bitácora se sube al repo en el MISMO PR del trabajo (o en uno propio si no hubo código).
> 5. Si además cambió el estado general, actualizá `05-ESTADO-Y-PENDIENTES.md` (ese sí se reescribe: es la foto
>    del presente) y sumá los PR a `03-HISTORIAL-DE-CAMBIOS.md`.
>
> **Plantilla** (copiala tal cual):
>
> ```
> ## AAAA-MM-DD HH:MM — <agente> (<modelo>)
> - Pedido del dueño: «…» (cita textual corta)
> - Hecho: … (archivos, PR #…, migraciones)
> - Probado: … (cómo: tablet real / tsc+build / CI) — o «sin probar» y por qué
> - Quedó pendiente / a medias: …
> - Para quien siga: … (el siguiente paso concreto)
> ```

---

## 2026-10-27 → 2026-10-29 — Claude Code (Claude Opus 5.5) — sesión larga inicial

Resumen de lo hecho (el detalle de cada PR está en `03-HISTORIAL-DE-CAMBIOS.md`):

- **Auditoría de seguridad y migraciones en producción** (con permiso del dueño): blindaje de 57 funciones
  anónimas, ajustes privados, motor de banners, pautas y CRM, contenido solo para la gestión, ubicaciones sin rol
  falso, facturas inmutables. PR #279, #281, #282.
- **Facturas y correo**: cupón restado en el comprobante; la función `send-invoice-email` ya no sirve de relé de
  spam; está en el repo. PR #282.
- **Tienda**: precios con formato único, paneles flotantes que no se tapan, cookies discretas, búsqueda sin banners,
  vitrina de foto con color del tema, quitar fondo preciso y automático al subir fotos. PR #280, #285–#292.
- **Entrada**: navegador = correo y contraseña siempre; APK con huella o cara. PR #284.
- **Banners**: «Usar de banner» sube bien; las piezas de pauta salen enteras y sin velo; el gestor valida enlaces.
- **WhatsApp**: banner con mensaje listo, botón «Consultar por WhatsApp» en el detalle del producto, línea en el
  carrito, apertura nativa en Android (`intent://`) y en la APK (complemento `TelefonoNativo`). PR #293–#296, #299.
- **CRM**: canal WhatsApp (migración `crm_whatsapp` aplicada con permiso), alta rápida con «Ref.», ficha con
  «WhatsApp» y «Armar venta» → Cobros precargado, seguimiento a 48 h, errores traducidos. PR #297, #298.
- **Ciberseguridad**: bitácora con lo más nuevo arriba, visitantes alineados. PR #283.
- **Audífonos**: 5 productos cargados desde el panel con foto, descripción y precio competitivo frente a Intelec y
  Extreme Tech (stock y costo ESTIMADOS: el dueño debe corregirlos).
- **Tablet**: widget de Termux arreglado (`escritorio` con cerrojo por PID y avisos); APK 1.578 instalada y probada.
- **Guía para IA y OpenCode**: `docs/guia-ia/` + `opencode.json` (PR #300); guías completas para IA y para el dueño,
  esta bitácora y comandos `/inicio`, `/cierre` y `/estado` de OpenCode (PR #301). Copia en el escritorio:
  `/root/Desktop/Guia-para-IA/` (`para-la-IA/` y `para-el-dueno/`).

Probado: todo lo de tienda, banners, WhatsApp y CRM se probó con **toques reales en la tablet** (Chrome y APK),
sin enviar mensajes, sin cobrar y sin emitir facturas; borradores y datos de prueba eliminados.

Quedó pendiente: ver `05-ESTADO-Y-PENDIENTES.md` (lista completa). Lo más urgente:
1. Traer al repo el código de las 6 funciones del servidor que solo están en Supabase.
2. Respaldo automático de la base.
3. Que la tienda no emita factura antes de verificar el SINPE.
4. El dueño reportó (29-oct) que en **Termux:X11 las ventanas no se pueden redimensionar y a veces no se ven bien**:
   todavía sin revisar.

Para quien siga: empezá por `/inicio` en OpenCode (o leé `00-LEEME-PRIMERO.md`), después atendé lo que pida el
dueño; si no pide nada, el siguiente paso recomendado es el punto 1 de arriba.

## 2026-10-29 02:25 — Claude Code (Claude Opus 5.5)
- Pedido del dueño: «en la app de termux x11 no se ve bien las ventanas de cualquier cosa, no les puedo modificar el
  tamaño de la ventana».
- Causa encontrada: los botones IZQ/DER (`/usr/local/bin/ventana`) usaban `_NET_WORKAREA`, que xfwm4 tenía viejo
  (0,40,1536,867: sin descontar la barra de tareas de 45 px). Las ventanas quedaban 45 px debajo de la barra: el
  borde inferior (el que se agarra) y las últimas líneas tapados. Además, en Termux:X11 el primer toque sobre un borde
  solo mueve el puntero: hay que tocar y después arrastrar.
- Hecho (fuera del repo, con respaldo `*.respaldo-20261029` al lado): nuevo `/usr/local/bin/area-util`; `ventana`
  usa `area-util` y acepta un id; `ajuste-teclado` con `vigia()` (capa azul al fondo, revive xfwm4, encaja ventanas
  nuevas) y `Reacomodo` (tras girar o cerrar el teclado, fuerza a xfwm4 a recalcular el área y encaja todas).
  Guías: §3.3 de la guía del dueño, §7 de `00-LEEME-PRIMERO.md`, estado en `05`.
- Probado con toques reales (`adb shell input`): esquina ◢ 745×758 → 637×650; borde derecho e inferior tocando y
  arrastrando → 709×704; ventana pedida de 220×70 caracteres nace dentro del área (0..1536 × 40..862); ventana
  corrida fuera + abrir/cerrar teclado → vuelve adentro; capa azul subida a mano → al fondo en < 2,5 s; `pkill
  xfwm4` → revivido en ~2 s con los marcos intactos.
- Incidente: una prueba con `xdotool mousedown` congeló el servidor X (xfwm4 toma el servidor en `box_resize`). Se
  resolvió matando xfwm4 y bajando la capa azul; ahora el vigía lo hace solo. Anotado en `00` §7 y §8.
- Quedó pendiente: nada de esto. Lo de la bitácora anterior sigue igual (6 funciones del servidor, respaldo, SINPE…).
- Para quien siga: si el dueño reporta otra ventana rara, pedile cuál y cuándo; medí con `xwininfo`, `area-util`
  y una captura (`adb exec-out screencap -p`).
