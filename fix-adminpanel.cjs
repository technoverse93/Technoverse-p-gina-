const fs = require('fs');
let code = fs.readFileSync('src/components/AdminPanel.tsx', 'utf-8');

code = code.replace(/del && \{/g, '{ \nif (!del) return null;');

fs.writeFileSync('src/components/AdminPanel.tsx', code);
console.log('done');
