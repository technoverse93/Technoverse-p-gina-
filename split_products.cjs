const fs = require('fs');

let code = fs.readFileSync('src/utils/storage.ts', 'utf-8');

// Replace diffs building
code = code.replace(
  /const diffs = COLLECTIONS_CONFIG\.map\(\(\{ key, colName, idKey \}\) => \{[\s\S]*?\}\);/,
  `const spareCategories = ['LCD', 'Batería', 'Rack de Carga', 'Tapa', 'Desbloqueo', 'Flex', 'Conector', 'Otra'];
  const diffs: any[] = [];
  
  COLLECTIONS_CONFIG.forEach(({ key, colName, idKey }) => {
    if (key === 'products') {
      const oldArr = (oldDb as any)[key] || [];
      const newArr = (newDb as any)[key] || [];
      
      const oldProds = oldArr.filter(p => !spareCategories.includes(p.category) && p.category !== 'Repuestos');
      const newProds = newArr.filter(p => !spareCategories.includes(p.category) && p.category !== 'Repuestos');
      diffs.push({ key: 'productos', colName: 'productos', idKey: idKey || 'id', ...diffArrays(oldProds, newProds, idKey || 'id') });
      
      const oldRep = oldArr.filter(p => spareCategories.includes(p.category) || p.category === 'Repuestos');
      const newRep = newArr.filter(p => spareCategories.includes(p.category) || p.category === 'Repuestos');
      diffs.push({ key: 'repuestos', colName: 'repuestos', idKey: idKey || 'id', ...diffArrays(oldRep, newRep, idKey || 'id') });
    } else {
      const oldArr = (oldDb as any)[key] || [];
      const newArr = (newDb as any)[key] || [];
      diffs.push({ key, colName, idKey: idKey || 'id', ...diffArrays(oldArr, newArr, idKey || 'id') });
    }
  });`
);

// We must also update `initRealTimeSync` to listen to BOTH `productos` and `repuestos` and merge them into `products`
code = code.replace(
  /COLLECTIONS_CONFIG\.forEach\(\(\{ key, colName \}\) => \{[\s\S]*?\}\);/,
  `COLLECTIONS_CONFIG.forEach(({ key, colName }) => {
    if (key === 'products') return; // Handled specially below
    const unsub = onSnapshot(collection(db, colName), (snapshot) => {
      const items: any[] = [];
      snapshot.forEach(doc => items.push(doc.data()));
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

  // Special handling for merged 'products' and 'repuestos' collections
  let currentProductos: any[] = [];
  let currentRepuestos: any[] = [];
  const updateMergedProducts = () => {
    const merged = [...currentProductos, ...currentRepuestos];
    const prevData = JSON.stringify((localCache as any)['products']);
    const newData = JSON.stringify(merged);
    if (prevData !== newData) {
      (localCache as any)['products'] = merged;
      if (!lastSyncedDb) {
        lastSyncedDb = JSON.parse(JSON.stringify(localCache));
      } else {
        (lastSyncedDb as any)['products'] = JSON.parse(JSON.stringify(merged));
      }
      notifyUpdate();
    }
  };

  const unsubProd = onSnapshot(collection(db, 'productos'), (snapshot) => {
    currentProductos = [];
    snapshot.forEach(doc => currentProductos.push(doc.data()));
    updateMergedProducts();
  });
  activeListeners.push(unsubProd);

  const unsubRep = onSnapshot(collection(db, 'repuestos'), (snapshot) => {
    currentRepuestos = [];
    snapshot.forEach(doc => currentRepuestos.push(doc.data()));
    updateMergedProducts();
  });
  activeListeners.push(unsubRep);`
);

fs.writeFileSync('src/utils/storage.ts', code);
