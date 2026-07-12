const fs = require('fs');

// 1. Update src/utils/storage.ts
let storage = fs.readFileSync('src/utils/storage.ts', 'utf8');
if (!storage.includes('localforage')) {
  storage = `import localforage from 'localforage';\n\nexport async function saveLogo(base64: string) {\n  await localforage.setItem('storeLogo', base64);\n  if (typeof window !== 'undefined') {\n    window.dispatchEvent(new Event('store_logo_updated'));\n  }\n}\n\nexport async function getLogo(): Promise<string | null> {\n  return await localforage.getItem('storeLogo');\n}\n\n` + storage;
  fs.writeFileSync('src/utils/storage.ts', storage);
}

// 2. Update AdminPanel.tsx
let admin = fs.readFileSync('src/components/AdminPanel.tsx', 'utf8');
// Replace useState
admin = admin.replace(/const \[storeLogo, setStoreLogo\] = useState\(''\);/, `const [storeLogo, setStoreLogo] = useState('');\n  const [storeLogoPreview, setStoreLogoPreview] = useState<string | null>(null);`);
// In useEffect, load the logo
admin = admin.replace(/setStoreLogo\(db\.settings\.storeLogo \|\| ''\);/, `import('../utils/storage').then(mod => mod.getLogo().then(logo => { if (logo) setStoreLogo(logo); }));`);
// In handleLogoChange, set preview
admin = admin.replace(/setStoreLogo\(reader\.result as string\);/, `setStoreLogoPreview(reader.result as string);`);
// In handleSaveConfig, save via localforage
admin = admin.replace(/db\.settings\.storeLogo = storeLogo;/, `if (storeLogoPreview) { import('../utils/storage').then(mod => mod.saveLogo(storeLogoPreview)); } db.settings.storeLogo = undefined;`);
// In src
admin = admin.replace(/src=\{storeLogo \|\| "\/logo\.png"\}/g, `src={storeLogoPreview || storeLogo || "/logo.png"}`);
fs.writeFileSync('src/components/AdminPanel.tsx', admin);

// 3. Update PublicStore.tsx
let store = fs.readFileSync('src/components/PublicStore.tsx', 'utf8');
if (!store.includes('const [storeLogo, setStoreLogo]')) {
  store = store.replace(/const \[dbInstance, setDbInstance\] = useState<Database \| null>\(null\);/, `const [dbInstance, setDbInstance] = useState<Database | null>(null);\n  const [storeLogo, setStoreLogo] = useState<string | null>(null);\n  useEffect(() => {\n    const loadLogo = () => import('../utils/storage').then(mod => mod.getLogo().then(logo => { if (logo) setStoreLogo(logo); }));\n    loadLogo();\n    window.addEventListener('store_logo_updated', loadLogo);\n    return () => window.removeEventListener('store_logo_updated', loadLogo);\n  }, []);`);
  store = store.replace(/src=\{dbInstance\?\.settings\?\.storeLogo \|\| "\/logo\.png"\}/g, `src={storeLogo || "/logo.png"}`);
  fs.writeFileSync('src/components/PublicStore.tsx', store);
}

// 4. Update Employee components (InventarioControl, TallerKanban, etc.) if they use the logo
const empFiles = [
  'src/components/InventarioControl.tsx',
  'src/components/TallerKanban.tsx',
  'src/components/ComplianceModule.tsx',
  'src/components/InventarioMundo3D.tsx'
];

empFiles.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  if (content.includes('logo.png')) {
    if (!content.includes('const [storeLogo, setStoreLogo]')) {
      content = content.replace(/const \[currentUser, setCurrentUser\] = useState<User \| null>\(null\);/, `const [currentUser, setCurrentUser] = useState<User | null>(null);\n  const [storeLogo, setStoreLogo] = useState<string | null>(null);\n  useEffect(() => {\n    const loadLogo = () => import('../utils/storage').then(mod => mod.getLogo().then(logo => { if (logo) setStoreLogo(logo); }));\n    loadLogo();\n    window.addEventListener('store_logo_updated', loadLogo);\n    return () => window.removeEventListener('store_logo_updated', loadLogo);\n  }, []);`);
      content = content.replace(/src="\/logo\.png"/g, `src={storeLogo || "/logo.png"}`);
      fs.writeFileSync(file, content);
    }
  }
});

console.log('Update logo logic complete');
