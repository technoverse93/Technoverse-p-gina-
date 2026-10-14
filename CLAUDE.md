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
  mientras tanto se reserva el lugar, sin dibujar nada (ni esqueleto animado ni aro).
- NO hay aro ni indicador de carga al abrir la tienda ni el panel (orden del dueño, 2026-10-14:
  «para eso ya carga Chrome»): mientras llega el JavaScript solo se ve el fondo del tema. Lo único
  que queda es la red de seguridad de `public/arranque.js` (tarjeta con qué hacer si la app no
  arranca en 15 s), que vigila el contenedor vacío `#tv-arranque`: no lo quites.
- Sin el dato en el HTML (APK, desarrollo, el Worker no alcanzó a leer) la tienda espera
  un instante acotado el contenido (`ModoEdicionProvider`) antes de dibujar.

## Regla de producto: íconos y textos NO se desplazan por tamaño

Ordenado por el dueño (2026-10-14): en las pantallas densas del panel (Ciberseguridad,
«Nueva pestaña», tarjetas, filas y botones) ningún ícono ni texto se corre hacia abajo ni
hacia la izquierda porque el contenido, o la letra del teléfono, sea más grande. Tiene que
verse atractivo y no invasivo (compacto, sin que la pantalla crezca).

- El ícono queda anclado (`flex: none`) y el rótulo va en UNA línea. Nada de `flex-wrap`,
  `overflow-wrap: anywhere` ni `justify-items: center` que deje crecer al texto: eso lo baja
  de renglón o lo saca de su tarjeta por la izquierda.
- Un rótulo que no cabe se achica hasta el mínimo legible (`data-ajustar` +
  `useAjusteDeTextos`, `src/utils/ajustarTexto.ts`; las etiquetas de `Btn` van solas) y solo
  entonces se corta con «…». Los correos, IPs e IDs se cortan AL MEDIO con `<TextoMedio>`
  (se sigue viendo «@gmail.com» o el final del ID).
- Las pistas de grilla son `minmax(0, 1fr)`: un `1fr` a secas se ensancha con su contenido
  (un correo, una etiqueta con letra grande) y empuja la pantalla fuera del aparato.
- Lo secundario o repetido se compacta en vez de bajar de línea: «Aparato nuevo» → «Nuevo»
  (`sg-largo`/`sg-corto`), el estado ya lo dice el ícono, «Abierto» pasa a ser un punto.
- Antes de dar por buena una pantalla así, medirla con la letra del sistema agrandada (×1,3 y
  ×1,5; en Chromium se emula redefiniendo las fuentes con `size-adjust`, que agranda solo el
  texto como lo hace Android) a 320, 360, 412, 768 y 1280 px: una sola línea, íconos en la misma
  posición y ninguna caja fuera del ancho del aparato.

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
