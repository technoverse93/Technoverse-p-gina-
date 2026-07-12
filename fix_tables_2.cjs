const fs = require('fs');
const path = require('path');

const fileAdmin = path.join(__dirname, 'src', 'components', 'AdminPanel.tsx');
let adminCode = fs.readFileSync(fileAdmin, 'utf8');

adminCode = adminCode.replace(
    /<tbody className="divide-y divide-white\/5 text-gray-900">\s*\{payrolls\.map\(pay => \(([\s\S]*?)<\/tr>\s*\)\)\}\s*<\/tbody>/,
    `<PaginatedTbody items={payrolls} itemsPerPage={10} renderItem={(pay) => ( $1 </tr> )} />`
);

adminCode = adminCode.replace(
    /<tbody className="divide-y divide-white\/5 text-gray-900">\s*\{campaigns\.map\(c => \(([\s\S]*?)<\/tr>\s*\)\)\}\s*<\/tbody>/,
    `<PaginatedTbody items={campaigns} itemsPerPage={10} renderItem={(c) => ( $1 </tr> )} />`
);

adminCode = adminCode.replace(
    /<tbody className="divide-y divide-white\/5 text-gray-900">\s*\{auditLog\.map\(log => \(([\s\S]*?)<\/tr>\s*\)\)\}\s*<\/tbody>/,
    `<PaginatedTbody items={auditLog} itemsPerPage={10} renderItem={(log) => ( $1 </tr> )} />`
);

fs.writeFileSync(fileAdmin, adminCode);
console.log("Replaced missing tables");
