const fs = require('fs');
const path = require('path');

const componentsDir = path.join(__dirname, 'src', 'components');
const files = fs.readdirSync(componentsDir).filter(f => f.endsWith('.tsx'));

for (const file of files) {
  let content = fs.readFileSync(path.join(componentsDir, file), 'utf8');

  // 1. Remove backdrop blurs
  content = content.replace(/backdrop-blur-[a-zA-Z0-9\[\]-]+/g, ' ');
  
  // 2. Solid backgrounds
  content = content.replace(/bg-white\/\d+/g, 'bg-white');
  content = content.replace(/bg-slate-[0-9]+\/\d+/g, (match) => match.split('/')[0]);
  content = content.replace(/bg-black\/\d+/g, 'bg-black');

  // 3. Lighten shadows
  content = content.replace(/shadow-(md|lg|xl|2xl)/g, 'shadow-sm');

  // Clean up extra spaces
  content = content.replace(/\s+/g, ' ');

  fs.writeFileSync(path.join(componentsDir, file), content);
}
