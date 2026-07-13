const fs = require('fs');
let code = fs.readFileSync('src/components/InventarioControl.tsx', 'utf-8');

code = code.replace(/products\.some\(p => /g, 'products.some(p => p && ');
code = code.replace(/products\.find\(p => /g, 'products.find(p => p && ');
code = code.replace(/products\.findIndex\(x => /g, 'products.findIndex(x => x && ');

fs.writeFileSync('src/components/InventarioControl.tsx', code);
console.log('done');
