import React, { useState, useEffect } from 'react';
import { Kanban, Search, Plus, Save, Clock, HelpCircle, FileText, CheckCircle2, ChevronRight, RefreshCw, Key } from 'lucide-react';
import { RepairOrder, Product, ClientProfile } from '../types';
import { getDB, saveDB, addAuditLog } from '../utils/storage';
import { processRepairAtomic } from '../utils/transactions';

interface TallerKanbanProps {
  activeUserEmail?: string;
  onRepairUpdated?: () => void;
}

const KANBAN_COLUMNS: RepairOrder['status'][] = [
  'Pendiente', 'Diagnosticada', 'Cotizada', 'Aprobada', 'Esperando repuestos', 'En Reparación', 'Lista', 'Entregada', 'Cancelada'
];

const sparePartCategories = ['LCD', 'Batería', 'Rack de Carga', 'Tapa', 'Desbloqueo', 'Flex', 'Conector', 'Otra'];

export default function TallerKanban({ activeUserEmail = 'tecnico@technoverse.com', onRepairUpdated }: TallerKanbanProps) {
  const [repairs, setRepairs] = useState<RepairOrder[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [clients, setClients] = useState<ClientProfile[]>([]);
  const [selectedRepair, setSelectedRepair] = useState<RepairOrder | null>(null);
  useEffect(() => {
    if (selectedRepair) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "auto";
    }
    return () => { document.body.style.overflow = "auto"; };
  }, [selectedRepair]);

  // New repair form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerEmail, setNewCustomerEmail] = useState('');
  const [newDevice, setNewDevice] = useState('');
  const [newDamageReported, setNewDamageReported] = useState('');
  const [newWarrantyMonths, setNewWarrantyMonths] = useState<number | ''>(''); // Minimum is 3 by Costa Rican law
  const [newRepairLocation, setNewRepairLocation] = useState('Taller en casa');
  const [newNeededTools, setNewNeededTools] = useState('');

  // Edit / Diagnosis State
  const [diagnosis, setDiagnosis] = useState('');
  const [laborCost, setLaborCost] = useState<number | ''>('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedProductQty, setSelectedProductQty] = useState<number | ''>('');
  const [repuestosSelected, setRepuestosSelected] = useState<{ productId: string; productName: string; quantity: number; price: number }[]>([]);

  // Public Inquiry States
  const [searchTicket, setSearchTicket] = useState('');
  const [searchEmail, setSearchEmail] = useState('');
  const [publicSearchResult, setPublicSearchResult] = useState<RepairOrder | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [draggedRepairId, setDraggedRepairId] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedRepairId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault(); // Necessary to allow dropping
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, newStatus: RepairOrder['status']) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (id && newStatus) {
      handleUpdateStatus(id, newStatus);
    }
    setDraggedRepairId(null);
  };


  useEffect(() => {
    loadTallerData();
    const handleUpdate = () => loadTallerData();
    window.addEventListener('technoverse_db_updated', handleUpdate);
    return () => window.removeEventListener('technoverse_db_updated', handleUpdate);
  }, []);

  const loadTallerData = () => {
    const db = getDB();
    setRepairs(db.repair_orders || []);
    setProducts(db.products || []);
    setClients(db.clients || []);
  };

  const handleCreateRepair = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustomerName.trim() || !newCustomerEmail.trim() || !newDevice.trim() || !newDamageReported.trim()) {
      alert('Por favor complete todos los datos requeridos.');
      return;
    }

    if (newWarrantyMonths === '' || newWarrantyMonths < 3) {
      alert('La legislación de Costa Rica (Ley 7472) exige una garantía mínima de 3 meses para servicios de reparación.');
      return;
    }

    const db = getDB();
    
    // Generate order and ticket ID
    const number = Math.floor(100 + Math.random() * 900);
    const repairId = `GT-${number}`;
    const ticketId = `TKT-${number}`;

    const newRepair: RepairOrder = {
      id: repairId,
      ticket: ticketId,
      customerId: `CUST-${Math.floor(1000 + Math.random() * 9000)}`,
      customerName: newCustomerName.trim(),
      customerEmail: newCustomerEmail.trim().toLowerCase(),
      device: newDevice.trim(),
      damageReported: newDamageReported.trim(),
      repuestos: [],
      laborCost: 0,
      totalCost: 0,
      status: 'Pendiente',
      warrantyMonths: Number(newWarrantyMonths),
      bitacora: [
        {
          status: 'Pendiente',
          notes: `Orden de reparación abierta. Equipo recibido para diagnóstico en "${newRepairLocation}".`,
          timestamp: new Date().toISOString(),
          user: activeUserEmail
        }
      ],
      createdAt: new Date().toISOString(),
      repairLocation: newRepairLocation,
      neededTools: newNeededTools
    };

    // Ensure client exists in CRM
    let client = db.clients.find(c => c.email === newCustomerEmail.trim().toLowerCase());
    if (!client) {
      const newClient: ClientProfile = {
        id: newRepair.customerId,
        name: newCustomerName.trim(),
        email: newCustomerEmail.trim().toLowerCase(),
        phone: '+506 8000 0000',
        province: 'San José',
        addressDetail: 'Dirección a reportar',
        cardsTokenized: [],
        balance: 0,
        notes: 'Cliente registrado automáticamente al abrir orden de servicio.'
      };
      db.clients.push(newClient);
    }

    db.repair_orders.push(newRepair);
    saveDB(db);

    addAuditLog(activeUserEmail, 'Taller', 'Crear Orden', `Orden de reparación ${repairId} (${ticketId}) creada para ${newCustomerName} en el espacio de trabajo: "${newRepairLocation}"`);

    // Clean form
    setNewCustomerName('');
    setNewCustomerEmail('');
    setNewDevice('');
    setNewDamageReported('');
    setNewWarrantyMonths(3);
    setNewRepairLocation('Taller en casa');
    setNewNeededTools('');
    setShowAddForm(false);
    loadTallerData();
    if (onRepairUpdated) onRepairUpdated();
  };

  const handleSelectRepairForEdit = (rep: RepairOrder) => {
    setSelectedRepair(rep);
    setDiagnosis(rep.diagnosisManual || '');
    setLaborCost(rep.laborCost || 0);
    setRepuestosSelected(rep.repuestos || []);
  };

  const handleAddRepuesto = () => {
    if (!selectedProductId || selectedProductQty === '' || selectedProductQty <= 0) return;
    const prod = products.find(p => p.id === selectedProductId);
    if (!prod) return;

    const availableStock = prod.stock;
    const qtyToAdd = Number(selectedProductQty);

    if (availableStock < qtyToAdd) {
      alert(`⚠️ STOCK INSUFICIENTE EN CASA: El repuesto "${prod.name}" no cuenta con las ${qtyToAdd} unidades requeridas (Stock actual en casa: ${availableStock} un.). El ticket de reparación cambiará automáticamente al estado "Esperando repuestos".`);
      
      if (selectedRepair) {
        const db = getDB();
        const idxRep = db.repair_orders.findIndex(r => r.id === selectedRepair.id);
        if (idxRep !== -1) {
          db.repair_orders[repIdx].status = 'Esperando repuestos';
          db.repair_orders[repIdx].bitacora.push({
            status: 'Esperando repuestos',
            notes: `Falta de repuesto: "${prod.name}" (se requerían ${qtyToAdd} un. pero solo hay ${prod.stock} en almacenamiento en casa).`,
            timestamp: new Date().toISOString(),
            user: activeUserEmail
          });
          saveDB(db);
          addAuditLog(activeUserEmail, 'Taller', 'Falta Repuesto', `Orden ${selectedRepair.id} pasó a "Esperando repuestos" por desabastecimiento de "${prod.name}"`);
          loadTallerData();
          if (onRepairUpdated) onRepairUpdated();
          setSelectedRepair(db.repair_orders[repIdx]);
        }
      }
      return;
    }

    // Add to local selection
    const exists = repuestosSelected.find(r => r.productId === selectedProductId);
    if (exists) {
      setRepuestosSelected(
        repuestosSelected.map(r => r.productId === selectedProductId 
          ? { ...r, quantity: r.quantity + qtyToAdd } 
          : r
        )
      );
    } else {
      setRepuestosSelected([
        ...repuestosSelected,
        {
          productId: prod.id,
          productName: prod.name,
          quantity: qtyToAdd,
          price: prod.price
        }
      ]);
    }

    setSelectedProductId('');
    setSelectedProductQty(1);
  };

  const handleRemoveRepuesto = (idx: number) => {
    setRepuestosSelected(repuestosSelected.filter((_, i) => i !== idx));
  };

  const handleSaveDiagnosisAndCost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRepair) return;
    if (laborCost === '') {
      alert('Por favor ingrese el costo de mano de obra.');
      return;
    }

    const db = getDB();
    const idxRep = db.repair_orders.findIndex(r => r.id === selectedRepair.id);
    if (repIdx === -1) return;

    const originalRepair = db.repair_orders[repIdx];
    const finalLaborCost = Number(laborCost);
    
    // We need to compare repuestos selection and handle physical inventory deductions
    // Deduct stock for new parts added
    const partsMap = new Map<string, number>();
    repuestosSelected.forEach(p => {
      partsMap.set(p.productId, p.quantity);
    });

    // Check if parts stock can hold the transaction
    let stockValid = true;
    repuestosSelected.forEach(rep => {
      const productInDb = db.products.find(p => p.id === rep.productId);
      if (productInDb) {
        // Look up previous consumed parts for this specific repair
        const previouslyConsumed = originalRepair.repuestos.find(pr => pr.productId === rep.productId)?.quantity || 0;
        const additionalNeeded = rep.quantity - previouslyConsumed;
        
        const availableStock = productInDb.stock;

        if (additionalNeeded > 0 && availableStock < additionalNeeded) {
          alert(`Stock insuficiente para repuesto: ${productInDb.name}. Necesario: ${additionalNeeded}, disponible: ${availableStock}`);
          stockValid = false;
        }
      }
    });

    if (!stockValid) return;


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
          notes: `Diagnóstico y cotización actualizados. Mano de Obra: ₡${finalLaborCost}. Repuestos: ₡${sparePartsTotal}. Total: ₡${totalRepairCost}`,
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

    addAuditLog(activeUserEmail || 'admin', 'Taller', 'Actualizar Diagnóstico', `Diagnóstico de ticket ${selectedRepair.ticket} guardado.`);
    
    // UI Update immediately for snappy feel
    if (idxRep !== -1) {
       db.repair_orders[idxRep] = newRepairData;
    }
    
    loadTallerData();

    setSelectedRepair(null);
    if (onRepairUpdated) onRepairUpdated();
    alert('Diagnóstico y presupuesto de reparación actualizados correctamente.');
  };

  const handleUpdateStatus = (repairId: string, newStatus: RepairOrder['status']) => {
    const db = getDB();
    const idxRep = db.repair_orders.findIndex(r => r.id === repairId);
    if (repIdx === -1) return;

    const rep = db.repair_orders[repIdx];
    const prevStatus = rep.status;
    if (prevStatus === newStatus) return;

    db.repair_orders[repIdx].status = newStatus;

    // Generate blockchain-like hash when transitioned to "Entregada"
    let hashMsg = "";
    if (newStatus === 'Entregada') {
      const randHex = Math.floor(1e12 + Math.random() * 9e12).toString(16);
      const blockchainHash = `SHA256-${randHex}-TECHNOVERSE-COSTA-RICA-WARRANTY-${rep.ticket}`;
      db.repair_orders[repIdx].blockchainHash = blockchainHash;
      hashMsg = ` Garantía de ${rep.warrantyMonths} meses sellada en bloque con hash traceable: ${blockchainHash}`;
    }

    db.repair_orders[repIdx].bitacora.push({
      status: newStatus,
      notes: `Cambio de estado: de ${prevStatus} a ${newStatus}.${hashMsg}`,
      timestamp: new Date().toISOString(),
      user: activeUserEmail
    });

    saveDB(db);
    addAuditLog(
      activeUserEmail, 
      'Taller', 
      'Cambio Estado Kanban', 
      `Ticket ${rep.ticket} movido a ${newStatus}.${hashMsg}`
    );

    loadTallerData();
    if (onRepairUpdated) onRepairUpdated();
  };

  // Public Search Inquiry
  const handlePublicLookup = (e: React.FormEvent) => {
    e.preventDefault();
    setHasSearched(true);
    if (!searchTicket.trim() && !searchEmail.trim()) {
      setPublicSearchResult(null);
      return;
    }

    const matched = repairs.find(r => 
      (searchTicket && r.ticket.toLowerCase() === searchTicket.trim().toLowerCase()) ||
      (searchEmail && r.customerEmail.toLowerCase() === searchEmail.trim().toLowerCase())
    );

    setPublicSearchResult(matched || null);
  };

  return (
    <div className="space-y-6" id="taller-kanban-module">
      
      {/* Upper bar with public search and open ticket option */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* PUBLIC LOOKUP PORTAL */}
        <div className="lg:col-span-2 bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-2xl p-5 text-[var(--text-primary)]">
          <div className="flex items-center gap-2 mb-3">
            <Search className="w-5 h-5 text-emerald-400 dark:text-[var(--brand-gold-light)]" />
            <div>
              <h3 className="font-bold text-sm">Portal Público de Consulta de Reparación</h3>
              <p className="text-[10px] text-[var(--text-secondary)]">Verifica el estado real de tu dispositivo y su garantía de forma abierta.</p>
            </div>
          </div>

          <form onSubmit={handlePublicLookup} className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input
              type="text"
              value={searchTicket}
              onChange={(e) => setSearchTicket(e.target.value)}
              placeholder="Número de Ticket (ej: TKT-123)"
              className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-4 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-emerald-500 dark:focus:border-[var(--brand-gold-mid)] font-mono"
            />
            <input
              type="email"
              value={searchEmail}
              onChange={(e) => setSearchEmail(e.target.value)}
              placeholder="Correo electrónico registrado"
              className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-4 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-emerald-500 dark:focus:border-[var(--brand-gold-mid)]"
            />
            <button
              type="submit"
              className="bg-emerald-500 hover:bg-emerald-600 dark:bg-[var(--brand-gold-mid)] dark:hover:bg-[var(--brand-gold-dark)] text-white font-bold text-xs rounded-xl py-2 shadow-sm transition dark:text-slate-950"
            >
              Consultar Estado En Vivo
            </button>
          </form>

          {/* Inquiry results */}
          {hasSearched && (
            <div className="mt-4 bg-[var(--bg-surface)] rounded-xl p-4 border border-[var(--border-color)]/50 space-y-3 animate-in fade-in">
              {publicSearchResult ? (
                <div>
                  <div className="flex flex-wrap justify-between items-center pb-2 border-b border-[var(--border-color)]/50">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-[var(--text-secondary)] font-mono">Ticket de Servicio</span>
                      <h4 className="text-sm font-bold text-emerald-400 dark:text-[var(--brand-gold-light)] font-mono">{publicSearchResult.ticket} / {publicSearchResult.id}</h4>
                    </div>
                    <span className="bg-sky-50 border border-sky-200 dark:border-[var(--brand-gold-dark)] text-sky-600 dark:text-[var(--brand-gold-light)] font-bold text-xs px-3 py-1 rounded-full uppercase">
                      {publicSearchResult.status}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-3 text-xs leading-relaxed">
                    <div>
                      <div>Cliente: <strong className="text-[var(--text-primary)]">{publicSearchResult.customerName}</strong></div>
                      <div>Equipo: <strong className="text-[var(--text-primary)]">{publicSearchResult.device}</strong></div>
                      <div>Daño Reportado: <span className="text-[var(--text-secondary)] italic">"{publicSearchResult.damageReported}"</span></div>
                    </div>
                    <div>
                      <div>Diagnóstico Técnico: <span className="text-[var(--text-secondary)]">{publicSearchResult.diagnosisManual || 'Pendiente de revisión técnica.'}</span></div>
                      <div>Costo Estimado: <strong className="text-emerald-400 dark:text-[var(--brand-gold-light)] font-mono">₡{publicSearchResult.totalCost.toLocaleString()}</strong></div>
                      <div>Garantía Oficial: <strong className="text-[var(--text-primary)]">{publicSearchResult.warrantyMonths} meses</strong></div>
                    </div>
                  </div>

                  {/* Cryptographic hash */}
                  {publicSearchResult.blockchainHash && (
                    <div className="mt-3 bg-indigo-950/40 dark:bg-[var(--brand-gold-mid)]/10 border border-indigo-500/30 dark:border-[var(--brand-gold-dark)] p-2.5 rounded-lg flex items-start gap-2">
                      <Key className="w-4 h-4 text-indigo-400 flex-shrink-0 mt-0.5 dark:text-[var(--brand-gold-light)]" />
                      <div className="font-mono text-[9px]">
                        <span className="text-indigo-300 font-bold uppercase block dark:text-[var(--brand-gold-light)]">Garantía Blockchain Trazable:</span>
                        <span className="text-[var(--text-secondary)] break-all">{publicSearchResult.blockchainHash}</span>
                      </div>
                    </div>
                  )}

                  {/* Status Timeline */}
                  <div className="mt-4 pt-3 border-t border-[var(--border-color)]/50">
                    <span className="text-[10px] font-bold text-[var(--text-secondary)] uppercase block mb-2 flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" /> Bitácora Técnica de Eventos
                    </span>
                    <div className="space-y-2 max-h-32 overflow-y-auto">
                      {publicSearchResult.bitacora.map((evt, i) => (
                        <div key={i} className="flex gap-2 text-[10px] text-[var(--text-secondary)] border-l border-emerald-500 dark:border-[var(--brand-gold-mid)]/30 pl-3 ml-1 relative">
                          <span className="absolute -left-1 top-1.5 w-2 h-2 rounded-full bg-emerald-500 dark:bg-[var(--brand-gold-mid)]" />
                          <div>
                            <span className="font-bold text-[var(--text-primary)]">{evt.status}</span>
                            <span className="text-[8px] ml-1.5 text-[var(--text-secondary)]">{new Date(evt.timestamp).toLocaleString()}</span>
                            <p className="text-[var(--text-secondary)] italic">"{evt.notes}"</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-4 text-xs text-rose-400 italic">
                  No se encontró ningún ticket de reparación coincidente. Verifique la información ingresada.
                </div>
              )}
            </div>
          )}
        </div>

        {/* CREATE REPAIR ORDER (ADMIN ONLY TRIGGER) */}
        <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-2xl p-5 text-[var(--text-primary)] flex flex-col justify-between">
          <div>
            <h3 className="font-bold text-sm mb-1 flex items-center gap-1.5">
              <Kanban className="w-5 h-5 text-sky-400 dark:text-[var(--brand-gold-light)]" /> Servicio Técnico Interno
            </h3>
            <p className="text-[10px] text-[var(--text-secondary)] mb-4">Ingresa un nuevo dispositivo para diagnóstico e inicio del flujo de soporte legal.</p>
          </div>

          {!showAddForm ? (
            <button
              onClick={() => {
                setShowAddForm(true);
                loadTallerData(); // refresh product stocks
              }}
              className="w-full bg-sky-500 hover:bg-sky-600 dark:bg-[var(--brand-gold-mid)] dark:hover:bg-[var(--brand-gold-dark)] text-white font-bold text-xs py-3 rounded-xl flex items-center justify-center gap-2 transition shadow-sm dark:text-slate-950"
            >
              <Plus className="w-4 h-4" /> Registrar Nueva Orden Técnica
            </button>
          ) : (
            <button
              onClick={() => setShowAddForm(false)}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 text-[var(--text-secondary)] hover:text-white text-xs font-bold py-2.5 rounded-xl transition"
            >
              Cancelar Registro
            </button>
          )}
        </div>
      </div>

      {/* NEW ORDER FORM DROPDOWN */}
      {showAddForm && (
        <form onSubmit={handleCreateRepair} className="bg-[var(--bg-surface)] /90 border border-[var(--border-color)]/80 rounded-2xl p-6 space-y-4 text-[var(--text-primary)] animate-in slide-in-from-top-4 duration-200">
          <h4 className="text-xs font-bold uppercase tracking-wider text-sky-400 dark:text-[var(--brand-gold-light)] pb-2 border-b border-[var(--border-color)]/50">Nueva Orden de Reparación de Hardware</h4>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">Nombre Completo del Cliente</label>
              <input
                type="text"
                required
                value={newCustomerName}
                onChange={(e) => setNewCustomerName(e.target.value)}
                placeholder="Ej. María Chinchilla Solano"
                className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-4 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-sky-500 dark:focus:border-[var(--brand-gold-mid)]"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">Correo Electrónico (Para Alertas)</label>
              <input
                type="email"
                required
                value={newCustomerEmail}
                onChange={(e) => setNewCustomerEmail(e.target.value)}
                placeholder="maria@correo.cr"
                className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-4 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-sky-500 dark:focus:border-[var(--brand-gold-mid)]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">Dispositivo (Marca, Modelo, Color)</label>
              <input
                type="text"
                required
                value={newDevice}
                onChange={(e) => setNewDevice(e.target.value)}
                placeholder="Ej. iPhone 14 Pro Max 256GB Grafito"
                className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-4 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-sky-500 dark:focus:border-[var(--brand-gold-mid)]"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">Garantía Ofrecida (Meses)</label>
              <input
                type="number"
                min="3"
                required
                placeholder="Meses de garantía"
                value={newWarrantyMonths}
                onChange={(e) => setNewWarrantyMonths(e.target.value === '' ? '' : Math.max(3, parseInt(e.target.value) || 3))}
                className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-4 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-sky-500 dark:focus:border-[var(--brand-gold-mid)] font-mono"
              />
              <span className="text-[8px] text-amber-400 block mt-1 leading-relaxed">
                *Min. de 3 meses de garantía obligatoria por Ley 7472.
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">Lugar de Reparación en Casa</label>
              <select
                value={newRepairLocation}
                onChange={(e) => setNewRepairLocation(e.target.value)}
                className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-4 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-sky-500 dark:focus:border-[var(--brand-gold-mid)]"
              >
                <option value="Taller en casa">Taller en casa (Escritorio principal)</option>
                <option value="Mesa del comedor">Mesa del comedor</option>
                <option value="Estudio de electrónica">Estudio de electrónica</option>
                <option value="Garaje / Banco de trabajo">Garaje / Banco de trabajo</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">Herramientas Requeridas</label>
              <input
                type="text"
                value={newNeededTools}
                onChange={(e) => setNewNeededTools(e.target.value)}
                placeholder="Ej. Kit iFixit, Soldador, Multímetro, Cinta Kapton"
                className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-4 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-sky-500 dark:focus:border-[var(--brand-gold-mid)]"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">Daño Reportado por el Cliente</label>
            <textarea
              required
              rows={2}
              value={newDamageReported}
              onChange={(e) => setNewDamageReported(e.target.value)}
              placeholder="Ej. El teléfono se cayó, la pantalla está rota y no enciende. Desea cotizar reemplazo."
              className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-4 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-sky-500 dark:focus:border-[var(--brand-gold-mid)] resize-none"
            />
          </div>

          <button
            type="submit"
            className="w-full bg-sky-500 hover:bg-sky-600 dark:bg-[var(--brand-gold-mid)] dark:hover:bg-[var(--brand-gold-dark)] text-white font-bold text-xs py-3 rounded-xl transition shadow-sm uppercase tracking-wider dark:text-slate-950"
          >
            Abrir Ticket de Soporte Técnico
          </button>
        </form>
      )}

      {/* ADMIN KANBAN COLUMNS BOARD */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-2xl p-5 text-[var(--text-primary)]">
        <h3 className="font-bold text-sm mb-4 text-sky-400 dark:text-[var(--brand-gold-light)] flex items-center gap-1.5">
          <Kanban className="w-5 h-5 text-sky-400 dark:text-[var(--brand-gold-light)]" /> Tablero Kanban de Órdenes de Servicio
        </h3>

        {/* Scrollable Columns wrapper */}
        <div className="flex gap-4 overflow-x-auto pb-4">
          {KANBAN_COLUMNS.map(col => {
            const colRepairs = repairs.filter(r => r.status === col);
            return (
              <div 
                key={col} 
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, col)}
                className="flex-shrink-0 w-72 bg-[var(--bg-surface)] /60 rounded-xl border border-[var(--border-color)]/50 p-3 flex flex-col h-[400px] transition-colors duration-200"
              >
                {/* Column Title Header */}
                <div className="flex justify-between items-center mb-3 pb-1.5 border-b border-[var(--border-color)]/50">
                  <span className="text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wide">{col}</span>
                  <span className="text-[10px] bg-slate-800 dark:bg-transparent border border-[var(--border-color)]/80 text-sky-400 dark:text-[var(--brand-gold-light)] px-2 py-0.5 rounded-full font-bold">
                    {colRepairs.length}
                  </span>
                </div>

                {/* Column cards container */}
                <div className="flex-1 overflow-y-auto space-y-2">
                  {colRepairs.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-[var(--text-secondary)] text-[10px] italic border border-dashed border-[var(--border-color)]/50 rounded-lg py-12">
                      Sin registros
                    </div>
                  ) : (
                    colRepairs.map(rep => (
                      <div
                        key={rep.id}
                        onClick={() => handleSelectRepairForEdit(rep)}
                        className="bg-[var(--bg-surface)] hover:bg-[var(--bg-surface)] border border-[var(--border-color)]/50 hover:border-sky-500 dark:hover:border-[var(--brand-gold-dark)] dark:border-[var(--brand-gold-mid)]/50 rounded-xl p-3 text-xs space-y-2 cursor-pointer transition duration-150 active:scale-98"
                        draggable
                        onDragStart={(e) => handleDragStart(e, rep.id)}
                        style={{ opacity: draggedRepairId === rep.id ? 0.5 : 1, cursor: 'grab' }}
                      >
                        <div className="flex justify-between font-mono text-[9px] text-[var(--text-secondary)]">
                          <span className="font-bold text-sky-400 dark:text-[var(--brand-gold-light)]">{rep.ticket}</span>
                          <span>{new Date(rep.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                        </div>
                        <div className="font-bold text-[var(--text-primary)] truncate">{rep.device}</div>
                        <div className="text-[var(--text-secondary)] text-[10px] truncate">Cliente: {rep.customerName}</div>
                        <div className="text-[9px] bg-sky-50 border border-sky-100 rounded px-1.5 py-0.5 text-sky-600 dark:text-[var(--brand-gold-light)] w-fit font-sans flex items-center gap-1 dark:border-[var(--brand-gold-dark)]">
                          <span>🏠</span> {rep.repairLocation || 'Taller en casa'}
                        </div>
                        <div className="text-[10px] text-emerald-400 dark:text-[var(--brand-gold-light)] font-mono font-bold">₡{rep.totalCost.toLocaleString()}</div>
                        
                        {/* Quick state switcher */}
                        <div className="flex justify-between items-center pt-1.5 border-t border-[var(--border-color)]/50">
                          <span className="text-[8px] text-[var(--text-secondary)]">Mover a:</span>
                          <select
                            value={rep.status}
                            onClick={(e) => e.stopPropagation()} // stop parent click
                            onChange={(e) => handleUpdateStatus(rep.id, e.target.value as RepairOrder['status'])}
                            className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded text-[9px] text-sky-600 dark:text-[var(--brand-gold-light)] px-1 py-0.5 focus:outline-none"
                          >
                            {KANBAN_COLUMNS.map(s => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* DIAGNOSTIC DETAILS MODAL */}
      {selectedRepair && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in" id="repair-detail-modal">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-2xl overflow-hidden shadow-sm w-full max-w-xl text-[var(--text-primary)] flex flex-col">
            
            {/* Header */}
            <div className="p-4 bg-[var(--bg-surface)] border-b border-[var(--border-color)]/80 flex justify-between items-center">
              <div>
                <h3 className="font-bold text-sm text-sky-400 dark:text-[var(--brand-gold-light)]">Administrar Orden de Reparación</h3>
                <p className="text-[10px] text-[var(--text-secondary)]">Ticket: <strong className="font-mono">{selectedRepair.ticket}</strong> | Cliente: <strong>{selectedRepair.customerName}</strong></p>
              </div>
              <button
                onClick={() => setSelectedRepair(null)}
                className="text-xs bg-[var(--bg-surface)] hover:bg-rose-600 px-2.5 py-1.5 rounded-lg transition"
              >
                Cerrar
              </button>
            </div>

            {/* Content Form */}
            <form onSubmit={handleSaveDiagnosisAndCost} className="p-5 space-y-4 flex-1 overflow-y-auto max-h-[450px]">
              <div className="bg-[var(--bg-surface)] p-3 rounded-xl border border-[var(--border-color)]/50 text-xs space-y-1">
                <div>Equipo: <strong className="text-[var(--text-primary)]">{selectedRepair.device}</strong></div>
                <div>Daño Reportado: <span className="text-[var(--text-secondary)] italic">"{selectedRepair.damageReported}"</span></div>
                <div>Lugar de Trabajo: <strong className="text-sky-600 dark:text-[var(--brand-gold-light)]">{selectedRepair.repairLocation || 'Taller en casa'}</strong></div>
                {selectedRepair.neededTools && (
                  <div>Herramientas: <span className="text-amber-400 font-medium">{selectedRepair.neededTools}</span></div>
                )}
                <div>Garantía legal configurada: <strong className="text-emerald-400 dark:text-[var(--brand-gold-light)]">{selectedRepair.warrantyMonths} meses</strong></div>
              </div>

              {/* Diagnosis Field */}
              <div>
                <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">Diagnóstico Técnico Detallado (Manual)</label>
                <textarea
                  required
                  rows={2}
                  value={diagnosis}
                  onChange={(e) => setDiagnosis(e.target.value)}
                  placeholder="Detalla el diagnóstico exacto de la falla identificada y los repuestos a instalar..."
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-sky-500 dark:focus:border-[var(--brand-gold-mid)] resize-none"
                />
              </div>

              {/* Labor Cost Field */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">Costo Mano de Obra (Colones)</label>
                  <input
                    type="number"
                    min="0"
                    required
                    placeholder="Ingrese el monto"
                    value={laborCost}
                    onChange={(e) => setLaborCost(e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-4 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-sky-500 dark:focus:border-[var(--brand-gold-mid)] font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">Total Cotización Actual</label>
                  <div className="bg-emerald-500 dark:bg-[var(--brand-gold-mid)]/10 border border-emerald-500 dark:border-[var(--brand-gold-mid)]/20 text-emerald-400 dark:text-[var(--brand-gold-light)] font-bold text-sm px-4 py-2 rounded-xl font-mono flex items-center justify-center">
                    ₡{(Number(laborCost || 0) + repuestosSelected.reduce((sum, r) => sum + (r.price * r.quantity), 0)).toLocaleString()}
                  </div>
                </div>
              </div>

              {/* SPARE PARTS SELECTOR FROM DOMESTIC STOCK */}
              <div className="border-t border-[var(--border-color)]/50 pt-3 space-y-3">
                <span className="text-[10px] uppercase font-bold text-[var(--text-secondary)] block">Repuestos Disponibles en Inventario Doméstico</span>
                
                <div className="flex gap-2">
                    <select
                      value={selectedProductId}
                      onChange={(e) => setSelectedProductId(e.target.value)}
                      className="flex-1 bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none"
                    >
                      <option value="">-- Seleccionar Repuesto en Casa --</option>
                      {products.filter(p => sparePartCategories.includes(p.category) && p.active !== false).map(p => (
                        <option key={p.id} value={p.id} disabled={p.stock <= 0}>
                          {p.name} (Stock: {p.stock} un. en "{p.physicalLocation || 'Sin ubicar'}" | ₡{p.price.toLocaleString()})
                        </option>
                      ))}
                    </select>
                  <input
                    type="number"
                    min="1"
                    placeholder="Cant."
                    value={selectedProductQty}
                    onChange={(e) => setSelectedProductQty(e.target.value === '' ? '' : Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-16 bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] text-center font-mono"
                  />
                  <button
                    type="button"
                    onClick={handleAddRepuesto}
                    className="bg-sky-500 hover:bg-sky-600 dark:bg-[var(--brand-gold-mid)] dark:hover:bg-[var(--brand-gold-dark)] transition px-4 text-xs font-bold rounded-xl"
                  >
                    Asignar
                  </button>
                </div>

                {/* List of allocated parts */}
                <div className="space-y-1.5">
                  <span className="text-[9px] uppercase font-bold text-[var(--text-secondary)] block">Repuestos Consumidos en esta Reparación:</span>
                  {repuestosSelected.length === 0 ? (
                    <div className="text-center py-2 text-[10px] italic text-[var(--text-secondary)]">Ningún repuesto de bodega asignado aún.</div>
                  ) : (
                    repuestosSelected.map((rep, idx) => (
                      <div key={idx} className="bg-[var(--bg-surface)] p-2.5 border border-[var(--border-color)]/50 rounded-xl flex items-center justify-between text-xs">
                        <div>
                          <strong className="text-[var(--text-primary)]">{rep.productName}</strong>
                          <span className="text-[9px] text-[var(--text-secondary)] font-mono ml-2">({rep.quantity} un. x ₡{rep.price.toLocaleString()})</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-emerald-400 dark:text-[var(--brand-gold-light)]">₡{(rep.price * rep.quantity).toLocaleString()}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveRepuesto(idx)}
                            className="text-[10px] text-rose-400 hover:text-rose-300 font-bold px-1"
                          >
                            Quitar
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Submit Buttons */}
              <button
                type="submit"
                className="w-full bg-emerald-500 hover:bg-emerald-600 dark:bg-[var(--brand-gold-mid)] dark:hover:bg-[var(--brand-gold-dark)] transition text-white font-bold text-xs py-3 rounded-xl mt-4 uppercase tracking-wider dark:text-slate-950"
              >
                Guardar Diagnóstico, Asignar Repuestos y Recalcular
              </button>
            </form>

          </div>
        </div>
      )}

    </div>
  );
}
