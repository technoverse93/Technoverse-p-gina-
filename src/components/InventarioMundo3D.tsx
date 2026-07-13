import React, { useState, useEffect } from 'react';
import { 
  Home, Package, AlertTriangle, CheckCircle2, RefreshCw, 
  ArrowRightLeft, ClipboardCheck, LayoutGrid, HelpCircle, Save, Plus
} from 'lucide-react';
import { Product, InventoryMovement } from '../types';
import { getDB, saveDB, addAuditLog } from '../utils/storage';

interface InventarioMundo3DProps {
  onStockUpdated?: () => void;
  activeUserEmail?: string;
}

export default function InventarioMundo3D({ onStockUpdated, activeUserEmail = 'technoverse.admin@gmail.com' }: InventarioMundo3DProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [maxStockLimit, setMaxStockLimit] = useState<number>(50);
  
  // Quick count audit state
  const [isAuditing, setIsAuditing] = useState(false);
  const [auditQuantities, setAuditQuantities] = useState<{ [productId: string]: number }>({});
  const [auditReasons, setAuditReasons] = useState<{ [productId: string]: string }>({});
  const [auditFilter, setAuditFilter] = useState<string>('todos');

  // Quick edit location state
  const [editingLocationProductId, setEditingLocationProductId] = useState<string | null>(null);
  const [tempLocation, setTempLocation] = useState('');

  useEffect(() => {
    loadHomeInventoryData();

    const handleUpdate = () => {
      loadHomeInventoryData();
    };

    window.addEventListener('storage', handleUpdate);
    window.addEventListener('technoverse_db_updated', handleUpdate);
    window.addEventListener('product:created', handleUpdate);
    window.addEventListener('stock:update', handleUpdate);
    
    return () => {
      window.removeEventListener('storage', handleUpdate);
      window.removeEventListener('technoverse_db_updated', handleUpdate);
      window.removeEventListener('product:created', handleUpdate);
      window.removeEventListener('stock:update', handleUpdate);
    };
  }, []);

  const loadHomeInventoryData = () => {
    const db = getDB();
    const activeProducts = (db.products || []).filter(p => p.active !== false && p.stock > 0);
    setProducts(activeProducts);
    setMovements(db.inventory_movements || []);
    setMaxStockLimit(db.settings?.maxStockLimit ?? 50);
    
    // Initialize audit values
    const initialQuantities: { [productId: string]: number } = {};
    const initialReasons: { [productId: string]: string } = {};
    activeProducts.forEach(p => {
      initialQuantities[p.id] = p.stock;
      initialReasons[p.id] = '';
    });
    setAuditQuantities(initialQuantities);
    setAuditReasons(initialReasons);
  };

  // Calculate stats
  const totalStock = products.reduce((acc, p) => acc + p.stock, 0);
  const occupancyPercentage = Math.min(100, Math.round((totalStock / maxStockLimit) * 100));

  // Group products by physical location
  const groupedProducts: { [location: string]: Product[] } = {};
  products.forEach(p => {
    const loc = p.physicalLocation?.trim() || 'Sin ubicación (Por asignar)';
    if (!groupedProducts[loc]) {
      groupedProducts[loc] = [];
    }
    groupedProducts[loc].push(p);
  });

  // Handle single count adjustment
  const handleApplySingleAudit = (productId: string) => {
    const db = getDB();
    const pIdx = db.products.findIndex(p => p.id === productId);
    if (pIdx === -1) return;

    const prod = db.products[pIdx];
    const realQty = auditQuantities[productId] ?? prod.stock;
    const diff = realQty - prod.stock;
    const reason = auditReasons[productId]?.trim() || 'Ajuste por conteo físico rápido de inventario en casa';

    if (diff === 0) {
      alert(`El stock físico coincide con el sistema (${prod.stock} un.). No se requieren ajustes.`);
      return;
    }

    // Apply change
    db.products[pIdx].stock = realQty;

    // Register movement
    const movement: InventoryMovement = {
      id: `MOV-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`,
      productId: prod.id,
      productName: prod.name,
      quantityChange: diff,
      type: diff > 0 ? 'Entrada' : 'Salida',
      notes: reason,
      timestamp: new Date().toISOString(),
      userEmail: activeUserEmail
    };

    if (!db.inventory_movements) db.inventory_movements = [];
    db.inventory_movements.unshift(movement);
    saveDB(db);

    addAuditLog(
      activeUserEmail,
      'Inventario',
      'Conteo Físico',
      `Ajuste por conteo de stock físico: ${prod.name} (SKU: ${prod.sku}). Cambió de ${prod.stock} a ${realQty} un. (${diff > 0 ? '+' : ''}${diff}). Motivo: ${reason}`
    );

    alert('¡Conteo físico registrado y stock ajustado exitosamente!');
    loadHomeInventoryData();
    if (onStockUpdated) onStockUpdated();
  };

  // Quick save physical location
  const handleSaveLocation = (productId: string) => {
    if (!tempLocation.trim()) return;
    const db = getDB();
    const pIdx = db.products.findIndex(p => p.id === productId);
    if (pIdx !== -1) {
      const oldLoc = db.products[pIdx].physicalLocation || 'Ninguna';
      db.products[pIdx].physicalLocation = tempLocation.trim();
      saveDB(db);
      addAuditLog(
        activeUserEmail,
        'Inventario',
        'Ubicación Física',
        `Se cambió la ubicación en casa para "${db.products[pIdx].name}": de "${oldLoc}" a "${tempLocation.trim()}"`
      );
      alert('Ubicación física en casa actualizada.');
      setEditingLocationProductId(null);
      loadHomeInventoryData();
    }
  };

  return (
    <div className="space-y-6" id="home-inventory-control-panel">
      {/* 1. Header / Home-Operated Context */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-2xl p-6 relative overflow-hidden">
        <div className="absolute right-0 top-0 w-64 h-64 bg-sky-500 dark:bg-[var(--brand-gold-mid)]/5 rounded-full blur-3xl pointer-events-none"></div>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 z-10 relative">
          <div>
            <span className="bg-sky-500 dark:bg-[var(--brand-gold-mid)]/10 text-sky-300 dark:text-[var(--brand-gold-light)] border border-sky-500 dark:border-[var(--brand-gold-mid)]/20 px-2.5 py-0.5 rounded-full text-[10px] uppercase font-bold tracking-wider mb-2 inline-block">
              Operación 100% en Casa (Home-Office)
            </span>
            <h3 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
              <Home className="w-5 h-5 text-sky-400 dark:text-[var(--brand-gold-light)]" /> Control Físico de Inventario Doméstico
            </h3>
            <p className="text-xs text-slate-500 max-w-xl mt-1 leading-relaxed">
              El inventario de Technoverse se almacena en la vivienda del CEO. Sin CEDIS ni muelles de carga;
              esta herramienta administra la distribución en habitaciones, armarios y estanterías del hogar de forma profesional.
            </p>
          </div>
          
          {/* Action buttons */}
          <div className="flex gap-2">
            <button
              onClick={() => setIsAuditing(!isAuditing)}
              className={`flex items-center gap-1.5 font-bold text-xs px-4 py-2 rounded-xl transition ${
                isAuditing 
                  ? 'bg-rose-500 hover:bg-rose-600 text-white' 
                  : 'bg-emerald-500 dark:bg-[var(--brand-gold-mid)] hover:bg-emerald-600 dark:hover:bg-[var(--brand-gold-mid)] dark:bg-[var(--brand-gold-mid)] dark:hover:bg-[var(--brand-gold-dark)] text-slate-950'
              }`}
            >
              <ClipboardCheck className="w-4 h-4" />
              {isAuditing ? 'Cancelar Auditoría' : 'Iniciar Conteo Físico'}
            </button>
            <button
              onClick={loadHomeInventoryData}
              className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] text-xs font-bold px-3 py-2 rounded-xl transition"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Space Occupancy Indicator Widget (FASE 1 & 5) */}
        <div className="mt-6 border-t border-[var(--border-color)]/50 pt-4">
          <div className="flex justify-between items-center mb-1.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">Capacidad Almacenamiento Doméstico Ocupada</span>
              <span className="text-[10px] bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded font-mono">Límite: {maxStockLimit} unidades</span>
            </div>
            <span className="text-xs font-bold font-mono text-[var(--text-primary)]">{totalStock} / {maxStockLimit} un. ({occupancyPercentage}%)</span>
          </div>
          <div className="w-full bg-[var(--bg-surface)] rounded-full h-3.5 p-0.5 border border-[var(--border-color)]/50 overflow-hidden">
            <div 
              className={`h-full rounded-full transition-all duration-500 ${
                occupancyPercentage >= 90 ? 'bg-rose-500' : occupancyPercentage >= 75 ? 'bg-amber-500' : 'bg-sky-500 dark:bg-[var(--brand-gold-mid)]'
              }`}
              style={{ width: `${occupancyPercentage}%` }}
            />
          </div>
          
          {/* Space warning alerts if limit is exceeded */}
          {totalStock >= maxStockLimit && (
            <div className="mt-3 bg-rose-500/10 border border-rose-500/20 text-rose-300 p-3 rounded-xl flex items-start gap-2 text-xs leading-relaxed">
              <AlertTriangle className="w-4 h-4 text-rose-400 mt-0.5 flex-shrink-0" />
              <div>
                <strong className="font-bold">⚠️ ALERTA DE SATURACIÓN ESPACIAL EN CASA:</strong> El stock acumulado actual es de {totalStock} unidades y supera el umbral configurado de {maxStockLimit} unidades. Se sugiere revisar espacio físico disponible en armarios/estudio, o realizar liquidaciones promocionales para liberar espacio en la vivienda.
              </div>
            </div>
          )}
          {totalStock >= maxStockLimit * 0.75 && totalStock < maxStockLimit && (
            <div className="mt-3 bg-amber-500/10 border border-amber-500/20 text-amber-300 p-3 rounded-xl flex items-start gap-2 text-xs leading-relaxed">
              <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
              <div>
                <strong className="font-bold">⚠️ ESPACIO DOMÉSTICO LIMITADO:</strong> El stock total está al {occupancyPercentage}% de la capacidad máxima de almacenamiento en la vivienda. Considere limitar nuevas compras de stock voluminoso.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 2. Interactive Quick Count Audit Panel (FASE 1 - Conteo Rápido) */}
      {isAuditing && (
        <div className="bg-[var(--bg-surface)] border border-emerald-500 dark:border-[var(--brand-gold-mid)]/30 rounded-2xl p-6 space-y-4 shadow-sm">
          <div className="flex justify-between items-center border-b border-[var(--border-color)]/50 pb-3">
            <div>
              <h4 className="text-sm font-bold text-emerald-400 dark:text-[var(--brand-gold-light)] flex items-center gap-1.5">
                <ClipboardCheck className="w-4.5 h-4.5" /> Proceso Activo de Conteo Físico Rápido
              </h4>
              <p className="text-[11px] text-slate-500 mt-0.5">Revise físicamente cada producto y confirme si la cantidad real en casa coincide con el sistema.</p>
            </div>
            
            {/* Quick Filter */}
            <div className="flex gap-2 text-[10px]">
              {['todos', 'sin_ubicacion', 'con_diferencia'].map(f => (
                <button
                  key={f}
                  onClick={() => setAuditFilter(f)}
                  className={`px-2.5 py-1 rounded-lg border font-bold transition uppercase ${
                    auditFilter === f 
                      ? 'bg-emerald-500 dark:bg-[var(--brand-gold-mid)] text-slate-950 border-emerald-500 dark:border-[var(--brand-gold-dark)] dark:border-[var(--brand-gold-mid)]' 
                      : 'bg-[var(--bg-surface)]   text-slate-500 border-[var(--border-color)]/80 hover:bg-[var(--bg-surface)]  '
                  }`}
                >
                  {f === 'todos' ? 'Todos' : f === 'sin_ubicacion' ? 'Sin Ubicación' : 'Con Diferencia'}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[var(--border-color)]/80 text-slate-500 bg-[var(--bg-surface)] ">
                  <th className="p-3">Producto / SKU</th>
                  <th className="p-3">Ubicación Física</th>
                  <th className="p-3 text-center">Cant. Sistema</th>
                  <th className="p-3 text-center w-28">Cant. Real en Casa</th>
                  <th className="p-3 text-center">Diferencia</th>
                  <th className="p-3">Motivo del Ajuste</th>
                  <th className="p-3 text-center">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-[var(--text-secondary)]">
                {products
                  .filter(p => {
                    if (auditFilter === 'sin_ubicacion') return !p.physicalLocation?.trim();
                    if (auditFilter === 'con_diferencia') {
                      const qty = auditQuantities[p.id] ?? p.stock;
                      return qty !== p.stock;
                    }
                    return true;
                  })
                  .map(p => {
                    const counted = auditQuantities[p.id] ?? p.stock;
                    const diff = counted - p.stock;
                    
                    return (
                      <tr key={p.id} className="hover:bg-[var(--bg-surface)] ">
                        <td className="p-3">
                          <div className="font-bold text-[var(--text-primary)]">{p.name}</div>
                          <div className="text-[10px] text-sky-400 dark:text-[var(--brand-gold-light)] font-mono">{p.sku}</div>
                        </td>
                        <td className="p-3 italic text-slate-500 text-[11px]">
                          {p.physicalLocation || '⚠️ Sin ubicar'}
                        </td>
                        <td className="p-3 text-center font-mono font-bold text-[var(--text-secondary)]">{p.stock} un.</td>
                        <td className="p-3 text-center">
                          <input
                            type="number"
                            min="0"
                            value={counted}
                            onChange={(e) => {
                              const v = Math.max(0, parseInt(e.target.value) || 0);
                              setAuditQuantities(prev => ({ ...prev, [p.id]: v }));
                            }}
                            className="w-20 bg-[var(--bg-surface)] text-[var(--text-primary)] font-mono border border-[var(--border-color)]/80 rounded px-2 py-1 text-center font-bold text-xs focus:outline-none focus:border-emerald-500 dark:focus:border-[var(--brand-gold-mid)]"
                          />
                        </td>
                        <td className="p-3 text-center font-mono font-bold">
                          {diff === 0 ? (
                            <span className="text-slate-500">0</span>
                          ) : diff > 0 ? (
                            <span className="text-emerald-400 dark:text-[var(--brand-gold-light)]">+{diff}</span>
                          ) : (
                            <span className="text-rose-400">{diff}</span>
                          )}
                        </td>
                        <td className="p-3">
                          <input
                            type="text"
                            placeholder="Motivo (ej: Inventariado en armario)"
                            value={auditReasons[p.id] || ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              setAuditReasons(prev => ({ ...prev, [p.id]: val }));
                            }}
                            disabled={diff === 0}
                            className={`w-full bg-[var(--bg-surface)]   text-xs border border-[var(--border-color)]/80 rounded px-3 py-1.5 text-white focus:outline-none focus:border-emerald-500 dark:focus:border-[var(--brand-gold-mid)] dark:border-[var(--brand-gold-mid)] ${
                              diff === 0 ? 'opacity-30 cursor-not-allowed' : ''
                            }`}
                          />
                        </td>
                        <td className="p-3 text-center">
                          <button
                            onClick={() => handleApplySingleAudit(p.id)}
                            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition flex items-center gap-1 mx-auto ${
                              diff === 0 
                                ? 'bg-slate-800 text-slate-500 border border-[var(--border-color)]/50 cursor-not-allowed' 
                                : 'bg-emerald-500 dark:bg-[var(--brand-gold-mid)] text-slate-950 hover:bg-emerald-600 dark:hover:bg-[var(--brand-gold-mid)] dark:bg-[var(--brand-gold-mid)] dark:hover:bg-[var(--brand-gold-dark)] font-extrabold cursor-pointer'
                            }`}
                            disabled={diff === 0}
                          >
                            <Save className="w-3 h-3" /> Ajustar
                          </button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3. Physical Locations Bento-Grid (Grouping & Assignment) */}
      <div className="space-y-3">
        <h4 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
          <LayoutGrid className="w-4.5 h-4.5 text-sky-400 dark:text-[var(--brand-gold-light)]" /> Distribución Física del Inventario en Casa
        </h4>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Object.keys(groupedProducts).length === 0 ? (
            <div className="col-span-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 p-12 rounded-2xl text-center text-slate-500 italic">
              No hay productos con ubicaciones asignadas en el hogar.
            </div>
          ) : (
            Object.entries(groupedProducts).map(([locationName, items]) => (
              <div 
                key={locationName} 
                className={`bg-[var(--bg-surface)]   border rounded-2xl p-4 flex flex-col justify-between transition hover:border-white/20 ${
                  locationName.includes('Sin ubicación') ? 'border-rose-500/20 bg-rose-500/2' : 'border-[var(--border-color)]/80'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between border-b border-[var(--border-color)]/50 pb-2.5 mb-3">
                    <span className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                      <Home className="w-3.5 h-3.5 text-sky-400 dark:text-[var(--brand-gold-light)]" /> {locationName}
                    </span>
                    <span className="text-[10px] bg-sky-500 dark:bg-[var(--brand-gold-mid)]/10 text-sky-300 dark:text-[var(--brand-gold-light)] font-bold px-2 py-0.5 rounded-full font-mono">
                      {items.length} {items.length === 1 ? 'ref' : 'refs'}
                    </span>
                  </div>

                  <div className="space-y-2 max-h-[160px] overflow-y-auto pr-1">
                    {items.map(it => (
                      <div key={it.id} className="flex justify-between items-center text-[11px] bg-[var(--bg-surface)] /40 p-2 rounded-lg border border-[var(--border-color)]/50">
                        <div className="truncate max-w-[120px]">
                          <span className="font-bold text-[var(--text-secondary)] text-xs block truncate">{it.name}</span>
                          <span className="font-mono text-[9px] text-slate-500">{it.sku}</span>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <span className={`font-mono font-bold block ${it.stock <= 3 ? 'text-rose-400' : 'text-emerald-400 dark:text-[var(--brand-gold-light)]'}`}>
                            {it.stock} un.
                          </span>
                          <button
                            onClick={() => {
                              setEditingLocationProductId(it.id);
                              setTempLocation(it.physicalLocation || '');
                            }}
                            className="text-[9px] text-sky-400 dark:text-[var(--brand-gold-light)] hover:underline block"
                          >
                            Reubicar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Quick relocation form inline */}
                {editingLocationProductId && items.some(it => it.id === editingLocationProductId) && (
                  <div className="mt-4 pt-3 border-t border-[var(--border-color)]/50 space-y-2 bg-[var(--bg-surface)] /60 p-2.5 rounded-xl border border-[var(--border-color)]/80">
                    <label className="block text-[9px] uppercase font-bold text-slate-500">Nueva ubicación en casa</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Ej: Armario estudio, Caja 2"
                        value={tempLocation}
                        onChange={(e) => setTempLocation(e.target.value)}
                        className="flex-1 bg-[var(--bg-surface)] border border-white/15 rounded-lg px-2.5 py-1 text-xs text-[var(--text-primary)] focus:outline-none"
                      />
                      <button
                        onClick={() => handleSaveLocation(editingLocationProductId)}
                        className="bg-sky-500 hover:bg-sky-600 dark:bg-[var(--brand-gold-mid)] dark:hover:bg-[var(--brand-gold-dark)] text-slate-950 font-bold text-[10px] px-2 rounded-lg transition"
                      >
                        Guardar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* 4. Inventory Movements History with Location (FASE 1) */}
      <div className="space-y-3">
        <h4 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
          <ArrowRightLeft className="w-4.5 h-4.5 text-sky-400 dark:text-[var(--brand-gold-light)]" /> Historial Reciente de Movimientos de Stock en Casa
        </h4>
        
        <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse font-mono leading-relaxed">
              <thead>
                <tr className="border-b border-[var(--border-color)]/80 bg-[var(--bg-surface)] text-slate-500">
                  <th className="p-3">Código Movimiento</th>
                  <th className="p-3">Artículo</th>
                  <th className="p-3 text-center">Cambio Cant.</th>
                  <th className="p-3 text-center">Tipo</th>
                  <th className="p-3">Ubicación de Destino/Origen</th>
                  <th className="p-3">Comentario de Ajuste</th>
                  <th className="p-3">Responsable / Fecha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-[var(--text-secondary)]">
                {movements.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-6 text-slate-500 italic">No hay registros de movimientos en el historial.</td>
                  </tr>
                ) : (
                  movements.slice(0, 10).map(m => {
                    const matchedProd = products.find(p => p.id === m.productId);
                    const loc = matchedProd?.physicalLocation || 'Estudio / No especificada';
                    
                    return (
                      <tr key={m.id} className="hover:bg-[var(--bg-surface)] ">
                        <td className="p-3 text-slate-500 text-[10px]">{m.id}</td>
                        <td className="p-3">
                          <span className="font-bold text-[var(--text-primary)] block">{m.productName}</span>
                        </td>
                        <td className="p-3 text-center font-bold">
                          {m.quantityChange > 0 ? (
                            <span className="text-emerald-400 dark:text-[var(--brand-gold-light)]">+{m.quantityChange}</span>
                          ) : (
                            <span className="text-rose-400">{m.quantityChange}</span>
                          )}
                        </td>
                        <td className="p-3 text-center">
                          <span className={`px-2 py-0.5 rounded text-[9px] uppercase font-bold border ${
                            m.type === 'Entrada' ? 'bg-emerald-500 dark:bg-[var(--brand-gold-mid)]/10 text-emerald-300 dark:text-[var(--brand-gold-light)] border-emerald-500 dark:border-[var(--brand-gold-dark)] dark:border-[var(--brand-gold-mid)]/20' :
                            m.type === 'Salida' ? 'bg-rose-500/10 text-rose-300 border-rose-500/20' :
                            'bg-sky-500 dark:bg-[var(--brand-gold-mid)]/10 text-sky-300 dark:text-[var(--brand-gold-light)] border-sky-500 dark:border-[var(--brand-gold-dark)] dark:border-[var(--brand-gold-mid)]/20'
                          }`}>
                            {m.type}
                          </span>
                        </td>
                        <td className="p-3 text-sky-300 dark:text-[var(--brand-gold-light)] font-semibold">{loc}</td>
                        <td className="p-3 text-slate-500 text-[11px] max-w-xs truncate" title={m.notes}>{m.notes}</td>
                        <td className="p-3">
                          <div className="text-[10px] font-medium text-[var(--text-secondary)]">{m.userEmail}</div>
                          <div className="text-[9px] text-slate-500">{new Date(m.timestamp).toLocaleDateString()} {new Date(m.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
