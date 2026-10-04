// =====================================================================
// INVENTARIO — cambiar existencias o precio de un producto
// =====================================================================
// Lo usa Jarvis («subile 5 al cargador USB-C», «poné la funda A12 a
// ₡4 500»). Mismo patrón que el conteo físico del módulo de Inventario:
// se ajusta la ficha, queda el movimiento con su existencia resultante y
// la bitácora general, y se guarda con `saveDB`.
// =====================================================================

import { getDB, saveDB, addAuditLog } from './storage';

export type CambioProducto = { modo?: 'fijar' | 'sumar'; stock?: number; precio?: number };
export type Antes = { stock: number; precio: number; nombre: string };

/** Devuelve cómo estaba antes (para deshacer), o null si no existe. */
export function editarProducto(productId: string, cambio: CambioProducto, quien: string, nota: string): Antes | null {
  const db = getDB();
  const p = db.products.find(x => x.id === productId);
  if (!p) return null;
  const antes: Antes = { stock: p.stock, precio: p.price, nombre: p.name };

  if (typeof cambio.stock === 'number' && Number.isFinite(cambio.stock)) {
    const nuevo = Math.max(0, Math.round(cambio.modo === 'sumar' ? p.stock + cambio.stock : cambio.stock));
    if (nuevo !== p.stock) {
      const diff = nuevo - p.stock;
      p.stock = nuevo;
      // Igual que el conteo: en 0 se apaga en pantalla; el disparador de la
      // base es el que de verdad lo archiva.
      if (nuevo === 0) p.active = false;
      else if (diff > 0) p.active = true;
      db.inventory_movements.unshift({
        id: `MOV-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        productId: p.id,
        productName: p.name,
        quantityChange: diff,
        type: 'Ajuste manual',
        notes: nota,
        timestamp: new Date().toISOString(),
        userEmail: quien,
        resultingStock: nuevo,
      });
    }
  }
  if (typeof cambio.precio === 'number' && Number.isFinite(cambio.precio) && cambio.precio >= 0) p.price = Math.round(cambio.precio);

  addAuditLog(quien, 'Inventario', 'Ajuste por Jarvis',
    `${p.name}: existencias ${antes.stock} → ${p.stock}, precio ₡${antes.precio} → ₡${p.price}. ${nota}`, db);
  void saveDB(db);
  return antes;
}
