// =====================================================================
// MAPA DE NAVEGACIÓN DE LA CONSOLA — "REGLETA Y CARPETAS"
// =====================================================================
// UNA sola definición de los módulos del panel y de sus carpetas,
// consumida por las superficies que los muestran: la regleta de
// escritorio, la pestaña «Nueva pestaña» y el dock de móvil.
//
// ---------------------------------------------------------------------
// QUÉ CAMBIÓ Y POR QUÉ
// ---------------------------------------------------------------------
// Antes había QUINCE entradas planas, y cinco de ellas —Productos,
// Repuestos, Insumos, Movimientos y Reportes— eran en realidad las cinco
// vistas de un mismo módulo, InventarioControl, que además las volvía a
// dibujar por dentro como pestañas. Resultado medido sobre el panel real:
// el mismo menú, dos veces, uno encima del otro, y 330 px de alto gastados
// antes de ver el primer producto.
//
// Ahora un módulo puede declarar CARPETAS. Inventario es UN módulo con
// cinco carpetas; el menú de módulos lista once entradas en vez de
// quince, y las cinco vistas se dibujan UNA sola vez, en la fila de
// carpetas que pinta el armazón.
//
// Las carpetas conservan los mismos `activeTab` de siempre
// (`inventario_productos`…), así que ningún enlace guardado ni ningún
// `activeTab` existente deja de funcionar.
// =====================================================================

import {
  LayoutDashboard, Package, Wrench, ArrowRightLeft, FileSpreadsheet,
  Cpu, Boxes, LayoutGrid,
  MessageSquare, CreditCard, Megaphone, ShieldAlert, Settings, Receipt,
  UserCog, ShieldCheck, MonitorPlay, Camera, Ban,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * Una carpeta: una vista dentro de un módulo.
 *
 * `tab` es el `activeTab` que la activa. Se conserva el identificador
 * histórico de cada una para no romper enlaces ni marcadores.
 */
export interface AdminCarpeta {
  id: string;
  label: string;
  tab: string;
  icon?: LucideIcon;
  /** Palabras por las que el buscador debe encontrar esta carpeta. */
  buscar?: string[];
}

export interface AdminNavItem {
  /** Debe coincidir EXACTAMENTE con el valor de `activeTab` del panel. */
  id: string;
  /** Nombre corto: el que se ve en la regleta y en el selector. */
  label: string;
  /** Nombre aún más corto para el dock móvil, donde caben ~9 caracteres. */
  short: string;
  icon: LucideIcon;
  /** Frase que explica el módulo. Se usa como pista bajo las carpetas. */
  descripcion: string;
  /**
   * Palabras por las que se puede encontrar el módulo en el buscador.
   * Van los sinónimos que usa el personal aunque no aparezcan en el
   * nombre oficial: quien busca "factura" tiene que llegar a
   * Contabilidad sin saber que el módulo se llama así.
   */
  buscar: string[];
  /**
   * Vistas del módulo. Cuando existen, el armazón dibuja la fila de
   * carpetas y el módulo NO debe dibujar ninguna pestaña propia: esa
   * duplicación es justo lo que este modelo viene a eliminar.
   */
  carpetas?: AdminCarpeta[];
  /**
   * Si es `true`, el módulo solo aparece —en la regleta, el selector y
   * el buscador— para la cuenta del administrador supremo (ver
   * `esAdminSupremo` en securityPin.ts). Es un filtro de UI únicamente:
   * la restricción real vive en el servidor, en las funciones que ese
   * módulo termina llamando.
   */
  soloAdminSupremo?: boolean;
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
        // UN módulo, cinco carpetas. Antes eran cinco entradas de menú
        // que el propio InventarioControl repetía como pestañas.
        id: 'inventario_productos',
        label: 'Inventario',
        short: 'Inventario',
        icon: Package,
        descripcion: 'Catálogo, repuestos, insumos, movimientos de existencias y reportes de stock.',
        buscar: [
          'inventario', 'productos', 'catalogo', 'articulos', 'stock', 'precios',
          'repuestos', 'piezas', 'partes', 'pantallas', 'baterias',
          'insumos', 'temperados', 'micas', 'cables', 'regalia',
          'movimientos', 'entradas', 'salidas', 'kardex', 'reportes', 'existencias',
        ],
        carpetas: [
          {
            id: 'productos', label: 'Productos', tab: 'inventario_productos', icon: Package,
            buscar: ['productos', 'catalogo', 'articulos', 'celulares', 'accesorios'],
          },
          {
            // Icono distinto al de Taller a propósito: dos llaves inglesas
            // idénticas obligan a leer la etiqueta para saber cuál es cuál.
            id: 'repuestos', label: 'Repuestos', tab: 'inventario_repuestos', icon: Cpu,
            buscar: ['repuestos', 'piezas', 'partes', 'lcd', 'pantallas', 'baterias', 'flex'],
          },
          {
            id: 'insumos', label: 'Insumos', tab: 'inventario_insumos', icon: Boxes,
            buscar: ['insumos', 'temperados', 'micas', 'cables', 'estuches', 'regalia', 'consumibles'],
          },
          {
            id: 'movimientos', label: 'Movimientos', tab: 'inventario_movimientos', icon: ArrowRightLeft,
            buscar: ['movimientos', 'entradas', 'salidas', 'ajustes', 'kardex', 'trazabilidad'],
          },
          {
            id: 'reportes', label: 'Reportes', tab: 'inventario_reportes', icon: FileSpreadsheet,
            buscar: ['reportes', 'stock', 'existencias', 'valorizado', 'rotacion'],
          },
        ],
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
        buscar: ['ciberseguridad', 'seguridad', 'bitacora', 'auditoria', 'baneos', 'bloqueos', 'huella', 'biometria', 'ip', 'visitantes', 'penalizados'],
      },
      {
        id: 'configuracion',
        label: 'Configuración',
        short: 'Ajustes',
        icon: Settings,
        descripcion: 'Datos fiscales, logo de la tienda y creación de administradores.',
        buscar: ['configuracion', 'ajustes', 'logo', 'cedula', 'fiscal', 'usuarios', 'administradores'],
      },
      {
        id: 'ingresos',
        label: 'Ingresos',
        short: 'Ingresos',
        icon: ShieldCheck,
        descripcion: 'Auditoría en vivo de cada autenticación exitosa: correo, hora y entorno.',
        buscar: ['ingresos', 'accesos', 'auditoria', 'sesiones', 'login', 'seguridad', 'supremo', 'zero trust'],
        soloAdminSupremo: true,
      },
      {
        id: 'supervision',
        label: 'Supervisión',
        short: 'Espejo',
        icon: MonitorPlay,
        descripcion: 'Espejo en vivo de la sesión del personal conectado (web y APK).',
        buscar: ['supervision', 'espejo', 'monitoreo', 'pantalla', 'sesion', 'replay', 'vigilancia', 'supremo', 'zero trust'],
        soloAdminSupremo: true,
      },
      {
        id: 'dlp',
        label: 'Capturas',
        short: 'Capturas',
        icon: Camera,
        descripcion: 'Lista blanca de capturas de pantalla: quién puede, y en qué capa (web o APK).',
        buscar: ['capturas', 'dlp', 'pantallazo', 'screenshot', 'printscreen', 'fuga', 'lista blanca', 'flag secure', 'supremo', 'zero trust'],
        soloAdminSupremo: true,
      },
      {
        id: 'bloqueos',
        label: 'Bloqueos',
        short: 'Bloqueos',
        icon: Ban,
        descripcion: 'Expulsa al instante una cuenta, una IP o un modelo de aparato, y los libera igual de rápido.',
        buscar: ['bloqueos', 'bloquear', 'expulsar', 'ban', 'baneo', 'kill switch', 'ip', 'dispositivo', 'intruso', 'supremo'],
        soloAdminSupremo: true,
      },
      {
        id: 'gestion_usuarios',
        label: 'Gestión de usuarios',
        short: 'Usuarios',
        icon: UserCog,
        descripcion: 'Restablece la contraseña o el PIN de seguridad de otra cuenta administradora.',
        buscar: ['usuarios', 'administradores', 'gestion', 'restablecer', 'contrasena', 'pin', 'supremo'],
        soloAdminSupremo: true,
      },
    ],
  },
];

/** Todos los módulos en una lista plana. */
export const NAV_ITEMS: AdminNavItem[] = NAV_GROUPS.flatMap(g => g.items);

/**
 * La pestaña «Nueva pestaña»: el lanzador que reemplaza al modal del
 * botón «+», con el mismo espíritu que la página de inicio de un
 * navegador. No es un módulo real —no aparece en `NAV_GROUPS`, así que
 * nunca se lista a sí misma en su propia cuadrícula— pero necesita
 * comportarse como uno para que el resto del sistema de pestañas
 * (`BarraDePestanas`, `usePestanas`, el ciclo de apertura y cierre) no
 * tenga que conocer un caso especial.
 */
export const PESTANA_NUEVA = '__nueva__';

const MODULO_NUEVA_PESTANA: AdminNavItem = {
  id: PESTANA_NUEVA,
  label: 'Nueva pestaña',
  short: 'Nueva',
  icon: LayoutGrid,
  descripcion: 'Abrir un módulo.',
  buscar: [],
};

/**
 * Los módulos que se abren varias veces al día, de partida.
 *
 * Solo alimenta la fila "Frecuentes" de «Nueva pestaña» (ver
 * `modulosFrecuentes` en `usePestanas.ts`) cuando todavía no hay
 * historial real de uso guardado — el primer arranque, o un
 * `localStorage` recién borrado. En cuanto hay uso real, este orden fijo
 * deja de importar: la lista pasa a ordenarse por lo que la cuenta abre
 * de verdad.
 */
export const MODULOS_HABITUALES = ['dashboard', 'taller', 'cobros', 'inventario_productos'];

/**
 * Traduce un `activeTab` al módulo que le corresponde.
 *
 * Contempla los alias históricos para que un marcador viejo o un enlace
 * compartido nunca abra el panel en blanco: era lo que pasaba con
 * /admin/bitacora después de fusionar esa pestaña dentro de
 * Ciberseguridad.
 */
export function resolverModulo(tab: string): AdminNavItem {
  if (tab === PESTANA_NUEVA) return MODULO_NUEVA_PESTANA;

  const alias: Record<string, string> = {
    productos: 'inventario_productos',
    inventario: 'inventario_productos',
    bitacora: 'ciberseguridad',
    cumplimiento: 'dashboard',
    logistica: 'dashboard',
  };
  const id = alias[tab] || tab;

  // Coincidencia directa con un módulo.
  const directo = NAV_ITEMS.find(i => i.id === id);
  if (directo) return directo;

  // ¿Es el `tab` de una carpeta? Entonces el módulo es su dueño.
  const dueno = NAV_ITEMS.find(i => i.carpetas?.some(c => c.tab === id));
  return dueno || NAV_ITEMS[0];
}

/** La carpeta activa dentro de su módulo, si el módulo tiene carpetas. */
export function resolverCarpeta(tab: string): AdminCarpeta | undefined {
  const modulo = resolverModulo(tab);
  if (!modulo.carpetas) return undefined;
  return modulo.carpetas.find(c => c.tab === tab) || modulo.carpetas[0];
}

/** Grupo al que pertenece un módulo. Alimenta el selector de módulos. */
export function grupoDe(tab: string): string {
  const modulo = resolverModulo(tab);
  const grupo = NAV_GROUPS.find(g => g.items.some(i => i.id === modulo.id));
  return grupo?.titulo || 'General';
}

// El buscador por texto que vivía aquí (`buscarModulos`, con su
// `normalizar` de acentos) se retiró junto con el campo de texto del
// selector de módulos: un input que se enfoca solo levanta el teclado en
// Android y tapa la lista que se venía a leer. La «Nueva pestaña»
// (`NuevaPestana.tsx`) que lo reemplaza no busca — enseña los once
// módulos agrupados, que se leen de un vistazo.
