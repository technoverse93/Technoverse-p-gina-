const fs = require('fs');
let code = fs.readFileSync('src/components/PublicStore.tsx', 'utf-8');

code = code.replace(
  "import { getDB, saveDB, addAuditLog, ADMIN_PASSWORD } from '../utils/storage';",
  "import { getDB, saveDB, addAuditLog, ADMIN_PASSWORD } from '../utils/storage';\nimport { processSaleAtomic } from '../utils/transactions';"
);

const atomicCode = `
    const result = await processSaleAtomic(cart, newOrder);
    if (!result.success) {
      alert(result.error);
      return;
    }

    // Ensure client registration in CRM
    const db = getDB();
    let client = db.clients?.find(c => c.name.toLowerCase() === recipientName.trim().toLowerCase());
    if (!client) {
      db.clients.push({
        id: newOrder.customerId,
        name: recipientName.trim(),
        email: \`\${recipientName.replace(/\\s+/g, '').toLowerCase()}@correo.cr\`,
        phone: recipientPhone.trim(),
        province: shippingProvince as any,
        addressDetail: shippingAddress.trim(),
        membershipTier: buyerMembership,
        cardsTokenized: paymentMethod === 'Tarjeta' ? [{ last4: cardNumber.slice(-4), brand: 'Visa' }] : [],
        balance: 0,
        notes: 'Cliente registrado automáticamente desde checkout.'
      });
    }

    // Register logistics delivery
    if (!db.deliveries) db.deliveries = [];
    db.deliveries.unshift({
      id: invoiceId,
      type: 'Orden',
      recipientName: recipientName.trim(),
      recipientPhone: recipientPhone.trim(),
      province: shippingProvince,
      addressDetail: shippingAddress.trim(),
      status: 'Pendiente',
      incidences: []
    });
    
    // Save clients and deliveries, but avoid touching products since it's handled by transaction
    saveDB(db);

    addAuditLog('cliente@technoverse.com', 'Ventas', 'Crear Compra', \`Factura \${invoiceId} emitida por un monto de ₡\${cartTotal.toLocaleString()} para \${recipientName}\`);
    setConfirmedOrder(newOrder);
    setCheckoutStep(3); // Completed!
    setCart([]);
`;

// Replace the old deduct logic
code = code.replace(
  /\/\/ Ensure client registration in CRM[\s\S]*?setCheckoutStep\(3\); \/\/ Completed!/g,
  atomicCode
);

fs.writeFileSync('src/components/PublicStore.tsx', code);
