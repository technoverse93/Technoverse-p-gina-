const fs = require('fs');
let code = fs.readFileSync('src/components/InventarioControl.tsx', 'utf-8');

const regex = /const confirmDeleteProduct = \(p: Product\) => \{[\s\S]*?loadData\(\);\s*onDataChanged\(\);\s*\};/;

const replacement = `const confirmDeleteProduct = (p: Product) => {
    if (p.stock > 0) {
      alert('No se puede eliminar un producto con stock mayor a 0.');
      return;
    }
    const db = getDB();
    const idx = db.products.findIndex(x => x && x.id === p.id);
    if (idx !== -1) {
      db.products[idx].active = false;
      addAuditLog(currentUser?.email || 'technoverse.admin@gmail.com', 'Inventario', 'Desactivar Producto', \`Producto desactivado por eliminación: \${p.name}\`, db);
      
      // Store in historical
      if (!db.historical_skus) db.historical_skus = [];
      if (!db.historical_skus.find(h => h.sku === p.sku)) {
        db.historical_skus.push({
          sku: p.sku,
          name: p.name,
          category: p.category,
          price: p.price,
          cost: p.cost,
          imageUrl: p.imageUrl,
          deletedAt: new Date().toISOString()
        });
      }

      // Cascading deletion for linked products if this is a spare part
      if (sparePartCategories.includes(p.category)) {
        const linkedProducts = db.products.filter(x => x && x.linkedSparePartSku === p.sku);
        linkedProducts.forEach(lp => {
          lp.active = false;
          addAuditLog(currentUser?.email || 'technoverse.admin@gmail.com', 'Inventario', 'Desactivar Producto', \`Producto vinculado (\${lp.name}) desactivado por eliminación de repuesto: \${p.sku}\`, db);
        });
      }
    }
    saveDB(db);
    loadData();
    onDataChanged();
  };`;

if(code.match(regex)) {
  fs.writeFileSync('src/components/InventarioControl.tsx', code.replace(regex, replacement));
  console.log("Fixed delete logic");
} else {
  console.log("Could not match regex");
}
