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
