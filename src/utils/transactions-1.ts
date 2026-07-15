import { supabase } from '../supabaseClient';
import { getDB } from './storage';

// Convierte una reparación (forma camelCase del frontend) a las columnas
// snake_case de la tabla "repair_orders" en Supabase. Misma correspondencia
// de campos que usa storage.ts para esta misma tabla.
function repairToRow(o: any) {
  return {
    id: o.id, ticket: o.ticket || '', customer_id: o.customerId || '', customer_name: o.customerName || '',
    customer_email: o.customerEmail || '', device: o.device || '', damage_reported: o.damageReported || '',
    diagnosis_manual: o.diagnosisManual || null, repuestos: o.repuestos || [], labor_cost: o.laborCost || 0,
    total_cost: o.totalCost || 0, status: o.status, warranty_months: o.warrantyMonths ?? 3,
    blockchain_hash: o.blockchainHash || null, bitacora: o.bitacora || [],
    repair_location: o.repairLocation || null, needed_tools: o.neededTools || null,
    created_at: o.createdAt || new Date().toISOString()
  };
}

// Los productos (incluidos los repuestos) viven en Supabase (tabla "products"),
// no en Firestore. El ajuste de stock se hace con la función atómica
// adjust_stock(jsonb) en Supabase (row locking, todo o nada), en vez de
// runTransaction() sobre las colecciones "productos"/"repuestos" de Firestore,
// que ya no reciben ninguna escritura y por eso toda venta fallaba siempre.

export async function processSaleAtomic(cart: any[], newOrder: any) {
  try {
    const items = cart.map((it: any) => ({ id: it.product.id, delta: it.quantity }));
    const { error } = await supabase.rpc('adjust_stock', { p_items: items });

    if (error) {
      const msg = error.message || '';
      if (msg.includes('INSUFFICIENT_STOCK')) {
        const parts = msg.split(':');
        throw new Error(`Concurrencia: el stock del producto ${parts[1] || ''} cambió. Solo quedan ${parts[2] || 0} disponibles.`);
      }
      if (msg.includes('PRODUCT_NOT_FOUND')) {
        throw new Error('Uno de los productos del carrito ya no existe en la base de datos.');
      }
      throw new Error(msg || 'No se pudo procesar la venta.');
    }

    const currentDb = getDB();
    if (!currentDb.orders) currentDb.orders = [];
    currentDb.orders.push(newOrder);

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function processRepairAtomic(originalRepair: any, repuestosSelected: any[], activeUserEmail: string, finalLaborCost: number, diagnosis: string, newRepairData: any) {
  try {
    const deltas = repuestosSelected
      .map((rep: any) => {
        const previouslyConsumed = (originalRepair.repuestos || []).find((pr: any) => pr.productId === rep.productId)?.quantity || 0;
        return { id: rep.productId, name: rep.productName, delta: rep.quantity - previouslyConsumed };
      })
      .filter((it: any) => it.delta !== 0);

    if (deltas.length > 0) {
      const ids = deltas.map((d) => d.id);
      const { data: existing, error: checkError } = await supabase.from('products').select('id').in('id', ids);
      if (checkError) throw new Error(checkError.message);

      const existingIds = new Set((existing || []).map((r: any) => r.id));
      const validItems = deltas.filter((d) => existingIds.has(d.id)).map((d) => ({ id: d.id, delta: d.delta }));

      if (validItems.length > 0) {
        const { error } = await supabase.rpc('adjust_stock', { p_items: validItems });
        if (error) {
          const msg = error.message || '';
          if (msg.includes('INSUFFICIENT_STOCK')) {
            const parts = msg.split(':');
            throw new Error(`Concurrencia: el stock del repuesto ${parts[1] || ''} cambió. Solo quedan ${parts[2] || 0} disponibles.`);
          }
          throw new Error(msg || 'No se pudo actualizar el stock de repuestos.');
        }
      }
    }

    const { error: repairError } = await supabase
      .from('repair_orders')
      .update(repairToRow(newRepairData))
      .eq('id', originalRepair.id);
    if (repairError) throw new Error(repairError.message);

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
