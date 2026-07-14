const fs = require('fs');

let code = fs.readFileSync('src/utils/storage.ts', 'utf-8');

// Rename colName to the requested Spanish ones
code = code.replace(
  /const COLLECTIONS_CONFIG = \[\s+([\s\S]+?)\];/,
  `const COLLECTIONS_CONFIG = [
  { key: 'products', colName: 'productos', idKey: 'id' },
  { key: 'inventory_movements', colName: 'movimientosInventario', idKey: 'id' },
  { key: 'repair_orders', colName: 'ordenesReparacion', idKey: 'id' },
  { key: 'orders', colName: 'ordenesVenta', idKey: 'id' },
  { key: 'membership_tiers', colName: 'membership_tiers', idKey: 'id' },
  { key: 'chat_conversations', colName: 'chat_conversations', idKey: 'id' },
  { key: 'employees', colName: 'empleados', idKey: 'id' },
  { key: 'users', colName: 'usuarios', idKey: 'id' },
  { key: 'payroll', colName: 'payroll', idKey: 'id' },
  { key: 'audit_log', colName: 'audit_log', idKey: 'id' },
  { key: 'clients', colName: 'clients', idKey: 'id' },
  { key: 'deliveries', colName: 'deliveries', idKey: 'id' },
  { key: 'marketing_campaigns', colName: 'marketing_campaigns', idKey: 'id' },
  { key: 'banners', colName: 'banners', idKey: 'id' },
  { key: 'historical_skus', colName: 'historicalSKUs', idKey: 'sku' }
];`
);

fs.writeFileSync('src/utils/storage.ts', code);
