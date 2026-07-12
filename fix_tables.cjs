const fs = require('fs');
const path = require('path');

const fileAdmin = path.join(__dirname, 'src', 'components', 'AdminPanel.tsx');
let adminCode = fs.readFileSync(fileAdmin, 'utf8');

// 2. Payrolls
adminCode = adminCode.replace(
    /<tbody className="divide-y divide-white\/5 text-gray-900">\s*\{payrolls\.length === 0 \? \([\s\S]*?\) : \(\s*payrolls\.map\(pay => \(([\s\S]*?)<\/tr>\s*\)\)\s*\)\}\s*<\/tbody>/,
    `<PaginatedTbody items={payrolls} itemsPerPage={10} renderItem={(pay) => ( $1 </tr> )} />`
);

// 3. Clients
adminCode = adminCode.replace(
    /<tbody className="divide-y divide-white\/5 text-gray-900">\s*\{clients\.length === 0 \? \([\s\S]*?\) : \(\s*clients\.map\(c => \(([\s\S]*?)<\/tr>\s*\)\)\s*\)\}\s*<\/tbody>/,
    `<PaginatedTbody items={clients} itemsPerPage={10} renderItem={(c) => ( $1 </tr> )} />`
);

// 4. Orders
adminCode = adminCode.replace(
    /<tbody className="divide-y divide-white\/5 text-gray-900">\s*\{orders\.length === 0 \? \([\s\S]*?\) : \(\s*orders\.map\(o => \(([\s\S]*?)<\/tr>\s*\)\)\s*\)\}\s*<\/tbody>/,
    `<PaginatedTbody items={orders} itemsPerPage={10} renderItem={(o) => ( $1 </tr> )} />`
);

// 5. Campaigns
adminCode = adminCode.replace(
    /<tbody className="divide-y divide-white\/5 text-gray-900">\s*\{campaigns\.length === 0 \? \([\s\S]*?\) : \(\s*campaigns\.map\(c => \(([\s\S]*?)<\/tr>\s*\)\)\s*\)\}\s*<\/tbody>/,
    `<PaginatedTbody items={campaigns} itemsPerPage={10} renderItem={(c) => ( $1 </tr> )} />`
);

// 6. AuditLog
adminCode = adminCode.replace(
    /<tbody className="divide-y divide-white\/5 text-gray-900">\s*\{auditLog\.length === 0 \? \([\s\S]*?\) : \(\s*auditLog\.map\(log => \(([\s\S]*?)<\/tr>\s*\)\)\s*\)\}\s*<\/tbody>/,
    `<PaginatedTbody items={auditLog} itemsPerPage={10} renderItem={(log) => ( $1 </tr> )} />`
);

fs.writeFileSync(fileAdmin, adminCode);
console.log("Replaced other tables");
