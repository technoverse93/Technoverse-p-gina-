const fs = require('fs');
const path = require('path');

const fileInventario = path.join(__dirname, 'src', 'components', 'InventarioControl.tsx');
let invCode = fs.readFileSync(fileInventario, 'utf8');

if (!invCode.includes('function usePagination')) {
  const hookCode = `
function usePagination(items, itemsPerPage = 10) {
  const [page, setPage] = React.useState(1);
  React.useEffect(() => { setPage(1); }, [items.length]);
  const totalPages = Math.ceil(items.length / itemsPerPage) || 1;
  const startIndex = (page - 1) * itemsPerPage;
  const visibleItems = items.slice(startIndex, startIndex + itemsPerPage);
  return { page, setPage, totalPages, startIndex, visibleItems, itemsPerPage };
}
`;
  invCode = invCode.replace('export default function InventarioControl', hookCode + '\nexport default function InventarioControl');

  invCode = invCode.replace(
    'const [sortConfig, setSortConfig] = useState',
    'const { page: prodPage, setPage: setProdPage, totalPages: prodTotal, startIndex: prodStart, visibleItems: paginatedProducts } = usePagination(filteredProducts, 10);\n  const [sortConfig, setSortConfig] = useState'
  );

  invCode = invCode.replace(
    '{filteredProducts.map(p => (',
    '{paginatedProducts.map((p, pIndex) => ('
  );

  const prodControls = `
  {prodTotal > 1 && (
    <div className="flex items-center justify-between p-4 bg-white border-t border-slate-200">
      <span className="text-sm text-gray-500">Mostrando {prodStart + 1} a {Math.min(prodStart + 10, filteredProducts.length)} de {filteredProducts.length}</span>
      <div className="flex gap-2">
        <button onClick={() => setProdPage(p => Math.max(1, p - 1))} disabled={prodPage === 1} className="px-3 py-1 bg-gray-100 rounded disabled:opacity-50 text-slate-800">Anterior</button>
        <span className="px-3 py-1 font-bold text-slate-800">{prodPage} / {prodTotal}</span>
        <button onClick={() => setProdPage(p => Math.min(prodTotal, p + 1))} disabled={prodPage === prodTotal} className="px-3 py-1 bg-gray-100 rounded disabled:opacity-50 text-slate-800">Siguiente</button>
      </div>
    </div>
  )}
  `;
  invCode = invCode.replace('</tbody>\n                </table>', '</tbody>\n                </table>\n                ' + prodControls);

  fs.writeFileSync(fileInventario, invCode);
}
console.log("Inventario paginated.");
