const fs = require('fs');
let code = fs.readFileSync('src/components/InventarioControl.tsx', 'utf-8');

code = code.replace(/m => m && \{/g, 'm => { \nif (!m) return null;');

fs.writeFileSync('src/components/InventarioControl.tsx', code);
console.log('done');
