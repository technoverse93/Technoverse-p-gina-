const fs = require('fs');
let code = fs.readFileSync('src/components/InventarioControl.tsx', 'utf-8');

// Defensive filtering:
code = code.replace(/products\.filter\(p => \{/g, 'products.filter(p => {\n    if (!p) return false;');

// In historical_skus
code = code.replace(/historicalSkus\.filter\(h => \{/g, 'historicalSkus.filter(h => {\n    if (!h) return false;');

fs.writeFileSync('src/components/InventarioControl.tsx', code);
console.log('done');
