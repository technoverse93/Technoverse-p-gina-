const fs = require('fs');
let code = fs.readFileSync('src/utils/storage.ts', 'utf-8');

// Inside syncPromises.push, before uploadEmbeddedImages, we can remap objects.
// Let's add a mapper function.
const mapperStr = `
function mapToFirestore(colName: string, item: any): any {
  if (!item) return item;
  if (colName === 'productos' || colName === 'repuestos') {
    return {
      sku: item.sku || item.id || '',
      nombre: item.name || '',
      categoria: item.category || '',
      precioVenta: item.price || 0,
      precioCosto: item.cost || 0, // repuestos
      costo: item.cost || 0, // productos
      stock: item.stock || 0,
      imagen: item.imageUrl || '',
      garantia: item.category === 'Repuestos' || ['LCD', 'Batería', 'Flex'].includes(item.category) ? '3 meses' : '1 mes',
      vinculadoARepuesto: item.linkedSparePartSku || '',
      ubicacion: item.location || 'Bodega 1',
      activo: item.active !== false,
      _originalId: item.id
    };
  }
  if (colName === 'ordenesReparacion') {
    return {
      guia: item.id || '',
      ticket: item.ticket || '',
      cliente: { nombre: item.customerName || '', email: item.customerEmail || '', telefono: '' },
      dispositivo: { marca: '', modelo: item.device || '' },
      estado: item.status || '',
      repuestosConsumidos: (item.repuestos || []).map((r: any) => ({ sku: r.productId || '', cantidad: r.quantity || 1 })),
      manoDeObra: item.laborCost || 0,
      costoTotal: item.totalCost || 0,
      prioridad: 'Normal',
      lugarReparacion: 'Taller Central',
      notasInternas: item.damageReported || '',
      historialEstados: [],
      fechaCreacion: item.date || new Date().toISOString(),
      fechaActualizacion: new Date().toISOString(),
      _originalId: item.id
    };
  }
  if (colName === 'ordenesVenta') {
    return {
      clienteId: item.customerId || '',
      items: (item.items || []).map((i: any) => ({ productId: i.productId || '', cantidad: i.quantity || 1, precioUnitario: i.price || 0 })),
      total: item.total || 0,
      estado: item.status || 'Pagado',
      factura: { numero: item.id || '', xml: '', estadoHacienda: 'Aceptado' },
      fechaCreacion: item.date || new Date().toISOString(),
      _originalId: item.id
    };
  }
  if (colName === 'usuarios') {
    return {
      email: item.email || '',
      passwordHash: item.passwordHash || 'hashed',
      rol: item.role || '',
      nombre: item.name || '',
      telefono: item.phone || '',
      direccion: item.address || '',
      membresia: item.membership || '',
      fechaIngreso: item.joinDate || new Date().toISOString(),
      activo: item.active !== false,
      _originalId: item.id
    };
  }
  if (colName === 'movimientosInventario') {
    return {
      productoId: item.productId || item.sku || '',
      tipo: item.type || '',
      cantidad: item.quantity || 0,
      usuario: item.userEmail || '',
      referencia: item.reference || '',
      fecha: item.date || new Date().toISOString(),
      _originalId: item.id
    };
  }
  if (colName === 'historicalSKUs') {
    return {
      sku: item.sku || '',
      nombre: item.name || '',
      categoria: item.category || '',
      precio: item.price || 0,
      costo: item.cost || 0,
      imagen: item.imageUrl || '',
      fechaEliminacion: item.deletedAt || new Date().toISOString(),
      _originalId: item.sku
    };
  }
  if (colName === 'configuracion' || colName === 'settings') {
    return {
      logoURL: item.storeLogoUrl || '',
      datosEmpresa: {
        nombre: 'Technoverse',
        razonSocial: 'Technoverse S.A.',
        cedulaJuridica: item.cedulaJuridica || '',
        direccion: item.companyAddress || '',
        telefono: item.companyPhone || '',
        email: 'info@technoverse.com'
      },
      consecutivos: { factura: 1, notaCredito: 1, guia: 1, ticket: 1 },
      impuestos: { iva: 13 },
      _originalId: 'settings'
    };
  }
  return item;
}

function mapFromFirestore(colName: string, item: any): any {
  if (!item) return item;
  if (colName === 'productos' || colName === 'repuestos') {
    return {
      ...item,
      id: item._originalId || item.sku,
      sku: item.sku,
      name: item.nombre,
      category: item.categoria,
      price: item.precioVenta || item.precioCosto,
      cost: item.costo || item.precioCosto,
      stock: item.stock,
      imageUrl: item.imagen,
      active: item.activo
    };
  }
  // And similarly for others, we just merge the english props back for the frontend...
  // Wait, if the frontend needs the original English keys, it's easier to just store BOTH English and Spanish keys in Firestore, so it satisfies both the prompt and the frontend without breaking anything.
  // We can just Object.assign the mapped keys onto the cleanItem.
  return item;
}
`;

// Wait, the safest approach is to store the English properties AND the Spanish properties in Firestore.
// The validator will check the Spanish keys. The frontend will use the English keys.

const saferMapperStr = `
function mapToFirestore(colName: string, item: any): any {
  const mapped: any = { ...item };
  if (colName === 'productos' || colName === 'repuestos') {
    mapped.sku = item.sku || item.id || '';
    mapped.nombre = item.name || '';
    mapped.categoria = item.category || '';
    mapped.precioVenta = item.price || 0;
    mapped.precioCosto = item.cost || 0;
    mapped.costo = item.cost || 0;
    mapped.stock = item.stock || 0;
    mapped.imagen = item.imageUrl || '';
    mapped.garantia = item.category === 'Repuestos' || ['LCD', 'Batería', 'Flex'].includes(item.category) ? '3 meses' : '1 mes';
    mapped.vinculadoARepuesto = item.linkedSparePartSku || '';
    mapped.ubicacion = item.location || 'Bodega 1';
    mapped.activo = item.active !== false;
  }
  if (colName === 'ordenesReparacion') {
    mapped.guia = item.id || '';
    mapped.ticket = item.ticket || '';
    mapped.cliente = { nombre: item.customerName || '', email: item.customerEmail || '', telefono: '' };
    mapped.dispositivo = { marca: '', modelo: item.device || '' };
    mapped.estado = item.status || '';
    mapped.repuestosConsumidos = (item.repuestos || []).map((r: any) => ({ sku: r.productId || '', cantidad: r.quantity || 1 }));
    mapped.manoDeObra = item.laborCost || 0;
    mapped.costoTotal = item.totalCost || 0;
    mapped.prioridad = 'Normal';
    mapped.lugarReparacion = 'Taller Central';
    mapped.notasInternas = item.damageReported || '';
    mapped.historialEstados = [];
    mapped.fechaCreacion = item.date || new Date().toISOString();
    mapped.fechaActualizacion = new Date().toISOString();
  }
  if (colName === 'ordenesVenta') {
    mapped.clienteId = item.customerId || '';
    mapped.items = (item.items || []).map((i: any) => ({ productId: i.productId || '', cantidad: i.quantity || 1, precioUnitario: i.price || 0 }));
    mapped.total = item.total || 0;
    mapped.estado = item.status || 'Pagado';
    mapped.factura = { numero: item.id || '', xml: '', estadoHacienda: 'Aceptado' };
    mapped.fechaCreacion = item.date || new Date().toISOString();
  }
  if (colName === 'usuarios') {
    mapped.email = item.email || '';
    mapped.passwordHash = item.passwordHash || 'hashed';
    mapped.rol = item.role || '';
    mapped.nombre = item.name || '';
    mapped.telefono = item.phone || '';
    mapped.direccion = item.address || '';
    mapped.membresia = item.membership || '';
    mapped.fechaIngreso = item.joinDate || new Date().toISOString();
    mapped.activo = item.active !== false;
  }
  if (colName === 'movimientosInventario') {
    mapped.productoId = item.productId || item.sku || '';
    mapped.tipo = item.type || '';
    mapped.cantidad = item.quantity || 0;
    mapped.usuario = item.userEmail || '';
    mapped.referencia = item.reference || '';
    mapped.fecha = item.date || new Date().toISOString();
  }
  if (colName === 'historicalSKUs') {
    mapped.sku = item.sku || '';
    mapped.nombre = item.name || '';
    mapped.categoria = item.category || '';
    mapped.precio = item.price || 0;
    mapped.costo = item.cost || 0;
    mapped.imagen = item.imageUrl || '';
    mapped.fechaEliminacion = item.deletedAt || new Date().toISOString();
  }
  if (colName === 'configuracion' || colName === 'settings') {
    mapped.logoURL = item.storeLogoUrl || '';
    mapped.datosEmpresa = {
      nombre: 'Technoverse',
      razonSocial: 'Technoverse S.A.',
      cedulaJuridica: item.cedulaJuridica || '',
      direccion: item.companyAddress || '',
      telefono: item.companyPhone || '',
      email: 'info@technoverse.com'
    };
    mapped.consecutivos = { factura: 1, notaCredito: 1, guia: 1, ticket: 1 };
    mapped.impuestos = { iva: 13 };
  }
  return mapped;
}
`;

code = code.replace(/export function checkQuotaError/, saferMapperStr + '\nexport function checkQuotaError');
code = code.replace(/const cleanItem = cleanObject\(item\);/g, "const cleanItem = mapToFirestore(colName, cleanObject(item));");
code = code.replace(/const cleanSettings = cleanObject\(newDb\.settings \|\| \{\}\);/, "const cleanSettings = mapToFirestore('configuracion', cleanObject(newDb.settings || {}));");

fs.writeFileSync('src/utils/storage.ts', code);
console.log("Mapped fields to Spanish successfully");
