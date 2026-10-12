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

Cualquier cambio a la ventanita tiene que respetar esto.

## Mapa del código de Javier

Javier conoce el sistema por `supabase/functions/asistente-ia/mapa-codigo.ts`,
que se genera con `npm run mapa` a partir del comentario con que empieza cada
archivo. Después de agregar o cambiar archivos, correr `npm run mapa` y subir
el resultado junto con el cambio (la función lo trae al desplegarse).
