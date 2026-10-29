# GUÍA MAESTRA PARA CUALQUIER IA — Proyecto Technoverse Costa Rica

> Para Claude Code, OpenCode (con cualquier modelo, de pago o gratis) o cualquier IA futura que trabaje en este
> proyecto. Texto plano a propósito: lo entiende cualquier modelo. **Leé todo antes de tocar nada.**
> Si algo choca con `CLAUDE.md` (raíz del repo), **manda `CLAUDE.md`**. Si algo choca con el código, **manda el código**.

## 0. PROTOCOLO OBLIGATORIO DE CADA SESIÓN

### Al empezar (en OpenCode: comando `/inicio`)
1. `cd /root/proyectos/Technoverse-p-gina-` → `git status` (debe estar limpio salvo `.claude/`) →
   `git switch main` → `git pull`.
2. Leé la **última entrada** de `docs/guia-ia/BITACORA.md` y todo `docs/guia-ia/05-ESTADO-Y-PENDIENTES.md`.
3. `git log --oneline -10` para ver qué cambió desde la última entrada (otra IA o el dueño pudieron haber subido algo).
4. Contale al dueño, en 3-5 líneas y en español, dónde quedó el trabajo y qué sigue.

### Al terminar (en OpenCode: comando `/cierre`)
1. Agregá una entrada **al final** de `BITACORA.md` con la plantilla (hechos, sin inventar, sin secretos).
2. Si cambió el estado, reescribí la parte que corresponda de `05-ESTADO-Y-PENDIENTES.md`; sumá los PR a
   `03-HISTORIAL-DE-CAMBIOS.md`.
3. Subí esos cambios (en el PR del trabajo o en uno propio) y fusionalo.

## 1. Orden de lectura de esta carpeta (`docs/guia-ia/`)

| # | Archivo | Para qué |
|---|---|---|
| 1 | `00-LEEME-PRIMERO.md` | Esto: cómo se trabaja, quién es el dueño, dónde vive todo. |
| 2 | `01-REGLAS-QUE-NO-SE-ROMPEN.md` | Lo prohibido sin permiso y las reglas de diseño del dueño. |
| 3 | `05-ESTADO-Y-PENDIENTES.md` | Dónde estamos HOY y qué falta. |
| 4 | `BITACORA.md` | Qué hizo cada IA, sesión por sesión. |
| 5 | `04-MAPA-DEL-SISTEMA.md` | Mapa técnico: carpetas, módulos, roles, tablas, funciones, publicación. |
| 6 | `02-COMO-PROBAR-EN-LA-TABLET.md` | Cómo probar como un humano en la tablet (Chrome y APK). |
| 7 | `03-HISTORIAL-DE-CAMBIOS.md` | Cada PR con su porqué. |
| — | `herramientas/` | Guiones Node.js para manejar Chrome/APK por CDP. |

La guía para el dueño (humano) está en `docs/guia-humano/GUIA-COMPLETA.md`. No la uses para instrucciones técnicas,
pero respetá lo que ahí se le promete.

## 2. Quién es el dueño y cómo quiere trabajar

- Escribe en **español de Costa Rica** con voseo («tocá», «probá»). **Respondé siempre en español**: nada de inglés,
  ni en avisos cortos ni en leyendas de archivos.
- Quiere que **hagas las cosas vos**. Tiene autorización permanente (en `CLAUDE.md`) para commit, push, PR y
  **fusionar a `main`** si `npm run lint` (tsc) y `npm run build` pasan.
- **No le pidas el mismo permiso muchas veces**: agrupá lo que necesite aprobación en un solo pedido.
- Quiere **pruebas reales**: en la tablet física, en Chrome y en la APK, con toques en la pantalla. No en un
  navegador simulado ni «solo por código».
- Propuestas: **un tema por documento**, opciones numeradas («respondeme 1 y 3»).
- No llenes Chrome de pestañas: **reutilizá la misma**.
- Explicale qué encontraste y qué arreglaste en lenguaje claro.

## 3. El negocio

**Technoverse Costa Rica**: tienda de tecnología y taller de reparación de celulares en San José. WhatsApp y teléfono
**+506 6421 4795** (también es el número SINPE Móvil de la tienda). Horario L-V 1pm-6pm.
Dos caras: **la tienda** (clientes) y **el panel** (`/admin`, personal). Asistente de IA interno: **Javier**
(«Phill» en la ventanita del teléfono).

## 4. Dónde vive todo

| Pieza | Dónde |
|---|---|
| Código | GitHub `technoverse93/Technoverse-p-gina-`, rama `main`. Copia local: `/root/proyectos/Technoverse-p-gina-`. |
| Tienda | Cloudflare Worker `technoverse-cr` → https://technoverse-cr.technoversecr.workers.dev (se publica al fusionar a `main`). |
| Base | Supabase `hzatdfrjcqiimgqxcwwh` — https://supabase.com/dashboard/project/hzatdfrjcqiimgqxcwwh |
| APK | `com.technoverse.admin` («Technoverse Admin»), se compila en GitHub Actions; se actualiza por OTA. |
| Cloudflare | Cuenta de `technoverse.admin@gmail.com` (id `aa9d204f79ca460beecd48b6cbf3a2b8`). Hay una cuenta vieja vacía ligada a GitHub (Genarolopez): no usarla. |

Mapa técnico completo: `04-MAPA-DEL-SISTEMA.md`.

## 5. Qué puede hacer cada IA en esta tablet (importante para OpenCode)

| Herramienta | Claude Code | OpenCode | Notas |
|---|---|---|---|
| Leer/editar el código, `npm`, `git` | Sí | Sí | |
| `gh` (GitHub: PR, checks, merge, descargar APK) | Sí | Sí | `gh` está logueado como `technoverse93`. |
| `adb` (tablet, Chrome, APK) | Sí | Sí | Ver `02-COMO-PROBAR…`. |
| Leer la base de producción | Sí (conector de Supabase) | **No** directamente | OpenCode: verificá por la página real o pedile al dueño que corra un `select` en el SQL Editor de Supabase. |
| Aplicar migraciones / desplegar funciones del servidor | Sí, con permiso del dueño | **No** sin credenciales | Necesita Supabase CLI + token (`npx supabase login`), que hoy no está configurado. Escribí la migración y su prueba, subila, y dejá en la bitácora que falta aplicarla. |
| Publicar documentos (artifacts) | Sí | No | OpenCode deja Markdown en `docs/` o en el escritorio. |

Si no podés hacer algo, **no lo simules**: dejalo escrito en la bitácora como pendiente para quien sí pueda.

## 6. Cómo se trabaja un cambio (paso a paso)

```bash
cd /root/proyectos/Technoverse-p-gina-
git switch main && git pull
git switch -c <ia>/<tema-corto>          # ej. opencode/precios-envio  (una rama nueva por tema)
# ...editar...
npm run lint                             # tsc: 0 errores
npm run build                            # «✓ built»
npm run paletas                          # solo si tocaste colores
npm run mapa                             # si agregaste/renombraste archivos (y subí supabase/functions/asistente-ia/mapa-codigo.ts)
npm run secretos                         # siempre que toques config
git add <archivos> && git commit -m "Qué arregla y por qué (en español)"
git push -u origin <rama>
gh pr create --base main --title "…" --body "…"
gh pr checks <n> --watch                 # codigo, base-de-datos, api-publica, Workers Builds
gh pr merge <n> --squash --delete-branch
```

- **Nunca** `git push --force` (está bloqueado). Si la rama remota ya existe, usá otro nombre.
- Después de fusionar, Cloudflare tarda 1-3 min. Para saber si ya está publicado:
  `curl -s https://technoverse-cr.technoversecr.workers.dev/ | grep -o '/assets/main-[^"]*\.js'` y buscá en ese
  archivo un texto tuyo nuevo (`curl -s <url-del-js> | grep -c "tu texto"`).
- La APK recibe el cambio por OTA (workflow «Publicar actualización OTA»); se aplica al pasar la app a segundo
  plano y volver.
- **Después de publicar, probá en la tablet** (`02-COMO-PROBAR…`) y anotá el resultado en la bitácora.

## 7. La tablet

Xiaomi Redmi Pad (MIUI), Android con **Termux** → **Ubuntu 26.04 en PRoot** → escritorio **XFCE** en **Termux:X11**.
- Abrir el escritorio: widget de Termux → `tasks/Escritorio` (script `/data/data/com.termux/files/usr/bin/escritorio`;
  registro en `/sdcard/escritorio.log`). Salir: `tasks/Salir de Linux`.
- **Claude Code**: `tmux` sesión `cc`, arranca con `/usr/local/bin/cc-sesion` (icono «Claude Code»; alias `tv`).
- **OpenCode**: `tmux` sesión `oc`, arranca con `/usr/local/bin/oc-sesion` (icono «OpenCode»), en la carpeta del
  proyecto, retomando la última sesión (`opencode --continue`). Modelos disponibles hoy: solo los gratis de
  OpenCode (`opencode models`).
- **ADB a la propia tablet**: `127.0.0.1:5555`, guardián `/usr/local/bin/adb-estable`. Se cae seguido: el dueño lo
  reactiva con el icono «Activar conexion adb». **Nunca uses `adb reverse`** (hace un bucle en PRoot).
- Poca memoria (3,8 GB): usá `timeout` en todo. La pantalla gira (1920×1200 ↔ 1200×1920): medí antes de tocar.
- Node 22, `gh` logueado; **no hay** `psql`, `supabase` CLI ni `wrangler` global (usar `npx`).

## 8. Errores que ya se cometieron (no los repitas)

- Probar en Chrome «emulado» y dar por bueno: el dueño lo rechaza. Probá con toques reales.
- Respaldo de WhatsApp con temporizador: dejaba la pestaña en wa.me. Hoy se usa `intent://` (Android) y el
  complemento nativo (APK). No vuelvas a `whatsapp://` + `setTimeout` en Android.
- Subir a `marketing` con `upsert: true`: falla por permisos (no se puede listar el bucket).
- Poner un velo/título encima de una pieza de pauta (ya trae su texto): sale duplicado.
- Vitrina blanca detrás del producto: el dueño la rechazó; usa el color del tema.
- Mostrar errores crudos de la base (en inglés): traducilos (`mensajeDeError` en `utils/crm.ts`).
- Creer que algo «no tiene enlace» sin mirar la base: verificá con datos.
- Escribir en inglés al dueño.
