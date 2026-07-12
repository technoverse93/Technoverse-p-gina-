const fs = require('fs');
const path = require('path');

const fileStore = path.join(__dirname, 'src', 'components', 'PublicStore.tsx');
let storeCode = fs.readFileSync(fileStore, 'utf8');

const prodControls = `
  {prodTotal > 1 && (
    <div className="flex items-center justify-between p-4 bg-white border border-slate-200 mt-6 rounded-2xl shadow-sm">
      <span className="text-sm text-gray-500">Mostrando {prodStart + 1} a {Math.min(prodStart + 10, filteredProducts.length)} de {filteredProducts.length}</span>
      <div className="flex gap-2">
        <button onClick={() => setProdPage(p => Math.max(1, p - 1))} disabled={prodPage === 1} className="px-3 py-1 bg-gray-100 rounded disabled:opacity-50 text-slate-800">Anterior</button>
        <span className="px-3 py-1 font-bold text-slate-800">{prodPage} / {prodTotal}</span>
        <button onClick={() => setProdPage(p => Math.min(prodTotal, p + 1))} disabled={prodPage === prodTotal} className="px-3 py-1 bg-gray-100 rounded disabled:opacity-50 text-slate-800">Siguiente</button>
      </div>
    </div>
  )}
`;

if (!storeCode.includes('Mostrando {prodStart + 1}')) {
    storeCode = storeCode.replace(
        /<\/div>\s*<\/div>\s*<\/div>\s*\)\}\s*<\/main>/,
        '</div>\n' + prodControls + '\n              </div>\n            </div>\n          )}\n        </main>'
    );
    fs.writeFileSync(fileStore, storeCode);
}
console.log("Controls inserted.");
