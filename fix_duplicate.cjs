const fs = require('fs');
const path = require('path');

const fileStore = path.join(__dirname, 'src', 'components', 'PublicStore.tsx');
let storeCode = fs.readFileSync(fileStore, 'utf8');

// The first occurrence is around line 107. Let's find and remove it.
storeCode = storeCode.replace(
  "const [isCartOpen, setIsCartOpen] = useState(false);\n  const { page: prodPage, setPage: setProdPage, totalPages: prodTotal, startIndex: prodStart, visibleItems: paginatedProducts } = usePagination(filteredProducts, 10);",
  "const [isCartOpen, setIsCartOpen] = useState(false);"
);

fs.writeFileSync(fileStore, storeCode);
