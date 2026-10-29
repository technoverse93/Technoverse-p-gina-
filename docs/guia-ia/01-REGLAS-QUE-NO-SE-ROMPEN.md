# REGLAS QUE NO SE ROMPEN

> Resumen de `CLAUDE.md` (en la raíz del repositorio) y de lo que el dueño ordenó en las sesiones.
> **`CLAUDE.md` siempre manda**: leelo entero al empezar (`cat /root/proyectos/Technoverse-p-gina-/CLAUDE.md`).

## A. Lo que SIEMPRE necesita la confirmación expresa del dueño

1. **Cualquier SQL en producción** (Supabase `hzatdfrjcqiimgqxcwwh`): migraciones, `update`, `delete`, cambiar roles,
   resetear o fijar contraseñas, borrar filas. Leer con `select` sí se puede.
2. **Cualquier cosa que dé o quite acceso a una persona real** al sistema.
3. **Emitir una factura real** (gasta un número de consecutivo fiscal que no se puede borrar; los comprobantes son
   inmutables) o **cobrar** en Cobros. En pruebas se llega hasta el último paso y NO se confirma.
4. **Enviar mensajes reales** a clientes (WhatsApp, correo). En pruebas se abre el mensaje, se mira, y se borra el
   borrador sin enviar.
5. **Nunca** correr `supabase/reset_produccion.sql` ni `reset_datos_prueba.sql` contra producción.

Las migraciones de seguridad se escriben en `supabase/migracion_*.sql` **con su prueba** en `supabase/pruebas/*.sql`
y se suman al CI (`.github/workflows/seguridad.yml`). Primero el CI, después pedir permiso, después aplicar.

## B. Lo que está autorizado de forma permanente

`git commit`, `git push` a una rama de trabajo, abrir PR y **fusionar a `main`** si `tsc --noEmit` y `npm run build`
pasan. No hace falta preguntar «¿lo fusiono?».

## C. Reglas de producto (ordenadas por el dueño; respetalas en cada cambio)

- **La tienda no parpadea al abrir**: lo editado sale definitivo en el primer dibujo. Nada de estado inicial `[]`/`null`
  que se llena después; nada de aro de carga al abrir. No borrar `public/arranque.js` ni el contenedor `#tv-arranque`.
- **Íconos y textos no se desplazan** con letra grande: rótulos en UNA línea (se achican y luego «…»), `min-w-0` en
  hijos de filas flex, grillas `minmax(0,1fr)`, nada de `flex-wrap` que baje textos. Medir con letra ×1,3 y ×1,5.
- **Nada de `opacity` sobre texto**. **Colores solo por token** (`var(--text-muted)`, `--accent`, `--accent-2`…), nunca
  un hex suelto ni `text-blue-500`. Si tocás colores: `npm run paletas` (todo AA).
- **Pie de la tienda**: UN solo plegable «Privacidad y soporte». No pedir cámara al cliente. Aviso de cookies discreto
  (una fila, «Aceptar» y X).
- **Phill / widget fuera de la app no tapan el teléfono**: nada de oscurecer el fondo, ni pantallas completas.
- **Botones de WhatsApp discretos**: NO en cada tarjeta de producto (ensucia la tienda); sí en el detalle del producto
  (botón de contorno) y en el carrito (una línea de texto).
- **Navegador = correo y contraseña siempre** (sin huella/patrón); la APK sí usa huella/cara.
- **Fotos de producto**: sin fondo blanco detrás; el fondo se quita bien (sin parches, sin mordidas, sin halo).

## D. Seguridad

- Ninguna llave secreta en el navegador ni en el repo. Funciones `SECURITY DEFINER` con `set search_path = public`.
- Un `insert` público exige un disparador que valide y limite (`es_visitante()` + `limitar_uso()`).
- Buckets de Storage: tamaño y tipos en el bucket; nombres no adivinables en los públicos.
- El bucket `marketing` **no deja leer/listar** a nadie: por eso las subidas usan nombre nuevo y `upsert: false`.

## E. Hábitos que evitan romper cosas

- Antes de cambiar algo, **leé el comentario de cabecera del archivo**: casi todos explican el porqué de decisiones
  pasadas («FALLO CORREGIDO…»). Muchas cosas raras son a propósito.
- Un cambio = una rama = un PR con título y cuerpo en español que expliquen el porqué.
- Probá en la tablet real después de que Cloudflare publique. Si algo no se puede probar, decilo.
- No dejes basura: borradores, contactos «PRUEBA», banners «PRUEBA», carritos, archivos temporales.
- Si el sistema de permisos te niega algo (por ejemplo `push --force` o simular otro navegador), **no lo esquives**:
  buscá el camino normal o pedile al dueño.
