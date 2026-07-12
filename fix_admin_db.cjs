const fs = require('fs');
let content = fs.readFileSync('src/components/AdminPanel.tsx', 'utf-8');

content = content.replace(
  /\/\/ 2\. Check created employees\s*const db = getDB\(\);/g,
  '// 2. Check created employees'
);

fs.writeFileSync('src/components/AdminPanel.tsx', content);
