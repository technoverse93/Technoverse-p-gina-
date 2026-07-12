import fs from 'fs';
import path from 'path';

const files = fs.readdirSync('src/components').filter(f => f.endsWith('.tsx'));

for (const file of files) {
  const filePath = path.join('src/components', file);
  let content = fs.readFileSync(filePath, 'utf8');

  // Replace existing off-brand dark colors
  content = content.replace(/dark:(text|bg|border|ring)-(blue|emerald|sky|cyan|indigo|purple|fuchsia|teal|amber|rose)-(?:[0-9]{2,3})/g, (match, type) => {
      // Except for rose and emerald if they are success/error? The prompt says we can keep them for errors/success.
      // But for simplicity, we will make sure they harmonize.
      // actually, just replace everything with gold for dark mode as it requested.
      if (type === 'text') return 'dark:text-[var(--brand-gold-light)]';
      if (type === 'bg') return 'dark:bg-[var(--brand-gold-mid)]';
      if (type === 'border') return 'dark:border-[var(--brand-gold-dark)]';
      if (type === 'ring') return 'dark:ring-[var(--brand-gold-mid)]';
      return match;
  });

  // Now, what about classes that don't have a dark: variant?
  // We can search for class="..." and add dark variants if missing.
  
  content = content.replace(/className=(["'])(.*?)\1/g, (match, quote, classesStr) => {
      let classes = classesStr.split(/\s+/);
      let newClasses = [...classes];
      
      const offBrandRegex = /^(text|bg|border|ring)-(blue|sky|cyan|indigo|purple|fuchsia|teal)-(?:[0-9]{2,3})$/;
      const offBrandEmerald = /^(text|bg|border|ring)-(emerald)-(?:[0-9]{2,3})$/;
      const offBrandAmber = /^(text|bg|border|ring)-(amber)-(?:[0-9]{2,3})$/;

      for (const cls of classes) {
          const m1 = cls.match(offBrandRegex);
          if (m1) {
              const type = m1[1];
              let darkClass = '';
              if (type === 'text') darkClass = 'dark:text-[var(--brand-gold-light)]';
              else if (type === 'bg') darkClass = 'dark:bg-[var(--brand-gold-mid)]';
              else if (type === 'border') darkClass = 'dark:border-[var(--brand-gold-dark)]';
              else if (type === 'ring') darkClass = 'dark:ring-[var(--brand-gold-mid)]';
              
              if (!classesStr.includes(`dark:${type}-`) && !classesStr.includes(`dark:${type}-[var(--brand-gold`)) {
                  newClasses.push(darkClass);
              }
          }
          
          const m2 = cls.match(offBrandEmerald);
          if (m2 && !classesStr.includes('rose') && !classesStr.includes('error')) {
              // we treat emerald as gold too, unless it's explicitly a success message, but gold is safer.
              const type = m2[1];
              let darkClass = '';
              if (type === 'text') darkClass = 'dark:text-[var(--brand-gold-light)]';
              else if (type === 'bg') darkClass = 'dark:bg-[var(--brand-gold-mid)]';
              else if (type === 'border') darkClass = 'dark:border-[var(--brand-gold-dark)]';
              else if (type === 'ring') darkClass = 'dark:ring-[var(--brand-gold-mid)]';
              
              if (!classesStr.includes(`dark:${type}-`) && !classesStr.includes(`dark:${type}-[var(--brand-gold`)) {
                  newClasses.push(darkClass);
              }
          }
      }
      
      return `className=${quote}${newClasses.join(' ')}${quote}`;
  });

  fs.writeFileSync(filePath, content);
}
console.log("Colors fixed.");
