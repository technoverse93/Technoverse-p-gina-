import fs from 'fs';
import path from 'path';

const files = fs.readdirSync('src/components').filter(f => f.endsWith('.tsx'));

for (const file of files) {
  const filePath = path.join('src/components', file);
  let content = fs.readFileSync(filePath, 'utf8');

  // Any bg-*/* followed by dark:bg-[var(--brand-gold-mid)] should be dark:bg-[var(--brand-gold-mid)]/10
  content = content.replace(/(bg-[a-z]+-(?:[0-9]{2,3})\/[0-9]+(?:\s+dark:bg-transparent)?)\s+dark:bg-\[var\(--brand-gold-mid\)\]/g, '$1 dark:bg-[var(--brand-gold-mid)]/10');
  
  fs.writeFileSync(filePath, content);
}
console.log("Colors opacities 2 fixed.");
