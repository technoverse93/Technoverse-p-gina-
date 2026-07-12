import fs from 'fs';
import path from 'path';

const files = fs.readdirSync('src/components').filter(f => f.endsWith('.tsx'));

for (const file of files) {
  const filePath = path.join('src/components', file);
  let content = fs.readFileSync(filePath, 'utf8');

  // We want to replace ANY occurrence of (text|bg|border|ring)-(blue|sky|cyan|indigo|purple|fuchsia|teal|emerald)-[0-9]{2,3} 
  // that is NOT followed by dark:(same type)-... 
  // A simpler way is to just blindly replace them if they don't have a dark class nearby.
  // Actually, wait, some might be in template literals like `text-emerald-500`
  
  content = content.replace(/(text|bg|border|ring|focus-within:border|focus-within:ring)-(blue|sky|cyan|indigo|purple|fuchsia|teal|emerald)-(?:[0-9]{2,3})(?:\/[0-9]{2})?/g, (match, prefix, color) => {
      // Find what type it is (text, bg, border, ring)
      let type = prefix;
      if (prefix === 'focus-within:border') type = 'focus-within:border';
      if (prefix === 'focus-within:ring') type = 'focus-within:ring';
      
      let darkType = type;
      if (type === 'focus-within:border') darkType = 'dark:focus-within:border';
      else if (type === 'focus-within:ring') darkType = 'dark:focus-within:ring';
      else darkType = `dark:${type}`;

      let goldVar = '';
      if (type.includes('text')) goldVar = '[var(--brand-gold-light)]';
      else if (type.includes('bg')) goldVar = '[var(--brand-gold-mid)]';
      else if (type.includes('border')) goldVar = '[var(--brand-gold-dark)]';
      else if (type.includes('ring')) goldVar = '[var(--brand-gold-mid)]';

      const addition = `${darkType}-${goldVar}`;
      
      return `${match} ${addition}`;
  });

  // Now, what about hover states?
  content = content.replace(/hover:(text|bg|border|ring)-(blue|sky|cyan|indigo|purple|fuchsia|teal|emerald)-(?:[0-9]{2,3})/g, (match, type) => {
      let goldVar = '';
      if (type.includes('text')) goldVar = '[var(--brand-gold-light)]';
      else if (type.includes('bg')) goldVar = '[var(--brand-gold-mid)]';
      else if (type.includes('border')) goldVar = '[var(--brand-gold-dark)]';
      else if (type.includes('ring')) goldVar = '[var(--brand-gold-mid)]';

      const addition = `dark:hover:${type}-${goldVar}`;
      return `${match} ${addition}`;
  });

  fs.writeFileSync(filePath, content);
}
console.log("Colors fixed 2.");
