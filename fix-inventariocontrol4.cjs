const fs = require('fs');
let code = fs.readFileSync('src/components/InventarioControl.tsx', 'utf-8');

code = code.replace(/movements\.map\(m => /g, 'movements.map(m => m && ');
code = code.replace(/movements\.filter\(m => /g, 'movements.filter(m => m && ');

fs.writeFileSync('src/components/InventarioControl.tsx', code);
console.log('done');
