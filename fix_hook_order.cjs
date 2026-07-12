const fs = require('fs');
const path = require('path');

const fileInv = path.join(__dirname, 'src', 'components', 'InventarioControl.tsx');
let invCode = fs.readFileSync(fileInv, 'utf8');

// remove bad injection
invCode = invCode.replace(/const \{ page: prodPage.*?\n\s*const \[activeSubTab/, 'const [activeSubTab');

// insert correctly after filteredProducts
invCode = invCode.replace(
  /const filteredProducts = products\.filter\([\s\S]*?\n\s*\}\);/,
  `$&
  const { page: prodPage, setPage: setProdPage, totalPages: prodTotal, startIndex: prodStart, visibleItems: paginatedProducts } = usePagination(filteredProducts, 10);`
);

fs.writeFileSync(fileInv, invCode);
