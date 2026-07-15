import { db, storage, auth } from '../firebase';
import { 
  collection, doc, setDoc, deleteDoc, onSnapshot, getDoc, getDocs, 
  writeBatch, query, limit, getDocFromServer 
} from 'firebase/firestore';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';
import { supabase } from '../supabaseClient';
import { 
  User, Product, InventoryMovement, RepairOrder, Order, 
  MembershipTier, ChatConversation, Employee, Payroll, 
  AuditLog, ClientProfile, LogisticsDelivery, MarketingCampaign,
  AppSettings, Banner, HistoricalSku
} from '../types';

export const ADMIN_PASSWORD = "T3chn0V3rs3!Admin2026";

interface Database {
  users: User[];
  products: Product[];
  inventory_movements: InventoryMovement[];
  repair_orders: RepairOrder[];
  orders: Order[];
  membership_tiers: MembershipTier[];
  chat_conversations: ChatConversation[];
  employees: Employee[];
  payroll: Payroll[];
  audit_log: AuditLog[];
  clients: ClientProfile[];
  deliveries: LogisticsDelivery[];
  marketing_campaigns: MarketingCampaign[];
  banners: Banner[];
  settings?: AppSettings;
  historical_skus?: HistoricalSku[];
}

const DEFAULT_BANNERS: Banner[] = [ { id: 'BAN-001', title: 'Reparación desde Casa', description: 'Ahorre tiempo', type: 'Servicios', active: true } ];
const DEFAULT_MEMBERSHIPS: MembershipTier[] = [ { id: 'Plata', name: 'Membresía Plata', price: 5000, discountPercent: 5, shippingSJ: 2000, shippingOther: 3500, active: true, features: [] } ];
const DEFAULT_SETTINGS: AppSettings = { cedulaJuridica: '3-101-987452', companyPhone: '+506 6421 4795', companyAddress: 'San José', workshopAddress: 'San José', pickupHours: 'L-V 1pm-6pm', maxStockLimit: 50 };

const COLLECTIONS_CONFIG = [
  { key: 'inventory_movements', colName: 'movimientosInventario', idKey: 'id' },
  { key: 'repair_orders', colName: 'ordenesReparacion', idKey: 'id' },
  { key: 'orders', colName: 'ordenesVenta', idKey: 'id' },
  { key: 'membership_tiers', colName: 'membership_tiers', idKey: 'id' },
  { key: 'chat_conversations', colName: 'chat_conversations', idKey: 'id' },
  { key: 'employees', colName: 'empleados', idKey: 'id' },
  { key: 'users', colName: 'usuarios', idKey: 'id' },
  { key: 'payroll', colName: 'payroll', idKey: 'id' },
  { key: 'audit_log', colName: 'audit_log', idKey: 'id' },
  { key: 'clients', colName: 'clients', idKey: 'id' },
  { key: 'deliveries', colName: 'deliveries', idKey: 'id' },
  { key: 'marketing_campaigns', colName: 'marketing_campaigns', idKey: 'id' },
  { key: 'banners', colName: 'banners', idKey: 'id' },
  { key: 'historical_skus', colName: 'historicalSKUs', idKey: 'sku' }
];

let localCache: Database = getDefaultDB();
let lastSyncedDb: Database | null = null;
let isSyncing = false;
let isQuotaExceeded = false;
let activeListeners: (() => void)[] = [];
let saveTimeout: any = null;
let initializedCollectionsCount = 0;
let pendingWrites: Database[] = [];
let broadcastChannel: BroadcastChannel | null = null;

if (typeof window !== 'undefined') {
  try {
    broadcastChannel = new BroadcastChannel('technoverse_db_channel');
  } catch (e) {
    broadcastChannel = null;
  }
}

// ===================== Supabase: Productos en tiempo real =====================
// Los productos ahora viven en Supabase (tabla "products"), no en Firestore.
// Esto se hizo para tener una base de datos en tiempo real funcional sin
// depender de las cuotas/créditos de Firebase para esta colección.

function mapProductFromSupabase(row: any): Product {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    category: row.category,
    price: Number(row.price) || 0,
    cost: Number(row.cost) || 0,
    stock: row.stock ?? 0,
    imageUrl: row.image_url || '',
    discountPercent: Number(row.discount_percent) || 0,
    discountStartDate: row.discount_start_date || undefined,
    discountEndDate: row.discount_end_date || undefined,
    applicableMemberships: row.applicable_memberships || [],
    active: row.active !== false,
    description: row.description || '',
    minStock: row.min_stock ?? 0,
    weight: row.weight ?? undefined,
    dimensions: row.dimensions || undefined,
    row: row.warehouse_row || undefined,
    shelf: row.shelf || undefined,
    physicalLocation: row.physical_location || undefined,
    warranty: row.warranty || undefined,
    isDoubleStock: row.is_double_stock || false,
    internalStock: row.internal_stock ?? 0,
    clientStock: row.client_stock ?? 0,
    linkedSparePartSku: row.linked_spare_part_sku || undefined,
  };
}

function mapProductToSupabase(p: Product): any {
  return {
    id: p.id,
    name: p.name || '',
    sku: p.sku || '',
    category: p.category || '',
    price: p.price || 0,
    cost: p.cost || 0,
    stock: p.stock || 0,
    image_url: p.imageUrl || '',
    discount_percent: p.discountPercent || 0,
    discount_start_date: p.discountStartDate || null,
    discount_end_date: p.discountEndDate || null,
    applicable_memberships: p.applicableMemberships || [],
    active: p.active !== false,
    description: p.description || '',
    min_stock: p.minStock || 0,
    weight: p.weight ?? null,
    dimensions: p.dimensions || null,
    warehouse_row: p.row || null,
    shelf: p.shelf || null,
    physical_location: p.physicalLocation || null,
    warranty: p.warranty || null,
    is_double_stock: p.isDoubleStock || false,
    internal_stock: p.internalStock || 0,
    client_stock: p.clientStock || 0,
    linked_spare_part_sku: p.linkedSparePartSku || null,
  };
}

let productsRealtimeReady = false;
let pendingProductWrites: { added: Product[]; modified: Product[]; deleted: Product[] }[] = [];

async function refreshProductsFromSupabase() {
  const { data, error } = await supabase.from('products').select('*');
  if (error) {
    console.error('[Supabase] Error cargando productos:', error.message);
    return;
  }
  const items = (data || []).map(mapProductFromSupabase);
  localCache.products = items;
  if (!lastSyncedDb) {
    lastSyncedDb = JSON.parse(JSON.stringify(localCache));
  } else {
    lastSyncedDb.products = JSON.parse(JSON.stringify(items));
  }
  notifyUpdate();
}

async function initProductsRealtimeSync() {
  await refreshProductsFromSupabase();
  productsRealtimeReady = true;
  flushPendingProductWrites();

  supabase
    .channel('products-realtime-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => {
      refreshProductsFromSupabase();
    })
    .subscribe();
}

async function syncProductsToSupabase(added: Product[], modified: Product[], deleted: Product[]) {
  if (!productsRealtimeReady) {
    pendingProductWrites.push({ added, modified, deleted });
    return;
  }
  try {
    for (const item of added) {
      const { error } = await supabase.from('products').insert(mapProductToSupabase(item));
      if (error) console.error('[Supabase] Error creando producto:', error.message);
    }
    for (const item of modified) {
      const { error } = await supabase.from('products').update(mapProductToSupabase(item)).eq('id', item.id);
      if (error) console.error('[Supabase] Error actualizando producto:', error.message);
    }
    for (const item of deleted) {
      const { error } = await supabase.from('products').delete().eq('id', item.id);
      if (error) console.error('[Supabase] Error eliminando producto:', error.message);
    }
  } catch (err: any) {
    console.error('[Supabase] Error de sincronización de productos:', err?.message || err);
  }
}

async function flushPendingProductWrites() {
  while (pendingProductWrites.length > 0) {
    const pending = pendingProductWrites.shift()!;
    await syncProductsToSupabase(pending.added, pending.modified, pending.deleted);
  }
}
// ================== Fin Supabase: Productos en tiempo real ==================


function mapToFirestore(colName: string, item: any): any {
  const mapped: any = { ...item };
  if (colName === 'productos' || colName === 'repuestos') {
    mapped.sku = item.sku || item.id || '';
    mapped.nombre = item.name || '';
    mapped.categoria = item.category || '';
    mapped.precioVenta = item.price || 0;
    mapped.precioCosto = item.cost || 0;
    mapped.costo = item.cost || 0;
    mapped.stock = item.stock || 0;
    mapped.imagen = item.imageUrl || '';
    mapped.garantia = item.category === 'Repuestos' || ['LCD', 'Batería', 'Flex'].includes(item.category) ? '3 meses' : '1 mes';
    mapped.vinculadoARepuesto = item.linkedSparePartSku || '';
    mapped.ubicacion = item.location || 'Bodega 1';
    mapped.activo = item.active !== false;
  }
  if (colName === 'ordenesReparacion') {
    mapped.guia = item.id || '';
    mapped.ticket = item.ticket || '';
    mapped.cliente = { nombre: item.customerName || '', email: item.customerEmail || '', telefono: '' };
    mapped.dispositivo = { marca: '', modelo: item.device || '' };
    mapped.estado = item.status || '';
    mapped.repuestosConsumidos = (item.repuestos || []).map((r: any) => ({ sku: r.productId || '', cantidad: r.quantity || 1 }));
    mapped.manoDeObra = item.laborCost || 0;
    mapped.costoTotal = item.totalCost || 0;
    mapped.prioridad = 'Normal';
    mapped.lugarReparacion = 'Taller Central';
    mapped.notasInternas = item.damageReported || '';
    mapped.historialEstados = [];
    mapped.fechaCreacion = item.date || new Date().toISOString();
    mapped.fechaActualizacion = new Date().toISOString();
  }
  if (colName === 'ordenesVenta') {
    mapped.clienteId = item.customerId || '';
    mapped.items = (item.items || []).map((i: any) => ({ productId: i.productId || '', cantidad: i.quantity || 1, precioUnitario: i.price || 0 }));
    mapped.total = item.total || 0;
    mapped.estado = item.status || 'Pagado';
    mapped.factura = { numero: item.id || '', xml: '', estadoHacienda: 'Aceptado' };
    mapped.fechaCreacion = item.date || new Date().toISOString();
  }
  if (colName === 'usuarios') {
    mapped.email = item.email || '';
    mapped.passwordHash = item.passwordHash || 'hashed';
    mapped.rol = item.role || '';
    mapped.nombre = item.name || '';
    mapped.telefono = item.phone || '';
    mapped.direccion = item.address || '';
    mapped.membresia = item.membership || '';
    mapped.fechaIngreso = item.joinDate || new Date().toISOString();
    mapped.activo = item.active !== false;
  }
  if (colName === 'movimientosInventario') {
    mapped.productoId = item.productId || item.sku || '';
    mapped.tipo = item.type || '';
    mapped.cantidad = item.quantity || 0;
    mapped.usuario = item.userEmail || '';
    mapped.referencia = item.reference || '';
    mapped.fecha = item.date || new Date().toISOString();
  }
  if (colName === 'historicalSKUs') {
    mapped.sku = item.sku || '';
    mapped.nombre = item.name || '';
    mapped.categoria = item.category || '';
    mapped.precio = item.price || 0;
    mapped.costo = item.cost || 0;
    mapped.imagen = item.imageUrl || '';
    mapped.fechaEliminacion = item.deletedAt || new Date().toISOString();
  }
  if (colName === 'configuracion' || colName === 'settings') {
    mapped.logoURL = item.storeLogo || '';
    mapped.storeLogo = item.storeLogo || '';
    mapped.datosEmpresa = {
      nombre: 'Technoverse',
      razonSocial: 'Technoverse S.A.',
      cedulaJuridica: item.cedulaJuridica || '',
      direccion: item.companyAddress || '',
      telefono: item.companyPhone || '',
      email: 'info@technoverse.com'
    };
    mapped.consecutivos = { factura: 1, notaCredito: 1, guia: 1, ticket: 1 };
    mapped.impuestos = { iva: 13 };
  }
  return mapped;
}

export function checkQuotaError(err: any) {
  if (!err) return;
  const message = err?.message || String(err || '');
  const isQuota = message.toLowerCase().includes('quota') || message.toLowerCase().includes('limit exceeded');

  if (isQuota) {
    isQuotaExceeded = true;
    console.error("[Sistema] Límite de Firebase alcanzado. Los cambios en tiempo real podrían detenerse.");
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('firebase_quota_exceeded', { detail: { message: "Se ha excedido la cuota de Firebase." } }));
    }
    return;
  }
  console.error("[Firebase Error]", err);
}

export function isFirebaseQuotaExceeded() {
  return isQuotaExceeded;
}

function getDefaultDB(): Database {
  return {
    users: [{ id: 'admin-id', email: 'technoverse.admin@gmail.com', role: 'Dueño', name: 'Administrador Technoverse' }],
    products: [], inventory_movements: [], repair_orders: [], orders: [],
    membership_tiers: DEFAULT_MEMBERSHIPS, chat_conversations: [], employees: [],
    payroll: [], audit_log: [], clients: [], deliveries: [], marketing_campaigns: [],
    banners: DEFAULT_BANNERS, settings: DEFAULT_SETTINGS, historical_skus: []
  };
}

async function initRealTimeSync() {
  console.log("[Sistema] Iniciando canales de comunicación en tiempo real...");
  
  COLLECTIONS_CONFIG.forEach(({ key, colName }) => {
    const unsub = onSnapshot(collection(db, colName), (snapshot) => {
      const items: any[] = [];
      snapshot.forEach(doc => items.push(doc.data()));
      
      if (key === 'users') {
         const hasAdmin = items.find(u => u.email === 'technoverse.admin@gmail.com');
         if (!hasAdmin) {
            items.push({ id: 'admin-id', email: 'technoverse.admin@gmail.com', role: 'Dueño', name: 'Administrador Technoverse' });
         }
      }
      const prevData = JSON.stringify((localCache as any)[key]);

      const newData = JSON.stringify(items);
      if (prevData !== newData) {
        (localCache as any)[key] = items;
        if (!lastSyncedDb) {
          lastSyncedDb = JSON.parse(JSON.stringify(localCache));
        } else {
          (lastSyncedDb as any)[key] = JSON.parse(JSON.stringify(items));
        }
        notifyUpdate();
      }
    }, (err) => checkQuotaError(err));
    activeListeners.push(unsub);
  });

  // Productos: sincronizados en tiempo real vía Supabase (no Firestore).
  initProductsRealtimeSync();

  const unsubSettings = onSnapshot(doc(db, 'configuracion', 'settings'), (docSnap) => {
    if (docSnap.exists()) {
      const raw = docSnap.data() as any;
      const serverSettings: AppSettings = {
        cedulaJuridica: raw.datosEmpresa?.cedulaJuridica || raw.cedulaJuridica || '',
        companyPhone: raw.datosEmpresa?.telefono || raw.companyPhone || '',
        companyAddress: raw.datosEmpresa?.direccion || raw.companyAddress || '',
        workshopAddress: raw.workshopAddress || raw.datosEmpresa?.direccion || '',
        pickupHours: raw.pickupHours || 'L-V 1pm-6pm',
        maxStockLimit: raw.maxStockLimit || 50,
        storeLogo: raw.logoURL || raw.storeLogo || raw.settings?.storeLogo || undefined
      };
      const prevSettings = JSON.stringify(localCache.settings);
      const newSettings = JSON.stringify(serverSettings);

      if (prevSettings !== newSettings) {
        localCache.settings = serverSettings;
        if (lastSyncedDb) lastSyncedDb.settings = JSON.parse(JSON.stringify(serverSettings));
        notifyUpdate();
      }
    }

    if (initializedCollectionsCount < COLLECTIONS_CONFIG.length + 1) {
      initializedCollectionsCount++;
      if (initializedCollectionsCount === COLLECTIONS_CONFIG.length + 1) {
        console.log("[Sistema] Base de datos conectada y sincronizada al 100%.");
        flushPendingWrites();
      }
    }
  }, (err) => checkQuotaError(err));
  activeListeners.push(unsubSettings);
}

function saveLocal() {
  // Obsoleto: Ya no usamos localStorage para guardar datos transaccionales, todo va a Firestore
}

function notifyUpdate() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('technoverse_db_updated', { detail: localCache }));
    if (broadcastChannel) {
      try { broadcastChannel.postMessage({ type: 'UPDATE_DB' }); } catch (e) {}
    }
  }
}

export function initFirebaseSync() {
  if (isSyncing) return;
  isSyncing = true;
  
  console.log("[Sistema] Sincronización Real-Time Directa Activada.");
  
  localCache = getDefaultDB();

  initRealTimeSync();
}

if (typeof window !== 'undefined') {
  initFirebaseSync();
}

export function getDB(): Database {
  if (!localCache) {
    localCache = getDefaultDB();
  }
  return JSON.parse(JSON.stringify(localCache));
}

function diffArrays(oldArr: any[], newArr: any[], key = 'id') {
  const safeOldArr = (oldArr || []).filter(item => item && item[key] !== undefined);
  const safeNewArr = (newArr || []).filter(item => item && item[key] !== undefined);

  const oldMap = new Map(safeOldArr.map(item => [item[key], item]));
  const added: any[] = [];
  const modified: any[] = [];
  const deleted: any[] = [];
  
  safeNewArr.forEach(item => {
    if (!oldMap.has(item[key])) added.push(item);
    else {
      const oldItem = oldMap.get(item[key]);
      if (JSON.stringify(oldItem) !== JSON.stringify(item)) modified.push(item);
      oldMap.delete(item[key]);
    }
  });
  oldMap.forEach(item => deleted.push(item));
  return { added, modified, deleted };
}

function cleanObject(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(cleanObject);
  }
  const clean: any = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const val = obj[key];
      if (val !== undefined) {
        clean[key] = cleanObject(val);
      }
    }
  }
  return clean;
}

export function compressImage(dataUrl: string, maxWidth = 500, maxHeight = 500, quality = 0.7): Promise<string> {
  return new Promise((resolve) => {
    if (!dataUrl || !dataUrl.startsWith('data:')) {
      resolve(dataUrl);
      return;
    }
    const img = new Image();
    img.onload = () => {
      let width = img.width;
      let height = img.height;
      if (width > height) {
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      try {
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch (err) {
        resolve(dataUrl);
      }
    };
    img.onerror = () => {
      resolve(dataUrl);
    };
    img.src = dataUrl;
  });
}

async function uploadEmbeddedImages(obj: any, pathPrefix: string): Promise<any> {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    const promises = obj.map(item => uploadEmbeddedImages(item, pathPrefix));
    return Promise.all(promises);
  }
  const result: any = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const val = obj[key];
      if (typeof val === 'string' && val.startsWith('data:') && val.includes(';base64,')) {
        try {
          const compressedVal = await compressImage(val, 600, 600, 0.75);
          const fileRef = ref(storage, `${pathPrefix}/${Date.now()}_${Math.floor(Math.random() * 100000)}.jpg`);
          await uploadString(fileRef, compressedVal, 'data_url');
          const downloadUrl = await getDownloadURL(fileRef);
          result[key] = downloadUrl;
        } catch (err) {
          checkQuotaError(err);
          try {
            const lowResVal = await compressImage(val, 300, 300, 0.6);
            result[key] = lowResVal;
          } catch (compressErr) {
            result[key] = val;
          }
        }
      } else {
        result[key] = await uploadEmbeddedImages(val, pathPrefix);
      }
    }
  }
  return result;
}

async function flushPendingWrites() {
  while (pendingWrites.length > 0) {
    const pending = pendingWrites.shift()!;
    try {
      const dbToSyncFrom = JSON.parse(JSON.stringify(lastSyncedDb!));
      const dbToSyncTo = JSON.parse(JSON.stringify(pending));
      await performSync(dbToSyncFrom, dbToSyncTo);
    } catch (err) {
      checkQuotaError(err);
    }
  }
}

export async function saveDB(newDb: Database) {
  localCache = newDb;
  notifyUpdate();

  if (!lastSyncedDb) {
    pendingWrites.push(newDb);
    console.warn("[Sistema] Firestore aún no responde. Cambio encolado y se guardará automáticamente.");
    return;
  }

  const dbToSyncFrom = JSON.parse(JSON.stringify(lastSyncedDb));
  const dbToSyncTo = JSON.parse(JSON.stringify(newDb));

  try {
    await performSync(dbToSyncFrom, dbToSyncTo);
  } catch (err) {
    checkQuotaError(err);
    localCache = JSON.parse(JSON.stringify(lastSyncedDb));
    notifyUpdate();
  }
}

async function performSync(oldDb: Database, newDb: Database) {
  const diffs: any[] = [];

  // Productos: van a Supabase, no a Firestore.
  const productDiff = diffArrays(oldDb.products || [], newDb.products || [], 'id');
  const hasProductChanges = productDiff.added.length > 0 || productDiff.modified.length > 0 || productDiff.deleted.length > 0;

  COLLECTIONS_CONFIG.forEach(({ key, colName, idKey }) => {
    const oldArr = (oldDb as any)[key] || [];
    const newArr = (newDb as any)[key] || [];
    diffs.push({ key, colName, idKey: idKey || 'id', ...diffArrays(oldArr, newArr, idKey || 'id') });
  });

  const settingsChanged = JSON.stringify(oldDb.settings) !== JSON.stringify(newDb.settings);
  const syncPromises: Promise<void>[] = [];

  if (hasProductChanges) {
    syncPromises.push(syncProductsToSupabase(productDiff.added, productDiff.modified, productDiff.deleted));
  }

  diffs.forEach(({ colName, idKey, added, modified, deleted }) => {
    if (added.length === 0 && modified.length === 0 && deleted.length === 0) return;

    syncPromises.push((async () => {
      const batch = writeBatch(db);
      let count = 0;

      for (const item of added) {
        const cleanItem = mapToFirestore(colName, cleanObject(item));
        const uploadedItem = await uploadEmbeddedImages(cleanItem, colName);
        if (uploadedItem[idKey]) {
          batch.set(doc(db, colName, uploadedItem[idKey]), uploadedItem);
          count++;
        }
      }
      for (const item of modified) {
        const cleanItem = mapToFirestore(colName, cleanObject(item));
        const uploadedItem = await uploadEmbeddedImages(cleanItem, colName);
        if (uploadedItem[idKey]) {
          batch.set(doc(db, colName, uploadedItem[idKey]), uploadedItem, { merge: true });
          count++;
        }
      }
      for (const item of deleted) {
        const cleanItem = mapToFirestore(colName, cleanObject(item));
        if (cleanItem[idKey]) {
          batch.delete(doc(db, colName, cleanItem[idKey]));
          count++;
        }
      }
      if (count > 0) await batch.commit();
    })());
  });

  if (settingsChanged) {
    syncPromises.push((async () => {
      const cleanSettings = mapToFirestore('configuracion', cleanObject(newDb.settings || {}));
      const uploadedSettings = await uploadEmbeddedImages(cleanSettings, 'settings');
      await setDoc(doc(db, 'configuracion', 'settings'), uploadedSettings);
    })());
  }

  try {
    await Promise.all(syncPromises);
  } catch (err) {
    checkQuotaError(err);
  }
}


export async function saveLogo(base64: string) {
  try {
    if (base64.startsWith('data:')) {
      try {
        const storageRef = ref(storage, 'settings/logo_' + Date.now());
        await uploadString(storageRef, base64, 'data_url');
        const url = await getDownloadURL(storageRef);
        const dbInst = getDB();
        if (!dbInst.settings) dbInst.settings = DEFAULT_SETTINGS;
        dbInst.settings.storeLogo = url;
        await saveDB(dbInst);
      } catch (storageErr) {
        console.warn("[Firebase Storage Warning] Storage upload failed, falling back to direct compressed base64 in Firestore settings:", storageErr);
        const lowResLogo = await compressImage(base64, 250, 250, 0.7);
        const dbInst = getDB();
        if (!dbInst.settings) dbInst.settings = DEFAULT_SETTINGS;
        dbInst.settings.storeLogo = lowResLogo;
        await saveDB(dbInst);
      }
    } else {
      const dbInst = getDB();
      if (!dbInst.settings) dbInst.settings = DEFAULT_SETTINGS;
      dbInst.settings.storeLogo = base64;
      await saveDB(dbInst);
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('store_logo_updated'));
    }
  } catch (err) {
    checkQuotaError(err);
    try {
      const dbInst = getDB();
      if (!dbInst.settings) dbInst.settings = DEFAULT_SETTINGS;
      dbInst.settings.storeLogo = base64;
      localCache = dbInst;
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('technoverse_db_updated', { detail: localCache }));
        window.dispatchEvent(new Event('store_logo_updated'));
      }
    } catch (localErr) {
      checkQuotaError(localErr);
    }
  }
}

export async function getLogo(): Promise<string | null> {
  const dbInst = getDB();
  return dbInst.settings?.storeLogo || null;
}

export function addAuditLog(userEmail: string, module: string, action: string, detail: string, existingDb?: Database) {
  const dbInst = existingDb || getDB();
  const newLog: AuditLog = {
    id: `LOG-${Math.floor(100000 + Math.random() * 900000)}`,
    userEmail: userEmail || 'technoverse.admin@gmail.com',
    module, action, detail,
    timestamp: new Date().toISOString()
  };
  if (!dbInst.audit_log) dbInst.audit_log = [];
  dbInst.audit_log.unshift(newLog);
  if (!existingDb) saveDB(dbInst);
}
