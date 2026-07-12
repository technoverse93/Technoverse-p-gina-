const fs = require('fs');
const files = [
  'src/components/AdminPanel.tsx',
  'src/components/InventarioControl.tsx',
  'src/components/TallerKanban.tsx',
  'src/components/ComplianceModule.tsx',
  'src/components/InventarioMundo3D.tsx'
];

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');

  // Backgrounds
  content = content.replace(/bg-\[#1E293B\]/g, 'bg-white/95');
  content = content.replace(/bg-\[#111827\]\/80/g, 'bg-white/60');
  content = content.replace(/bg-\[#0F172A\]/g, 'bg-white/80');
  content = content.replace(/bg-slate-900\/40/g, 'bg-white/50 backdrop-blur-md');
  content = content.replace(/bg-slate-900\/60/g, 'bg-white/60 backdrop-blur-md');
  content = content.replace(/bg-slate-900/g, 'bg-white/80 backdrop-blur-md');
  content = content.replace(/bg-slate-950\/20/g, 'bg-white/40');
  content = content.replace(/bg-slate-950\/50/g, 'bg-white/50 backdrop-blur-md');
  content = content.replace(/bg-slate-950\/80/g, 'bg-white/80 backdrop-blur-md');
  content = content.replace(/bg-slate-950/g, 'bg-white/90 backdrop-blur-md');
  
  // Specific white transparent backgrounds that were used for dark mode rows
  content = content.replace(/bg-white\/5/g, 'bg-slate-50/50');
  content = content.replace(/bg-white\/10/g, 'bg-slate-100/50');
  
  // Borders
  content = content.replace(/border-white\/5/g, 'border-slate-200/50');
  content = content.replace(/border-white\/10/g, 'border-slate-200/80');
  content = content.replace(/border-slate-700\/50/g, 'border-slate-200');
  content = content.replace(/border-slate-700\/60/g, 'border-slate-200');
  content = content.replace(/border-slate-700/g, 'border-slate-200');

  // Text colors
  content = content.replace(/text-slate-400/g, 'text-slate-500');
  content = content.replace(/text-slate-300/g, 'text-slate-600');
  content = content.replace(/text-slate-200/g, 'text-slate-700');
  content = content.replace(/text-slate-100/g, 'text-slate-800');
  
  content = content.replace(/className="([^"]*)"/g, (match, p1) => {
    let classes = p1.split(' ');
    let hasBgColor = classes.some(c => c.match(/^bg-(blue|sky|emerald|rose|red|green)-/));
    if (!hasBgColor) {
      classes = classes.map(c => c === 'text-white' ? 'text-slate-800' : c);
    }
    return `className="${classes.join(' ')}"`;
  });
  
  // Fix specifically the main screen background
  content = content.replace(/h-screen bg-white\/95/g, 'h-screen bg-[#F8F9FA]');

  fs.writeFileSync(file, content, 'utf8');
});
console.log("Done");
