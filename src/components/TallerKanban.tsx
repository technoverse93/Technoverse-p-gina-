import React, { useState, useEffect } from 'react';
import { Kanban, Search, Plus, Save, Clock, HelpCircle, FileText, CheckCircle2, ChevronRight, RefreshCw, Key, MessageCircle, BookMarked, EyeOff, X, Receipt
} from 'lucide-react';
import { RepairOrder, Product, ClientProfile } from '../types';
import { getDB, saveDB, addAuditLog } from '../utils/storage';
import { processRepairAtomic } from '../utils/transactions';
import { CustomSelect } from './CustomSelect';
import { useToast } from './ui/Overlays';
import { CATEGORIAS_REPUESTO } from '../utils/categorias';
import {
  Catalogo, catalogoBase, cargarCatalogo, categoriasDe, marcasDe, modelosDe,
  agregarModelo, ocultarModelo, contarModelos, OPCION_OTRO,
} from '../utils/catalogoDispositivos';

interface TallerKanbanProps {
  activeUserEmail?: string;
  onRepairUpdated?: () => void;
}

const KANBAN_COLUMNS: RepairOrder['status'][] = [
  'Pendiente', 'Diagnosticada', 'Cotizada', 'Aprobada', 'Esperando repuestos', 'En Reparación', 'Lista', 'Entregada', 'Cancelada'
];

// Misma lista que usa el inventario. Estaba copiada a mano aquí y en
// InventarioControl.tsx; si alguien agregaba una categoría de repuesto en
// un lado y no en el otro, el taller dejaba de ver piezas que sí existían
// en bodega.
const sparePartCategories = CATEGORIAS_REPUESTO;

// Filtros en cascada de recepción: Categoría -> Marca -> Modelo -> Categoría de Falla.
//
// Las tres listas ya NO viven aquí. Estaban escritas a mano en este
// archivo —4 categorías, 19 marcas y unos 120 modelos— y ampliarlas
// obligaba a tocar el código y volver a desplegar. Ahora salen de
// `src/utils/catalogoDispositivos.ts`, que trae 513 modelos de base y se
// puede ampliar desde el propio taller sin programar nada.
//
// El catálogo base vive en el código a propósito: si Supabase no
// responde, la recepción de equipos tiene que seguir funcionando.

const DAMAGE_CATEGORIES = [
  'Pantalla / LCD', 'Batería', 'Puerto de Carga', 'Cámara', 'Placa Lógica', 'Software / Sistema',
  'Botones', 'Audio / Micrófono', 'Daño por Líquido', 'Otro'
];

/** Mensaje formateado para notificar al cliente por WhatsApp del estado de su orden. */
function buildWhatsAppMessage(rep: RepairOrder): string {
  const lines = [
    `Hola ${rep.customerName}, le escribimos de *Technoverse Costa Rica* sobre su equipo:`,
    '',
    `Orden: ${rep.id} (Ticket ${rep.ticket})`,
    `Equipo: ${rep.device}`,
    `Estado actual: ${rep.status}`,
  ];
  if (rep.diagnosisManual) lines.push(`Diagnóstico: ${rep.diagnosisManual}`);
  // Igual que en la consulta pública: sin importe cobrado no se manda una
  // cifra. "Monto: ₡0" en un WhatsApp al cliente se lee como "no le vamos a
  // cobrar", y esa conversación después no se deshace.
  if (rep.totalCost > 0) lines.push(`Monto: ₡${rep.totalCost.toLocaleString()}`);
  lines.push('', 'Puede consultar el estado de su equipo cuando guste indicando su número de ticket en nuestro portal de Technoverse Costa Rica.');
  return lines.join('\n');
}

/** Arma el enlace wa.me; asume Costa Rica (código 506) si el número viene sin código de país. */
function buildWhatsAppUrl(phone: string, message: string): string {
  const digits = phone.replace(/\D/g, '');
  const withCountry = digits.length === 8 ? `506${digits}` : digits;
  return `https://wa.me/${withCountry}?text=${encodeURIComponent(message)}`;
}

export default function TallerKanban({ activeUserEmail = 'tecnico@technoverse.com', onRepairUpdated }: TallerKanbanProps) {
  const toast = useToast();
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
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  // Filtros en cascada de recepción: Categoría -> Marca -> Modelo -> Categoría de Falla.
  const [newDeviceCategory, setNewDeviceCategory] = useState('');
  const [newDeviceBrand, setNewDeviceBrand] = useState('');
  const [newDeviceModel, setNewDeviceModel] = useState('');
  const [newDeviceModelOther, setNewDeviceModelOther] = useState('');
  // Arranca con el catálogo base para que el formulario esté usable en el
  // primer render, sin esperar a la red; en cuanto llega lo de Supabase se
  // sustituye por el catálogo completo.
  const [catalogo, setCatalogo] = useState<Catalogo>(() => catalogoBase());
  const [guardarEnCatalogo, setGuardarEnCatalogo] = useState(false);
  const [verCatalogo, setVerCatalogo] = useState(false);
  const [buscarModelo, setBuscarModelo] = useState('');
  const [nuevoModeloCat, setNuevoModeloCat] = useState('');
  const [nuevoModeloMarca, setNuevoModeloMarca] = useState('');
  const [nuevoModeloNombre, setNuevoModeloNombre] = useState('');
  const [newDamageCategory, setNewDamageCategory] = useState('');
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

  // El catálogo se lee una sola vez al abrir el taller. Si falla, queda el
  // base y no se avisa nada: el técnico puede trabajar igual, solo que sin
  // los modelos que se hayan agregado a mano.
  useEffect(() => {
    let vigente = true;
    cargarCatalogo().then(c => { if (vigente) setCatalogo(c); });
    return () => { vigente = false; };
  }, []);

  const loadTallerData = () => {
    const db = getDB();
    setRepairs(db.repair_orders || []);
    setProducts(db.products || []);
    setClients(db.clients || []);
  };

  const handleCreateRepair = (e: React.FormEvent) => {
    e.preventDefault();
    const finalModel = newDeviceModel === OPCION_OTRO ? newDeviceModelOther.trim() : newDeviceModel;
    if (!newCustomerName.trim() || !newCustomerEmail.trim() || !newCustomerPhone.trim()
      || !newDeviceCategory || !newDeviceBrand || !finalModel || !newDamageCategory || !newDamageReported.trim()) {
      toast.warning('Por favor complete todos los datos requeridos, incluyendo categoría, marca, modelo y categoría de falla del equipo.');
      return;
    }

    if (newWarrantyMonths === '' || newWarrantyMonths < 3) {
      toast.warning('La legislación de Costa Rica (Ley 7472) exige una garantía mínima de 3 meses para servicios de reparación.');
      return;
    }

    const db = getDB();

    // Generate order and ticket ID
    const number = Math.floor(100 + Math.random() * 900);
    const repairId = `GT-${number}`;
    const ticketId = `TKT-${number}`;
    // Si se pidió guardar el modelo escrito a mano, se manda al catálogo.
    // Es aparte de la orden y sin esperar respuesta: que el catálogo no se
    // pueda ampliar jamás puede impedir recibir un equipo.
    if (guardarEnCatalogo && newDeviceModel === OPCION_OTRO && finalModel) {
      void agregarModelo(newDeviceCategory, newDeviceBrand, finalModel, activeUserEmail)
        .then(error => {
          if (error) { toast.warning('La orden se creó, pero el modelo no se pudo guardar en el catálogo: ' + error); return; }
          cargarCatalogo().then(setCatalogo);
          toast.success(`"${finalModel}" quedó guardado en el catálogo.`);
        });
    }

    const deviceLabel = `${newDeviceBrand} ${finalModel} (${newDeviceCategory})`;

    const newRepair: RepairOrder = {
      id: repairId,
      ticket: ticketId,
      customerId: `CUST-${Math.floor(1000 + Math.random() * 9000)}`,
      customerName: newCustomerName.trim(),
      customerEmail: newCustomerEmail.trim().toLowerCase(),
      customerPhone: newCustomerPhone.trim(),
      device: deviceLabel,
      deviceCategory: newDeviceCategory,
      deviceBrand: newDeviceBrand,
      deviceModel: finalModel,
      damageReported: newDamageReported.trim(),
      damageCategory: newDamageCategory,
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
        phone: newCustomerPhone.trim(),
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
    setNewCustomerPhone('');
    setNewDeviceCategory('');
    setNewDeviceBrand('');
    setNewDeviceModel('');
    setNewDeviceModelOther('');
    setGuardarEnCatalogo(false);
    setNewDamageCategory('');
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
      toast.warning(`STOCK INSUFICIENTE EN CASA: El repuesto "${prod.name}" no cuenta con las ${qtyToAdd} unidades requeridas (Stock actual en casa: ${availableStock} un.). El ticket de reparación cambiará automáticamente al estado "Esperando repuestos".`);
      
      if (selectedRepair) {
        const db = getDB();
        const idxRep = db.repair_orders.findIndex(r => r.id === selectedRepair.id);
        if (idxRep !== -1) {
          db.repair_orders[idxRep].status = 'Esperando repuestos';
          db.repair_orders[idxRep].bitacora.push({
            status: 'Esperando repuestos',
            notes: `Falta de repuesto: "${prod.name}" (se requerían ${qtyToAdd} un. pero solo hay ${prod.stock} en almacenamiento en casa).`,
            timestamp: new Date().toISOString(),
            user: activeUserEmail
          });
          saveDB(db);
          addAuditLog(activeUserEmail, 'Taller', 'Falta Repuesto', `Orden ${selectedRepair.id} pasó a "Esperando repuestos" por desabastecimiento de "${prod.name}"`);
          loadTallerData();
          if (onRepairUpdated) onRepairUpdated();
          setSelectedRepair(db.repair_orders[idxRep]);
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

    const db = getDB();
    const idxRep = db.repair_orders.findIndex(r => r.id === selectedRepair.id);
    if (idxRep === -1) return;

    const originalRepair = db.repair_orders[idxRep];

    // SEPARACIÓN TALLER / FACTURACIÓN
    // -------------------------------
    // El taller ya no pone precios. Antes pedía "costo de mano de obra" y
    // calculaba un total cobrable aquí mismo, mezclando el trabajo técnico
    // con la contabilidad: el mismo formulario servía para escribir un
    // diagnóstico y para decidir cuánto se le cobra al cliente.
    //
    // Ahora el importe se define UNA sola vez, en el módulo de Cobros, con
    // el cliente delante y con su comprobante. Aquí se conserva el valor
    // que ya tuviera la orden para no borrar el histórico de las
    // reparaciones anteriores, pero no se calcula ninguno nuevo.
    const finalLaborCost = originalRepair.laborCost || 0;
    
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
          toast.error(`Stock insuficiente para repuesto: ${productInDb.name}. Necesario: ${additionalNeeded}, disponible: ${availableStock}`);
          stockValid = false;
        }
      }
    });

    if (!stockValid) return;


    const sparePartsTotal = repuestosSelected.reduce((sum, r) => sum + (r.price * r.quantity), 0);
    // Se respeta el total ya registrado: no se recalcula desde el taller.
    const totalRepairCost = originalRepair.totalCost || 0;

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
          // La bitácora del taller anota trabajo, no dinero. El costo de
          // los repuestos queda porque es consumo de inventario —dato
          // operativo—, no un precio de venta.
          notes: `Diagnóstico actualizado. Repuestos consumidos: ${repuestosSelected.length} (costo interno ₡${sparePartsTotal}).`,
          timestamp: new Date().toISOString(),
          user: activeUserEmail
        }
      ]
    };

    const result = await processRepairAtomic(originalRepair, repuestosSelected, activeUserEmail || 'admin', finalLaborCost, diagnosis, newRepairData);
    
    if (!result.success) {
      toast.error(result.error);
      return;
    }

    addAuditLog(activeUserEmail || 'admin', 'Taller', 'Actualizar Diagnóstico', `Diagnóstico de ticket ${selectedRepair.ticket} guardado.`);

    // UI Update immediately for snappy feel
    if (idxRep !== -1) {
       db.repair_orders[idxRep] = newRepairData;
    }

    // Trazabilidad de la cadena Inventario ↔ Taller.
    //
    // El descuento físico ya lo hizo processRepairAtomic con la función atómica
    // adjust_stock de Supabase (bloqueo de fila, todo o nada). Lo que faltaba
    // era dejar constancia del consumo en "inventory_movements", que es la
    // tabla que alimenta el historial y la trazabilidad del módulo Inventario:
    // sin esto el stock bajaba pero no había forma de saber qué orden lo gastó.
    //
    // Se registra el DELTA (lo consumido de más o devuelto al editar la orden),
    // nunca la cantidad total, para que reabrir y guardar la misma orden no
    // vuelva a descontar.
    if (!db.inventory_movements) db.inventory_movements = [];
    let movimientosRegistrados = 0;

    repuestosSelected.forEach((rep) => {
      const previamenteConsumido = (originalRepair.repuestos || [])
        .find(pr => pr.productId === rep.productId)?.quantity || 0;
      const delta = rep.quantity - previamenteConsumido;
      if (delta === 0) return;

      const idxProd = db.products.findIndex(p => p && p.id === rep.productId);
      if (idxProd === -1) return;

      // Se refleja el nuevo stock también en la copia local para que el módulo
      // de Inventario y el catálogo público lo vean sin esperar al Realtime.
      const stockResultante = Math.max(0, db.products[idxProd].stock - delta);
      db.products[idxProd].stock = stockResultante;
      if (stockResultante <= 0) db.products[idxProd].active = false;

      db.inventory_movements.unshift({
        id: `MOV-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        productId: rep.productId,
        productName: rep.productName,
        quantityChange: -delta,
        type: 'Consumo en reparación',
        notes: `Consumido en la orden de taller ${originalRepair.ticket} (${originalRepair.device}).`,
        timestamp: new Date().toISOString(),
        userEmail: activeUserEmail || 'admin',
        resultingStock: stockResultante
      });
      movimientosRegistrados++;
    });

    // Órdenes que devuelven repuestos al quitarlos de la selección.
    (originalRepair.repuestos || []).forEach((prev) => {
      const sigueAsignado = repuestosSelected.some(r => r.productId === prev.productId);
      if (sigueAsignado) return;

      const idxProd = db.products.findIndex(p => p && p.id === prev.productId);
      if (idxProd === -1) return;

      const stockResultante = db.products[idxProd].stock + prev.quantity;
      db.products[idxProd].stock = stockResultante;
      if (stockResultante > 0) db.products[idxProd].active = true;

      db.inventory_movements.unshift({
        id: `MOV-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        productId: prev.productId,
        productName: prev.productName,
        quantityChange: prev.quantity,
        type: 'Devolución',
        notes: `Repuesto liberado de la orden ${originalRepair.ticket} al quitarlo del diagnóstico.`,
        timestamp: new Date().toISOString(),
        userEmail: activeUserEmail || 'admin',
        resultingStock: stockResultante
      });
      movimientosRegistrados++;
    });

    if (movimientosRegistrados > 0) {
      try {
        await saveDB(db);
      } catch (err: any) {
        // El stock físico ya se ajustó de forma atómica en Supabase; si acá
        // falla, lo único que se pierde es la línea del historial. Se avisa sin
        // bloquear el guardado del diagnóstico, que sí quedó bien.
        toast.warning('El stock se descontó correctamente, pero no se pudo registrar el movimiento en el historial de inventario: ' + (err?.message || err));
      }
    }

    loadTallerData();

    setSelectedRepair(null);
    if (onRepairUpdated) onRepairUpdated();
    toast.success('Diagnóstico y presupuesto de reparación actualizados correctamente.');
  };

  const handleUpdateStatus = (repairId: string, newStatus: RepairOrder['status']) => {
    const db = getDB();
    const idxRep = db.repair_orders.findIndex(r => r.id === repairId);
    if (idxRep === -1) return;

    const rep = db.repair_orders[idxRep];
    const prevStatus = rep.status;
    if (prevStatus === newStatus) return;

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
                      {/* Solo se enseña un importe cuando existe de verdad.
                          Desde que el taller dejó de cotizar, una orden sin
                          cobrar tiene totalCost en 0, y mostrar "Costo
                          Estimado: ₡0" haría creer al cliente que su
                          reparación es gratis. */}
                      <div>
                        Costo:{' '}
                        {publicSearchResult.totalCost > 0 ? (
                          <strong className="text-emerald-400 dark:text-[var(--brand-gold-light)] font-mono">
                            ₡{publicSearchResult.totalCost.toLocaleString()}
                          </strong>
                        ) : (
                          <strong className="text-[var(--text-secondary)]">Pendiente de cotizar</strong>
                        )}
                      </div>
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
            <p className="text-[10px] text-[var(--text-secondary)] mb-3">Ingresa un nuevo dispositivo para diagnóstico e inicio del flujo de soporte legal.</p>
            <button
              onClick={() => setVerCatalogo(true)}
              className="mb-4 text-[10px] font-bold uppercase tracking-wide px-3 py-1.5 rounded-xl border border-[var(--border-color)]/70 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] inline-flex items-center gap-1.5"
            >
              <BookMarked className="w-3.5 h-3.5" />
              Catálogo de equipos · {contarModelos(catalogo)} modelos
            </button>
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">Teléfono / WhatsApp del Cliente</label>
              <input
                type="tel"
                required
                value={newCustomerPhone}
                onChange={(e) => setNewCustomerPhone(e.target.value)}
                placeholder="Ej. 8812 3456"
                className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-4 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-sky-500 dark:focus:border-[var(--brand-gold-mid)] font-mono"
              />
              <span className="text-[8px] text-[var(--text-secondary)] block mt-1 leading-relaxed">
                Se usa para notificarle por WhatsApp el estado de su orden.
              </span>
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

          {/* Filtros en cascada: Categoría -> Marca -> Modelo -> Categoría de Falla */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">Categoría de Equipo</label>
              <CustomSelect
                value={newDeviceCategory}
                onChange={(val) => { setNewDeviceCategory(val); setNewDeviceBrand(''); setNewDeviceModel(''); setNewDeviceModelOther(''); }}
                placeholder="-- Categoría --"
                className="text-xs py-2"
                options={categoriasDe(catalogo).map(c => ({ value: c, label: c }))}
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">Marca</label>
              <CustomSelect
                value={newDeviceBrand}
                onChange={(val) => { setNewDeviceBrand(val); setNewDeviceModel(''); setNewDeviceModelOther(''); }}
                placeholder={newDeviceCategory ? '-- Marca --' : 'Elija categoría primero'}
                className="text-xs py-2"
                options={(newDeviceCategory ? marcasDe(catalogo, newDeviceCategory) : []).map(b => ({ value: b, label: b }))}
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">Modelo</label>
              <CustomSelect
                value={newDeviceModel}
                onChange={setNewDeviceModel}
                placeholder={newDeviceBrand ? '-- Modelo --' : 'Elija marca primero'}
                className="text-xs py-2"
                options={(newDeviceBrand ? modelosDe(catalogo, newDeviceCategory, newDeviceBrand) : []).map(m => ({ value: m, label: m }))}
              />
              {newDeviceModel === OPCION_OTRO && (
                <>
                  <input
                    type="text"
                    required
                    value={newDeviceModelOther}
                    onChange={(e) => setNewDeviceModelOther(e.target.value)}
                    placeholder="Especifique el modelo"
                    className="w-full mt-2 bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-sky-500 dark:focus:border-[var(--brand-gold-mid)]"
                  />
                  {/* Así crece el catálogo: con los equipos que de verdad
                      entran al taller, en el momento en que entran. No hay
                      que sentarse a llenar listas por adelantado. */}
                  <label className="flex items-start gap-2 mt-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={guardarEnCatalogo}
                      onChange={(e) => setGuardarEnCatalogo(e.target.checked)}
                      className="mt-0.5 flex-shrink-0"
                    />
                    <span className="text-[10px] text-[var(--text-secondary)] leading-snug">
                      Guardar este modelo en el catálogo para no volver a escribirlo
                    </span>
                  </label>
                </>
              )}
            </div>
            <div>
              <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">Categoría de Falla</label>
              <CustomSelect
                value={newDamageCategory}
                onChange={setNewDamageCategory}
                placeholder="-- Categoría de falla --"
                className="text-xs py-2"
                options={DAMAGE_CATEGORIES.map(d => ({ value: d, label: d }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">Lugar de Reparación en Casa</label>
              <CustomSelect
                value={newRepairLocation}
                onChange={setNewRepairLocation}
                className="text-xs py-2"
                options={[
                  { value: 'Taller en casa', label: 'Taller en casa (Escritorio principal)' },
                  { value: 'Mesa del comedor', label: 'Mesa del comedor' },
                  { value: 'Estudio de electrónica', label: 'Estudio de electrónica' },
                  { value: 'Garaje / Banco de trabajo', label: 'Garaje / Banco de trabajo' },
                ]}
              />
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
                        <div className="flex justify-between items-center pt-1.5 border-t border-[var(--border-color)]/50 gap-1.5">
                          <span className="text-[8px] text-[var(--text-secondary)]">Mover a:</span>
                          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            <div className="w-24">
                              <CustomSelect
                                value={rep.status}
                                onChange={(val) => handleUpdateStatus(rep.id, val as RepairOrder['status'])}
                                className="text-[9px] text-sky-600 dark:text-[var(--brand-gold-light)] px-1.5 py-0.5"
                                options={KANBAN_COLUMNS.map(s => ({ value: s, label: s }))}
                              />
                            </div>
                            {rep.customerPhone && (
                              <button
                                type="button"
                                title="Notificar por WhatsApp"
                                onClick={() => window.open(buildWhatsAppUrl(rep.customerPhone!, buildWhatsAppMessage(rep)), '_blank', 'noopener,noreferrer')}
                                className="p-1.5 rounded-lg bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25 transition shrink-0"
                              >
                                <MessageCircle className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 animate-in fade-in" id="repair-detail-modal">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-2xl overflow-hidden shadow-sm w-full max-w-xl text-[var(--text-primary)] flex flex-col max-h-[92dvh]">
            
            {/* Header */}
            <div className="p-4 bg-[var(--bg-surface)] border-b border-[var(--border-color)]/80 flex justify-between items-center">
              <div>
                <h3 className="font-bold text-sm text-sky-400 dark:text-[var(--brand-gold-light)]">Administrar Orden de Reparación</h3>
                <p className="text-[10px] text-[var(--text-secondary)]">Ticket: <strong className="font-mono">{selectedRepair.ticket}</strong> | Cliente: <strong>{selectedRepair.customerName}</strong></p>
              </div>
              <div className="flex items-center gap-2">
                {selectedRepair.customerPhone && (
                  <button
                    type="button"
                    onClick={() => window.open(buildWhatsAppUrl(selectedRepair.customerPhone!, buildWhatsAppMessage(selectedRepair)), '_blank', 'noopener,noreferrer')}
                    className="flex items-center gap-1.5 text-xs bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25 px-2.5 py-1.5 rounded-lg transition font-bold"
                  >
                    <MessageCircle className="w-3.5 h-3.5" /> Notificar por WhatsApp
                  </button>
                )}
                <button
                  onClick={() => setSelectedRepair(null)}
                  className="text-xs bg-[var(--bg-surface)] hover:bg-rose-600 px-2.5 py-1.5 rounded-lg transition"
                >
                  Cerrar
                </button>
              </div>
            </div>

            {/* Content Form */}
            <form onSubmit={handleSaveDiagnosisAndCost} className="p-5 space-y-4 flex-1 overflow-y-auto min-h-0">
              <div className="bg-[var(--bg-surface)] p-3 rounded-xl border border-[var(--border-color)]/50 text-xs space-y-1">
                <div>Equipo: <strong className="text-[var(--text-primary)]">{selectedRepair.device}</strong></div>
                {selectedRepair.damageCategory && (
                  <div>Categoría de Falla: <strong className="text-sky-600 dark:text-[var(--brand-gold-light)]">{selectedRepair.damageCategory}</strong></div>
                )}
                <div>Daño Reportado: <span className="text-[var(--text-secondary)] italic">"{selectedRepair.damageReported}"</span></div>
                {selectedRepair.customerPhone && (
                  <div>Teléfono: <span className="text-[var(--text-secondary)] font-mono">{selectedRepair.customerPhone}</span></div>
                )}
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

              {/* SEPARACIÓN TALLER / FACTURACIÓN
                  Aquí había dos campos de dinero: "Costo Mano de Obra" y
                  "Total Cotización Actual". Se retiraron. El taller
                  documenta el trabajo; el importe se define en Cobros, una
                  sola vez, con el cliente delante y contra su comprobante.
                  Tener el precio en los dos sitios llevaba a que la
                  cotización del taller y lo realmente cobrado no
                  coincidieran, sin que nadie pudiera decir cuál valía. */}
              <div className="flex items-start gap-2.5 rounded-xl border border-[var(--border-color)] px-3.5 py-3">
                <Receipt className="w-4 h-4 flex-shrink-0 mt-0.5 text-[var(--text-muted)]" />
                <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
                  El cobro no se hace desde el taller. Cuando el equipo esté listo, pase al módulo
                  <strong className="text-[var(--text-primary)]"> Cobros</strong> para facturar el servicio,
                  aplicar la garantía y enviarle el comprobante al cliente.
                </p>
              </div>

              {/* SPARE PARTS SELECTOR FROM DOMESTIC STOCK
                  Esta sección se muestra SIEMPRE, incluso con el inventario
                  vacío o todo en cero: antes se confundía con "no existe la
                  función" cuando en realidad solo no había nada que listar.
                  El recuadro con borde la separa del resto del formulario para
                  que no pase desapercibida al desplazarse. */}
              <div className="border border-[var(--border-color)]/70 rounded-xl p-3 space-y-3 bg-[var(--bg-sunken)]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] uppercase font-bold text-[var(--text-secondary)] block">
                    Vincular Repuesto del Inventario
                  </span>
                  <span className="text-[9px] font-mono text-[var(--text-muted)]">
                    {products.filter(p => p && p.active !== false).length} artículo(s) · {products.filter(p => p && p.active !== false && p.stock > 0).length} con stock
                  </span>
                </div>

                {products.filter(p => p && p.active !== false).length === 0 && (
                  <div className="text-[10px] leading-relaxed text-[var(--text-secondary)] border border-dashed border-[var(--border-color)] rounded-lg px-3 py-2.5">
                    Todavía no hay artículos en el inventario. Creá el repuesto en
                    <strong className="text-[var(--text-primary)]"> Inventario → Agregar Producto</strong> y
                    aparecerá aquí automáticamente para vincularlo a esta orden.
                  </div>
                )}

                <div className="flex gap-2">
                    <div className="flex-1">
                      <CustomSelect
                        value={selectedProductId}
                        onChange={setSelectedProductId}
                        placeholder="-- Seleccionar Repuesto en Casa --"
                        className="text-xs py-2"
                        options={[
                          { value: '', label: '-- Seleccionar Repuesto en Casa --' },
                          // Se listan TODOS los artículos activos del inventario, no
                          // solo los de las categorías de repuesto. El filtro anterior
                          // exigía categorías fijas (LCD, Flex, Conector…) que ningún
                          // producto real usaba, así que el desplegable salía siempre
                          // vacío y era imposible vincular un repuesto. Los repuestos
                          // se ordenan primero para que sigan quedando a mano.
                          ...products
                            .filter(p => p && p.active !== false)
                            .sort((a, b) => {
                              const aRep = sparePartCategories.includes(a.category) ? 0 : 1;
                              const bRep = sparePartCategories.includes(b.category) ? 0 : 1;
                              if (aRep !== bRep) return aRep - bRep;
                              return a.name.localeCompare(b.name, 'es');
                            })
                            .map(p => ({
                              value: p.id,
                              label: `${p.name} — ${p.category} (Stock: ${p.stock} un.${p.physicalLocation ? ` en "${p.physicalLocation}"` : ''} | ₡${p.price.toLocaleString()})`,
                              disabled: p.stock <= 0
                            }))
                        ]}
                      />
                    </div>
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


      {/* =============== CATÁLOGO DE EQUIPOS =============== */}
      {verCatalogo && (
        <div
          className="fixed inset-0 z-[999] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setVerCatalogo(false)}
        >
          <div
            className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl max-h-[88vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--border-color)]/50 p-4 flex-shrink-0">
              <h4 className="font-bold text-[var(--text-primary)] flex items-center gap-2 text-sm">
                <BookMarked className="w-4 h-4" /> Catálogo de equipos
              </h4>
              <button
                onClick={() => setVerCatalogo(false)}
                className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-4 overflow-y-auto">
              <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed">
                {contarModelos(catalogo)} modelos en {categoriasDe(catalogo).length} categorías. Los que agregue acá
                aparecen de una vez en el formulario de recepción.{' '}
                <strong className="text-[var(--text-primary)]">Nunca hace falta que un equipo esté en la lista</strong>{' '}
                para poder recibirlo: siempre se puede escoger "Otro" y escribir el modelo a mano.
              </p>

              {/* ---- Agregar ---- */}
              <div className="bg-[var(--bg-base)] border border-[var(--border-color)]/60 rounded-2xl p-3 space-y-2">
                <h5 className="text-[10px] uppercase font-bold text-[var(--text-secondary)]">Agregar un modelo</h5>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input
                    value={nuevoModeloCat}
                    onChange={e => setNuevoModeloCat(e.target.value)}
                    list="taller-categorias"
                    placeholder="Categoría"
                    className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-sky-500 dark:focus:border-[var(--brand-gold-mid)]"
                  />
                  <input
                    value={nuevoModeloMarca}
                    onChange={e => setNuevoModeloMarca(e.target.value)}
                    list="taller-marcas"
                    placeholder="Marca"
                    className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-sky-500 dark:focus:border-[var(--brand-gold-mid)]"
                  />
                  <input
                    value={nuevoModeloNombre}
                    onChange={e => setNuevoModeloNombre(e.target.value)}
                    placeholder="Modelo"
                    className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-sky-500 dark:focus:border-[var(--brand-gold-mid)]"
                  />
                </div>
                {/* Las sugerencias salen del catálogo que ya existe, para que
                    no se creen "Samsung" y "samsung" como marcas distintas. */}
                <datalist id="taller-categorias">
                  {categoriasDe(catalogo).map(c => <option key={c} value={c} />)}
                </datalist>
                <datalist id="taller-marcas">
                  {Array.from(new Set(
                    Object.values(catalogo).flatMap(marcas => Object.keys(marcas))
                  )).sort((a, b) => a.localeCompare(b, 'es')).map(m => <option key={m} value={m} />)}
                </datalist>
                <button
                  onClick={async () => {
                    const error = await agregarModelo(nuevoModeloCat, nuevoModeloMarca, nuevoModeloNombre, activeUserEmail);
                    if (error) { toast.warning(error); return; }
                    setCatalogo(await cargarCatalogo());
                    toast.success(`"${nuevoModeloNombre.trim()}" agregado al catálogo.`);
                    setNuevoModeloNombre('');
                  }}
                  className="bg-sky-500 hover:bg-sky-600 dark:bg-[var(--brand-gold-mid)] dark:hover:bg-[var(--brand-gold-dark)] text-white dark:text-slate-950 text-xs font-bold px-4 py-2 rounded-xl flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" /> Agregar al catálogo
                </button>
              </div>

              {/* ---- Buscar y esconder ---- */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
                <input
                  value={buscarModelo}
                  onChange={e => setBuscarModelo(e.target.value)}
                  placeholder="Buscar un modelo en el catálogo…"
                  className="w-full bg-[var(--bg-base)] border border-[var(--border-color)]/80 rounded-xl pl-9 pr-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-sky-500 dark:focus:border-[var(--brand-gold-mid)]"
                />
              </div>

              {buscarModelo.trim().length >= 2 ? (
                <div className="space-y-1">
                  {(() => {
                    const q = buscarModelo.trim().toLowerCase();
                    const hallazgos: { categoria: string; marca: string; modelo: string }[] = [];
                    for (const [categoria, marcas] of Object.entries(catalogo)) {
                      for (const [marca, modelos] of Object.entries(marcas)) {
                        for (const modelo of modelos) {
                          if (`${marca} ${modelo}`.toLowerCase().includes(q)) {
                            hallazgos.push({ categoria, marca, modelo });
                          }
                        }
                      }
                    }
                    if (hallazgos.length === 0) {
                      return (
                        <p className="text-center text-[11px] text-[var(--text-secondary)] py-6">
                          Ningún modelo coincide. Agréguelo arriba, o recíbalo con "Otro" sin agregarlo.
                        </p>
                      );
                    }
                    return hallazgos.slice(0, 60).map(h => (
                      <div
                        key={`${h.categoria}|${h.marca}|${h.modelo}`}
                        className="flex items-center justify-between gap-2 bg-[var(--bg-base)] border border-[var(--border-color)]/50 rounded-xl px-3 py-2"
                      >
                        <div className="min-w-0">
                          <div className="text-xs text-[var(--text-primary)] truncate">{h.marca} {h.modelo}</div>
                          <div className="text-[9px] uppercase text-[var(--text-secondary)]">{h.categoria}</div>
                        </div>
                        <button
                          onClick={async () => {
                            const error = await ocultarModelo(h.categoria, h.marca, h.modelo, activeUserEmail);
                            if (error) { toast.error('No se pudo esconder: ' + error); return; }
                            setCatalogo(await cargarCatalogo());
                            toast.success(`"${h.modelo}" ya no aparece en las listas.`);
                          }}
                          className="text-[10px] font-bold uppercase px-2 py-1 rounded-lg border border-[var(--border-color)]/70 text-[var(--text-secondary)] hover:text-rose-400 hover:border-rose-500/40 flex-shrink-0 inline-flex items-center gap-1"
                        >
                          <EyeOff className="w-3 h-3" /> Esconder
                        </button>
                      </div>
                    ));
                  })()}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {categoriasDe(catalogo).map(c => (
                    <div key={c} className="bg-[var(--bg-base)] border border-[var(--border-color)]/50 rounded-xl px-3 py-2">
                      <div className="text-xs font-bold text-[var(--text-primary)] truncate">{c}</div>
                      <div className="text-[10px] text-[var(--text-secondary)]">
                        {Object.values(catalogo[c] || {}).reduce((n: number, m: string[]) => n + m.length, 0)} modelos ·{' '}
                        {Object.keys(catalogo[c]).length} marcas
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed">
                Esconder un modelo no borra nada: las órdenes que ya lo usan lo conservan tal cual, porque el modelo se
                guarda como texto dentro de la orden.
              </p>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
