// =====================================================================
// COBROS — lógica del módulo de facturación
// =====================================================================
// Todo lo que ocurre cuando se cobra un servicio: cálculo del margen,
// armado de las líneas del comprobante, descuento de inventario, emisión
// de la factura, generación del PDF y envío al cliente.
//
// ---------------------------------------------------------------------
// POR QUÉ ESTÁ SEPARADO DE LA PANTALLA
// ---------------------------------------------------------------------
// El cobro es la operación con más consecuencias del sistema: mueve
// stock, consume un consecutivo fiscal que no se puede reutilizar y
// manda un documento al cliente. Esa secuencia tiene que poder leerse
// entera, de arriba abajo, sin estar mezclada con estados de formulario
// ni con JSX. Aquí está la secuencia; en FacturacionPanel.tsx está la
// pantalla que la invoca.
//
// ---------------------------------------------------------------------
// EL ORDEN DE LOS PASOS NO ES ARBITRARIO
// ---------------------------------------------------------------------
// Primero se descuenta el inventario y se guarda el pedido, y solo
// después se emite el comprobante. Al revés, un fallo de stock dejaría
// un consecutivo fiscal quemado sin venta detrás — un hueco en la
// numeración que hay que justificar ante Hacienda.
//
// Y si el comprobante falla DESPUÉS de cobrar, la venta no se deshace:
// el dinero ya se recibió. Se informa del fallo con el número de pedido
// para poder reemitir, que es lo que se puede arreglar a mano.
// =====================================================================

import { supabase } from '../supabaseClient';
import { getDB, saveDB, addAuditLog } from './storage';
import { processSaleAtomic } from './transactions';
import {
  computeInvoiceTotals, buildInvoicePdfBlob, generateQrDataUrl,
} from './invoicePdf';
import type { IdentificacionTipo, MedioPago, InvoiceData } from './invoicePdf';
import type { Order } from '../types';

/**
 * Código CAABYS por defecto.
 *
 * Es el mismo que usa la tienda para los artículos sin código propio. En
 * un cobro de taller lo que se factura es el SERVICIO, no una pieza de
 * catálogo, así que no hay un CAABYS más específico que consultar.
 */
const CAABYS_SERVICIO = '8399000000000';

/**
 * Medios de cobro habilitados.
 *
 * SOLO estos dos. La tarjeta queda deshabilitada porque no hay
 * procesador de pagos contratado: ofrecerla en la pantalla llevaría a
 * registrar cobros con tarjeta que nunca entraron a ninguna cuenta.
 *
 * El valor `codigo` es el que entiende Hacienda y el que viaja al
 * comprobante ('01' efectivo, '04' SINPE). El '02' de tarjeta sigue
 * existiendo en el tipo `MedioPago` porque las facturas ya emitidas lo
 * llevan y deben poder seguir leyéndose.
 */
export const MEDIOS_DE_COBRO = [
  { valor: 'SINPE' as const, etiqueta: 'SINPE Móvil', codigo: '04' as MedioPago },
  { valor: 'Efectivo' as const, etiqueta: 'Efectivo', codigo: '01' as MedioPago },
];

export type MedioCobro = (typeof MEDIOS_DE_COBRO)[number]['valor'];

/**
 * Periodos de garantía admitidos. NO hay ningún otro.
 *
 * ---------------------------------------------------------------------
 * POR QUÉ ES UNA LISTA CERRADA Y NO UN CAMPO LIBRE
 * ---------------------------------------------------------------------
 * La garantía es lo que el cliente puede reclamar: si cada cobro pudiera
 * escribir su propio plazo, dos trabajos idénticos saldrían con
 * garantías distintas según quién los facturó, y el comprobante —que es
 * el respaldo legal— quedaría a merced de un error de digitación.
 *
 * Con una lista cerrada, el plazo que sale impreso siempre es uno de
 * estos cuatro, y `normalizarGarantia()` rechaza cualquier otro valor
 * que llegue por otra vía.
 */
export const GARANTIAS_VALIDAS = [1, 3, 6, 12] as const;

export type GarantiaMeses = (typeof GARANTIAS_VALIDAS)[number];

/** Etiquetas para el desplegable. Sin "mínimo de ley" ni texto libre. */
export const OPCIONES_GARANTIA = GARANTIAS_VALIDAS.map(m => ({
  value: String(m),
  label: m === 1 ? '1 mes' : m === 12 ? '12 meses (máximo)' : `${m} meses`,
}));

/**
 * Devuelve un plazo válido a partir de cualquier entrada.
 *
 * Ante un valor que no esté en la lista se queda con 3 meses, que es el
 * plazo intermedio y el que más se usa. Nunca devuelve 0 ni un plazo
 * inventado: un comprobante sin garantía o con una garantía imposible es
 * peor que uno con el plazo estándar.
 */
export function normalizarGarantia(meses: unknown): GarantiaMeses {
  const n = Number(meses);
  return (GARANTIAS_VALIDAS as readonly number[]).includes(n) ? (n as GarantiaMeses) : 3;
}

/** Un insumo del inventario consumido en el trabajo. */
export interface InsumoConsumido {
  productId: string;
  productName: string;
  quantity: number;
  /** Costo unitario del inventario. Es el COSTO, nunca el precio de venta. */
  costoUnitario: number;
  /**
   * Marcado como regalía.
   *
   * Antes esto se decidía metiendo el artículo en una de DOS listas
   * separadas. Con una marca por artículo, el mismo temperado puede ir
   * cobrado en un trabajo y regalado en otro sin duplicar nada, y basta
   * una casilla para cambiarlo — que es como se decide de verdad, en el
   * mostrador y en el último momento.
   *
   * En los dos casos sale del inventario y cuenta como costo. La
   * diferencia es que la regalía aparece en la factura a ₡0.
   */
  esRegalia?: boolean;
}

/**
 * Trae todo lo vinculado a un producto o servicio: repuestos e insumos,
 * con su cantidad y su costo ya resueltos.
 *
 * Lee de la vista `v_product_components`, que hace la unión del lado del
 * servidor. Resolverlo aquí obligaría a una consulta por componente, y
 * en el teléfono del mostrador eso son varios segundos de espera con el
 * cliente delante.
 *
 * Ante cualquier fallo devuelve una lista vacía en vez de lanzar: un
 * problema al sugerir componentes no puede impedir cobrar.
 */
export async function componentesDe(productId: string): Promise<InsumoConsumido[]> {
  try {
    const { data, error } = await supabase
      .from('v_product_components')
      .select('component_id, component_name, quantity, component_cost, tipo')
      .eq('product_id', productId);
    if (error || !data) return [];
    return data.map((c: any) => ({
      productId: c.component_id,
      productName: c.component_name,
      quantity: Number(c.quantity) || 1,
      costoUnitario: Number(c.component_cost) || 0,
      // Lo vinculado nunca se marca como regalía por su cuenta: eso lo
      // decide quien cobra, artículo por artículo, en el mostrador.
      esRegalia: false,
    }));
  } catch {
    return [];
  }
}

export interface DatosDeCobro {
  clienteNombre: string;
  clienteIdTipo: IdentificacionTipo;
  clienteId: string;
  clienteEmail: string;
  clienteTelefono: string;
  descripcionServicio: string;
  /** Lo que paga el cliente, IVA incluido. */
  montoTotal: number;
  /** Uno de GARANTIAS_VALIDAS. Cualquier otro valor se normaliza a 3. */
  garantiaMeses: number;
  medioCobro: MedioCobro;
  /** Repuestos usados: descuentan stock y bajan el margen. */
  repuestos: InsumoConsumido[];
  /**
   * Insumos del trabajo. Los marcados con `esRegalia` salen en la
   * factura a ₡0; el resto va dentro del precio del servicio.
   */
  insumos: InsumoConsumido[];
  adminEmail: string;
}

export interface ResumenMargen {
  /** Lo cobrado al cliente. */
  ingreso: number;
  costoRepuestos: number;
  costoRegalias: number;
  /** Ingreso menos los dos costos. Puede ser negativo, y se muestra así. */
  margenNeto: number;
  /** Margen sobre ingreso, en porcentaje. 0 si no se cobró nada. */
  margenPorcentaje: number;
}

/**
 * Margen neto de la operación.
 *
 * Es un cálculo INTERNO: no aparece en la factura ni en ningún documento
 * que reciba el cliente. Solo sirve para saber si el trabajo dejó dinero.
 *
 * Las regalías cuentan como costo aunque el cliente las reciba gratis:
 * el temperado regalado salió del inventario y se pagó. No contarlo
 * inflaría el margen justo en las operaciones donde más se estrecha.
 */
export function calcularMargen(
  montoTotal: number,
  repuestos: InsumoConsumido[],
  insumos: InsumoConsumido[]
): ResumenMargen {
  const sumar = (lista: InsumoConsumido[]) =>
    lista.reduce((total, i) => total + (i.costoUnitario || 0) * (i.quantity || 0), 0);

  const ingreso = Math.max(0, montoTotal || 0);
  // Los insumos NO regalados también son costo del trabajo: su precio
  // está incluido dentro de lo que se le cobró al cliente, así que si no
  // se restaran, el margen saldría inflado.
  const costoRepuestos = sumar(repuestos) + sumar(insumos.filter(i => !i.esRegalia));
  const costoRegalias = sumar(insumos.filter(i => i.esRegalia));
  const margenNeto = ingreso - costoRepuestos - costoRegalias;

  return {
    ingreso,
    costoRepuestos,
    costoRegalias,
    margenNeto,
    margenPorcentaje: ingreso > 0 ? (margenNeto / ingreso) * 100 : 0,
  };
}

/**
 * Las líneas que salen impresas en el comprobante.
 *
 * Dos clases, y la distinción importa:
 *
 *   · El SERVICIO, con su garantía. Una sola línea por el monto
 *     acordado. Los repuestos usados NO salen desglosados: van dentro
 *     del precio del servicio, que es como se cotizó y como el cliente
 *     lo entiende. Desglosarlos invitaría a discutir el precio pieza por
 *     pieza sobre un documento que ya se cobró.
 *
 *   · Las REGALÍAS, a precio unitario 0. Salen en la factura porque el
 *     cliente se lleva ese artículo y tiene que constar que lo recibió
 *     —para su garantía y para el inventario—, pero sin cobrarse. La
 *     descripción dice "Descuento 100%" de forma explícita para que no
 *     quede duda de que fue un obsequio y no un error de digitación.
 *
 * Sale a ₡0 sin ningún cambio en el generador del PDF: una línea con
 * precio unitario 0 ya se calcula y se imprime como ₡0,00 con la
 * plantilla actual.
 */
export function construirLineasFactura(datos: DatosDeCobro) {
  const meses = normalizarGarantia(datos.garantiaMeses);
  const garantia = `${meses} ${meses === 1 ? 'mes' : 'meses'}`;
  const regalias = datos.insumos.filter(i => i.esRegalia);

  const lineas = [
    {
      caabys: CAABYS_SERVICIO,
      description: datos.descripcionServicio.trim() || 'Servicio técnico',
      qty: 1,
      unitPrice: datos.montoTotal,
      warranty: garantia,
    },
    ...regalias.map(r => ({
      caabys: CAABYS_SERVICIO,
      // "Descuento 100%" va AL PRINCIPIO, no al final, y no es una cuestión
      // de estilo: la tabla del comprobante imprime únicamente la PRIMERA
      // línea de la descripción (`descLines[0]` en invoicePdf.ts) y descarta
      // el resto sin avisar. Con el texto al final —"… — Regalía por primera
      // compra (Descuento 100%)"— la frase que da sentido a la línea se
      // perdía y quedaba un artículo a ₡0,00 sin explicación, que es
      // exactamente lo que un cliente reclama y lo que un auditor marca.
      //
      // Poniéndolo delante, sobrevive por larga que sea la descripción.
      //
      // El recorte subió de 28 a 34 caracteres: al sacar el CAABYS de la
      // tabla, la columna de descripción ganó los 20 mm que ocupaba, y con
      // el límite anterior se cortaban nombres que ahora sí caben.
      description: `Descuento 100% — ${recortar(r.productName, 34)}`,
      qty: r.quantity,
      unitPrice: 0,
      warranty: garantia,
    })),
  ];

  return computeInvoiceTotals(lineas);
}

/** Recorta un texto a lo que cabe, con puntos suspensivos si sobra. */
function recortar(texto: string, largo: number): string {
  const limpio = (texto || '').trim();
  return limpio.length <= largo ? limpio : `${limpio.slice(0, largo - 1)}…`;
}

export interface ResultadoCobro {
  ok: boolean;
  mensaje: string;
  /** Número del pedido. Existe aunque falle el comprobante. */
  pedidoId?: string;
  consecutivo?: string;
  pdfUrl?: string;
  margen?: ResumenMargen;
  /** true cuando se cobró pero el comprobante no salió: hay que reemitir. */
  requiereReemision?: boolean;
}

/**
 * Cobra un servicio de principio a fin.
 *
 * Devuelve siempre un resultado descriptivo en vez de lanzar: quien
 * llama es una pantalla de cobro, y ahí una excepción sin contexto se
 * traduce en un mensaje que no dice qué pasó con el dinero.
 */
export async function cobrarServicio(datos: DatosDeCobro): Promise<ResultadoCobro> {
  const margen = calcularMargen(datos.montoTotal, datos.repuestos, datos.insumos);

  // El número se arma con la fecha y un tramo al azar, sin consultar
  // nada: dos cobros simultáneos desde aparatos distintos no pueden
  // chocar. Es la misma fórmula que usa la tienda.
  const ahora = new Date();
  const sello = ahora.toISOString().slice(2, 10).replace(/-/g, '');
  const azar = Math.random().toString(36).slice(2, 7).toUpperCase();
  const pedidoId = `FAC-${sello}-${azar}`;

  const { items, subtotal, ivaTotal, total } = construirLineasFactura(datos);

  // Todo lo que sale del inventario, en un solo lote para `adjust_stock`:
  // repuestos y regalías descuentan igual, la diferencia es contable, no
  // de almacén.
  const consumos = [...datos.repuestos, ...datos.insumos].filter(i => i.quantity > 0);

  const pedido: Order = {
    id: pedidoId,
    customerId: `CRM-${Math.floor(1000 + Math.random() * 9000)}`,
    customerName: datos.clienteNombre.trim(),
    customerEmail: datos.clienteEmail.trim().toLowerCase(),
    items: [
      {
        productId: 'SERVICIO',
        productName: datos.descripcionServicio.trim() || 'Servicio técnico',
        quantity: 1,
        price: datos.montoTotal,
        discountApplied: 0,
      },
      ...datos.insumos.filter(i => i.esRegalia).map(r => ({
        productId: r.productId,
        productName: `${r.productName} (regalía)`,
        quantity: r.quantity,
        // Precio 0 y descuento 0: el pedido refleja lo COBRADO. El costo
        // real del obsequio queda en la bitácora y en el margen, que es
        // donde tiene sentido leerlo.
        price: 0,
        discountApplied: 0,
      })),
    ],
    subtotal,
    membershipDiscount: 0,
    shippingCost: 0,
    taxAmount: ivaTotal,
    total,
    paymentMethod: datos.medioCobro,
    paymentDetails: {
      phone: datos.medioCobro === 'SINPE' ? datos.clienteTelefono.trim() : undefined,
    },
    status: 'Completado',
    xmlVerified: false,
    hdaStatus: 'Pendiente',
    timestamp: ahora.toISOString(),
  };

  // ---- 1. Inventario y pedido -------------------------------------------
  // `processSaleAtomic` descuenta el stock con la función atómica de la
  // base (bloqueo de filas, todo o nada) y deja el pedido en la copia
  // local. Se reutiliza en vez de repetir su lógica: es el mismo camino
  // que ya usa la tienda y está probado en producción.
  const carrito = consumos.map(i => ({ product: { id: i.productId }, quantity: i.quantity }));
  const venta = await processSaleAtomic(carrito, pedido);
  if (!venta.success) {
    return {
      ok: false,
      mensaje: venta.error || 'No se pudo descontar el inventario. No se cobró nada.',
    };
  }

  // El pedido se guarda AQUÍ, explícitamente. `processSaleAtomic` solo
  // ajusta el stock: no persiste nada (ver su comentario). Sin esto la
  // venta se cobraba, el inventario bajaba y el comprobante salía, pero
  // el pedido no llegaba nunca a la base — y por tanto no aparecía en el
  // panel general, ni en Contabilidad, ni en los ingresos del día.
  try {
    const bd = getDB();
    if (!bd.orders) bd.orders = [];
    bd.orders.push(pedido);

    // Movimientos de inventario, uno por artículo consumido. Es lo que
    // hace que la salida quede trazable: sin ellos el stock baja y nadie
    // puede reconstruir por qué.
    if (!bd.inventory_movements) bd.inventory_movements = [];
    for (const i of consumos) {
      bd.inventory_movements.unshift({
        id: `MOV-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        productId: i.productId,
        productName: i.productName,
        quantityChange: -i.quantity,
        type: 'Salida',
        notes: i.esRegalia
          ? `Regalía entregada con el cobro ${pedidoId}`
          : `Consumido en el servicio cobrado ${pedidoId}`,
        timestamp: ahora.toISOString(),
        userEmail: datos.adminEmail || 'admin',
      } as any);
    }

    await saveDB(bd);
  } catch (e: any) {
    // El dinero ya se recibió y el stock ya bajó: no se puede deshacer.
    // Se avisa con el número de pedido para poder registrarlo a mano.
    return {
      ok: false,
      requiereReemision: true,
      pedidoId,
      margen,
      mensaje:
        `Se cobró y el inventario se descontó, pero el pedido ${pedidoId} no se pudo ` +
        `guardar: ${e?.message || e}. Anote el número: no aparecerá en los informes ` +
        `hasta registrarlo.`,
    };
  }

  // ---- 2. Comprobante ----------------------------------------------------
  try {
    const { data: emitida, error: errorEmision } = await supabase.rpc('issue_invoice', {
      p_order_id: pedidoId,
      p_tipo_doc: '01',
      p_customer_identification_type: datos.clienteIdTipo,
      p_customer_identification: datos.clienteId.replace(/\D/g, ''),
      p_customer_name: datos.clienteNombre.trim(),
      p_customer_email: datos.clienteEmail.trim().toLowerCase(),
      p_medio_pago: medioAHacienda(datos.medioCobro),
      p_items: items,
      p_subtotal: subtotal,
      p_iva_total: ivaTotal,
      p_total: total,
      p_garantia_meses: normalizarGarantia(datos.garantiaMeses),
    });
    if (errorEmision) throw errorEmision;

    // Se leen frescos, no de una copia capturada al abrir la pantalla:
    // si el administrador acaba de corregir el teléfono, la factura debe
    // llevar el corregido.
    const config = getDB().settings;

    const datosFactura: InvoiceData = {
      id: emitida.id,
      clave: emitida.clave,
      consecutivo: emitida.consecutivo,
      tipoDoc: '01',
      fechaISO: ahora.toISOString(),
      // `emisorCedulaMostrar` es la identificación TAL CUAL se configuró.
      // `emisorCedula` viene rellena con ceros a 12 posiciones porque la
      // clave de Hacienda lo exige, y era la que se imprimía: una cédula
      // física de 9 dígitos salía en el comprobante como 000119090965.
      emisorCedula: emitida.emisorCedulaMostrar || emitida.emisorCedula,
      emisorNombre: 'Technoverse Costa Rica',
      emisorTelefono: config?.companyPhone || undefined,
      emisorDireccion: config?.companyAddress || undefined,
      customerIdentificationType: datos.clienteIdTipo,
      customerIdentification: datos.clienteId.replace(/\D/g, ''),
      customerName: datos.clienteNombre.trim(),
      customerEmail: datos.clienteEmail.trim().toLowerCase(),
      medioPago: medioAHacienda(datos.medioCobro),
      items,
      subtotal,
      ivaTotal,
      total,
    };

    const { blob, qrText } = await buildInvoicePdfBlob(datosFactura);

    // ---------------------------------------------------------------
    // SUBIDA DEL PDF, A PRUEBA DE NOMBRES YA OCUPADOS
    // ---------------------------------------------------------------
    // Se sigue prefiriendo el nombre limpio `FE-<consecutivo>.pdf`: es
    // el que permite encontrar un comprobante a ojo dentro del bucket.
    //
    // Pero ese nombre PUEDE estar ocupado, y ya ocurrió: al limpiar la
    // base para producción se vaciaron las tablas y se reinició la
    // numeración, sin borrar los PDF que habían quedado en el
    // almacenamiento. La numeración volvió a 1 y al llegar al 4 chocó
    // con un archivo viejo. La subida falló con "The resource already
    // exists" y el cobro quedó a medias: dinero recibido, inventario
    // descontado, consecutivo consumido y sin comprobante.
    //
    // No se usa `upsert: true` porque eso convierte la subida en un
    // INSERT ... ON CONFLICT DO UPDATE, y el bucket no tiene política
    // RLS de UPDATE: fallaría igual. Y sobrescribir sería peor —se
    // perdería el comprobante anterior, que es un documento fiscal.
    //
    // Ante un choque se guarda con un sufijo único. El nombre deja de
    // ser bonito, pero la URL se guarda en la factura, así que nada
    // depende de adivinarlo.
    const subirPdf = async (ruta: string) =>
      supabase.storage.from('invoices').upload(ruta, blob, { contentType: 'application/pdf' });

    let rutaPdf = `${emitida.id}.pdf`;
    let { error: errorSubida } = await subirPdf(rutaPdf);

    if (errorSubida) {
      const yaExiste = /already exists|resource already|duplicate/i.test(
        `${(errorSubida as any)?.message || ''} ${(errorSubida as any)?.error || ''}`
      );
      if (!yaExiste) throw errorSubida;

      rutaPdf = `${emitida.id}-${Date.now().toString(36)}.pdf`;
      const reintento = await subirPdf(rutaPdf);
      if (reintento.error) throw reintento.error;
    }

    const { data: publico } = supabase.storage.from('invoices').getPublicUrl(rutaPdf);
    await supabase.rpc('set_invoice_pdf', {
      p_invoice_id: emitida.id,
      p_pdf_url: publico.publicUrl,
      p_qr_data: qrText,
    });

    // Se precalcula el QR para poder mostrarlo en pantalla sin volver a
    // generar el PDF entero.
    await generateQrDataUrl(qrText);

    // El correo es "dispara y olvida" a propósito: si el servidor de
    // correo tarda o falla, el cobro y el comprobante YA están hechos y
    // el PDF es descargable. Bloquear el cierre del cobro por un correo
    // dejaría al cliente esperando frente al mostrador.
    supabase.functions
      .invoke('send-invoice-email', { body: { invoiceId: emitida.id } })
      .catch(() => {});

    registrarEnBitacora(datos, pedidoId, margen);

    return {
      ok: true,
      mensaje: `Cobro registrado. Comprobante ${emitida.consecutivo}.`,
      pedidoId,
      consecutivo: emitida.consecutivo,
      pdfUrl: publico.publicUrl,
      margen,
    };
  } catch (e: any) {
    registrarEnBitacora(datos, pedidoId, margen, e?.message || 'sin detalle');
    return {
      ok: false,
      requiereReemision: true,
      pedidoId,
      margen,
      mensaje:
        `El cobro se registró (pedido ${pedidoId}) y el inventario ya se descontó, ` +
        `pero el comprobante no se pudo emitir: ${e?.message || e}. ` +
        `Anote el número de pedido para reemitirlo.`,
    };
  }
}

/** Traduce el medio de cobro al código que entiende Hacienda. */
function medioAHacienda(medio: MedioCobro): MedioPago {
  return MEDIOS_DE_COBRO.find(m => m.valor === medio)?.codigo ?? '01';
}

/**
 * Deja constancia del cobro en la bitácora de auditoría.
 *
 * Incluye el margen y el detalle de las regalías porque son justamente
 * los datos que después nadie puede reconstruir: la factura solo muestra
 * lo cobrado, y el inventario solo muestra que algo salió, sin decir por
 * qué salió gratis.
 */
function registrarEnBitacora(
  datos: DatosDeCobro,
  pedidoId: string,
  margen: ResumenMargen,
  fallo?: string
): void {
  const partes = [
    `Pedido ${pedidoId}`,
    `Cobrado ₡${Math.round(margen.ingreso).toLocaleString('es-CR')} por ${datos.medioCobro}`,
    `Costo repuestos ₡${Math.round(margen.costoRepuestos).toLocaleString('es-CR')}`,
  ];
  const regalias = datos.insumos.filter(i => i.esRegalia);
  if (regalias.length > 0) {
    const detalle = regalias.map(r => `${r.quantity}× ${r.productName}`).join(', ');
    partes.push(`Regalía (${detalle}) con costo ₡${Math.round(margen.costoRegalias).toLocaleString('es-CR')}`);
  }
  partes.push(`Margen neto ₡${Math.round(margen.margenNeto).toLocaleString('es-CR')}`);
  if (fallo) partes.push(`COMPROBANTE NO EMITIDO: ${fallo}`);

  try {
    addAuditLog(
      datos.adminEmail || 'admin',
      'Facturación',
      fallo ? 'Cobro sin comprobante' : 'Cobro de servicio',
      partes.join('. ') + '.'
    );
  } catch {
    /* la bitácora nunca debe impedir un cobro */
  }
}
