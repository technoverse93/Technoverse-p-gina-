// =====================================================================
// PAUTA — pasarle un pedido al Estudio desde otro lado
// =====================================================================
// El chat de Javier (tarjeta de la pieza) e Inventario («Crear con Javier»
// en una publicación de Instagram sin imagen) abren el Estudio ya con el
// producto, el formato y los textos puestos. El pedido queda en
// sessionStorage (por si el Estudio todavía no está montado) y se avisa
// con un evento (por si ya lo está).
// =====================================================================

import type { CopyPauta, EstiloId, FormatoId, ObjetivoId } from './modelo';

export const CLAVE_PEDIDO_PAUTA = 'tv_pauta_pedido';
export const EVENTO_PEDIDO_PAUTA = 'tv:pauta-pedido';

export type PedidoPauta = {
  productoId?: string | null; formato?: FormatoId; estilo?: EstiloId; objetivo?: ObjetivoId;
  copy?: CopyPauta | null; requestId?: string | null;
};

/** Deja el pedido y abre la pestaña de Marketing (donde vive el Estudio). */
export function abrirEstudio(pedido: PedidoPauta, abrirModulo?: (modulo: string) => void): void {
  try { sessionStorage.setItem(CLAVE_PEDIDO_PAUTA, JSON.stringify(pedido)); } catch { /* sin almacenamiento: se abre igual */ }
  abrirModulo?.('marketing');
  // Si el Estudio ya estaba abierto, lo recoge al instante.
  setTimeout(() => { try { window.dispatchEvent(new CustomEvent(EVENTO_PEDIDO_PAUTA)); } catch { /* nada */ } }, 80);
}
