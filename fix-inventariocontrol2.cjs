const fs = require('fs');
let code = fs.readFileSync('src/components/InventarioControl.tsx', 'utf-8');

code = code.replace(/products\.filter\(x => /g, 'products.filter(x => x && ');
code = code.replace(/products\.filter\(p => \(/g, 'products.filter(p => p && (');
code = code.replace(/products\.filter\(p => p\.stock/g, 'products.filter(p => p && p.stock');
code = code.replace(/products\.forEach\(p => \{/g, 'products.forEach(p => {\n    if (!p) return;');
code = code.replace(/db\.products\.forEach\(\(p, pIdx\) => \{/g, 'db.products.forEach((p, pIdx) => {\n              if (!p) return;');

fs.writeFileSync('src/components/InventarioControl.tsx', code);
console.log('done');
