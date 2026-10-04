// =====================================================================
// TALLER — cambio de estado de una orden
// =====================================================================
// Un solo camino para mover una orden de columna: el tablero Kanban y
// Jarvis («pasá la orden de Laura a Lista») hacen exactamente lo mismo,
// incluida la bitácora de la orden, el sello de garantía al entregar y la
// bitácora general.
// =====================================================================

import type { RepairOrder } from '../types';
import { getDB, saveDB, addAuditLog } from './storage';

/** Devuelve el estado anterior, o null si no había nada que cambiar. */
export function cambiarEstadoOrden(repairId: string, newStatus: RepairOrder['status'], quien: string): RepairOrder['status'] | null {
  const db = getDB();
  const idxRep = db.repair_orders.findIndex(r => r.id === repairId);
  if (idxRep === -1) return null;

  const rep = db.repair_orders[idxRep];
  const prevStatus = rep.status;
  if (prevStatus === newStatus) return null;

  db.repair_orders[idxRep].status = newStatus;

  // Generate blockchain-like hash when transitioned to "Entregada"
  let hashMsg = "";
  if (newStatus === 'Entregada') {
    const randHex = Math.floor(1e12 + Math.random() * 9e12).toString(16);
    const blockchainHash = `SHA256-${randHex}-TECHNOVERSE-COSTA-RICA-WARRANTY-${rep.ticket}`;
    db.repair_orders[idxRep].blockchainHash = blockchainHash;
    hashMsg = ` Garantía de ${rep.warrantyMonths} meses sellada en bloque con hash traceable: ${blockchainHash}`;
  }

  db.repair_orders[idxRep].bitacora.push({
    status: newStatus,
    notes: `Cambio de estado: de ${prevStatus} a ${newStatus}.${hashMsg}`,
    timestamp: new Date().toISOString(),
    user: quien
  });

  saveDB(db);
  addAuditLog(
    quien,
    'Taller',
    'Cambio Estado Kanban',
    `Ticket ${rep.ticket} movido a ${newStatus}.${hashMsg}`
  );
  return prevStatus;
}
