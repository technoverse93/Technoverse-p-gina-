import fs from 'fs';
import path from 'path';

const files = fs.readdirSync('src/components').filter(f => f.endsWith('.tsx'));

for (const file of files) {
  const filePath = path.join('src/components', file);
  let content = fs.readFileSync(filePath, 'utf8');

  // De-duplicate dark classes
  content = content.replace(/(dark:[a-zA-Z0-9\-\[\]\(\)\:\.]+)(?:\s+\1)+/g, '$1');
  
  fs.writeFileSync(filePath, content);
}
console.log("Colors deduplicated.");
