const fs = require('fs');
const path = require('path');

function replaceWithPaginatedTbody(filePath, arrayName, mapStartString, mapEndString, renderFnString) {
  let code = fs.readFileSync(filePath, 'utf8');
  if (!code.includes("import { PaginatedTbody, PaginatedGrid }")) {
    code = code.replace(/import React[^;]*;/, "$&\nimport { PaginatedTbody, PaginatedGrid } from './PaginationHelper';");
  }
  
  // This is too hard with regex if I don't know the exact end.
}
