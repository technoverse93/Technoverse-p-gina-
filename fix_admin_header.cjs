const fs = require('fs');

let content = fs.readFileSync('src/components/AdminPanel.tsx', 'utf8');

// The main header wrapper
content = content.replace(/<header className=".*">/g, '<header className="bg-white/60 backdrop-blur-xl h-16 border-b border-white/20 sticky top-0 z-50">');

// The dashboard tabs in the header should use dark text on hover
content = content.replace(/text-slate-600 hover:text-white/g, 'text-gray-700 hover:text-[#1F2937] hover:bg-white/40');
// Active tab should be #D4AF37 but with a light bg instead of bg-slate-800
content = content.replace(/text-\[#D4AF37\] bg-slate-800/g, 'text-[#D4AF37] bg-white/60 border border-[#D4AF37]/20');

// Dropdowns in AdminPanel should be glass
content = content.replace(/bg-\[#F8F9FA\] dynamic-dropdown/g, 'bg-white/60 backdrop-blur-xl dynamic-dropdown');
content = content.replace(/bg-slate-900\/95 backdrop-blur-xl dynamic-dropdown border border-slate-800/g, 'bg-white/60 backdrop-blur-xl dynamic-dropdown border border-slate-200/50 shadow-xl');
content = content.replace(/bg-slate-800 dynamic-dropdown border border-slate-700/g, 'bg-white/60 backdrop-blur-xl dynamic-dropdown border border-slate-200/50 shadow-xl');
content = content.replace(/bg-slate-900 dynamic-dropdown border border-slate-800/g, 'bg-white/60 backdrop-blur-xl dynamic-dropdown border border-slate-200/50 shadow-xl');

// Remove double backdrop-blur-md
content = content.replace(/backdrop-blur-xl backdrop-blur-md/g, 'backdrop-blur-xl');

// User profile button in Admin header: it was bg-slate-800
content = content.replace(/bg-slate-800 hover:bg-slate-700 transition cursor-pointer text-\[#1F2937\]/g, 'bg-white/60 hover:bg-white/80 border border-slate-200 transition cursor-pointer text-[#1F2937] backdrop-blur-xl');

// Mobile 'Ver tienda' is fine.
content = content.replace(/bg-slate-900 border border-slate-800/g, 'bg-white/60 backdrop-blur-xl border border-slate-200');


// Fix text legibility
content = content.replace(/text-slate-400 hover:text-white/g, 'text-gray-600 hover:text-[#1F2937]');
content = content.replace(/text-slate-300/g, 'text-gray-700');
content = content.replace(/text-slate-400/g, 'text-gray-500');

fs.writeFileSync('src/components/AdminPanel.tsx', content, 'utf8');

console.log('AdminPanel header and glass dropdowns fixed');
