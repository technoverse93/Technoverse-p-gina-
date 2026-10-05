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

// ---------------------------------------------------------------------
// Crear productos nuevos (Jarvis: «creá 3 productos de prueba»). Mismo
// patrón que el alta del módulo de Inventario: ficha, movimiento de
// entrada, bitácora y `saveDB`. Deshacer no borra: los retira (sin
// existencias y apagados), igual que un producto dado de baja.
// ---------------------------------------------------------------------
export type ProductoNuevo = { nombre: string; precio: number; costo?: number; stock: number; categoria: string; descripcion?: string };

const IMAGEN_VACIA = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNTAiIGhlaWdodD0iMTUwIiB2aWV3Qm94PSIwIDAgMTUwIDE1MCI+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTUwIiBmaWxsPSIjZjhmOWZhIi8+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0iIzBmMTcyYSIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBkb21pbmF0LWJhc2VsaW5lPSJtaWRkbGUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjE2IiBmb250LXdlaWdodD0iYm9sZCIgZmlsbD0iIzM4YmRmZiI+VEVDSE5PVkVSU0U8L3RleHQ+PC9zdmc+";

/** Devuelve los ids creados (para deshacer). Omite los que ya existen con el mismo nombre. */
export async function crearProductos(lista: ProductoNuevo[], enTienda: boolean, quien: string, nota: string): Promise<{ id: string; nombre: string }[]> {
  const db = getDB();
  if (!db.products) db.products = [];
  if (!db.inventory_movements) db.inventory_movements = [];
  const usados = new Set(db.products.map(p => String(p.sku || '').toUpperCase()));
  const creados: { id: string; nombre: string }[] = [];
  for (const n of lista) {
    if (db.products.some(p => p.name.trim().toLowerCase() === n.nombre.trim().toLowerCase() && p.active !== false)) continue;
    let sku = '';
    do { sku = `TV-${Math.floor(10000 + Math.random() * 90000)}`; } while (usados.has(sku));
    usados.add(sku);
    const stock = Math.max(0, Math.round(n.stock));
    const p = {
      id: `PROD-${crypto.randomUUID()}`, name: n.nombre.trim(), sku, category: n.categoria,
      price: Math.max(0, Math.round(n.precio)), cost: Math.max(0, Math.round(n.costo || 0)), stock,
      imageUrl: IMAGEN_VACIA, discountPercent: 0, active: enTienda && stock > 0,
      description: n.descripcion || undefined, physicalLocation: 'Bodega Central',
    };
    db.products.push(p);
    if (stock > 0) {
      db.inventory_movements.unshift({
        id: `MOV-${crypto.randomUUID()}`, productId: p.id, productName: p.name, quantityChange: stock, type: 'Entrada',
        notes: nota, timestamp: new Date().toISOString(), userEmail: quien, resultingStock: stock,
      });
    }
    creados.push({ id: p.id, nombre: p.name });
  }
  if (!creados.length) return creados;
  addAuditLog(quien, 'Inventario', 'Crear Producto', `${nota}: ${creados.map(c => c.nombre).join(', ')}${enTienda ? '' : ' (ocultos de la tienda)'}.`, db);
  await saveDB(db);
  if (typeof window !== 'undefined') for (const c of creados) window.dispatchEvent(new CustomEvent('product:created', { detail: db.products.find(p => p.id === c.id) }));
  return creados;
}

/** Deshacer una creación: sin existencias y apagados (no se borran registros). */
export async function retirarProductos(ids: string[], quien: string, nota: string): Promise<number> {
  const db = getDB();
  let n = 0;
  for (const id of ids) {
    const p = db.products.find(x => x.id === id);
    if (!p) continue;
    if (p.stock > 0) {
      db.inventory_movements.unshift({
        id: `MOV-${crypto.randomUUID()}`, productId: p.id, productName: p.name, quantityChange: -p.stock, type: 'Ajuste manual',
        notes: nota, timestamp: new Date().toISOString(), userEmail: quien, resultingStock: 0,
      });
    }
    p.stock = 0; p.active = false; n++;
  }
  if (n) { addAuditLog(quien, 'Inventario', 'Retirar Producto', `${nota}: ${n} producto(s).`, db); await saveDB(db); }
  return n;
}
