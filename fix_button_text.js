import fs from 'fs';
import path from 'path';

const files = fs.readdirSync('src/components').filter(f => f.endsWith('.tsx'));

for (const file of files) {
  const filePath = path.join('src/components', file);
  let content = fs.readFileSync(filePath, 'utf8');

  // If we find `text-white` in a className that also has `dark:bg-[var(--brand-gold-mid)]` or `dark:bg-[var(--brand-gold-light)]`
  // we must ensure it has `dark:text-slate-900` to be readable.
  content = content.replace(/className=(["'])(.*?)\1/g, (match, quote, classesStr) => {
      let classes = classesStr.split(/\s+/);
      
      const hasGoldBg = classes.some(c => c.startsWith('dark:bg-[var(--brand-gold-mid)]') || c.startsWith('dark:bg-[var(--brand-gold-light)]') || c.startsWith('dark:bg-[var(--brand-gold-dark)]'));
      const hasTextWhite = classes.includes('text-white') || classes.includes('text-slate-50');
      
      // If it's a solid bg (not /10 or /20)
      const hasSolidGoldBg = classes.some(c => c.match(/^dark:bg-\[var\(--brand-gold-(mid|light|dark)\)\]$/));

      if (hasSolidGoldBg && hasTextWhite) {
          if (!classesStr.includes('dark:text-slate-900') && !classesStr.includes('dark:text-slate-950')) {
              classes.push('dark:text-slate-950');
          }
      }
      
      return `className=${quote}${classes.join(' ')}${quote}`;
  });
  
  fs.writeFileSync(filePath, content);
}
console.log("Button text fixed.");
