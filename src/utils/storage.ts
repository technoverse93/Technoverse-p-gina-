
import localforage from 'localforage';
import { db, storage, auth } from '../firebase';
import { collection, doc, setDoc, deleteDoc, onSnapshot, getDoc, getDocs, writeBatch, getDocFromServer } from 'firebase/firestore';
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

let localCache: Database = getDefaultDB();
let isSyncing = false;
let isQuotaExceeded = false;
let activeListeners: (() => void)[] = [];
let saveTimeout: any = null;

export function checkQuotaError(err: any) {
  if (!err) return;
  const code = err?.code || '';
  const message = err?.message || String(err || '');
  const isQuota = code === 'resource-exhausted' || 
                  message.toLowerCase().includes('quota') || 
                  message.toLowerCase().includes('limit exceeded');

  if (isQuota) {
    if (!isQuotaExceeded) {
      isQuotaExceeded = true;
      console.warn("[Sistema] Advertencia de cuota: La sincronización podría verse afectada por límites de Google, pero el sistema seguirá intentando conectar.");
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('firebase_quota_exceeded', { detail: { message } }));
      }
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

async function startCollectionListener(key: string, colName: string) {
  try {
    const unsub = onSnapshot(collection(db, colName), (querySnapshot) => {
      const items: any[] = [];
      querySnapshot.forEach((doc) => {
        items.push(doc.data());
      });
      
      (localCache as any)[key] = items;
      try {
        localStorage.setItem('technoverse_db', JSON.stringify(localCache));
      } catch (e) {}
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('technoverse_db_updated', { detail: localCache }));
      }
    }, (err) => {
      checkQuotaError(err);
    });
    activeListeners.push(unsub);
  } catch (err) {
    checkQuotaError(err);
  }
}

export function initFirebaseSync() {
  if (isSyncing) return;
  isSyncing = true;
  
  console.log("[Sistema] Sincronización Real-Time Activada.");
  
  const saved = localStorage.getItem('technoverse_db');
  if (saved) {
    try { localCache = JSON.parse(saved); } catch(e) {}
  }

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
    { key: 'historical_skus', colName: 'historical_skus' }
  ];

  collectionsToSync.forEach(({ key, colName }) => {
    startCollectionListener(key, colName);
  });

  try {
    const unsubSettings = onSnapshot(doc(db, 'globals', 'settings'), (docSnap) => {
      if (docSnap.exists()) {
        localCache.settings = docSnap.data() as AppSettings;
        localStorage.setItem('technoverse_db', JSON.stringify(localCache));
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('technoverse_db_updated', { detail: localCache }));
        }
      }
    }, (err) => checkQuotaError(err));
    activeListeners.push(unsubSettings);
  } catch (e) { checkQuotaError(e); }
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
          // Client-side compress before upload to keep it lightweight (600x600, 0.75 quality)
          const compressedVal = await compressImage(val, 600, 600, 0.75);
          const fileRef = ref(storage, `${pathPrefix}/${Date.now()}_${Math.floor(Math.random() * 100000)}.jpg`);
          await uploadString(fileRef, compressedVal, 'data_url');
          const downloadUrl = await getDownloadURL(fileRef);
          result[key] = downloadUrl;
        } catch (err) {
          checkQuotaError(err);
          // Fallback: compress even further (300x300, 0.6 quality) to fit easily in Firestore 1MB document size limit
          try {
            const lowResVal = await compressImage(val, 300, 300, 0.6);
            result[key] = lowResVal;
          } catch (compressErr) {
            result[key] = val; // ultimate fallback
          }
        }
      } else {
        result[key] = await uploadEmbeddedImages(val, pathPrefix);
      }
    }
  }
  return result;
}

export async function saveDB(newDb: Database) {
  const oldDb = localCache ? JSON.parse(JSON.stringify(localCache)) : getDefaultDB();
  localCache = newDb;
  
  try {
    localStorage.setItem('technoverse_db', JSON.stringify(localCache));
  } catch (e) {}

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('technoverse_db_updated', { detail: localCache }));
  }

  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    performSync(oldDb, newDb).catch(err => checkQuotaError(err));
  }, 1500);
}

async function performSync(oldDb: Database, newDb: Database) {
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

  const diffs = collectionsToSync.map(({ key, colName, idKey }) => {
    const oldArr = (oldDb as any)[key] || [];
    const newArr = (newDb as any)[key] || [];
    const diff = diffArrays(oldArr, newArr, idKey || 'id');
    return { key, colName, idKey: idKey || 'id', ...diff };
  });

  const settingsChanged = JSON.stringify(oldDb.settings) !== JSON.stringify(newDb.settings);
  const syncPromises: Promise<void>[] = [];

  diffs.forEach(({ colName, idKey, added, modified, deleted }) => {
    if (added.length === 0 && modified.length === 0 && deleted.length === 0) return;

    syncPromises.push((async () => {
      const batch = writeBatch(db);
      let count = 0;

      for (const item of added) {
        const cleanItem = cleanObject(item);
        const uploadedItem = await uploadEmbeddedImages(cleanItem, colName);
        if (uploadedItem[idKey]) {
          batch.set(doc(db, colName, uploadedItem[idKey]), uploadedItem);
          count++;
        }
      }
      for (const item of modified) {
        const cleanItem = cleanObject(item);
        const uploadedItem = await uploadEmbeddedImages(cleanItem, colName);
        if (uploadedItem[idKey]) {
          batch.set(doc(db, colName, uploadedItem[idKey]), uploadedItem, { merge: true });
          count++;
        }
      }
      for (const item of deleted) {
        const cleanItem = cleanObject(item);
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
      const cleanSettings = cleanObject(newDb.settings || {});
      const uploadedSettings = await uploadEmbeddedImages(cleanSettings, 'settings');
      await setDoc(doc(db, 'globals', 'settings'), uploadedSettings);
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
        // Compress base64 further so it takes very little space in Firestore
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
    // Ultimate fallback: save base64 directly to localCache/localStorage so at least current user sees it
    try {
      const dbInst = getDB();
      if (!dbInst.settings) dbInst.settings = DEFAULT_SETTINGS;
      dbInst.settings.storeLogo = base64;
      localCache = dbInst;
      localStorage.setItem('technoverse_db', JSON.stringify(localCache));
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
