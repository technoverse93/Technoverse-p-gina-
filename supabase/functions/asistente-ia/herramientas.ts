// =====================================================================
// ASISTENTE IA — herramientas de consulta al sistema (solo lectura)
// =====================================================================
// Cada herramienta es una consulta que la IA puede pedir. Se ejecutan con
// el cliente de Supabase DE QUIEN PREGUNTA (su sesión), así que valen las
// mismas reglas de acceso que en el panel: nadie obtiene por el asistente
// algo que no podría ver en su propia pantalla.
//
// PRIVACIDAD: el plan gratis de Google puede usar lo que recibe para
// entrenar. Por eso NINGUNA consulta pide columnas de clientes (nombre,
// correo, cédula, teléfono) y los textos libres pasan por `limpiar()`, que
// tacha correos, teléfonos y números de identificación.
//
// DOS CARRILES (consultas del superadmin): seguridad, ingresos, visitantes y
// ubicaciones tocan datos de personas reales (correos, IPs, coordenadas).
// Esas consultas devuelven:
//   · `datos`  → lo que lee la IA: solo conteos y resúmenes, sin personas.
//   · `panel`  → el detalle COMPLETO, que va directo a la pantalla del
//                superadmin como tabla (y mapa) y nunca pasa por Google.
// Así el superadmin ve todo, al instante y sin filtros, y Google no recibe
// datos personales.
// =====================================================================

// deno-lint-ignore no-explicit-any
type Db = any;

export type Consulta = {
  modulo: string;       // «Inventario», «Facturación»…
  desc: string;         // qué se consultó, en palabras
  filas: string;        // «4 productos», «23 facturas»
  detalle: string;      // lo que leyó la IA, resumido (se ve al abrir la tarjeta)
  sinPermiso?: boolean;
  /** Carril de pantalla: detalle completo que NO se manda a la IA. */
  panel?: Panel;
};
export type Panel = {
  columnas: string[];
  filas: (string | number | null)[][];
  /** Coordenadas por fila (mismo índice), para «Ver en el mapa». */
  puntos?: ({ lat: number; lon: number; etiqueta: string } | null)[];
};
export type Contexto = { db: Db; esSuper: boolean; hoy: string };
type Salida = { datos: unknown; consulta: Consulta };

type Herramienta = {
  nombre: string;
  modulo: 'inventario' | 'facturacion' | 'taller' | 'errores' | 'seguridad' | 'finanzas';
  /** Solo se le ofrece al superadmin (los demás ni la ven). */
  soloSuper?: boolean;
  descripcion: string;
  parametros: Record<string, unknown>;
  ejecutar: (args: Record<string, unknown>, ctx: Contexto) => Promise<Salida>;
};

export const NOMBRE_MODULO: Record<string, string> = {
  inventario: 'Inventario', facturacion: 'Facturación', taller: 'Taller', errores: 'Errores del sistema',
  seguridad: 'Ciberseguridad', finanzas: 'Finanzas',
};
const MAX_PANEL = 200;
const fechaCorta = (v: unknown) => {
  if (!v) return '—';
  try { return new Date(String(v)).toLocaleString('es-CR', { timeZone: 'America/Costa_Rica', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return String(v).slice(0, 16); }
};
const coord = (lat: unknown, lon: unknown, etiqueta: string) => {
  const a = Number(lat), o = Number(lon);
  return lat != null && lon != null && Number.isFinite(a) && Number.isFinite(o) ? { lat: a, lon: o, etiqueta } : null;
};
const contar = <T,>(xs: T[], f: (x: T) => string | null | undefined) => {
  const r: Record<string, number> = {};
  for (const x of xs) { const k = f(x) || 'sin dato'; r[k] = (r[k] || 0) + 1; }
  return Object.fromEntries(Object.entries(r).sort((a, b) => b[1] - a[1]).slice(0, 12));
};

const MEDIO: Record<string, string> = { '01': 'Efectivo', '02': 'Tarjeta', '03': 'Cheque', '04': 'SINPE Móvil', '05': 'Recaudado por terceros', '06': 'SINPE Móvil', '07': 'Plataforma digital', '99': 'Otro' };
const TIPO_DOC: Record<string, string> = { '01': 'Factura', '02': 'Nota de débito', '03': 'Nota de crédito', '04': 'Tiquete', '08': 'Factura de compra', '09': 'Factura de exportación' };
const CERRADAS = ['Entregada', 'Cancelada'];

const colones = (n: number) => '₡' + Math.round(n || 0).toLocaleString('es-CR');
const num = (v: unknown, def: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : def;
};
const texto = (v: unknown) => String(v ?? '').trim().slice(0, 60);
/** Para filtros `ilike`: sin comas, paréntesis ni comodines que rompan el filtro. */
const patron = (v: unknown) => texto(v).replace(/[,()%*_\\]/g, ' ').trim();

/** Tacha correos, teléfonos y números de identificación de un texto libre. */
export function limpiar(t: unknown, max = 140): string {
  return String(t ?? '')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[correo]')
    .replace(/\+?\d[\d\s-]{7,}\d/g, '[número]')
    .slice(0, max);
}

/** Fecha «AAAA-MM-DD» de Costa Rica → inicio del día en ISO (CR es UTC−6 todo el año). */
function inicioDia(d: string): string { return `${d}T00:00:00-06:00`; }
function diaSiguiente(d: string): string {
  const f = new Date(`${d}T12:00:00Z`); f.setUTCDate(f.getUTCDate() + 1);
  return f.toISOString().slice(0, 10);
}
function fecha(v: unknown, def: string): string {
  const s = String(v ?? '');
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : def;
}
function restarDias(d: string, n: number): string {
  const f = new Date(`${d}T12:00:00Z`); f.setUTCDate(f.getUTCDate() - n);
  return f.toISOString().slice(0, 10);
}
const diasDesde = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
const lineas = (xs: string[], max = 8) => xs.slice(0, max).join('\n') + (xs.length > max ? `\n… y ${xs.length - max} más` : '');

async function todos(db: Db, tabla: string, columnas: string, filtro?: (q: Db) => Db) {
  let q = db.from(tabla).select(columnas).limit(1000);
  if (filtro) q = filtro(q);
  const { data, error } = await q;
  if (error) throw new Error(`No se pudo leer ${tabla}: ${error.message}`);
  return (data || []) as Record<string, any>[];
}

export const HERRAMIENTAS: Herramienta[] = [
  {
    nombre: 'consultar_inventario',
    modulo: 'inventario',
    descripcion: 'Busca productos del inventario: existencias, precio, costo, categoría y mínimo. Sirve para «cuántos quedan de X», «qué está por agotarse» o «qué hay de tal marca o categoría».',
    parametros: {
      type: 'object',
      properties: {
        buscar: { type: 'string', description: 'Texto a buscar en nombre, SKU o marca (opcional).' },
        categoria: { type: 'string', description: 'Filtrar por categoría (opcional).' },
        por_agotarse: { type: 'boolean', description: 'Solo productos con existencias en o bajo su mínimo (o 3 si no tienen mínimo).' },
        limite: { type: 'integer', description: 'Máximo de productos a devolver (1-50, por defecto 25).' },
      },
    },
    async ejecutar(a, { db }) {
      const buscar = patron(a.buscar), cat = patron(a.categoria), limite = num(a.limite, 25, 1, 50);
      const filas = await todos(db, 'products', 'name,sku,category,brand,price,cost,stock,min_stock,active', q => {
        q = q.eq('active', true);
        if (buscar) q = q.or(`name.ilike.%${buscar}%,sku.ilike.%${buscar}%,brand.ilike.%${buscar}%`);
        if (cat) q = q.ilike('category', `%${cat}%`);
        return q;
      });
      let lista = filas;
      if (a.por_agotarse) {
        lista = filas.filter(p => (p.stock ?? 0) <= ((p.min_stock ?? 0) > 0 ? p.min_stock : 3)).sort((x, y) => (x.stock ?? 0) - (y.stock ?? 0));
      } else {
        lista = [...filas].sort((x, y) => String(x.name).localeCompare(String(y.name)));
      }
      const datos = {
        coincidencias: lista.length,
        productos: lista.slice(0, limite).map(p => ({ nombre: p.name, sku: p.sku, categoria: p.category, marca: p.brand, existencias: p.stock ?? 0, minimo: p.min_stock ?? 0, precio: p.price, costo: p.cost })),
      };
      const desc = [a.por_agotarse ? 'por agotarse' : '', buscar ? `«${buscar}»` : '', cat ? `categoría ${cat}` : ''].filter(Boolean).join(' · ') || 'productos';
      return {
        datos,
        consulta: {
          modulo: 'Inventario', desc, filas: `${lista.length} producto${lista.length === 1 ? '' : 's'}`,
          detalle: lineas(datos.productos.map(p => `${p.sku || '—'} · ${p.nombre} · quedan ${p.existencias} · ${colones(Number(p.precio))}`)),
        },
      };
    },
  },
  {
    nombre: 'resumen_inventario',
    modulo: 'inventario',
    descripcion: 'Totales del inventario: cantidad de productos, unidades, valor a costo y a precio de venta, agotados, bajos de existencias y desglose por categoría.',
    parametros: { type: 'object', properties: {} },
    async ejecutar(_a, { db }) {
      const filas = await todos(db, 'products', 'category,price,cost,stock,min_stock', q => q.eq('active', true));
      const cats = new Map<string, { productos: number; unidades: number }>();
      let unidades = 0, valorCosto = 0, valorVenta = 0, agotados = 0, bajos = 0;
      for (const p of filas) {
        const s = Math.max(0, p.stock ?? 0);
        unidades += s; valorCosto += s * Number(p.cost || 0); valorVenta += s * Number(p.price || 0);
        if (s === 0) agotados++; else if (s <= ((p.min_stock ?? 0) > 0 ? p.min_stock : 3)) bajos++;
        const c = cats.get(p.category || 'Sin categoría') || { productos: 0, unidades: 0 };
        c.productos++; c.unidades += s; cats.set(p.category || 'Sin categoría', c);
      }
      const porCategoria = [...cats.entries()].sort((x, y) => y[1].productos - x[1].productos).slice(0, 15).map(([categoria, v]) => ({ categoria, ...v }));
      const datos = { productos: filas.length, unidades, valor_a_costo: Math.round(valorCosto), valor_a_precio: Math.round(valorVenta), agotados, bajos, por_categoria: porCategoria };
      return {
        datos,
        consulta: {
          modulo: 'Inventario', desc: 'resumen general', filas: `${filas.length} productos`,
          detalle: `productos ${filas.length} · unidades ${unidades} · agotados ${agotados} · bajos ${bajos}\nvalor a costo ${colones(valorCosto)} · a precio ${colones(valorVenta)}`,
        },
      };
    },
  },
  {
    nombre: 'resumen_ventas',
    modulo: 'facturacion',
    descripcion: 'Totales de facturación entre dos fechas: número de comprobantes, total, IVA, desglose por medio de pago y tipo de documento, y pedidos de la tienda en línea.',
    parametros: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'Fecha inicial AAAA-MM-DD (incluida).' },
        hasta: { type: 'string', description: 'Fecha final AAAA-MM-DD (incluida). Por defecto, hoy.' },
      },
      required: ['desde'],
    },
    async ejecutar(a, { db, hoy }) {
      const hasta = fecha(a.hasta, hoy), desde = fecha(a.desde, restarDias(hasta, 6)); // resumen_ventas
      const rango = (q: Db) => q.gte('created_at', inicioDia(desde)).lt('created_at', inicioDia(diaSiguiente(hasta)));
      const [facturas, pedidos] = await Promise.all([
        todos(db, 'invoices', 'total,iva_total,medio_pago,tipo_doc', rango),
        todos(db, 'orders', 'total,status', rango),
      ]);
      const porMedio: Record<string, { comprobantes: number; total: number }> = {};
      const porTipo: Record<string, number> = {};
      let total = 0, iva = 0;
      for (const f of facturas) {
        total += Number(f.total || 0); iva += Number(f.iva_total || 0);
        const m = MEDIO[f.medio_pago] || f.medio_pago || 'Sin dato';
        porMedio[m] ||= { comprobantes: 0, total: 0 };
        porMedio[m].comprobantes++; porMedio[m].total += Number(f.total || 0);
        const t = TIPO_DOC[f.tipo_doc] || f.tipo_doc || 'Otro';
        porTipo[t] = (porTipo[t] || 0) + 1;
      }
      const tienda: Record<string, { pedidos: number; total: number }> = {};
      for (const p of pedidos) {
        const e = p.status || 'Sin estado';
        tienda[e] ||= { pedidos: 0, total: 0 };
        tienda[e].pedidos++; tienda[e].total += Number(p.total || 0);
      }
      const datos = { desde, hasta, comprobantes: facturas.length, total: Math.round(total), iva: Math.round(iva), por_medio_de_pago: porMedio, por_tipo: porTipo, tienda_en_linea: tienda };
      return {
        datos,
        consulta: {
          modulo: 'Facturación', desc: `resumen ${desde} a ${hasta}`, filas: `${facturas.length} comprobante${facturas.length === 1 ? '' : 's'}`,
          detalle: `total ${colones(total)} · IVA ${colones(iva)}\n` + Object.entries(porMedio).map(([m, v]) => `${m} · ${v.comprobantes} · ${colones(v.total)}`).join('\n'),
        },
      };
    },
  },
  {
    nombre: 'listar_facturas',
    modulo: 'facturacion',
    descripcion: 'Lista comprobantes emitidos (número, fecha, total, medio de pago, estado del correo), sin datos del cliente. Con problema="correo" devuelve solo los que no se enviaron por correo.',
    parametros: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'Fecha inicial AAAA-MM-DD (opcional, por defecto hace 30 días).' },
        hasta: { type: 'string', description: 'Fecha final AAAA-MM-DD (opcional, por defecto hoy).' },
        problema: { type: 'string', enum: ['correo', 'todas'], description: '«correo» = solo las que no se enviaron por correo.' },
        limite: { type: 'integer', description: 'Máximo a devolver (1-50, por defecto 20).' },
      },
    },
    async ejecutar(a, { db, hoy }) {
      const hasta = fecha(a.hasta, hoy), desde = fecha(a.desde, restarDias(hasta, 30)), limite = num(a.limite, 20, 1, 50);
      let filas = await todos(db, 'invoices', 'id,consecutivo,numero_documento,tipo_doc,created_at,total,medio_pago,email_status,garantia_meses,items', q =>
        q.gte('created_at', inicioDia(desde)).lt('created_at', inicioDia(diaSiguiente(hasta))).order('created_at', { ascending: false }));
      if (a.problema === 'correo') filas = filas.filter(f => f.email_status !== 'enviado');
      const lista = filas.slice(0, limite).map(f => ({
        numero: f.consecutivo || f.numero_documento || f.id, tipo: TIPO_DOC[f.tipo_doc] || f.tipo_doc,
        fecha: String(f.created_at).slice(0, 10), total: Number(f.total || 0), medio_de_pago: MEDIO[f.medio_pago] || f.medio_pago,
        correo: f.email_status || 'sin dato', garantia_meses: f.garantia_meses, articulos: Array.isArray(f.items) ? f.items.length : 0,
      }));
      return {
        datos: { desde, hasta, encontradas: filas.length, facturas: lista },
        consulta: {
          modulo: 'Facturación', desc: a.problema === 'correo' ? 'correos no enviados' : `comprobantes ${desde} a ${hasta}`,
          filas: `${filas.length} comprobante${filas.length === 1 ? '' : 's'}`,
          detalle: lineas(lista.map(f => `${f.numero} · ${f.fecha} · ${colones(f.total)} · ${f.correo}`)),
        },
      };
    },
  },
  {
    nombre: 'ordenes_taller',
    modulo: 'taller',
    descripcion: 'Órdenes de reparación del taller: ticket, equipo, estado, días desde el ingreso y costo, sin datos del cliente. Por defecto solo las abiertas (no entregadas ni canceladas).',
    parametros: {
      type: 'object',
      properties: {
        estado: { type: 'string', description: 'Pendiente, Diagnosticada, Cotizada, Aprobada, Esperando repuestos, En Reparación, Lista, Entregada o Cancelada (opcional).' },
        minimo_dias: { type: 'integer', description: 'Solo las que llevan al menos estos días (opcional).' },
        buscar: { type: 'string', description: 'Ticket, marca o modelo del equipo (opcional).' },
        limite: { type: 'integer', description: 'Máximo a devolver (1-50, por defecto 25).' },
      },
    },
    async ejecutar(a, { db }) {
      const estado = texto(a.estado), buscar = patron(a.buscar), minDias = num(a.minimo_dias, 0, 0, 3650), limite = num(a.limite, 25, 1, 50);
      const filas = await todos(db, 'repair_orders', 'id,ticket,device,device_brand,device_model,device_category,damage_category,status,total_cost,created_at', q => {
        if (estado) q = q.ilike('status', estado);
        if (buscar) q = q.or(`ticket.ilike.%${buscar}%,id.ilike.%${buscar}%,device.ilike.%${buscar}%,device_brand.ilike.%${buscar}%,device_model.ilike.%${buscar}%`);
        return q;
      });
      const abiertas = filas.filter(o => estado || !CERRADAS.includes(o.status));
      const lista = abiertas
        .map(o => ({ orden: o.id, ticket: o.ticket, equipo: o.device || [o.device_brand, o.device_model].filter(Boolean).join(' '), tipo_de_dano: o.damage_category, estado: o.status, dias: diasDesde(o.created_at), costo: Number(o.total_cost || 0) }))
        .filter(o => o.dias >= minDias)
        .sort((x, y) => y.dias - x.dias);
      const porEstado: Record<string, number> = {};
      for (const o of lista) porEstado[o.estado] = (porEstado[o.estado] || 0) + 1;
      return {
        datos: { encontradas: lista.length, por_estado: porEstado, ordenes: lista.slice(0, limite) },
        consulta: {
          modulo: 'Taller', desc: [estado || 'abiertas', minDias ? `${minDias}+ días` : '', buscar ? `«${buscar}»` : ''].filter(Boolean).join(' · '),
          filas: `${lista.length} orden${lista.length === 1 ? '' : 'es'}`,
          detalle: lineas(lista.map(o => `${o.orden} · ${o.equipo} · ${o.estado} · ${o.dias} d`)),
        },
      };
    },
  },
  {
    nombre: 'errores_sistema',
    modulo: 'errores',
    descripcion: 'Fallos del sistema en los últimos días: correos de facturas que no salieron, pagos fallidos, publicaciones con error, rechazos de Hacienda, errores en la bitácora e intentos de ingreso fallidos. Solo para el superadmin.',
    parametros: {
      type: 'object',
      properties: { dias: { type: 'integer', description: 'Cuántos días hacia atrás (1-30, por defecto 1 = hoy).' } },
    },
    async ejecutar(a, { db, esSuper, hoy }) {
      if (!esSuper) {
        return {
          datos: { error: 'Sin acceso: el registro de errores del sistema solo lo puede ver el superadmin.' },
          consulta: { modulo: 'Errores del sistema', desc: 'sin acceso', filas: '—', detalle: '', sinPermiso: true },
        };
      }
      const dias = num(a.dias, 1, 1, 30);
      const desde = inicioDia(restarDias(hoy, dias - 1));
      const [correos, pagos, publicaciones, hacienda, bitacora, ingresos] = await Promise.all([
        todos(db, 'invoices', 'consecutivo,numero_documento,id,email_status,created_at', q => q.gte('created_at', desde).neq('email_status', 'enviado')),
        todos(db, 'payments', 'metodo,estado,motivo_fallo,monto_menor,creado_en', q => q.gte('creado_en', desde).not('motivo_fallo', 'is', null)),
        todos(db, 'marketing_requests', 'product_sku,status,error_detail,updated_at', q => q.gte('updated_at', desde).not('error_detail', 'is', null)),
        todos(db, 'orders', 'id,hda_status,created_at', q => q.gte('created_at', desde).in('hda_status', ['Rechazado', 'Rechazada', 'Error'])),
        todos(db, 'audit_logs', 'module,action,detail,created_at', q => q.gte('created_at', desde).or('action.ilike.%error%,action.ilike.%fall%,detail.ilike.%error%').order('created_at', { ascending: false })),
        todos(db, 'login_audit_logs', 'exito', q => q.gte('ocurrido_en', desde).eq('exito', false)),
      ]);
      const datos = {
        dias,
        correos_de_factura: correos.map(f => ({ factura: f.consecutivo || f.numero_documento || f.id, estado: limpiar(f.email_status, 80), fecha: fechaCorta(f.created_at) })),
        pagos_fallidos: pagos.map(p => ({ metodo: p.metodo, estado: p.estado, motivo: limpiar(p.motivo_fallo), monto: Math.round(Number(p.monto_menor || 0) / 100), fecha: fechaCorta(p.creado_en) })),
        publicaciones_con_error: publicaciones.map(m => ({ sku: m.product_sku, estado: m.status, error: limpiar(m.error_detail) })),
        rechazos_de_hacienda: hacienda.map(o => ({ pedido: o.id, estado: o.hda_status })),
        bitacora: bitacora.slice(0, 20).map(b => ({ modulo: b.module, accion: limpiar(b.action, 60), detalle: limpiar(b.detail), fecha: fechaCorta(b.created_at) })),
        ingresos_fallidos: ingresos.length,
      };
      const total = correos.length + pagos.length + publicaciones.length + hacienda.length + bitacora.length;
      return {
        datos,
        consulta: {
          modulo: 'Errores del sistema', desc: dias === 1 ? 'hoy' : `últimos ${dias} días`, filas: `${total} evento${total === 1 ? '' : 's'}`,
          detalle: [
            `correos de factura · ${correos.length}`, `pagos fallidos · ${pagos.length}`, `publicaciones con error · ${publicaciones.length}`,
            `rechazos de Hacienda · ${hacienda.length}`, `errores en bitácora · ${bitacora.length}`, `ingresos fallidos · ${ingresos.length}`,
          ].join('\n'),
        },
      };
    },
  },
  // ===================================================================
  // SOLO SUPERADMIN — dos carriles (ver cabecera del archivo)
  // ===================================================================
  {
    nombre: 'ingresos_cuentas',
    modulo: 'seguridad',
    soloSuper: true,
    descripcion: 'Inicios de sesión al panel y a la app (intentos correctos, fallidos y bloqueados), con ciudad, país, origen (web o app) y si el equipo es conocido. Usa esto para «quién entró», «cuántas veces entró X», «intentos fallidos», «desde dónde». La tabla completa con correos e IPs le aparece al superadmin en pantalla; tú recibes los conteos.',
    parametros: {
      type: 'object',
      properties: {
        buscar: { type: 'string', description: 'Parte del correo, ciudad o equipo (opcional).' },
        dias: { type: 'integer', description: 'Días hacia atrás (1-90, por defecto 1 = hoy).' },
        solo_fallidos: { type: 'boolean', description: 'Solo intentos fallidos o bloqueados.' },
      },
    },
    async ejecutar(a, { db, hoy }) {
      const dias = num(a.dias, 1, 1, 90), buscar = patron(a.buscar).toLowerCase();
      let filas = await todos(db, 'login_audit_logs', 'ocurrido_en,email,exito,bloqueado,motivo,ip,origen,pais,ciudad,region,latitud,longitud,gps_latitud,gps_longitud,device_id,dispositivo_conocido,user_agent', q =>
        q.gte('ocurrido_en', inicioDia(restarDias(hoy, dias - 1))).order('ocurrido_en', { ascending: false }));
      if (a.solo_fallidos) filas = filas.filter(f => !f.exito || f.bloqueado);
      if (buscar) filas = filas.filter(f => [f.email, f.ciudad, f.pais, f.user_agent, f.device_id, f.ip].some(v => String(v || '').toLowerCase().includes(buscar)));
      const correctos = filas.filter(f => f.exito && !f.bloqueado).length;
      const datos = {
        dias, total: filas.length, correctos, fallidos: filas.filter(f => !f.exito).length, bloqueados: filas.filter(f => f.bloqueado).length,
        ultimo_hora_cr: fechaCorta(filas[0]?.ocurrido_en || null),
        cuentas_distintas: new Set(filas.map(f => f.email)).size, equipos_nuevos: filas.filter(f => f.dispositivo_conocido === false).length,
        por_origen: contar(filas, f => f.origen), por_ciudad: contar(filas, f => [f.ciudad, f.pais].filter(Boolean).join(', ')),
        motivos_de_fallo: contar(filas.filter(f => !f.exito), f => limpiar(f.motivo, 60)),
        nota: 'El detalle con correos, IPs y equipos se le muestra al superadmin en pantalla, no aquí.',
      };
      const vis = filas.slice(0, MAX_PANEL);
      return {
        datos,
        consulta: {
          modulo: 'Ciberseguridad', desc: `ingresos · ${dias === 1 ? 'hoy' : `${dias} días`}${buscar ? ` · «${buscar}»` : ''}`,
          filas: `${filas.length} ingreso${filas.length === 1 ? '' : 's'}`,
          detalle: `correctos ${correctos} · fallidos ${datos.fallidos} · bloqueados ${datos.bloqueados} · equipos nuevos ${datos.equipos_nuevos}`,
          panel: {
            columnas: ['Fecha', 'Cuenta', 'Resultado', 'Origen', 'Lugar', 'IP', 'Equipo'],
            filas: vis.map(f => [fechaCorta(f.ocurrido_en), f.email, f.bloqueado ? 'Bloqueado' : f.exito ? 'Correcto' : `Fallido${f.motivo ? ` (${String(f.motivo).slice(0, 40)})` : ''}`, f.origen, [f.ciudad, f.pais].filter(Boolean).join(', ') || '—', f.ip, f.dispositivo_conocido === false ? 'Nuevo' : 'Conocido']),
            puntos: vis.map(f => coord(f.gps_latitud ?? f.latitud, f.gps_longitud ?? f.longitud, `${f.email} · ${fechaCorta(f.ocurrido_en)}`)),
          },
        },
      };
    },
  },
  {
    nombre: 'visitantes_tienda',
    modulo: 'seguridad',
    soloSuper: true,
    descripcion: 'Visitantes y equipos que entran a la tienda en línea (incluye modelos como GFY-LX3): visitas, primera y última vez, sistema, navegador y página. Usa esto para «cuántas veces entró el equipo X», «quién visitó hoy». El detalle con IP y huella le aparece al superadmin en pantalla.',
    parametros: {
      type: 'object',
      properties: {
        buscar: { type: 'string', description: 'Modelo del equipo (p. ej. GFY-LX3), sistema o navegador (opcional).' },
        dias: { type: 'integer', description: 'Días hacia atrás según la última visita (1-90, por defecto 1 = hoy).' },
      },
    },
    async ejecutar(a, { db, hoy }) {
      const dias = num(a.dias, 1, 1, 90), buscar = patron(a.buscar).toLowerCase();
      const desde = inicioDia(restarDias(hoy, dias - 1));
      const [huellas, sesiones] = await Promise.all([
        todos(db, 'visitor_fingerprints', 'huella,visitas,primera_visita,ultima_visita,ip,dispositivo,sistema,version_sistema,navegador,tipo,origen,ultima_ruta,email', q => q.gte('ultima_visita', desde).order('ultima_visita', { ascending: false })),
        todos(db, 'supervision_visitantes', 'visita,modelo,tipo,entorno,ruta,last_seen,lat,lon', q => q.gte('last_seen', desde).order('last_seen', { ascending: false })),
      ]);
      const coincide = (...vs: unknown[]) => !buscar || vs.some(v => String(v || '').toLowerCase().includes(buscar));
      const h = huellas.filter(f => coincide(f.dispositivo, f.sistema, f.navegador, f.tipo, f.ultima_ruta));
      const s2 = sesiones.filter(f => coincide(f.modelo, f.tipo, f.entorno, f.ruta));
      const datos = {
        dias, buscar: buscar || null,
        equipos: h.length, visitas_acumuladas: h.reduce((t, f) => t + Number(f.visitas || 0), 0), sesiones_en_el_periodo: s2.length,
        ultima_vez_hora_cr: fechaCorta(s2[0]?.last_seen || h[0]?.ultima_visita || null),
        por_equipo: contar([...h.map(f => f.dispositivo), ...s2.map(f => f.modelo)], x => x),
        por_sistema: contar(h, f => f.sistema), paginas: contar(s2, f => f.ruta),
        nota: 'IPs, huellas y correos se le muestran al superadmin en pantalla, no aquí.',
      };
      const filasP = [
        ...s2.map(f => ({ t: f.last_seen, fila: [fechaCorta(f.last_seen), f.modelo || '—', 'Sesión', f.entorno, f.ruta || '—', '—', '—'], p: coord(f.lat, f.lon, `${f.modelo} · ${fechaCorta(f.last_seen)}`) })),
        ...h.map(f => ({ t: f.ultima_visita, fila: [fechaCorta(f.ultima_visita), f.dispositivo || '—', `${f.visitas} visitas`, [f.sistema, f.navegador].filter(Boolean).join(' · '), f.ultima_ruta || '—', f.ip || '—', f.email || '—'], p: null })),
      ].sort((x, y) => String(y.t).localeCompare(String(x.t))).slice(0, MAX_PANEL);
      return {
        datos,
        consulta: {
          modulo: 'Ciberseguridad', desc: `visitantes · ${dias === 1 ? 'hoy' : `${dias} días`}${buscar ? ` · «${buscar}»` : ''}`,
          filas: `${s2.length} sesión${s2.length === 1 ? '' : 'es'} · ${h.length} equipo${h.length === 1 ? '' : 's'}`,
          detalle: `visitas acumuladas ${datos.visitas_acumuladas} · última vez ${datos.ultima_vez_hora_cr}`,
          panel: { columnas: ['Fecha', 'Equipo', 'Visitas', 'Sistema / entorno', 'Página', 'IP', 'Correo'], filas: filasP.map(x => x.fila), puntos: filasP.map(x => x.p) },
        },
      };
    },
  },
  {
    nombre: 'estado_ciberseguridad',
    modulo: 'seguridad',
    soloSuper: true,
    descripcion: 'Estado de la ciberseguridad: IPs bloqueadas (activas y permanentes), lista blanca, equipos y usuarios baneados, y bloqueos del sistema. Usa esto para «qué está bloqueado», «cuántos baneos hay». El detalle con IPs y correos le aparece al superadmin en pantalla.',
    parametros: { type: 'object', properties: {} },
    async ejecutar(_a, { db }) {
      const ahora = new Date().toISOString();
      const [ips, blanca, equipos, usuarios, bans] = await Promise.all([
        todos(db, 'banned_ips', 'ip,nivel,permanente,bloqueo_total,bloqueado_hasta,motivo,intentos_fallidos,pais,ciudad,actualizado_en'),
        todos(db, 'ip_whitelist', 'ip,descripcion,creado_en'),
        todos(db, 'banned_devices', 'device_uuid,motivo,email,creado_en,levantado_en'),
        todos(db, 'blocked_users_list', 'email,nombre,motivo,creado_en,levantado_en'),
        todos(db, 'system_bans', 'tipo,valor,motivo,hasta,activo,created_at'),
      ]);
      const ipsActivas = ips.filter(i => i.permanente || i.bloqueo_total || (i.bloqueado_hasta && i.bloqueado_hasta > ahora));
      const eqAct = equipos.filter(e => !e.levantado_en), usAct = usuarios.filter(u => !u.levantado_en), bansAct = bans.filter(b => b.activo && (!b.hasta || b.hasta > ahora));
      const datos = {
        ips_bloqueadas_activas: ipsActivas.length, ips_permanentes: ips.filter(i => i.permanente).length, ips_registradas: ips.length,
        lista_blanca: blanca.length, equipos_baneados: eqAct.length, usuarios_baneados: usAct.length, bloqueos_del_sistema: bansAct.length,
        motivos: contar([...ipsActivas, ...eqAct, ...usAct], x => limpiar(x.motivo, 60)),
        nota: 'IPs, correos y equipos concretos se le muestran al superadmin en pantalla, no aquí.',
      };
      const filasP: (string | number | null)[][] = [
        ...ipsActivas.map(i => ['IP bloqueada', i.ip, i.permanente ? 'Permanente' : `Hasta ${fechaCorta(i.bloqueado_hasta)}`, i.motivo || '—', [i.ciudad, i.pais].filter(Boolean).join(', ') || '—']),
        ...eqAct.map(e => ['Equipo baneado', e.device_uuid, fechaCorta(e.creado_en), e.motivo || '—', e.email || '—']),
        ...usAct.map(u => ['Usuario baneado', u.email, fechaCorta(u.creado_en), u.motivo || '—', u.nombre || '—']),
        ...bansAct.map(b => [`Bloqueo (${b.tipo})`, b.valor, b.hasta ? `Hasta ${fechaCorta(b.hasta)}` : 'Sin fecha', b.motivo || '—', '—']),
        ...blanca.map(w => ['Lista blanca', w.ip, fechaCorta(w.creado_en), w.descripcion || '—', '—']),
      ].slice(0, MAX_PANEL);
      return {
        datos,
        consulta: {
          modulo: 'Ciberseguridad', desc: 'bloqueos y lista blanca', filas: `${ipsActivas.length + eqAct.length + usAct.length + bansAct.length} bloqueo(s) activo(s)`,
          detalle: `IPs ${ipsActivas.length} · equipos ${eqAct.length} · usuarios ${usAct.length} · lista blanca ${blanca.length}`,
          panel: { columnas: ['Tipo', 'Valor', 'Vigencia', 'Motivo', 'Lugar / dato'], filas: filasP },
        },
      };
    },
  },
  {
    nombre: 'ubicaciones',
    modulo: 'seguridad',
    soloSuper: true,
    descripcion: 'Ubicaciones compartidas por personal o clientes (provincia, contexto, hora) y la ubicación de los últimos ingresos. Usa esto para «dónde está», «ubicaciones de hoy», «mapa». Las coordenadas y nombres se le muestran al superadmin en pantalla con mapa; tú recibes conteos por provincia.',
    parametros: {
      type: 'object',
      properties: {
        buscar: { type: 'string', description: 'Nombre, correo o provincia (opcional).' },
        dias: { type: 'integer', description: 'Días hacia atrás (1-90, por defecto 7).' },
      },
    },
    async ejecutar(a, { db, hoy }) {
      const dias = num(a.dias, 7, 1, 90), buscar = patron(a.buscar).toLowerCase();
      const filas = (await todos(db, 'ubicaciones_compartidas', 'nombre,email,rol,lat,lon,precision_m,provincia,contexto,created_at', q =>
        q.gte('created_at', inicioDia(restarDias(hoy, dias - 1))).order('created_at', { ascending: false })))
        .filter(f => !buscar || [f.nombre, f.email, f.provincia, f.contexto].some(v => String(v || '').toLowerCase().includes(buscar)));
      const datos = {
        dias, total: filas.length, personas: new Set(filas.map(f => f.email || f.nombre)).size,
        por_provincia: contar(filas, f => f.provincia), por_rol: contar(filas, f => f.rol), por_contexto: contar(filas, f => f.contexto),
        ultima_hora_cr: fechaCorta(filas[0]?.created_at || null),
        nota: 'Nombres y coordenadas se le muestran al superadmin en pantalla con mapa, no aquí.',
      };
      const vis = filas.slice(0, MAX_PANEL);
      return {
        datos,
        consulta: {
          modulo: 'Ciberseguridad', desc: `ubicaciones · ${dias} días${buscar ? ` · «${buscar}»` : ''}`, filas: `${filas.length} ubicación${filas.length === 1 ? '' : 'es'}`,
          detalle: `personas ${datos.personas} · última ${datos.ultima_hora_cr}`,
          panel: {
            columnas: ['Fecha', 'Persona', 'Rol', 'Provincia', 'Contexto', 'Precisión'],
            filas: vis.map(f => [fechaCorta(f.created_at), f.nombre || f.email || '—', f.rol || '—', f.provincia || '—', f.contexto || '—', f.precision_m ? `${f.precision_m} m` : '—']),
            puntos: vis.map(f => coord(f.lat, f.lon, `${f.nombre || f.email || 'Ubicación'} · ${fechaCorta(f.created_at)}`)),
          },
        },
      };
    },
  },
  {
    nombre: 'finanzas',
    modulo: 'finanzas',
    soloSuper: true,
    descripcion: 'Métricas financieras entre dos fechas: ventas de la tienda y del mostrador, costo de repuestos, regalías, margen neto, IVA, por método de pago y estado, pagos fallidos y desglose por día. Usa esto para utilidad, márgenes, ingresos de dinero y comparaciones.',
    parametros: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'Fecha inicial AAAA-MM-DD (incluida).' },
        hasta: { type: 'string', description: 'Fecha final AAAA-MM-DD (incluida). Por defecto, hoy.' },
      },
      required: ['desde'],
    },
    async ejecutar(a, { db, hoy }) {
      const hasta = fecha(a.hasta, hoy), desde = fecha(a.desde, restarDias(hasta, 29));
      const rango = (col: string) => (q: Db) => q.gte(col, inicioDia(desde)).lt(col, inicioDia(diaSiguiente(hasta)));
      const [pedidos, facturas, pagos] = await Promise.all([
        todos(db, 'orders', 'total,subtotal,tax_amount,shipping_cost,membership_discount,costo_repuestos,costo_regalias,margen_neto,payment_method,status,payment_status,created_at', rango('created_at')),
        todos(db, 'invoices', 'total,iva_total,medio_pago,created_at', rango('created_at')),
        todos(db, 'payments', 'estado,metodo,monto_menor,creado_en', rango('creado_en')),
      ]);
      const suma = (xs: Record<string, any>[], c: string) => Math.round(xs.reduce((t, x) => t + Number(x[c] || 0), 0));
      const validos = pedidos.filter(p => !/cancel|anul|rechaz/i.test(String(p.status)));
      const porDia: Record<string, { pedidos: number; ventas: number; margen: number; facturado: number }> = {};
      const dia = (v: unknown) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica' }).format(new Date(String(v)));
      for (const p of validos) { const d = dia(p.created_at); porDia[d] ||= { pedidos: 0, ventas: 0, margen: 0, facturado: 0 }; porDia[d].pedidos++; porDia[d].ventas += Number(p.total || 0); porDia[d].margen += Number(p.margen_neto || 0); }
      for (const f of facturas) { const d = dia(f.created_at); porDia[d] ||= { pedidos: 0, ventas: 0, margen: 0, facturado: 0 }; porDia[d].facturado += Number(f.total || 0); }
      const datos = {
        desde, hasta,
        tienda_en_linea: { pedidos: validos.length, ventas: suma(validos, 'total'), costo_repuestos: suma(validos, 'costo_repuestos'), regalias: suma(validos, 'costo_regalias'), margen_neto: suma(validos, 'margen_neto'), envios: suma(validos, 'shipping_cost'), descuentos: suma(validos, 'membership_discount'), cancelados: pedidos.length - validos.length, por_metodo: contar(validos, p => p.payment_method), por_estado: contar(pedidos, p => p.status) },
        facturacion: { comprobantes: facturas.length, total: suma(facturas, 'total'), iva: suma(facturas, 'iva_total'), por_medio: contar(facturas, f => MEDIO[f.medio_pago] || f.medio_pago) },
        pagos_en_linea: { total: pagos.length, por_estado: contar(pagos, p => p.estado), aprobado: Math.round(pagos.filter(p => /pag|aprob|complet/i.test(String(p.estado))).reduce((t, p) => t + Number(p.monto_menor || 0), 0) / 100) },
        por_dia: Object.entries(porDia).sort((x, y) => x[0].localeCompare(y[0])).map(([d, v]) => ({ dia: d, ...v, ventas: Math.round(v.ventas), margen: Math.round(v.margen), facturado: Math.round(v.facturado) })).slice(-62),
      };
      return {
        datos,
        consulta: {
          modulo: 'Finanzas', desc: `${desde} a ${hasta}`, filas: `${validos.length} pedido(s) · ${facturas.length} comprobante(s)`,
          detalle: `ventas tienda ${colones(datos.tienda_en_linea.ventas)} · margen ${colones(datos.tienda_en_linea.margen_neto)}\nfacturado ${colones(datos.facturacion.total)} · IVA ${colones(datos.facturacion.iva)}`,
          panel: { columnas: ['Día', 'Pedidos', 'Ventas tienda', 'Margen', 'Facturado'], filas: datos.por_dia.map(d => [d.dia, d.pedidos, colones(d.ventas), colones(d.margen), colones(d.facturado)]) },
        },
      };
    },
  },
];

/** Las herramientas que el superadmin dejó encendidas y que esta persona puede usar. */
export function disponibles(modulos: Record<string, boolean> | null | undefined, esSuper = false): Herramienta[] {
  return HERRAMIENTAS.filter(h => (modulos?.[h.modulo] ?? true) !== false && (!h.soloSuper || esSuper));
}

/** Ejecuta una herramienta; un fallo se le devuelve a la IA como dato, no rompe la respuesta. */
export async function ejecutar(nombre: string, args: Record<string, unknown>, ctx: Contexto, permitidas: Herramienta[]): Promise<Salida> {
  const h = permitidas.find(x => x.nombre === nombre);
  if (!h) {
    return { datos: { error: 'Esa consulta no está disponible.' }, consulta: { modulo: 'Sistema', desc: 'consulta no disponible', filas: '—', detalle: '', sinPermiso: true } };
  }
  try {
    const salida = await h.ejecutar(args || {}, ctx);
    // Tope de tamaño para no gastar el cupo en una respuesta enorme.
    const json = JSON.stringify(salida.datos);
    if (json.length > 12000) salida.datos = { aviso: 'Resultado recortado: hay más datos, pide un filtro más específico.', parcial: json.slice(0, 12000) };
    return salida;
  } catch (e) {
    console.log(`herramienta ${nombre} falló: ${e instanceof Error ? e.message : e}`);
    return { datos: { error: 'No se pudo leer ese dato ahora.' }, consulta: { modulo: NOMBRE_MODULO[h.modulo], desc: 'no se pudo leer', filas: '—', detalle: '' } };
  }
}
