const fs = require('fs');
let code = fs.readFileSync('src/utils/storage.ts', 'utf-8');

code = code.replace(/localStorage\.setItem\('technoverse_db', JSON\.stringify\(localCache\)\);/g, `try {
        localStorage.setItem('technoverse_db', JSON.stringify(localCache));
      } catch (e) {
        console.warn('localStorage quota exceeded or unavailable', e);
      }`);

fs.writeFileSync('src/utils/storage.ts', code);
console.log('done');
