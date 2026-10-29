# GUÍA MAESTRA PARA CUALQUIER IA — Proyecto Technoverse Costa Rica

> Escrita el 29 de octubre de 2026 por Claude (Claude Code, modelo Opus) al final de una larga sesión de trabajo
> con el dueño. Está pensada para que **cualquier IA** (Claude, OpenCode, GPT, Gemini, un modelo local gratis, o
> la que venga en el futuro) pueda **seguir trabajando exactamente igual, sin romper nada**, aunque vaya más lento.
>
> Está en texto plano Markdown a propósito: es el formato que cualquier modelo entiende sin herramientas.
> **Leela completa antes de tocar nada.** Si algo de aquí choca con lo que diga el archivo `CLAUDE.md` del
> repositorio, **manda `CLAUDE.md`** (es la fuente de verdad viva; esta guía es una foto de un momento).

Archivos de esta carpeta:

| Archivo | Para qué |
|---|---|
| `00-LEEME-PRIMERO.md` | Esta guía (todo el contexto). |
| `01-REGLAS-QUE-NO-SE-ROMPEN.md` | Lo que nunca se hace sin permiso y las reglas de producto del dueño. |
| `02-COMO-PROBAR-EN-LA-TABLET.md` | Paso a paso para probar «como un humano» en el Chrome real y en la APK. |
| `03-HISTORIAL-DE-CAMBIOS.md` | Qué se hizo, por qué, y qué quedó pendiente. |
| `herramientas/` | Los guiones (Node.js) para manejar Chrome y la APK desde el Linux. |

---

## 1. Quién es el dueño y cómo quiere trabajar

- Escribe en **español de Costa Rica** (usa «vos»: «tocá», «probá»). **Respondele siempre en español**, sin
  inglés, ni siquiera en avisos cortos ni en leyendas de archivos (se queja si aparece inglés).
- Quiere que **hagas las cosas vos directamente**, sin pedir permiso para cada paso de código. Tiene autorización
  permanente escrita en `CLAUDE.md` para: `git commit`, `git push`, abrir Pull Requests y **fusionarlos a `main`**
  cuando compila (`npx tsc --noEmit` y `npm run build`).
- **Odia** que le pidan el mismo permiso muchas veces. Agrupá lo que necesite su aprobación en un solo pedido.
- Quiere que **pruebes como un cliente o empleado real**: en la tablet física, en Chrome de verdad, con toques en
  la pantalla, y en la APK instalada. **No en un navegador simulado ni «solo por código».** Así lo pidió: «ingresa
  en tiempo real desde la tablet, con Chrome… una prueba como si fueses un cliente humano normal».
- Cuando muestres propuestas, hacelo **de a un tema por documento**. Dijo: «no me metas 7 cosas en un mismo
  artifact… se vuelve obstructivo». Numerá las opciones para que responda «1 y 3».
- No le gusta que la tablet se llene de pestañas de Chrome: **reutilizá la misma pestaña**.
- Explicale qué encontraste y qué arreglaste, en lenguaje claro, sin jerga.

## 2. El negocio

**Technoverse Costa Rica**: tienda de tecnología (celulares, audífonos, accesorios) y taller de reparación de
celulares, en San José. WhatsApp y teléfono del negocio: **+506 6421 4795**. Horario L-V 1pm-6pm.

La plataforma tiene dos caras:

1. **La tienda** (clientes): catálogo, carrito, pago por **SINPE Móvil**, comprobante en PDF por correo, chat en vivo,
   banners de promoción, botones a WhatsApp.
2. **El panel** (personal): Inventario, Cobros (facturación), Taller, Chat, CRM, Clientes, Contabilidad, Marketing
   (banners + «Estudio de pauta con Javier» con IA), Ciberseguridad, Configuración, Supervisión, Ubicaciones,
   Ingresos, Bloqueos, Gestión de usuarios. Hay un asistente de IA interno que se llama **Javier** (también «Phill»
   en la ventanita del teléfono).

## 3. Dónde vive todo (infraestructura)

| Pieza | Dónde | Notas |
|---|---|---|
| Código | GitHub `technoverse93/Technoverse-p-gina-` | Rama principal `main`. |
| Copia local | `/root/proyectos/Technoverse-p-gina-` (en el Linux de la tablet) | Ver `git status` antes de empezar. |
| Tienda web | Cloudflare Worker `technoverse-cr` → **https://technoverse-cr.technoversecr.workers.dev** | Se despliega SOLO al fusionar a `main` (Cloudflare Workers Builds). |
| Base de datos | Supabase, proyecto `hzatdfrjcqiimgqxcwwh` | Postgres + Auth + Storage + Edge Functions + Realtime. |
| Funciones del servidor | `supabase/functions/` | `asistente-ia`, `autocompletar-producto`, `consultar-cedula` (Hacienda), `send-invoice-email` (Gmail SMTP). |
| App Android (APK) | `com.technoverse.admin`, «Technoverse Admin» | Capacitor 8. Se compila en GitHub Actions (`build-android.yml`); el `.apk` queda como **artefacto** del build, no en una tienda. |
| Actualización de la APK sin reinstalar | OTA (`ota-publish.yml`, plugin CapacitorUpdater) | Se publica sola al fusionar cambios de `src/` a `main`. **Se aplica cuando la app pasa a segundo plano y vuelve.** |
| Cuenta Cloudflare correcta | `technoverse.admin@gmail.com` (cuenta `aa9d204f79ca460beecd48b6cbf3a2b8`) | Ojo: hay una cuenta vieja vacía ligada a GitHub (Genarolopez). No usarla. |

**Secretos:** ninguna llave secreta va en el navegador ni en el repo (lo revisa `npm run secretos` y el CI). Las
llaves de IA, Gmail (`GMAIL_USER`, `GMAIL_APP_PASSWORD`), Meta, etc. viven como **secretos de Supabase**. Las únicas
llaves públicas por diseño son la `sb_publishable_…` y el JWT `role: anon`. **Nunca escribas una contraseña en un
archivo.** Si el dueño te da su contraseña del panel para probar, usala solo por variable de entorno
(`TV_CORREO`, `TV_CLAVE`) y recomendale cambiarla al terminar.

## 4. La tecnología del código

- **React 19 + Vite 6 + TypeScript + Tailwind**, Capacitor 8 para Android/iOS.
- Estado y datos: `src/utils/storage.ts` (caché local + sincronización con Supabase; `getDB()`, `saveDB()`,
  `lecturaRapida()`).
- Pieza clave del arranque sin parpadeo: el Worker `src/worker/previo.ts` mete en el HTML los textos editables,
  ajustes, banners y paleta (`<script id="tv-previo">`), y el cliente los lee con `src/utils/previoDelSitio.ts`.
- Mapa del código para Javier: `supabase/functions/asistente-ia/mapa-codigo.ts`, se regenera con **`npm run mapa`**
  después de agregar o cambiar archivos (sale del comentario con que empieza cada archivo).

### Comandos que siempre se corren antes de subir

```bash
cd /root/proyectos/Technoverse-p-gina-
npx --no-install tsc --noEmit        # tipos: tiene que dar 0 errores
npm run build                        # compilación: tiene que terminar «✓ built»
npm run paletas                      # SOLO si tocaste colores: contraste WCAG AA de todos los temas
npm run mapa                         # si agregaste o renombraste archivos
npm run secretos                     # si tocaste algo de llaves/config
```

### Flujo de git (autorizado de forma permanente)

```bash
git fetch -q origin
git switch -c claude/<nombre-corto> origin/main     # SIEMPRE una rama nueva desde main
# ...cambios...
git add -u src   # (o los archivos concretos)
git commit -m "Título en español que diga QUÉ arregla y POR QUÉ"   # cuerpo explicativo
git push -u origin claude/<nombre-corto>
gh pr create --base main --title "..." --body "..."
gh pr checks <n>            # esperar: api-publica, base-de-datos, codigo, Workers Builds
gh pr merge <n> --squash --delete-branch
```

- **No uses `git push --force`**: el sistema de permisos lo bloquea. Si la rama remota ya existe con commits
  viejos, simplemente creá una rama con otro nombre.
- Un check de Cloudflare que falla por algo ajeno al cambio no bloquea (está escrito en `CLAUDE.md`).
- Después de fusionar, Cloudflare tarda 1-3 minutos. Para saber si ya está publicado, mirá que cambió el nombre del
  paquete principal: `curl -s https://technoverse-cr.technoversecr.workers.dev/ | grep -o '/assets/main-[^"]*\.js'`
  y buscá dentro un texto tuyo nuevo.

## 5. La tablet, el Linux y cómo se maneja todo

El trabajo se hace **desde una tablet Android (Xiaomi Redmi Pad, MIUI)** con un **Ubuntu en PRoot** dentro de Termux,
con escritorio XFCE mostrado en la app **Termux:X11**.

- Abrir el escritorio: widget de Termux → `tasks/Escritorio` (corre `/data/data/com.termux/files/usr/bin/escritorio`).
  Salir: widget → `tasks/Salir de Linux`. Registro de arranques: `/sdcard/escritorio.log`.
- El script `escritorio` (versión del 28-oct-2026) tiene cerrojo con PID, avisos en pantalla (`termux-toast`) y mira el
  proceso `xfce4-session` directo antes de cerrar nada. Respaldo del original: `escritorio.respaldo-20261028-2050`.
- **Claude Code corre dentro de `tmux`** (sesión `cc`, comando `/usr/local/bin/cc-sesion`), aparte del escritorio:
  si el escritorio se reinicia, la sesión de la IA NO muere. Alias `tv` = entrar al proyecto y continuar.
- **OpenCode** está en `/usr/bin/opencode` (icono en el escritorio).
- **ADB a la propia tablet**: `adb connect 127.0.0.1:5555` (`export ANDROID_SERIAL=127.0.0.1:5555`). Lo mantiene vivo
  `/usr/local/bin/adb-estable`. **Se cae seguido** («Connection refused»): el dueño lo reactiva con el icono
  «Activar conexion adb» del escritorio. Pedíselo y esperá; no inventes otra cosa.
- **Nunca uses `adb reverse` hacia un puerto local**: en PRoot el «aparato» y el Linux comparten red y se arma un
  bucle que cuelga el servidor ADB (pasó: hubo que matar `adb` y reconectar).
- La tablet es de **poca memoria** (3,8 GB, suele quedar con ~100 MB libres): las cosas pueden tardar; usá tiempos
  límite (`timeout`) en todo comando a la tablet.
- La pantalla **gira** (horizontal 1920×1200 o vertical 1200×1920): medí antes de tocar coordenadas.

## 6. Cómo se prueba «como humano» (resumen; detalle en `02-COMO-PROBAR-EN-LA-TABLET.md`)

1. Traer Chrome al frente: `adb shell monkey -p com.android.chrome -c android.intent.category.LAUNCHER 1`.
2. Conectar al protocolo de depuración de Chrome: `adb forward tcp:9333 localabstract:chrome_devtools_remote`,
   y listar pestañas: `curl -s localhost:9333/json/list`.
3. Con los guiones de `herramientas/` se lee la página, se mide dónde está un botón, y se **toca de verdad** con
   `adb shell input tap X Y` (coordenadas de pantalla = CSS × devicePixelRatio, más el alto de la barra de Chrome).
4. Para la **APK** (tiene protección anti-captura, la pantalla sale negra en capturas): es una APK de depuración, así
   que su WebView expone `webview_devtools_remote_<pid>` → `adb forward tcp:9444 localabstract:webview_devtools_remote_<pid>`.
5. Los textos de otras apps (WhatsApp, diálogos de Android) se leen con `uiautomator dump`.
6. **Después de probar, limpiá**: borradores de WhatsApp, contactos de prueba, banners de prueba, carritos.

## 7. Estado al 29-oct-2026 (lo más importante que está vivo)

- **Entrada en navegador**: siempre correo y contraseña (sin huella ni patrón). A los 5 min sin actividad se cierra
  la sesión. **En la APK** sí hay huella/cara.
- **Banners**: el gestor está en Marketing → «Banners y promociones». Formatos: hero, cintillo, campaña, divisor,
  tarjeta de cuadrícula y emergente. Las piezas del «Estudio de pauta» (Javier + fondo con IA) se publican con
  «Usar de banner»: salen enteras (sin velo ni texto encimado) y abren WhatsApp con el mensaje del producto.
- **WhatsApp**: `src/utils/whatsapp.ts` decide cómo abrirlo: en la APK con el complemento nativo `TelefonoNativo`;
  en Chrome Android con `intent://` (respaldo nativo a wa.me); en iPhone con `whatsapp://`; en computadora wa.me.
  Botones: banner, «Consultar por WhatsApp» en el detalle del producto, «¿Preferís comprar por WhatsApp?» en el
  carrito desplegable, y en el CRM.
- **CRM**: canal `whatsapp` (migración aplicada), alta rápida con la «Ref.» (SKU) del mensaje, ficha con
  «WhatsApp» (respuestas rápidas) y «Armar venta» → «Enviar resumen» (pasa a Pendiente de pago) → «SINPE recibido»
  (abre Cobros precargado). Seguimiento: WhatsApp sin cerrar en 48 h = sin atender.
- **Fotos de producto**: al subir CUALQUIER foto se le quita el fondo liso solo (`src/utils/quitarFondo.ts`), se
  recortan márgenes y se comprime (`prepararFotoProducto` en `storage.ts`). La vitrina usa el color del tema.
- **Facturación**: los comprobantes son inmutables (no se editan ni borran). El cupón se resta. El correo del
  comprobante no lo puede usar un extraño. **Todavía no se transmite a Hacienda** (formato v4.3 interno).

## 8. Lo que quedó pendiente / decisiones del dueño

Ver la lista completa al final de `03-HISTORIAL-DE-CAMBIOS.md`. Lo principal:

- La compra de la tienda **emite la factura antes de que alguien vea el SINPE** (riesgo de negocio). Para ventas por
  chat ya está resuelto con «Armar venta»; para la tienda falta decidir.
- El stock (1) y el costo (75 % del precio) de los 5 audífonos nuevos son **estimados**: el dueño debe corregirlos.
- Hay banners del iPhone creados en pruebas (hero y tarjeta) que el dueño debe decidir si deja.
- Respaldos automáticos de la base (el plan gratis de Supabase no guarda copias): propuesto, no hecho.

Si dudás de algo: **preguntá antes de tocar producción**. Mejor lento y bien que rápido y roto.
