// =====================================================================
// UN PANEL FLOTANTE A LA VEZ EN LA TIENDA (chat, carrito, cuenta)
// =====================================================================
// El chat flotante (LiveChat) y los menús de la cabecera (carrito y cuenta) viven en
// componentes distintos. Antes se podían abrir a la vez: el chat quedaba ENCIMA del carrito y
// tapaba el botón de pagar, y el aviso de cookies tapaba el botón «Iniciar chat seguro».
// Cada uno avisa aquí cuando se abre o se cierra, y los demás se apartan solos.
// =====================================================================

export type PanelTienda = 'chat' | 'carrito' | 'cuenta';

const EVENTO = 'technoverse_panel_tienda';

interface DetallePanel { panel: PanelTienda; abierto: boolean }

/** Avisa que `panel` se abrió o se cerró. */
export function avisarPanel(panel: PanelTienda, abierto: boolean): void {
  try { window.dispatchEvent(new CustomEvent<DetallePanel>(EVENTO, { detail: { panel, abierto } })); } catch { /* sin ventana */ }
}

/** Escucha los avisos de los paneles. Devuelve la función para dejar de escuchar. */
export function alCambiarPanel(fn: (panel: PanelTienda, abierto: boolean) => void): () => void {
  const manejar = (e: Event) => {
    const d = (e as CustomEvent<DetallePanel>).detail;
    if (d) fn(d.panel, d.abierto);
  };
  window.addEventListener(EVENTO, manejar);
  return () => window.removeEventListener(EVENTO, manejar);
}
