const fs = require('fs');
let code = fs.readFileSync('src/utils/storage.ts', 'utf-8');

const replacement = `
      if (key === 'users') {
         const hasAdmin = items.find(u => u.email === 'technoverse.admin@gmail.com');
         if (!hasAdmin) {
            items.push({ id: 'admin-id', email: 'technoverse.admin@gmail.com', role: 'Dueño', name: 'Administrador Technoverse' });
         }
      }
      const prevData = JSON.stringify((localCache as any)[key]);
`;

code = code.replace(
  "const prevData = JSON.stringify((localCache as any)[key]);",
  replacement
);

fs.writeFileSync('src/utils/storage.ts', code);
