const fs = require('fs');
const path = require('path');

const componentsDir = path.join(__dirname, 'src', 'components');

function processFile(fileName) {
    const p = path.join(componentsDir, fileName);
    if (!fs.existsSync(p)) return;
    let content = fs.readFileSync(p, 'utf8');

    // Restore header blur
    content = content.replace(/<header className="([^"]*)bg-white([^"]*)"/g, '<header className="$1bg-white/95 backdrop-blur-md$2"');
    
    // Dropdowns
    content = content.replace(/className="([^"]*)dynamic-dropdown([^"]*)"/g, 'className="$1dynamic-dropdown bg-white/95 backdrop-blur-md$2"');
    
    // Fix readability in dropdown options (AdminPanel uses text-xs py-2 px-3 etc., we want text-sm py-3 px-4 text-gray-900)
    // Actually, in AdminPanel, they are mapped buttons:
    // className={`w-full flex items-center gap-2 px-3 py-2 text-xs rounded-xl text-left transition cursor-pointer ... text-gray-700 hover:text-[#1F2937] hover:bg-white/40 hover:bg-slate-800/50
    // Let's replace the common classes
    content = content.replace(/px-2 py-1\.5/g, 'px-4 py-3');
    content = content.replace(/px-3 py-2/g, 'px-4 py-3');
    content = content.replace(/text-xs/g, 'text-sm');
    content = content.replace(/text-gray-700/g, 'text-gray-900');
    content = content.replace(/text-slate-600/g, 'text-gray-900');
    content = content.replace(/hover:bg-white\/40/g, 'hover:bg-gray-100');
    content = content.replace(/hover:bg-slate-800\/50/g, ''); // Remove weird hovers

    fs.writeFileSync(p, content);
}

processFile('AdminPanel.tsx');
processFile('PublicStore.tsx');

console.log('Fixed dropdowns and headers.');
