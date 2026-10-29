# Instrucciones para agentes (OpenCode y similares)

## Antes de cualquier cosa

Leé, en este orden: `CLAUDE.md` (reglas permanentes del dueño; manda sobre todo) y la guía completa en
`docs/guia-ia/` (`00-LEEME-PRIMERO.md`, `01-REGLAS-QUE-NO-SE-ROMPEN.md`, `02-COMO-PROBAR-EN-LA-TABLET.md`,
`03-HISTORIAL-DE-CAMBIOS.md`). Ahí está cómo se trabaja, qué necesita permiso, cómo se prueba en la tablet real y
qué quedó pendiente. Al terminar un trabajo, sumá lo hecho a `docs/guia-ia/03-HISTORIAL-DE-CAMBIOS.md` en el mismo PR.
`opencode.json` ya carga estos archivos como instrucciones en cada sesión de OpenCode.

## Búsquedas que necesitan datos reales y actuales (precios, stock, enlaces que funcionen)

Pasó (2026-10-22): al pedir una búsqueda tipo "busca audífonos en Amazon", la
búsqueda integrada daba enlaces viejos o rotos, porque no "ve" la página en
vivo. Cuando el pedido es de este tipo (precios, disponibilidad, resultados de
una tienda o sitio dinámico, cualquier cosa que cambie seguido), en vez de
quedarse con la búsqueda integrada:

1. Abrir la página real con `/usr/local/bin/navegador "URL"` (Firefox del
   escritorio, no un navegador aparte).
2. Esperar a que cargue y leer el contenido de verdad (captura de pantalla o
   el texto de la página), no un resumen cacheado.

Esto da datos y enlaces reales porque se navega la página tal cual está en
ese momento, en vez de depender del índice de búsqueda del modelo.

## Verificar cambios en el sitio real, no solo que el build pase

El dueño pidió (2026-10-22) que, al desplegar un cambio a producción, la
comprobación final sea abrir el sitio REAL con el navegador del escritorio y
ver el cambio funcionando ahí, en vez de darlo por hecho solo porque
`npm run build` o el workflow de GitHub Actions salieron en verde. El build
en verde dice que compila; no dice que el usuario vea lo que se pidió.

Flujo despues de hacer push/merge a `main`:

1. Esperar a que termine el workflow `Deploy to Cloudflare`
   (`gh run watch` o `gh run list` en el repo).
2. Abrir `https://technoverse-cr.technoversecr.workers.dev/` con
   `/usr/local/bin/navegador` (Firefox del escritorio) — NO un navegador de
   sandbox ni una petición curl sola.
3. Navegar de verdad a la parte que cambió y confirmar con una captura de
   pantalla que se ve/funciona como se pidió.

No se necesitan credenciales reales de clientes para esto salvo que el
cambio sea justo del portal de clientes logueado; si hace falta iniciar
sesión para verificar, pedir credenciales de prueba en vez de inventarlas
(evita bloqueos por intentos fallidos en cuentas reales).
