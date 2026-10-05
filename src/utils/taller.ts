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

// ---------------------------------------------------------------------
// Abrir una orden (Jarvis: «entró un A12 de Laura, no carga»). Igual que
// el formulario del tablero: estado Pendiente, bitácora y bitácora
// general. Sin correo ni teléfono (no se piden por voz): se completan en
// el tablero si hacen falta, y por eso no se crea ficha de cliente.
// ---------------------------------------------------------------------
export type OrdenNueva = { cliente: string; equipo: string; falla: string; categoria: string; garantia: number; mano: number };

export function abrirOrden(n: OrdenNueva, quien: string): RepairOrder {
  const db = getDB();
  const usados = new Set(db.repair_orders.map(r => r.ticket));
  let numero = 0;
  do { numero = Math.floor(100 + Math.random() * 900); } while (usados.has(`TKT-${numero}`) && usados.size < 900);
  const [marca, ...resto] = n.equipo.trim().split(/\s+/);
  const ahora = new Date().toISOString();
  const orden: RepairOrder = {
    id: `GT-${numero}`,
    ticket: `TKT-${numero}`,
    customerId: `CUST-${Math.floor(1000 + Math.random() * 9000)}`,
    customerName: n.cliente.trim(),
    customerEmail: '',
    device: `${n.equipo.trim()} (${n.categoria})`,
    deviceCategory: n.categoria,
    deviceBrand: marca,
    deviceModel: resto.join(' ') || marca,
    damageReported: n.falla.trim(),
    repuestos: [],
    laborCost: Math.max(0, Math.round(n.mano || 0)),
    totalCost: Math.max(0, Math.round(n.mano || 0)),
    status: 'Pendiente',
    warrantyMonths: Math.max(3, Math.round(n.garantia || 3)),
    bitacora: [{ status: 'Pendiente', notes: 'Orden abierta por Jarvis. Equipo recibido para diagnóstico.', timestamp: ahora, user: quien }],
    createdAt: ahora,
    repairLocation: 'Taller en casa',
  };
  db.repair_orders.push(orden);
  void saveDB(db);
  addAuditLog(quien, 'Taller', 'Crear Orden', `Orden ${orden.id} (${orden.ticket}) abierta por Jarvis para ${orden.customerName}: ${orden.device}.`);
  return orden;
}
