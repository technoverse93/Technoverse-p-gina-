// =====================================================================
// MAPA DE NAVEGACIÓN DE LA CONSOLA
// =====================================================================
// UNA sola definición de los módulos del panel, consumida por las tres
// superficies que los muestran: el riel de escritorio, el dock de móvil
// y el buscador de módulos.
//
// ---------------------------------------------------------------------
// POR QUÉ ESTO EXISTE
// ---------------------------------------------------------------------
// En la versión anterior la lista de módulos estaba escrita CUATRO
// veces dentro de AdminPanel.tsx: en `getPermittedSubItems`, en
// `sidebarSections`, en las hojas móviles y otra vez, a mano, en la
// barra inferior. Agregar un módulo obligaba a acordarse de los cuatro
// sitios, y bastaba olvidar uno para que el módulo existiera en
// escritorio y no en la APK — que es exactamente lo que había pasado
// con varias entradas.
//
// Con una sola fuente, agregar un módulo es agregar UN objeto aquí.
// =====================================================================

import {
  LayoutDashboard, Package, Wrench, ArrowRightLeft, FileSpreadsheet,
  Cpu,
  MessageSquare, CreditCard, Megaphone, ShieldAlert, Settings, Receipt,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface AdminNavItem {
  /** Debe coincidir EXACTAMENTE con el valor de `activeTab` del panel. */
  id: string;
  /** Nombre corto: el que se ve en el riel abierto y en el buscador. */
  label: string;
  /** Nombre aún más corto para el dock móvil, donde caben ~9 caracteres. */
  short: string;
  icon: LucideIcon;
  /** Frase que explica el módulo. Se usa como subtítulo de la pantalla. */
  descripcion: string;
  /**
   * Palabras por las que se puede encontrar el módulo en el buscador.
   * Van los sinónimos que usa el personal aunque no aparezcan en el
   * nombre oficial: quien busca "factura" tiene que llegar a
   * Contabilidad sin saber que el módulo se llama así.
   */
  buscar: string[];
}

export interface AdminNavGroup {
  titulo: string;
  items: AdminNavItem[];
}

export const NAV_GROUPS: AdminNavGroup[] = [
  {
    titulo: 'General',
    items: [
      {
        id: 'dashboard',
        label: 'Panel general',
        short: 'Inicio',
        icon: LayoutDashboard,
        descripcion: 'Estado del negocio hoy: ventas, taller, inventario y lo que necesita atención.',
        buscar: ['dashboard', 'inicio', 'resumen', 'kpi', 'metricas', 'ventas', 'home'],
      },
    ],
  },
  {
    titulo: 'Inventario',
    items: [
      {
        id: 'inventario_productos',
        label: 'Productos',
        short: 'Productos',
        icon: Package,
        descripcion: 'Catálogo, precios, existencias y ubicación física de cada artículo.',
        buscar: ['productos', 'catalogo', 'articulos', 'stock', 'precios', 'celulares', 'laptops'],
      },
      {
        id: 'inventario_repuestos',
        label: 'Repuestos',
        short: 'Repuestos',
        // Icono distinto al de Taller a propósito: con el riel cerrado
        // solo se ve el dibujo, y dos llaves inglesas idénticas obligan a
        // abrir el menú para saber cuál es cuál.
        icon: Cpu,
        descripcion: 'Piezas para reparación: existencias, costos y reposición.',
        buscar: ['repuestos', 'piezas', 'partes', 'pantallas', 'baterias', 'taller'],
      },
      {
        id: 'inventario_movimientos',
        label: 'Movimientos',
        short: 'Movim.',
        icon: ArrowRightLeft,
        descripcion: 'Entradas, salidas y ajustes de existencias con su trazabilidad.',
        buscar: ['movimientos', 'entradas', 'salidas', 'ajustes', 'kardex', 'trazabilidad'],
      },
      {
        id: 'inventario_reportes',
        label: 'Reportes de stock',
        short: 'Reportes',
        icon: FileSpreadsheet,
        descripcion: 'Existencias valorizadas, rotación y artículos por reponer.',
        buscar: ['reportes', 'stock', 'existencias', 'valorizado', 'rotacion', 'inventario'],
      },
    ],
  },
  {
    titulo: 'Operación',
    items: [
      {
        id: 'chat',
        label: 'Chat y CRM',
        short: 'Chat',
        icon: MessageSquare,
        descripcion: 'Conversaciones con clientes en tiempo real y seguimiento comercial.',
        buscar: ['chat', 'crm', 'mensajes', 'soporte', 'conversaciones', 'whatsapp'],
      },
      {
        id: 'taller',
        label: 'Taller',
        short: 'Taller',
        icon: Wrench,
        descripcion: 'Tablero de reparaciones por estado, desde el ingreso hasta la entrega.',
        buscar: ['taller', 'kanban', 'reparaciones', 'ordenes', 'servicio tecnico', 'arreglos'],
      },
      {
        id: 'clientes',
        label: 'Clientes',
        short: 'Clientes',
        icon: CreditCard,
        descripcion: 'Fichas de clientes, historial de compras y gestión de accesos.',
        buscar: ['clientes', 'crm', 'fichas', 'compradores', 'contactos', 'usuarios'],
      },
    ],
  },
  {
    titulo: 'Administración',
    items: [
      {
        id: 'cobros',
        label: 'Cobros',
        short: 'Cobrar',
        icon: Receipt,
        descripcion: 'Cobra un trabajo terminado, descuenta insumos y envía el comprobante al cliente.',
        buscar: ['cobros', 'cobrar', 'facturar', 'venta', 'servicio', 'sinpe', 'efectivo', 'regalia', 'garantia'],
      },
      {
        id: 'facturacion',
        label: 'Contabilidad',
        short: 'Facturas',
        icon: FileSpreadsheet,
        descripcion: 'Comprobantes electrónicos, IVA y notas de crédito.',
        buscar: ['contabilidad', 'facturacion', 'facturas', 'hacienda', 'iva', 'd104', 'nota de credito'],
      },
      {
        id: 'marketing',
        label: 'Marketing',
        short: 'Marketing',
        icon: Megaphone,
        descripcion: 'Cupones de descuento y campañas promocionales.',
        buscar: ['marketing', 'cupones', 'descuentos', 'campanas', 'promociones', 'publicidad'],
      },
      {
        id: 'ciberseguridad',
        label: 'Ciberseguridad',
        short: 'Seguridad',
        icon: ShieldAlert,
        descripcion: 'Bloqueos por dispositivo, bitácora de auditoría y acceso biométrico.',
        buscar: ['ciberseguridad', 'seguridad', 'bitacora', 'auditoria', 'baneos', 'bloqueos', 'huella', 'biometria'],
      },
      {
        id: 'configuracion',
        label: 'Configuración',
        short: 'Ajustes',
        icon: Settings,
        descripcion: 'Datos fiscales, logo de la tienda y creación de administradores.',
        buscar: ['configuracion', 'ajustes', 'logo', 'cedula', 'fiscal', 'usuarios', 'administradores'],
      },
    ],
  },
];

/** Todos los módulos en una lista plana. */
export const NAV_ITEMS: AdminNavItem[] = NAV_GROUPS.flatMap(g => g.items);

/**
 * Módulos que ocupan las ranuras fijas del dock móvil.
 *
 * Son CUATRO y no cinco a propósito: la quinta ranura la ocupa siempre
 * el botón "Más", y meter seis elementos en el ancho de un teléfono
 * deja etiquetas de cuatro letras cortadas. Se eligieron los que se
 * abren varias veces al día; el resto está a un toque de distancia en
 * la hoja de "Más", que además es una lista con nombres completos y no
 * abreviaturas.
 */
export const DOCK_IDS = ['dashboard', 'taller', 'cobros', 'inventario_productos'];

/**
 * Traduce un `activeTab` al módulo que le corresponde.
 *
 * Contempla los alias históricos para que un marcador viejo o un enlace
 * compartido nunca abra el panel en blanco: era lo que pasaba con
 * /admin/bitacora después de fusionar esa pestaña dentro de
 * Ciberseguridad.
 */
export function resolverModulo(tab: string): AdminNavItem {
  const alias: Record<string, string> = {
    productos: 'inventario_productos',
    inventario: 'inventario_productos',
    bitacora: 'ciberseguridad',
    cumplimiento: 'dashboard',
    logistica: 'dashboard',
  };
  const id = alias[tab] || tab;
  return NAV_ITEMS.find(i => i.id === id) || NAV_ITEMS[0];
}

/** Grupo al que pertenece un módulo. Alimenta la miga de pan. */
export function grupoDe(tab: string): string {
  const modulo = resolverModulo(tab);
  const grupo = NAV_GROUPS.find(g => g.items.some(i => i.id === modulo.id));
  return grupo?.titulo || 'General';
}

/**
 * Busca módulos por nombre o por sinónimo.
 *
 * La comparación ignora tildes: quien escribe "bitacora" sin tilde —que
 * es como se escribe con prisa— tiene que encontrar "Bitácora" igual.
 */
export function buscarModulos(consulta: string): AdminNavItem[] {
  const q = normalizar(consulta);
  if (!q) return NAV_ITEMS;
  return NAV_ITEMS.filter(item => {
    const heno = normalizar([item.label, item.descripcion, ...item.buscar].join(' '));
    return heno.includes(q);
  });
}

// Los signos diacríticos que `normalize('NFD')` separa de su letra. Se
// construye con `RegExp` y no con un literal para que el rango quede
// escrito con códigos legibles y no como caracteres invisibles en el
// archivo, que es imposible de revisar en un diff.
const DIACRITICOS = new RegExp('[\\u0300-\\u036f]', 'g');

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(DIACRITICOS, '')
    .trim();
}
