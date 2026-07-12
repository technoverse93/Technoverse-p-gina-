const fs = require('fs');

const files = ['src/components/AdminPanel.tsx', 'src/components/PublicStore.tsx'];

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/useEffect\(\(\) => \{\n\s*useEffect\(\(\) => \{/g, 'useEffect(() => {');
  fs.writeFileSync(file, content, 'utf8');
});
console.log('Fixed useEffect syntax error');
