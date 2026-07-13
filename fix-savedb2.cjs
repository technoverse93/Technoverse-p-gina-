const fs = require('fs');
let code = fs.readFileSync('src/utils/storage.ts', 'utf-8');

const startIndex = code.indexOf('export async function saveDB(newDb: Database) {');
const endIndex = code.indexOf('export async function saveLogo(base64: string) {');

const newSaveDB = `export async function saveDB(newDb: Database) {
  // 1. Capture old state synchronously BEFORE any awaits, to correctly determine what the user changed.
  const oldDb = localCache ? JSON.parse(JSON.stringify(localCache)) : getDefaultDB();

  // 2. Optimistically update localCache IMMEDIATELY so the UI reflects changes instantly without flickering.
  localCache = newDb;
  localStorage.setItem('technoverse_db', JSON.stringify(localCache));
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

  // 4. Wait for auth to initialize before attempting writes
  await new Promise<void>((resolve) => {
    let isResolved = false;
    const unsubscribe = auth.onAuthStateChanged(() => {
      if (!isResolved) {
        isResolved = true;
        if (typeof unsubscribe === 'function') {
          unsubscribe();
        } else {
          setTimeout(() => { if (typeof unsubscribe === 'function') unsubscribe(); }, 0);
        }
        resolve();
      }
    });
  });

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
  } catch (err) {
    console.error("[Firebase Sync Error] Error syncing data:", err);
    if (typeof window !== 'undefined') {
      alert("Error de red o permisos al guardar en el servidor. Tus cambios no se aplicaron. " + (err as any).message);
    }
  }
}

`;

code = code.substring(0, startIndex) + newSaveDB + code.substring(endIndex);
fs.writeFileSync('src/utils/storage.ts', code);
console.log('done');
