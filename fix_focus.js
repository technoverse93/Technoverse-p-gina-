import fs from 'fs';
import path from 'path';

const files = fs.readdirSync('src/components').filter(f => f.endsWith('.tsx'));

for (const file of files) {
  const filePath = path.join('src/components', file);
  let content = fs.readFileSync(filePath, 'utf8');

  // Any focus:border-... dark:border-... should be dark:focus:border-...
  content = content.replace(/(focus(?:-within)?:(?:border|ring)-(?:[a-z]+-[0-9]+))\s+dark:(border|ring)-\[var\(--brand-gold-[a-z]+\)\]/g, '$1 dark:focus:$2-[var(--brand-gold-mid)]');
  
  // also what about dark:focus:ring-[var(...)]
  
  fs.writeFileSync(filePath, content);
}
console.log("Focus states fixed.");
