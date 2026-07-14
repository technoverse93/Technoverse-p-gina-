import { db } from '../firebase';
import { runTransaction, doc, collection } from 'firebase/firestore';
import { getDB } from './storage';

const SPARE_PART_CATEGORIES = ['LCD', 'Batería', 'Rack de Carga', 'Tapa', 'Desbloqueo', 'Flex', 'Conector', 'Otra'];

export async function processSaleAtomic(cart: any[], newOrder: any) {
  try {
    await runTransaction(db, async (transaction) => {
      const productDocs: any = {};
      for (const item of cart) {
        const isSpare = SPARE_PART_CATEGORIES.includes(item.product.category) || item.product.category === 'Repuestos';
        const colName = isSpare ? 'repuestos' : 'productos';
        const pRef = doc(db, colName, item.product.id);
        const pDoc = await transaction.get(pRef);
        if (!pDoc.exists()) {
          throw new Error(`El producto ${item.product.name} no existe en la base de datos.`);
        }
        productDocs[item.product.id] = { ref: pRef, data: pDoc.data() };

        if (item.product.linkedSparePartSku) {
           const sRef = doc(db, 'repuestos', item.product.linkedSparePartSku);
           const sDoc = await transaction.get(sRef);
           if (sDoc.exists()) {
             productDocs['spare_' + item.product.id] = { ref: sRef, data: sDoc.data() };
           }
        }
      }

      for (const item of cart) {
        const currentStock = productDocs[item.product.id].data.stock || 0;
        if (item.quantity > currentStock) {
          throw new Error(`Concurrencia: El stock del producto ${item.product.name} fue modificado por otro proceso. Solo quedan ${currentStock} disponibles.`);
        }
      }

      for (const item of cart) {
        const currentStock = productDocs[item.product.id].data.stock || 0;
        transaction.update(productDocs[item.product.id].ref, { stock: currentStock - item.quantity });

        if (productDocs['spare_' + item.product.id]) {
           const spareStock = productDocs['spare_' + item.product.id].data.stock || 0;
           transaction.update(productDocs['spare_' + item.product.id].ref, { stock: spareStock - item.quantity });
        }
      }

      const orderRef = doc(collection(db, 'ordenesVenta'));
      transaction.set(orderRef, {
        clienteId: newOrder.customerId || '',
        items: cart.map((i: any) => ({ productId: i.product.id, cantidad: i.quantity, precioUnitario: i.product.price })),
        total: newOrder.total,
        estado: 'Pagado',
        factura: { numero: newOrder.id, xml: '', estadoHacienda: 'Aceptado' },
        fechaCreacion: new Date().toISOString()
      });
    });

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
    await runTransaction(db, async (transaction) => {
      const productDocs: any = {};

      for (const rep of repuestosSelected) {
        const pRef = doc(db, 'repuestos', rep.productId);
        const pDoc = await transaction.get(pRef);

        if (pDoc.exists()) {
           productDocs[rep.productId] = { ref: pRef, data: pDoc.data() };
        } else {
           const pRef2 = doc(db, 'productos', rep.productId);
           const pDoc2 = await transaction.get(pRef2);
           if (pDoc2.exists()) {
              productDocs[rep.productId] = { ref: pRef2, data: pDoc2.data() };
           }
        }
      }

      for (const rep of repuestosSelected) {
        if (!productDocs[rep.productId]) continue;
        const previouslyConsumed = (originalRepair.repuestos || []).find((pr: any) => pr.productId === rep.productId)?.quantity || 0;
        const netDeduction = rep.quantity - previouslyConsumed;

        const currentStock = productDocs[rep.productId].data.stock || 0;
        if (netDeduction > 0 && netDeduction > currentStock) {
          throw new Error(`Concurrencia: El stock del repuesto ${rep.productName} fue modificado por otro proceso. Solo quedan ${currentStock} disponibles.`);
        }
      }

      for (const rep of repuestosSelected) {
        if (!productDocs[rep.productId]) continue;
        const previouslyConsumed = (originalRepair.repuestos || []).find((pr: any) => pr.productId === rep.productId)?.quantity || 0;
        const netDeduction = rep.quantity - previouslyConsumed;

        if (netDeduction !== 0) {
          const currentStock = productDocs[rep.productId].data.stock || 0;
          transaction.update(productDocs[rep.productId].ref, { stock: currentStock - netDeduction });
        }
      }

      const orderRef = doc(db, 'ordenesReparacion', originalRepair.id);
      transaction.set(orderRef, newRepairData, { merge: true });
    });

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
