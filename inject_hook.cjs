const fs = require('fs');
const path = require('path');

const fileInv = path.join(__dirname, 'src', 'components', 'InventarioControl.tsx');
let invCode = fs.readFileSync(fileInv, 'utf8');

invCode = invCode.replace(
  "const [activeSubTab, setActiveSubTab] = useState",
  "const { page: prodPage, setPage: setProdPage, totalPages: prodTotal, startIndex: prodStart, visibleItems: paginatedProducts } = usePagination(products.filter(p => p.active !== false && (searchQuery ? p.name.toLowerCase().includes(searchQuery.toLowerCase()) || p.sku.toLowerCase().includes(searchQuery.toLowerCase()) : true) && (filterCategory === 'Todas' || p.category === filterCategory)), 10);\n  const [activeSubTab, setActiveSubTab] = useState"
);
fs.writeFileSync(fileInv, invCode);

const fileStore = path.join(__dirname, 'src', 'components', 'PublicStore.tsx');
let storeCode = fs.readFileSync(fileStore, 'utf8');

if (!storeCode.includes("const { page: prodPage")) {
    storeCode = storeCode.replace(
        "const [isCartOpen, setIsCartOpen] = useState(false);",
        "const [isCartOpen, setIsCartOpen] = useState(false);\n  const { page: prodPage, setPage: setProdPage, totalPages: prodTotal, startIndex: prodStart, visibleItems: paginatedProducts } = usePagination(products.filter(p => p.active !== false && (selectedCategory ? p.category === selectedCategory : true) && (searchQuery ? p.name.toLowerCase().includes(searchQuery.toLowerCase()) || p.sku.toLowerCase().includes(searchQuery.toLowerCase()) : true)), 10);"
    );
    fs.writeFileSync(fileStore, storeCode);
}
console.log("Hooks injected.");
