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
  content = content.replace(/bg-\[#1E293B\]/g, 'bg-[#F8F9FA]');
  content = content.replace(/bg-\[#111827\]\/80/g, 'bg-white/60');
  content = content.replace(/bg-\[#0F172A\]/g, 'bg-[#F8F9FA]');
  content = content.replace(/bg-slate-900\/40/g, 'bg-white/50 backdrop-blur-md');
  content = content.replace(/bg-slate-900\/60/g, 'bg-white/60 backdrop-blur-md');
  content = content.replace(/bg-slate-900/g, 'bg-white/80 backdrop-blur-md');
  content = content.replace(/bg-slate-950\/20/g, 'bg-white/40');
  content = content.replace(/bg-slate-950\/50/g, 'bg-white/50 backdrop-blur-md');
  content = content.replace(/bg-slate-950\/80/g, 'bg-white/80 backdrop-blur-md');
  content = content.replace(/bg-slate-950/g, 'bg-white/90 backdrop-blur-md');
  
  // Also fix any remaining bg-slate-800 (except when used for text)
  content = content.replace(/bg-slate-800/g, 'bg-white/80 backdrop-blur-md text-slate-800');

  // Specific white transparent backgrounds that were used for dark mode rows
  content = content.replace(/bg-white\/5/g, 'bg-slate-50/50');
  content = content.replace(/bg-white\/10/g, 'bg-slate-100/50');
  
  // Borders
  content = content.replace(/border-white\/5/g, 'border-slate-200/50');
  content = content.replace(/border-white\/10/g, 'border-slate-200/80');
  content = content.replace(/border-slate-700\/50/g, 'border-slate-200');
  content = content.replace(/border-slate-700\/60/g, 'border-slate-200');
  content = content.replace(/border-slate-700/g, 'border-slate-200');
  content = content.replace(/border-slate-800/g, 'border-slate-200');

  // Text colors
  // Need to be careful not to replace text-white inside colored buttons (like bg-blue-600)
  // Let's replace text-slate-400 and text-slate-300 with text-slate-600
  content = content.replace(/text-slate-400/g, 'text-slate-500');
  content = content.replace(/text-slate-300/g, 'text-slate-600');
  content = content.replace(/text-slate-200/g, 'text-slate-700');
  content = content.replace(/text-slate-100/g, 'text-slate-800');
  
  // We'll replace text-white with text-slate-800 ONLY where it's safe, 
  // actually, let's just replace `text-white` with `text-slate-800` everywhere,
  // then we might need to fix buttons that were explicitly white text.
  // Wait, if I do `content.replace(/text-white/g, 'text-slate-800')`, buttons like `bg-sky-500 text-white` will become `bg-sky-500 text-slate-800`.
  // To avoid breaking buttons:
  content = content.replace(/className="([^"]*)"/g, (match, p1) => {
    let classes = p1.split(' ');
    let hasBgColor = classes.some(c => c.match(/^bg-(blue|sky|emerald|rose|red|green)-/));
    if (!hasBgColor) {
      classes = classes.map(c => c === 'text-white' ? 'text-slate-800' : c);
    }
    return `className="${classes.join(' ')}"`;
  });

  fs.writeFileSync(file, content, 'utf8');
});
console.log("Done");
