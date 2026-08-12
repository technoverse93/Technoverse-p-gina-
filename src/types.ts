export interface User {
  id: string;
  email: string;
  role: 'Dueño' | 'Cliente';
  name: string;
  token?: string;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  category: string;
  price: number; // In Colones
  cost: number;  // In Colones
  stock: number;
  imageUrl: string;
  discountPercent: number;
  discountStartDate?: string;
  discountEndDate?: string;
  active?: boolean;
  description?: string;
  minStock?: number;
  weight?: number; // kg
  dimensions?: string; // e.g. "10x5x2 cm"
  row?: string; // row A-Z for warehouse
  shelf?: string; // shelf 1-10 for warehouse
  physicalLocation?: string; // physical location at home (e.g., "Estudio", "Caja azul", "Armario")
  warranty?: string; // Product warranty (e.g., "12 meses")
  isDoubleStock?: boolean;
  internalStock?: number;
  clientStock?: number;
  linkedSparePartSku?: string;
  /**
   * Solo aplica a los INSUMOS: los deja aparecer en el catálogo público.
   *
   * Por defecto ausente, que equivale a oculto. Es el valor seguro: un
   * insumo nuevo es material interno mientras alguien no decida lo
   * contrario, y publicar por descuido un temperado a precio de costo se
   * descubre tarde y mal. Los repuestos no la consultan nunca — no se
   * venden, marque lo que marque este campo.
   */
  visibleEnTienda?: boolean;
  // Código de 13 dígitos del Catálogo de Bienes y Servicios (CAABYS) de
  // Hacienda, requerido por línea en comprobantes electrónicos v4.3.
  caabys?: string;
}

export interface InventoryMovement {
  id: string;
  productId: string;
  productName: string;
  quantityChange: number; // positive or negative
  type: 'Entrada manual' | 'Venta' | 'Consumo en reparación' | 'Devolución' | 'Ajuste por conteo' | 'Entrada' | 'Salida' | 'Ajuste manual';
  notes: string;
  timestamp: string;
  userEmail: string;
  resultingStock?: number;
  reference?: string;
}

export interface RepairOrder {
  id: string; // GT-XXX
  ticket: string; // TKT-XXX
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string; // para notificación directa por WhatsApp
  device: string;
  deviceCategory?: string; // Celular / Laptop / PC / Consola
  deviceBrand?: string;
  deviceModel?: string;
  damageReported: string;
  damageCategory?: string; // categoría estructurada de la falla (filtro en cascada de recepción)
  diagnosisManual?: string;
  repuestos: {
    productId: string;
    productName: string;
    quantity: number;
    price: number; // in colones
  }[];
  laborCost: number;
  totalCost: number;
  status: 'Pendiente' | 'Diagnosticada' | 'Cotizada' | 'Aprobada' | 'En Reparación' | 'Lista' | 'Entregada' | 'Cancelada' | 'Esperando repuestos';
  warrantyMonths: number; // must be minimum 3 months according to Ley 7472
  blockchainHash?: string;
  bitacora: {
    status: string;
    notes: string;
    timestamp: string;
    user: string;
  }[];
  createdAt: string;
  repairLocation?: string; // place of repair at home (e.g. "Mesa de taller", "Habitación de repuestos")
  neededTools?: string; // tools required for repair
}

export interface OrderItem {
  productId: string;
  productName: string;
  quantity: number;
  price: number;
  discountApplied: number;
}

export interface Order {
  id: string; // FAC-XXX (starting from FAC-001) or NC-XXX for credit notes
  customerId: string;
  customerName: string;
  customerEmail: string;
  items: OrderItem[];
  subtotal: number;
  membershipDiscount: number;
  shippingCost: number;
  taxAmount: number; // IVA 13%
  total: number;
  // 'Efectivo' se agrega para los cobros del módulo de facturación, que se
  // hacen en mostrador. Es una ampliación del tipo, no un cambio: los
  // pedidos existentes con 'SINPE' o 'Tarjeta' siguen siendo válidos y
  // todo el código que los compara sigue funcionando igual.
  paymentMethod: 'SINPE' | 'Tarjeta' | 'Efectivo';
  paymentDetails: {
    phone?: string;
    cardLast4?: string;
    referenceNumber?: string;
  };
  status: 'Completado' | 'Devuelto' | 'Cancelado';
  xmlVerified: boolean;
  hdaStatus: 'Pendiente' | 'Enviado' | 'Aceptado' | 'Rechazado';
  xmlContent?: string;
  timestamp: string;
  pickupInPerson?: boolean; // pick up at home office (shop is home)
}

export interface ChatMessage {
  id: string;
  sender: 'customer' | 'support' | 'bot';
  text: string;
  timestamp: string;
  imageUrl?: string;
  isInternalNote?: boolean;
}

export interface ChatConversation {
  id: string;
  customerName: string;
  customerEmail: string;
  messages: ChatMessage[];
  status: 'nuevo' | 'pendiente' | 'resuelto';
  unreadCount: number;
  assignedAdminEmail?: string;
  // Secreto por cliente (anónimo): identifica de forma segura sus propias
  // conversaciones. Se genera en el navegador y se guarda en localStorage.
  customerToken?: string;
  // Mantenida por trigger en la BD (nunca la escribe el cliente): última vez
  // que cambió la fila. Es la base del filtro por rango temporal de chats
  // resueltos (1 día / 1 semana / 1 mes) en el panel del admin.
  updatedAt?: string;
}

export interface AuditLog {
  id: string;
  userEmail: string;
  module: string;
  action: string;
  detail: string;
  timestamp: string;
}

export interface ClientProfile {
  id: string;
  name: string;
  email: string;
  phone: string;
  // Opcional: desde que la entrega se coordina manualmente (sin módulo de
  // envío), el checkout ya no pide provincia. La columna en Supabase acepta
  // NULL, pero tiene un CHECK que rechaza cualquier texto que no sea una de
  // estas 7 — por eso NUNCA se debe enviar '' (cadena vacía viola el CHECK,
  // ausente/NULL no).
  province?: 'San José' | 'Alajuela' | 'Cartago' | 'Heredia' | 'Guanacaste' | 'Puntarenas' | 'Limón';
  addressDetail: string;
  cardsTokenized: {
    last4: string;
    brand: string;
  }[];
  balance: number; // saldo a favor
  notes: string;
  pickupInPerson?: boolean; // if they tend to pick up in person at home
}

export interface LegalPrivacyChecklist {
  consentimientoInformado: boolean;
  politicaPrivacidadVisible: boolean;
  derechoAlOlvidoActivo: boolean;
  exportacionLegibleDatos: boolean;
}

export interface MarketingCampaign {
  id: string;
  code: string; // for coupon
  type: 'Porcentaje' | 'Monto';
  value: number;
  limit: number;
  used: number;
  applicableCategory?: string; // e.g. "Fundas", "Todas"
  active: boolean;
  // Caducidad automática (60 días desde la creación); mantenida por la BD,
  // solo lectura desde el frontend.
  expiresAt?: string;
}

export interface Banner {
  id: string;
  title: string;
  description: string;
  imageUrl?: string;
  link?: string;
  type: 'Servicios' | 'Repuestos' | 'Soporte' | 'General';
  active: boolean;
  startDate?: string;
  endDate?: string;
}

export interface LogisticsDelivery {
  id: string; // same as order/repair id
  type: 'Orden' | 'Reparación';
  recipientName: string;
  recipientPhone: string;
  province: string;
  addressDetail: string;
  status: 'Pendiente' | 'En Ruta' | 'Entregado' | 'Incidencia';
  assignedRepartidorId?: string;
  assignedRepartidorName?: string;
  incidences: string[];
  digitalSignature?: string; // base64 or drawn path
}

export interface AppSettings {
  cedulaJuridica: string;
  companyPhone: string;
  companyAddress: string;
  workshopAddress: string;
  pickupHours: string;
  maxStockLimit: number;
  storeLogo?: string;
  // URL del "Catch Hook" de Zapier (Webhook -> Instagram Publish Photo).
  // Se configura una sola vez; de ahí en adelante el cron de Supabase la usa
  // para publicar solo las piezas programadas, sin intervención manual.
  instagramWebhookUrl?: string;
}

/**
 * Solicitud de publicación promocional en Instagram, creada desde el
 * formulario de "Agregar Producto" en Inventario.
 *
 * La GENERACIÓN de la imagen (vía Canva) todavía requiere criterio humano —
 * hoy la hace el equipo desde el chat con Claude, porque Canva no tiene una
 * API que este backend pueda invocar solo. Lo que SÍ corre sin intervención
 * es la PUBLICACIÓN: una vez que `imageUrl` está lleno, el cron de Supabase
 * dispara la publicación exactamente en `scheduledAt`, sin que nadie tenga
 * que hacer clic en ese momento.
 */
export interface MarketingRequest {
  id: string;
  productId: string;
  productName: string;
  productSku?: string;
  price: number;
  caption?: string;
  imageUrl?: string;
  status: 'pendiente_imagen' | 'programado' | 'publicado' | 'error';
  scheduledAt: string;
  errorDetail?: string;
  createdBy?: string;
  createdAt: string;
}

export interface HistoricalSku {
  sku: string;
  name: string;
  category: string;
  price: number;
  cost: number;
  imageUrl?: string;
}

