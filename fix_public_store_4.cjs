const fs = require('fs');
const path = require('path');

const fileStore = path.join(__dirname, 'src', 'components', 'PublicStore.tsx');
let storeCode = fs.readFileSync(fileStore, 'utf8');

const prodControls = `
  {prodTotal > 1 && (
    <div className="flex items-center justify-between p-4 bg-white border border-slate-200 mt-6 rounded-2xl shadow-sm w-full col-span-full">
      <span className="text-sm text-gray-500">Mostrando {prodStart + 1} a {Math.min(prodStart + 10, filteredProducts.length)} de {filteredProducts.length}</span>
      <div className="flex gap-2">
        <button onClick={() => setProdPage(p => Math.max(1, p - 1))} disabled={prodPage === 1} className="px-4 py-2 font-bold bg-gray-100 rounded disabled:opacity-50 text-slate-800">Anterior</button>
        <span className="px-4 py-2 font-bold text-slate-800">{prodPage} / {prodTotal}</span>
        <button onClick={() => setProdPage(p => Math.min(prodTotal, p + 1))} disabled={prodPage === prodTotal} className="px-4 py-2 font-bold bg-gray-100 rounded disabled:opacity-50 text-slate-800">Siguiente</button>
      </div>
    </div>
  )}
`;

// Insert after the end of the map:
// The map ends with "</div>\n                    );\n                  })}\n                </div>"
if (!storeCode.includes('Mostrando {prodStart + 1}')) {
    storeCode = storeCode.replace(
        /<\/div>\s*\);\s*\}\)\}\s*<\/div>/,
        '</div>\n                    );\n                  })}\n                  ' + prodControls + '\n                </div>'
    );
    fs.writeFileSync(fileStore, storeCode);
    console.log("Pagination added to PublicStore!");
}

