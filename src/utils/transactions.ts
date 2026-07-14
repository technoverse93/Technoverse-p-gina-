import { db } from '../firebase';
import { runTransaction, doc, collection, addDoc, getDoc } from 'firebase/firestore';
import { getDB, addAuditLog, saveDB } from './storage';

export async function processSaleAtomic(cart: any[], newOrder: any) {
  try {
    await runTransaction(db, async (transaction) => {
      // 1. Leer el stock actual desde Supabase.
      const productDocs: any = {};
      for (const item of cart) {
        const pRef = doc(db, 'productos', item.product.sku || item.product.id);
        const pDoc = await transaction.get(pRef);
        if (!pDoc.exists()) {
          throw new Error(`El producto ${item.product.name} no existe en la base de datos.`);
        }
        productDocs[item.product.id] = { ref: pRef, data: pDoc.data() };
        
        // Also check linked spare parts if any
        if (item.product.linkedSparePartSku) {
           const sRef = doc(db, 'repuestos', item.product.linkedSparePartSku);
           const sDoc = await transaction.get(sRef);
           if (sDoc.exists()) {
             productDocs['spare_' + item.product.id] = { ref: sRef, data: sDoc.data() };
           }
        }
      }

      // 2. Verificar que la cantidad solicitada no supere el stock disponible.
      for (const item of cart) {
        const currentStock = productDocs[item.product.id].data.stock || 0;
        if (item.quantity > currentStock) {
          throw new Error(`Concurrencia: El stock del producto ${item.product.name} fue modificado por otro proceso. Solo quedan ${currentStock} disponibles.`);
        }
      }

      // 3. Actualizar el stock con la nueva cantidad.
      for (const item of cart) {
        const currentStock = productDocs[item.product.id].data.stock || 0;
        transaction.update(productDocs[item.product.id].ref, { stock: currentStock - item.quantity });
        
        if (productDocs['spare_' + item.product.id]) {
           const spareStock = productDocs['spare_' + item.product.id].data.stock || 0;
           transaction.update(productDocs['spare_' + item.product.id].ref, { stock: spareStock - item.quantity });
        }
      }

      // Add order
      const orderRef = doc(collection(db, 'ordenesVenta'));
      transaction.set(orderRef, {
        clienteId: newOrder.customerId || '',
        items: cart.map(i => ({ productId: i.product.sku || i.product.id, cantidad: i.quantity, precioUnitario: i.product.price })),
        total: newOrder.total,
        estado: 'Pagado',
        factura: { numero: newOrder.id, xml: '', estadoHacienda: 'Aceptado' },
        fechaCreacion: new Date().toISOString()
      });
    });
    
    // Update local cache explicitly for the order since we just added it, or wait for snapshot
    const currentDb = getDB();
    if (!currentDb.orders) currentDb.orders = [];
    currentDb.orders.push(newOrder);
    // Don't call saveDB for products, they will sync via snapshot!
    // But we need to update the client in localCache and saveDB since we haven't migrated clients to Supabase table in the schema?
    // Wait, the schema says: productos, repuestos, ordenes_reparacion, ordenes_venta, usuarios, configuracion, movimientos_inventario, historical_skus.
    // Notice "clientes" is NOT in the Supabase schema! So clients stay in the old array/Firestore document or we map them to "usuarios".
    
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function processRepairAtomic(originalRepair: any, repuestosSelected: any[], activeUserEmail: string, finalLaborCost: number, diagnosis: string, newRepairData: any) {
  try {
    await runTransaction(db, async (transaction) => {
      const productDocs: any = {};
      
      // 1. Fetch current stock
      for (const rep of repuestosSelected) {
        const pRef = doc(db, 'repuestos', rep.productId);
        const pDoc = await transaction.get(pRef);
        
        if (pDoc.exists()) {
           productDocs[rep.productId] = { ref: pRef, data: pDoc.data() };
        } else {
           // Might be in products if it doesn't exist in repuestos
           const pRef2 = doc(db, 'productos', rep.productId);
           const pDoc2 = await transaction.get(pRef2);
           if (pDoc2.exists()) {
              productDocs[rep.productId] = { ref: pRef2, data: pDoc2.data() };
           }
        }
      }

      // 2. Validate stock for net deduction
      for (const rep of repuestosSelected) {
        if (!productDocs[rep.productId]) continue;
        const previouslyConsumed = (originalRepair.repuestos || []).find((pr: any) => pr.productId === rep.productId)?.quantity || 0;
        const netDeduction = rep.quantity - previouslyConsumed;
        
        const currentStock = productDocs[rep.productId].data.stock || 0;
        if (netDeduction > 0 && netDeduction > currentStock) {
          throw new Error(`Concurrencia: El stock del repuesto ${rep.productName} fue modificado por otro proceso. Solo quedan ${currentStock} disponibles.`);
        }
      }

      // 3. Update stock
      for (const rep of repuestosSelected) {
        if (!productDocs[rep.productId]) continue;
        const previouslyConsumed = (originalRepair.repuestos || []).find((pr: any) => pr.productId === rep.productId)?.quantity || 0;
        const netDeduction = rep.quantity - previouslyConsumed;
        
        if (netDeduction !== 0) {
          const currentStock = productDocs[rep.productId].data.stock || 0;
          transaction.update(productDocs[rep.productId].ref, { stock: currentStock - netDeduction });
        }
      }

      // 4. Update the repair order itself
      const orderRef = doc(db, 'ordenesReparacion', originalRepair.id);
      transaction.set(orderRef, newRepairData, { merge: true });
    });

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
