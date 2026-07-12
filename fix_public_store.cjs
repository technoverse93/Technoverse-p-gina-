const fs = require('fs');
const path = require('path');

const fileStore = path.join(__dirname, 'src', 'components', 'PublicStore.tsx');
let storeCode = fs.readFileSync(fileStore, 'utf8');

if (!storeCode.includes("PaginatedGrid")) {
  storeCode = storeCode.replace(/import React[^;]*;/, "$&\nimport { PaginatedGrid } from './PaginationHelper';");
}

storeCode = storeCode.replace(
    /<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6 mt-4 md:mt-8 relative z-10 px-2 sm:px-4 lg:px-8">\s*\{filteredProducts\.map\(prod => \{([\s\S]*?)return \(([\s\S]*?)<\/div>\s*\);\s*\}\)\}\s*<\/div>/,
    `<PaginatedGrid items={filteredProducts} itemsPerPage={10} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6 mt-4 md:mt-8 relative z-10 px-2 sm:px-4 lg:px-8" renderItem={(prod) => { $1 return ( $2 </div> ); }} />`
);

fs.writeFileSync(fileStore, storeCode);
console.log("Replaced public store products with PaginatedGrid");
