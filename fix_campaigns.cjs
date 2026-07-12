const fs = require('fs');
const path = require('path');

const fileAdmin = path.join(__dirname, 'src', 'components', 'AdminPanel.tsx');
let adminCode = fs.readFileSync(fileAdmin, 'utf8');

adminCode = adminCode.replace(
    /<tbody className="divide-y divide-white\/5">\s*\{campaigns\.length === 0 \? \([\s\S]*?\) : \(\s*campaigns\.map\(c => \(([\s\S]*?)<\/tr>\s*\)\)\s*\)\}\s*<\/tbody>/,
    `<PaginatedTbody items={campaigns} itemsPerPage={10} renderItem={(c) => ( $1 </tr> )} />`
);

fs.writeFileSync(fileAdmin, adminCode);
