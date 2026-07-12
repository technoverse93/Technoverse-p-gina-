import fs from 'fs';
import path from 'path';

const files = fs.readdirSync('src/components').filter(f => f.endsWith('.tsx'));

for (const file of files) {
  const filePath = path.join('src/components', file);
  let content = fs.readFileSync(filePath, 'utf8');

  // Fix messy multiple dark classes of the same type.
  content = content.replace(/className=(["'])(.*?)\1/g, (match, quote, classesStr) => {
      let classes = classesStr.split(/\s+/);
      
      const newClasses = [];
      const seenDarkTypes = new Set();
      
      // We process from right to left so that the LATEST added class takes precedence?
      // Actually, right to left is better to keep the last one.
      for (let i = classes.length - 1; i >= 0; i--) {
          const cls = classes[i];
          if (cls.startsWith('dark:')) {
              // Extract the type, e.g. dark:bg-[var(...)] -> dark:bg
              // dark:hover:bg-[var(...)] -> dark:hover:bg
              const prefixMatch = cls.match(/^(dark:(?:hover:|focus:|focus-within:)?[a-z\-]+)-/);
              if (prefixMatch) {
                  const prefix = prefixMatch[1];
                  if (!seenDarkTypes.has(prefix)) {
                      seenDarkTypes.add(prefix);
                      newClasses.unshift(cls);
                  }
              } else {
                  newClasses.unshift(cls);
              }
          } else {
              newClasses.unshift(cls);
          }
      }
      
      return `className=${quote}${newClasses.join(' ')}${quote}`;
  });
  
  fs.writeFileSync(filePath, content);
}
console.log("Messy classes fixed.");
