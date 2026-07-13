const fs = require('fs');
let code = fs.readFileSync('src/components/PublicStore.tsx', 'utf-8');

code = code.replace(/\.filter\(([a-zA-Z0-9_]+) => /g, '.filter($1 => $1 && ');
code = code.replace(/\.map\(([a-zA-Z0-9_]+) => /g, '.map($1 => $1 && ');
code = code.replace(/\.some\(([a-zA-Z0-9_]+) => /g, '.some($1 => $1 && ');

fs.writeFileSync('src/components/PublicStore.tsx', code);
console.log('done');
