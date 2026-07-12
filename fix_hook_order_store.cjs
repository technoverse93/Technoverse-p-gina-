const fs = require('fs');
const path = require('path');

const fileStore = path.join(__dirname, 'src', 'components', 'PublicStore.tsx');
let storeCode = fs.readFileSync(fileStore, 'utf8');

// remove bad injection if present
storeCode = storeCode.replace(/const \{ page: prodPage.*?\n\s*const \[isCartOpen/, 'const [isCartOpen');

storeCode = storeCode.replace(
  /const filteredProducts = products\.filter\([\s\S]*?\n\s*\}\);/,
  `$&
  const { page: prodPage, setPage: setProdPage, totalPages: prodTotal, startIndex: prodStart, visibleItems: paginatedProducts } = usePagination(filteredProducts, 10);`
);

fs.writeFileSync(fileStore, storeCode);
