import fs from 'fs';
import path from 'path';

const files = fs.readdirSync('src/components').filter(f => f.endsWith('.tsx'));

for (const file of files) {
  const filePath = path.join('src/components', file);
  let content = fs.readFileSync(filePath, 'utf8');

  // Any bg-*-50 or bg-*-100 followed by dark:bg-[var(--brand-gold-mid)] should be dark:bg-[var(--brand-gold-mid)]/10
  content = content.replace(/(bg-(blue|sky|cyan|indigo|purple|fuchsia|teal|emerald|amber|rose)-(?:50|100|200)(?:\/[0-9]+)?(?:\s+dark:bg-transparent)?)\s+dark:bg-\[var\(--brand-gold-mid\)\]/g, '$1 dark:bg-[var(--brand-gold-mid)]/10');
  
  content = content.replace(/(hover:bg-(blue|sky|cyan|indigo|purple|fuchsia|teal|emerald|amber|rose)-(?:50|100|200)(?:\/[0-9]+)?(?:\s+dark:bg-transparent)?)\s+dark:hover:bg-\[var\(--brand-gold-mid\)\]/g, '$1 dark:hover:bg-[var(--brand-gold-mid)]/10');

  // Also remove redundant dark:bg-[var(--brand-gold-mid)] dark:bg-transparent
  content = content.replace(/dark:bg-\[var\(--brand-gold-mid\)\] dark:bg-transparent/g, 'dark:bg-transparent');
  content = content.replace(/dark:hover:bg-\[var\(--brand-gold-mid\)\] dark:bg-transparent/g, 'dark:hover:bg-[var(--brand-gold-mid)]/10');
  
  fs.writeFileSync(filePath, content);
}
console.log("Colors opacities fixed.");
