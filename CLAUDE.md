# Technoverse Costa Rica — instrucciones permanentes

## Flujo de git/despliegue: autorización permanente

El dueño del repositorio autorizó de forma permanente (2026-08-12) que Claude
haga, sin pedir confirmación cada vez:

- `git commit` y `git push` de cambios de código a la rama de trabajo.
- Abrir Pull Requests.
- **Fusionar (merge) Pull Requests a `main`** una vez que el código compila
  (`tsc --noEmit`, `npm run build`) y no hay bloqueos reales (un check de CI
  que falla por algo ajeno al diff, como el build de Cloudflare Workers no
  relacionado con el cambio, no cuenta como bloqueo).

No hace falta preguntar "¿lo fusiono?" en cada PR: se fusiona directo.

## Lo que SIGUE necesitando confirmación explícita

Esta autorización es solo para el flujo de código/git. Sigue pidiéndose
confirmación antes de:

- Cambios directos en datos de producción en Supabase (SQL, ascender roles,
  resetear o fijar contraseñas de cuentas reales, borrar filas).
- Cualquier acción que otorgue o cambie el acceso de una persona real al
  sistema.

Si el dueño quiere ampliar la autorización permanente a estos casos también,
debe decirlo explícitamente.

## Regla de producto: Phill y el widget fuera de la app NO tapan el teléfono

Ordenado por el dueño (2026-10-12). Cuando Phill o el mini-widget se usan fuera
de la app (widget, «Oye Phill», botón del asistente), está **prohibido** tapar
el sistema y sus aplicaciones con una página o con algo oscuro:

- Nunca oscurecer lo de atrás (sin `FLAG_DIM_BEHIND` ni `backgroundDimEnabled`).
- La ventana nativa (`native-android/jarvis/JarvisRapido.java`) mide solo lo que
  Phill dibuja y deja pasar los toques de afuera (`FLAG_NOT_TOUCH_MODAL`): se
  tiene que poder seguir viendo y usando WhatsApp, YouTube o el escritorio.
- Nada de hojas o pantallas de carga a pantalla completa en `jarvis-rapido.html`
  ni en `VentanitaJarvis`; lo que se muestre va en un panel chico y traslúcido.

- Tocar FUERA de la tarjeta la guarda (`JarvisRapido.dispatchTouchEvent` con
  `FLAG_WATCH_OUTSIDE_TOUCH` → `guardar()`): con una ventana de otra tarea
  delante, la app de atrás pierde el foco del teclado y el dueño no podía
  escribir en WhatsApp hasta cerrar a Javier. El toque igual llega a la app de
  atrás (la ventana no es modal) y la burbuja vuelve para reabrirla.

Cualquier cambio a la ventanita tiene que respetar esto.

## Regla de producto: la tienda NO parpadea al abrir (lo editado sale definitivo)

Ordenado por el dueño (2026-10-14, con un video): al abrir la tienda no puede verse
primero el texto, el ícono o el logo «de fábrica» y a los instantes el editado
(«refrescamiento tras refrescamiento»). Lo editado tiene que salir definitivo en el
primer dibujo, en visitas nuevas y en repetidas (su equipo borra los datos del
navegador: para él toda visita es nueva).

- El Worker (`src/worker/previo.ts`) lee `contenido_sitio`, la configuración pública
  (`app_settings`: logo, teléfono, horario) y si la tienda tiene algo que mostrar, y lo
  deja dentro del HTML en `<script id="tv-previo" type="application/json">`. El
  cliente lo lee antes de dibujar (`src/utils/previoDelSitio.ts`). Si otra tabla pública
  pasa a ser «editable», se suma ahí; no se pide después del primer dibujo.
- Un componente que muestra datos de la base arranca con el dato ya cargado (estado
  inicial síncrono, ver `lecturaRapida()` en `storage.ts`); nunca con `[]`/`null` para
  llenarlo en un efecto: ese primer cuadro es el parpadeo.
- No se dice «Sin artículos disponibles» antes de saber si los hay (`catalogoListo()`):
  mientras tanto va el esqueleto.
- El aro de carga de `index.html` sale con 0,7 s de retardo: en una carga normal no se ve.
- Sin el dato en el HTML (APK, desarrollo, el Worker no alcanzó a leer) la tienda espera
  un instante acotado el contenido (`ModoEdicionProvider`) antes de dibujar.

## Mapa del código de Javier

Javier conoce el sistema por `supabase/functions/asistente-ia/mapa-codigo.ts`,
que se genera con `npm run mapa` a partir del comentario con que empieza cada
archivo. Después de agregar o cambiar archivos, correr `npm run mapa` y subir
el resultado junto con el cambio (la función lo trae al desplegarse).

## Javier y los datos en vivo (visitas, ingresos, equipos)

Pasó (2026-10-12): Javier contestaba «386 veces ayer» (eran las visitas de toda la
vida del equipo), «416 entradas» (sumaba totales) y «2 veces» (contaba filas),
porque no volvía a consultar y repetía la historia o notas del cerebro. Reglas:

- Las preguntas de seguridad (`esDatoDeSeguridad` en `nucleo.ts`) fuerzan la
  consulta (`tool_choice: required` en la primera vuelta), no usan el cerebro y
  ven las cifras viejas de la conversación tapadas con «[cifra]».
- `visitantes_tienda` devuelve `respuesta_lista` y `como_responder`: EQUIPOS, no
  personas; las «visitas en total» son de toda la vida y no se suman. Sin el
  registro de entradas (`supabase/migracion_visitas_por_dia.sql`) solo se sabe la
  ÚLTIMA vez de cada equipo y Javier lo dice en vez de inventar un conteo.
- El tiempo (hora, día, cuánto falta) lo calcula `tiempo.ts`, nunca el modelo.
- Los regex con `\b` después de una letra con tilde (`entró`) NO funcionan en JS:
  usar `(?![a-záéíóúñ])`.
