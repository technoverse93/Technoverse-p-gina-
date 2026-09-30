// =====================================================================
// CSS CRUDO — las hojas de estilo tal como vienen del servidor
// =====================================================================
// El espejo de supervisión necesita el CSS de la aplicación como TEXTO para
// inyectarlo en el iframe de rrweb (la hoja original no puede cargarse ahí:
// en la APK el espejo vive en https://localhost y la CSP bloquea la hoja
// del dominio web de quien se está mirando).
//
// ---------------------------------------------------------------------
// POR QUÉ NO SE RECONSTRUYE DESDE EL CSSOM
// ---------------------------------------------------------------------
// Antes el texto se armaba recorriendo `document.styleSheets` y juntando
// `regla.cssText`. Eso le pregunta al NAVEGADOR qué entendió de la hoja, y
// cada navegador entiende distinto: uno que no soporte `@layer` deja fuera
// del CSSOM todos los bloques de Tailwind (theme, base, utilities), y si la
// hoja no deja leer sus reglas (`cssRules` lanza) no se obtiene nada. En los
// dos casos el espejo recibía un CSS vacío o mutilado y pintaba HTML crudo:
// viñetas, subrayados, títulos a tamaño por defecto — el fallo reportado.
//
// Pedir el archivo por `fetch` devuelve los MISMOS bytes que descargó la
// página (sale de la caché HTTP, así que no cuesta red), sin pasar por la
// interpretación de nadie. El CSSOM queda solo como respaldo.
//
// Cada hoja se devuelve POR SEPARADO: una `@import` solo es válida al
// principio de su hoja, y concatenarlas la dejaría en medio, donde el
// navegador la ignora.
// =====================================================================

const crudoPorUrl = new Map<string, Promise<string | null>>();

function reglasDe(hoja: CSSStyleSheet | null | undefined): string {
  if (!hoja) return '';
  try {
    let texto = '';
    for (const regla of Array.from(hoja.cssRules)) texto += regla.cssText + '\n';
    return texto;
  } catch {
    return '';   // hoja de otro origen o ilegible
  }
}

function descargarCrudo(url: string): Promise<string | null> {
  let pendiente = crudoPorUrl.get(url);
  if (!pendiente) {
    pendiente = (async () => {
      try {
        const r = await fetch(url, { cache: 'force-cache', credentials: 'same-origin' });
        // Un archivo que ya no existe tras un despliegue nuevo no da 404: el
        // hosting devuelve el index.html (200) por ser una SPA. Ese HTML no
        // es CSS y se descarta.
        const tipo = r.headers.get('content-type') || '';
        if (!r.ok || /html/i.test(tipo)) return null;
        return await r.text();
      } catch {
        return null;
      }
    })();
    crudoPorUrl.set(url, pendiente);
    // Un fallo no se recuerda: el próximo intento vuelve a probar.
    void pendiente.then(t => { if (t === null) crudoPorUrl.delete(url); });
  }
  return pendiente;
}

/**
 * Todas las hojas de estilo de `doc`, en el orden del documento, una por
 * elemento. Las de otro origen (tipografías de Google) se omiten: no se
 * pueden leer y el propio CSS las importa.
 */
export async function leerCssCrudo(doc: Document = document): Promise<string[]> {
  const partes: string[] = [];
  const nodos = Array.from(doc.querySelectorAll('link[rel~="stylesheet"], style'));
  for (const nodo of nodos) {
    if (nodo instanceof HTMLLinkElement) {
      if (nodo.disabled || !nodo.href) continue;
      let texto: string | null = null;
      try {
        const url = new URL(nodo.href, doc.baseURI);
        if (url.origin !== location.origin) continue;
        texto = await descargarCrudo(url.href);
      } catch { /* URL inválida: se prueba el CSSOM */ }
      if (texto === null) texto = reglasDe(nodo.sheet as CSSStyleSheet | null);
      if (texto) partes.push(texto);
      continue;
    }
    const estilo = nodo as HTMLStyleElement;
    // Las hojas que el propio espejo inyecta no son de la aplicación.
    if (estilo.hasAttribute('data-tv-css')) continue;
    const texto = estilo.textContent || reglasDe(estilo.sheet as CSSStyleSheet | null);
    if (texto) partes.push(texto);
  }
  return partes;
}

/** Respaldo síncrono: el CSSOM de `doc`, para cuando todavía no hay texto crudo. */
export function leerCssDelCssom(doc: Document = document): string {
  let texto = '';
  for (const hoja of Array.from(doc.styleSheets)) texto += reglasDe(hoja as CSSStyleSheet);
  return texto;
}
