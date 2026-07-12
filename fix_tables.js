const fs = require('fs');
const path = require('path');

const fileAdmin = path.join(__dirname, 'src', 'components', 'AdminPanel.tsx');
let adminCode = fs.readFileSync(fileAdmin, 'utf8');

// Insert import
if (!adminCode.includes("PaginatedTbody")) {
    adminCode = adminCode.replace(/import React, \{ useState, useEffect \} from 'react';/, "import React, { useState, useEffect } from 'react';\nimport { PaginatedTbody } from './PaginationHelper';");
}

// 1. Employees
adminCode = adminCode.replace(
    /<tbody className="divide-y divide-white\/5 text-gray-900">([\s\S]*?)employees\.length === 0([\s\S]*?)employees\.map\(emp => \(([\s\S]*?)<\/tr>\n\s*\)\)\n\s*\)\}\n\s*<\/tbody>/,
    `<PaginatedTbody items={employees} itemsPerPage={10} renderItem={(emp) => ( $3 </tr> )} />`
);

fs.writeFileSync(fileAdmin, adminCode);
console.log("Replaced employees table");
