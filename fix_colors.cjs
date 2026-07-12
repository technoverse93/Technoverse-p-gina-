const fs = require('fs');

const files = [
  'src/components/AdminPanel.tsx',
  'src/components/InventarioControl.tsx',
  'src/components/TallerKanban.tsx',
  'src/components/ComplianceModule.tsx',
  'src/components/InventarioMundo3D.tsx',
  'src/components/PublicStore.tsx'
];

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');

  // Replace bg-slate-50/500 with proper glass
  content = content.replace(/bg-slate-50\/500/g, 'bg-white/60 backdrop-blur-xl');
  
  // Also clean up any double backdrop-blur
  content = content.replace(/backdrop-blur-md backdrop-blur-xl/g, 'backdrop-blur-xl');

  content = content.replace(/bg-slate-50\/50/g, 'bg-white/60 backdrop-blur-xl');
  content = content.replace(/bg-slate-100\/50/g, 'bg-white/80 backdrop-blur-xl');
  
  // Any general dark text should be #1F2937 -> text-gray-800
  // "El texto en esos componentes debe ser color: #1F2937"
  // Let's replace text-slate-800 or text-slate-500 with text-gray-800 where it makes sense, or just rely on text-slate-800.
  // We'll replace text-slate-800 with text-[#1F2937]
  content = content.replace(/text-slate-800/g, 'text-[#1F2937]');
  content = content.replace(/text-slate-700/g, 'text-[#1F2937]');

  fs.writeFileSync(file, content, 'utf8');
});
console.log('Colors fixed');
