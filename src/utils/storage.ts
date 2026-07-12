
import localforage from 'localforage';
import { db, storage, auth } from '../firebase';
import { collection, doc, setDoc, deleteDoc, onSnapshot, getDoc, writeBatch } from 'firebase/firestore';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';
import { 
  User, Product, InventoryMovement, RepairOrder, Order, 
  MembershipTier, ChatConversation, Employee, Payroll, 
  AuditLog, ClientProfile, LogisticsDelivery, MarketingCampaign,
  AppSettings, Banner, HistoricalSku
} from '../types';

export const ADMIN_PASSWORD = "T7vX9zR2mK4w";

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

// We keep a local cache in memory to serve getDB() synchronously
let localCache: Database | null = null;
let isSyncing = false;

function getDefaultDB(): Database {
  return {
    users: [{ id: 'admin-id', email: 'admin@technoverse.com', role: 'Dueño', name: 'Administrador Technoverse' }],
    products: [], inventory_movements: [], repair_orders: [], orders: [],
    membership_tiers: DEFAULT_MEMBERSHIPS, chat_conversations: [], employees: [],
    payroll: [], audit_log: [], clients: [], deliveries: [], marketing_campaigns: [],
    banners: DEFAULT_BANNERS, settings: DEFAULT_SETTINGS, historical_skus: []
  };
}

export function initFirebaseSync() {
  if (isSyncing) return;
  isSyncing = true;
  
  const saved = localStorage.getItem('technoverse_db');
  if (saved) {
    try { localCache = JSON.parse(saved); } catch(e) {}
  }
  if (!localCache) localCache = getDefaultDB();
  
  // Real-time listeners for all collections
  const collectionsToSync = [
    'products', 'inventory_movements', 'repair_orders', 'orders', 
    'membership_tiers', 'chat_conversations', 'employees', 'payroll',
    'audit_log', 'clients', 'deliveries', 'marketing_campaigns', 'banners', 'historical_skus'
  ];
  
  collectionsToSync.forEach(colName => {
    onSnapshot(collection(db, colName), (snapshot) => {
      if (!localCache) return;
      const items: any[] = [];
      snapshot.forEach(doc => items.push(doc.data()));
      (localCache as any)[colName] = items;
      
      localStorage.setItem('technoverse_db', JSON.stringify(localCache));
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('technoverse_db_updated', { detail: localCache }));
      }
    });
  });
  
  onSnapshot(doc(db, 'globals', 'settings'), (docSnap) => {
    if (docSnap.exists() && localCache) {
      localCache.settings = docSnap.data() as AppSettings;
      localStorage.setItem('technoverse_db', JSON.stringify(localCache));
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('technoverse_db_updated', { detail: localCache }));
    }
  });
}

// Ensure it starts
if (typeof window !== 'undefined') {
  initFirebaseSync();
}

export function getDB(): Database {
  if (!localCache) {
    const saved = localStorage.getItem('technoverse_db');
    if (saved) {
      try { localCache = JSON.parse(saved); } catch(e) {}
    }
    if (!localCache) localCache = getDefaultDB();
  }
  return localCache;
}

function diffArrays(oldArr: any[], newArr: any[], key = 'id') {
  const oldMap = new Map(oldArr.map(item => [item[key], item]));
  const added: any[] = [];
  const modified: any[] = [];
  const deleted: any[] = [];
  
  newArr.forEach(item => {
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

export function saveDB(newDb: Database) {
  const oldDb = localCache || getDefaultDB();
  
  // Sync arrays to Firestore
  const collectionsToSync = [
    { key: 'products', colName: 'products' },
    { key: 'inventory_movements', colName: 'inventory_movements' },
    { key: 'repair_orders', colName: 'repair_orders' },
    { key: 'orders', colName: 'orders' },
    { key: 'membership_tiers', colName: 'membership_tiers' },
    { key: 'chat_conversations', colName: 'chat_conversations' },
    { key: 'employees', colName: 'employees' },
    { key: 'payroll', colName: 'payroll' },
    { key: 'audit_log', colName: 'audit_log' },
    { key: 'clients', colName: 'clients' },
    { key: 'deliveries', colName: 'deliveries' },
    { key: 'marketing_campaigns', colName: 'marketing_campaigns' },
    { key: 'banners', colName: 'banners' },
    { key: 'historical_skus', colName: 'historical_skus', idKey: 'sku' }
  ];
  
  collectionsToSync.forEach(({ key, colName, idKey }) => {
    const oldArr = (oldDb as any)[key] || [];
    const newArr = (newDb as any)[key] || [];
    const { added, modified, deleted } = diffArrays(oldArr, newArr, idKey || 'id');
    
    // We run async, don't block
    const syncToFirebase = async () => {
      // Very crude batching for simplicity
      for (const item of added) {
        if (item[idKey || 'id']) await setDoc(doc(db, colName, item[idKey || 'id']), item);
      }
      for (const item of modified) {
        if (item[idKey || 'id']) await setDoc(doc(db, colName, item[idKey || 'id']), item, { merge: true });
      }
      for (const item of deleted) {
        if (item[idKey || 'id']) await deleteDoc(doc(db, colName, item[idKey || 'id']));
      }
    };
    syncToFirebase();
  });
  
  if (JSON.stringify(oldDb.settings) !== JSON.stringify(newDb.settings)) {
    setDoc(doc(db, 'globals', 'settings'), newDb.settings || {});
  }
  
  localCache = newDb;
  localStorage.setItem('technoverse_db', JSON.stringify(newDb));
  
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('technoverse_db_updated', { detail: newDb }));
  }
}

export async function saveLogo(base64: string) {
  if (base64.startsWith('data:')) {
    const storageRef = ref(storage, 'settings/logo_' + Date.now());
    await uploadString(storageRef, base64, 'data_url');
    const url = await getDownloadURL(storageRef);
    const dbInst = getDB();
    if (!dbInst.settings) dbInst.settings = DEFAULT_SETTINGS;
    dbInst.settings.storeLogo = url;
    saveDB(dbInst);
  } else {
    const dbInst = getDB();
    if (!dbInst.settings) dbInst.settings = DEFAULT_SETTINGS;
    dbInst.settings.storeLogo = base64;
    saveDB(dbInst);
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('store_logo_updated'));
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
    userEmail: userEmail || 'admin@technoverse.com',
    module, action, detail,
    timestamp: new Date().toISOString()
  };
  if (!dbInst.audit_log) dbInst.audit_log = [];
  dbInst.audit_log.unshift(newLog);
  if (!existingDb) saveDB(dbInst);
}
