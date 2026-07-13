
import localforage from 'localforage';
import { db, storage, auth } from '../firebase';
import { collection, doc, setDoc, deleteDoc, onSnapshot, getDoc, getDocs, writeBatch } from 'firebase/firestore';
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
let isQuotaExceeded = false;

export function checkQuotaError(err: any) {
  if (!err) return;
  const msg = err?.message || String(err || '');
  if (
    msg.toLowerCase().includes('quota') || 
    msg.toLowerCase().includes('limit exceeded') || 
    msg.toLowerCase().includes('exceeded') ||
    msg.toLowerCase().includes('permission-denied') ||
    msg.toLowerCase().includes('insufficient permissions')
  ) {
    if (!isQuotaExceeded) {
      isQuotaExceeded = true;
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('firebase_quota_status', { detail: { exceeded: true, message: msg } }));
      }
    }
  }
}

export function isFirebaseQuotaExceeded() {
  // If the user's quota is exceeded or the environment throws permission/quota errors,
  // we default to true to show the local backup mode helper.
  if (typeof window !== 'undefined' && (window as any).__technoverseQuotaExceeded) {
    return true;
  }
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

interface SyncState {
  products?: number;
  inventory_movements?: number;
  repair_orders?: number;
  orders?: number;
  membership_tiers?: number;
  chat_conversations?: number;
  employees?: number;
  payroll?: number;
  audit_log?: number;
  clients?: number;
  deliveries?: number;
  marketing_campaigns?: number;
  banners?: number;
  settings?: number;
  historical_skus?: number;
}

function getLocalSyncTimestamps(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  const saved = localStorage.getItem('technoverse_sync_timestamps');
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch (e) {}
  }
  return {};
}

function saveLocalSyncTimestamps(timestamps: Record<string, number>) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('technoverse_sync_timestamps', JSON.stringify(timestamps));
  } catch (e) {}
}

export async function processServerSyncState(serverState: SyncState) {
  if (!serverState) return;
  const localTimestamps = getLocalSyncTimestamps();
  let hasChanges = false;
  
  if (!localCache) {
    localCache = getDB();
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

  const fetchPromises = collectionsToSync.map(async ({ key, colName }) => {
    const serverTime = serverState[key as keyof SyncState] || 0;
    const localTime = localTimestamps[key] || 0;
    
    // Fetch if server timestamp is newer, or if we don't have this collection's data locally
    if (serverTime > localTime || localTime === 0 || !localCache?.[key as keyof Database]) {
      try {
        const querySnapshot = await getDocs(collection(db, colName));
        const items: any[] = [];
        querySnapshot.forEach((doc) => {
          items.push(doc.data());
        });
        
        if (localCache) {
          (localCache as any)[key] = items;
          hasChanges = true;
        }
        localTimestamps[key] = serverTime || Date.now();
      } catch (err) {
        checkQuotaError(err);
        console.error(`[Firebase Pull Error] Failed to fetch collection '${colName}':`, err);
      }
    }
  });

  // Settings
  const serverSettingsTime = serverState.settings || 0;
  const localSettingsTime = localTimestamps.settings || 0;
  if (serverSettingsTime > localSettingsTime || localSettingsTime === 0 || !localCache?.settings) {
    try {
      const docSnap = await getDoc(doc(db, 'globals', 'settings'));
      if (docSnap.exists() && localCache) {
        localCache.settings = docSnap.data() as AppSettings;
        hasChanges = true;
      }
      localTimestamps.settings = serverSettingsTime || Date.now();
    } catch (err) {
      checkQuotaError(err);
      console.error(`[Firebase Pull Error] Failed to fetch settings:`, err);
    }
  }

  await Promise.all(fetchPromises);

  if (hasChanges) {
    try {
      localStorage.setItem('technoverse_db', JSON.stringify(localCache));
    } catch (e) {
      console.warn('localStorage quota exceeded or unavailable', e);
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('technoverse_db_updated', { detail: localCache }));
    }
  }
  
  saveLocalSyncTimestamps(localTimestamps);
}

export async function fetchFullDatabaseFromFirebase() {
  try {
    const docSnap = await getDoc(doc(db, 'globals', 'sync_state'));
    if (docSnap.exists()) {
      const serverState = docSnap.data() as SyncState;
      await processServerSyncState(serverState);
    } else {
      // Create initial sync_state on server if it doesn't exist
      const initialSync: SyncState = {};
      const now = Date.now();
      const keys = [
        'products', 'inventory_movements', 'repair_orders', 'orders', 
        'membership_tiers', 'chat_conversations', 'employees', 'payroll',
        'audit_log', 'clients', 'deliveries', 'marketing_campaigns', 'banners', 'historical_skus', 'settings'
      ];
      keys.forEach(k => { initialSync[k as keyof SyncState] = now; });
      await setDoc(doc(db, 'globals', 'sync_state'), initialSync);
      await processServerSyncState(initialSync);
    }
  } catch (err) {
    checkQuotaError(err);
    console.error("[Firebase Sync Poll Error] Error pulling sync state:", err);
  }
}

export function initFirebaseSync() {
  if (isSyncing) return;
  isSyncing = true;
  
  const saved = localStorage.getItem('technoverse_db');
  if (saved) {
    try { localCache = JSON.parse(saved); } catch(e) {}
  }
  if (!localCache) localCache = getDefaultDB();
  
  // Real-time listener for the single sync state document
  let unsubscribe: (() => void) | null = null;
  try {
    unsubscribe = onSnapshot(doc(db, 'globals', 'sync_state'), (docSnap) => {
      if (docSnap.exists()) {
        const serverState = docSnap.data() as SyncState;
        processServerSyncState(serverState);
      } else {
        // If server sync_state doesn't exist, let's create it once
        const initialSync: SyncState = {};
        const now = Date.now();
        const keys = [
          'products', 'inventory_movements', 'repair_orders', 'orders', 
          'membership_tiers', 'chat_conversations', 'employees', 'payroll',
          'audit_log', 'clients', 'deliveries', 'marketing_campaigns', 'banners', 'historical_skus', 'settings'
        ];
        keys.forEach(k => { initialSync[k as keyof SyncState] = now; });
        setDoc(doc(db, 'globals', 'sync_state'), initialSync).catch(err => {
          checkQuotaError(err);
          console.error("Failed to write initial sync_state:", err);
        });
      }
    }, (error) => {
      checkQuotaError(error);
      console.error(`[Firebase Sync Error] Error in onSnapshot for 'globals/sync_state':`, error);
    });
  } catch (err) {
    checkQuotaError(err);
  }

  // Fallback periodic polling of the single sync state document (every 20 seconds)
  // to ensure offline/network-interrupted/iframe-blocked environments can sync reliably
  setInterval(async () => {
    try {
      const docSnap = await getDoc(doc(db, 'globals', 'sync_state'));
      if (docSnap.exists()) {
        const serverState = docSnap.data() as SyncState;
        await processServerSyncState(serverState);
      }
    } catch (err) {
      checkQuotaError(err);
      console.error(`[Firebase Sync Poll Error] Error pulling sync state:`, err);
    }
  }, 20000);
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
          console.error('[Firebase Storage Upload Error] Failed to upload image, falling back to super compressed base64:', err);
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
  // 1. Capture old state synchronously BEFORE any awaits, to correctly determine what the user changed.
  const oldDb = localCache ? JSON.parse(JSON.stringify(localCache)) : getDefaultDB();

  // 2. Optimistically update localCache IMMEDIATELY so the UI reflects changes instantly without flickering.
  localCache = newDb;
  try {
        localStorage.setItem('technoverse_db', JSON.stringify(localCache));
      } catch (e) {
        console.warn('localStorage quota exceeded or unavailable', e);
      }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('technoverse_db_updated', { detail: localCache }));
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
    { key: 'historical_skus', colName: 'historical_skus', idKey: 'sku' }
  ];

  // 3. Pre-calculate diffs synchronously
  const diffs = collectionsToSync.map(({ key, colName, idKey }) => {
    const oldArr = (oldDb as any)[key] || [];
    const newArr = (newDb as any)[key] || [];
    const diff = diffArrays(oldArr, newArr, idKey || 'id');
    return { key, colName, idKey: idKey || 'id', ...diff };
  });

  const settingsChanged = JSON.stringify(oldDb.settings) !== JSON.stringify(newDb.settings);

  const syncPromises: Promise<void>[] = [];

  // 5. Build sync promises
  diffs.forEach(({ colName, idKey, added, modified, deleted }) => {
    if (added.length === 0 && modified.length === 0 && deleted.length === 0) return;

    const syncToFirebase = async () => {
      for (const item of added) {
        const cleanItem = cleanObject(item);
        const uploadedItem = await uploadEmbeddedImages(cleanItem, colName);
        if (uploadedItem[idKey]) {
          await setDoc(doc(db, colName, uploadedItem[idKey]), uploadedItem);
        }
      }
      for (const item of modified) {
        const cleanItem = cleanObject(item);
        const uploadedItem = await uploadEmbeddedImages(cleanItem, colName);
        if (uploadedItem[idKey]) {
          await setDoc(doc(db, colName, uploadedItem[idKey]), uploadedItem, { merge: true });
        }
      }
      for (const item of deleted) {
        const cleanItem = cleanObject(item);
        if (cleanItem[idKey]) {
          await deleteDoc(doc(db, colName, cleanItem[idKey]));
        }
      }
    };
    syncPromises.push(syncToFirebase());
  });

  if (settingsChanged) {
    const syncSettings = async () => {
      const cleanSettings = cleanObject(newDb.settings || {});
      const uploadedSettings = await uploadEmbeddedImages(cleanSettings, 'settings');
      await setDoc(doc(db, 'globals', 'settings'), uploadedSettings);
    };
    syncPromises.push(syncSettings());
  }

  // 6. Execute background sync safely
  try {
    await Promise.all(syncPromises);

    // Update the globals/sync_state document to notify other clients
    const syncUpdate: Partial<SyncState> = {};
    const localTimestamps = getLocalSyncTimestamps();
    const updateTime = Date.now();

    diffs.forEach(({ key, added, modified, deleted }) => {
      if (added.length > 0 || modified.length > 0 || deleted.length > 0) {
        syncUpdate[key as keyof SyncState] = updateTime;
        localTimestamps[key] = updateTime;
      }
    });

    if (settingsChanged) {
      syncUpdate.settings = updateTime;
      localTimestamps.settings = updateTime;
    }

    if (Object.keys(syncUpdate).length > 0) {
      saveLocalSyncTimestamps(localTimestamps);
      try {
        await setDoc(doc(db, 'globals', 'sync_state'), syncUpdate, { merge: true });
      } catch (err) {
        console.error("[Firebase Sync Error] Error updating sync state document:", err);
      }
    }
  } catch (err) {
    console.error("[Firebase Sync Error] Error syncing data:", err);
    checkQuotaError(err);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('firebase_sync_failed', { detail: err }));
    }
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
    console.error("[Firebase Storage Error] Error saving logo:", err);
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
      console.error("Local storage fallback failed too:", localErr);
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
