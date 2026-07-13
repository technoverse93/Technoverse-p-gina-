const fs = require('fs');
let code = fs.readFileSync('src/components/AdminPanel.tsx', 'utf-8');

code = code.replace(/deliveries\.map\(del => \{/g, `deliveries.map(del => {
                      if (!del || !del.addressDetail) return null;`);

fs.writeFileSync('src/components/AdminPanel.tsx', code);
console.log('done');
