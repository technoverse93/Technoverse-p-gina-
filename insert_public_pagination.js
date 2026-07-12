const fs = require('fs');
const path = require('path');
const fileStore = path.join(__dirname, 'src', 'components', 'PublicStore.tsx');
let storeCode = fs.readFileSync(fileStore, 'utf8');

const prodControls = `
  {prodTotal > 1 && (
    <div className="flex items-center justify-between p-4 bg-white border border-slate-200 mt-6 rounded-2xl shadow-sm">
      <span className="text-sm text-gray-500">Mostrando {prodStart + 1} a {Math.min(prodStart + 10, filteredProducts.length)} de {filteredProducts.length}</span>
      <div className="flex gap-2">
        <button onClick={() => setProdPage(p => Math.max(1, p - 1))} disabled={prodPage === 1} className="px-4 py-2 font-bold bg-gray-100 rounded disabled:opacity-50 text-slate-800">Anterior</button>
        <span className="px-4 py-2 font-bold text-slate-800">{prodPage} / {prodTotal}</span>
        <button onClick={() => setProdPage(p => Math.min(prodTotal, p + 1))} disabled={prodPage === prodTotal} className="px-4 py-2 font-bold bg-gray-100 rounded disabled:opacity-50 text-slate-800">Siguiente</button>
      </div>
    </div>
  )}
`;

const lines = storeCode.split('\n');
let modified = [];
let insideGrid = false;
let openBrackets = 0;

for (let i = 0; i < lines.length; i++) {
  modified.push(lines[i]);
  if (lines[i].includes('className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3')) {
     insideGrid = true;
  }
  
  if (insideGrid && lines[i].includes('}')) {
     // rudimentary logic. Instead, let's just use string replace.
  }
}
