import { Product, RepairOrder, Order, User, InventoryMovement, HistoricalSku, AppSettings } from '../types';
import { Timestamp } from 'firebase/firestore';

const spareCategories = ['LCD', 'Batería', 'Flex', 'Cámara', 'Lógica', 'Conector'];

export function productToFirestore(p: Product): any {
  return {
    sku: p.sku || p.id,
    nombre: p.name,
    categoria: p.category,
    precioVenta: p.price,
    costo: p.cost || 0,
    stock: p.stock,
    imagen: p.imageUrl || '',
    garantia: p.category.includes('Repuesto') ? '3 meses' : '1 mes',
    activo: p.active !== false,
    _originalId: p.id,
    ...p
  };
}

export function productFromFirestore(data: any): Product {
  return {
    ...data,
    id: data._originalId || data.sku,
    name: data.nombre || data.name,
    sku: data.sku,
    category: data.categoria || data.category,
    price: data.precioVenta || data.price,
    cost: data.costo || data.cost,
    stock: data.stock,
    imageUrl: data.imagen || data.imageUrl,
    active: data.activo !== false,
  };
}

// And similar for others...
