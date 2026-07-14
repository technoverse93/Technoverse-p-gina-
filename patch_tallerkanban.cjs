const fs = require('fs');
let code = fs.readFileSync('src/components/TallerKanban.tsx', 'utf-8');

code = code.replace(
  "import { getDB, saveDB, addAuditLog } from '../utils/storage';",
  "import { getDB, saveDB, addAuditLog } from '../utils/storage';\nimport { processRepairAtomic } from '../utils/transactions';"
);

const targetStart = "    // Apply stock changes";
const targetEnd = "loadTallerData();";
const regex = new RegExp(targetStart + "[\\\\s\\\\S]*?" + targetEnd);

const replacement = `
    const sparePartsTotal = repuestosSelected.reduce((sum, r) => sum + (r.price * r.quantity), 0);
    const totalRepairCost = finalLaborCost + sparePartsTotal;

    const newRepairData = {
      ...originalRepair,
      diagnosisManual: diagnosis,
      laborCost: finalLaborCost,
      repuestos: repuestosSelected,
      totalCost: totalRepairCost,
      bitacora: [
        ...originalRepair.bitacora,
        {
          status: originalRepair.status,
          notes: \`Diagnóstico y cotización actualizados. Mano de Obra: ₡\${finalLaborCost}. Repuestos: ₡\${sparePartsTotal}. Total: ₡\${totalRepairCost}\`,
          timestamp: new Date().toISOString(),
          user: activeUserEmail
        }
      ]
    };

    const result = await processRepairAtomic(originalRepair, repuestosSelected, activeUserEmail || 'admin', finalLaborCost, diagnosis, newRepairData);
    
    if (!result.success) {
      alert(result.error);
      return;
    }

    addAuditLog(activeUserEmail || 'admin', 'Taller', 'Actualizar Diagnóstico', \`Diagnóstico de ticket \${selectedRepair.ticket} guardado.\`);
    
    // UI Update immediately for snappy feel
    const repIdx = db.repair_orders.findIndex(r => r.id === selectedRepair.id);
    if (repIdx !== -1) {
       db.repair_orders[repIdx] = newRepairData;
       // Note: we don't call saveDB(db) here because processRepairAtomic already saved it in Firestore.
       // The onSnapshot will eventually catch up and reload it.
    }
    
    loadTallerData();
`;

code = code.replace(regex, replacement);

fs.writeFileSync('src/components/TallerKanban.tsx', code);
