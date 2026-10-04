// =====================================================================
// MAPA DEL SISTEMA — lo que el modo Arquitecto sabe de Technoverse
// =====================================================================
// Resumen curado (no código) para que el Arquitecto evalúe ideas con lo
// que de verdad existe. Si se agrega un módulo o una regla de la casa,
// se actualiza aquí. No incluye claves, correos ni datos de clientes.
// =====================================================================

export const MAPA_SISTEMA = `
PLATAFORMA
- Tienda web pública + panel de administración. React 19 + Vite + Tailwind v4.
- App Android con Capacitor (APK). Los cambios web llegan solos (OTA) sin APK nueva; los cambios nativos (permisos, complementos, MainActivity) piden APK nueva.
- Backend: Supabase (Postgres con RLS, Auth, Realtime, Storage, Edge Functions en Deno). Web publicada en Cloudflare al fusionar a main.
- IA gratuita: Gemini (plan gratis de Google, puede usar los datos para entrenar) con Groq de respaldo. Nada de planes pagos. Búsqueda web con Tavily (1.000 gratis al mes).
- Roles: superadmin (dueño, acceso total), admin, empleado, Cliente.

MÓDULOS DEL PANEL (pestañas)
- Panel general: KPIs del día, atención requerida.
- Inventario: productos, repuestos, insumos, movimientos, reportes (tabla products: name, sku, category, brand, price, cost, stock, min_stock, warranty, active).
- Chat y CRM: conversaciones con clientes (texto, fotos, notas de voz), burbuja flotante para el personal.
- Asistente IA / Jarvis: chat con consultas de solo lectura; Jarvis prepara acciones que el superadmin confirma.
- Taller: tablero Kanban de órdenes (repair_orders: estados Pendiente, Diagnosticada, Cotizada, Aprobada, Esperando repuestos, En Reparación, Lista, Entregada, Cancelada).
- Clientes, Cobros (mostrador), Contabilidad/Facturación electrónica de Hacienda (invoices con consecutivo, IVA, medio de pago, garantia_meses; envío por correo).
- Marketing (publicaciones), Configuración, Ciberseguridad (IPs bloqueadas, lista blanca, equipos y clientes baneados, bitácora).
- Superadmin: Supervisión (personal y visitantes en vivo), Ubicaciones, Ingresos (inicios de sesión), Bloqueos (Kill Switch instantáneo por cuenta, IP, modelo o equipo), Gestión de usuarios.
- Tienda: catálogo, carrito, pedidos (orders), cupones, chat en vivo con la tienda, textos editables por el admin.

REGLAS DE LA CASA
- Privacidad en dos carriles: la IA nunca recibe datos personales de clientes; el detalle va directo a la pantalla del superadmin.
- Todo el panel en español de Costa Rica, voseo, legible a 360 px (Galaxy A12), tema claro y oscuro, letra mínima 12 px.
- Cada cambio se prueba en teléfono y PC, sin desbordes ni elementos encimados.
- Cambios en datos de producción (SQL, roles, contraseñas) piden confirmación explícita del dueño.
`.trim();

export const FORMATO_REQUERIMIENTO = `
Cuando entregues un requerimiento, usá este formato (es el que usa el dueño):

REQUERIMIENTO: <TÍTULO EN MAYÚSCULAS>

CONTEXTO Y OBJETIVO:
<por qué y qué se busca, en 2-4 frases>

===================================================================
1. <SECCIÓN>
===================================================================
- <punto concreto y verificable>

(las secciones que hagan falta: datos, interfaz, reglas, permisos, rendimiento…)

CRITERIOS DE ACEPTACIÓN:
- <comprobación concreta>

FUERA DE ALCANCE:
- <lo que no entra>

PREGUNTAS PARA EL DUEÑO:
1. <decisión que solo él puede tomar>
`.trim();
