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

/** Un insumo del inventario consumido en el trabajo. */
export interface InsumoConsumido {
  productId: string;
  productName: string;
  quantity: number;
  /** Costo unitario del inventario. Es el COSTO, nunca el precio de venta. */
  costoUnitario: number;
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
  garantiaMeses: number;
  medioCobro: MedioCobro;
  /** Repuestos usados: descuentan stock y bajan el margen. */
  repuestos: InsumoConsumido[];
  /** Regalías: descuentan stock, bajan el margen y salen en la factura a ₡0. */
  regalias: InsumoConsumido[];
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
  regalias: InsumoConsumido[]
): ResumenMargen {
  const sumar = (lista: InsumoConsumido[]) =>
    lista.reduce((total, i) => total + (i.costoUnitario || 0) * (i.quantity || 0), 0);

  const ingreso = Math.max(0, montoTotal || 0);
  const costoRepuestos = sumar(repuestos);
  const costoRegalias = sumar(regalias);
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
  const garantia = datos.garantiaMeses > 0
    ? `${datos.garantiaMeses} ${datos.garantiaMeses === 1 ? 'mes' : 'meses'}`
    : undefined;

  const lineas = [
    {
      caabys: CAABYS_SERVICIO,
      description: datos.descripcionServicio.trim() || 'Servicio técnico',
      qty: 1,
      unitPrice: datos.montoTotal,
      warranty: garantia,
    },
    ...datos.regalias.map(r => ({
      caabys: CAABYS_SERVICIO,
      // "Descuento 100%" va AL PRINCIPIO, no al final, y no es una cuestión
      // de estilo: la tabla del comprobante imprime únicamente la PRIMERA
      // línea de la descripción (`descLines[0]` en invoicePdf.ts) y descarta
      // el resto sin avisar. Con el texto al final —"… — Regalía por primera
      // compra (Descuento 100%)"— la frase que da sentido a la línea se
      // perdía y quedaba un artículo a ₡0,00 sin explicación, que es
      // exactamente lo que un cliente reclama y lo que un auditor marca.
      //
      // Poniéndolo delante, sobrevive por larga que sea la descripción. El
      // nombre del artículo se recorta a 28 caracteres para que quepan los
      // dos en la línea aun con nombres largos.
      description: `Descuento 100% — ${recortar(r.productName, 28)}`,
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
  const margen = calcularMargen(datos.montoTotal, datos.repuestos, datos.regalias);

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
  const consumos = [...datos.repuestos, ...datos.regalias].filter(i => i.quantity > 0);

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
      ...datos.regalias.map(r => ({
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

  try {
    await saveDB(getDB());
  } catch {
    /* el pedido ya está en memoria; el guardado se reintenta solo */
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
      emisorCedula: emitida.emisorCedula,
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

    // Sin `upsert`: el nombre sale del consecutivo atómico y no puede
    // repetirse. Activarlo convertía la subida en un INSERT ... ON
    // CONFLICT DO UPDATE, que exige una política RLS de UPDATE que el
    // bucket no tiene, y toda subida fallaba con la venta ya cobrada.
    const rutaPdf = `${emitida.id}.pdf`;
    const { error: errorSubida } = await supabase.storage
      .from('invoices')
      .upload(rutaPdf, blob, { contentType: 'application/pdf' });
    if (errorSubida) throw errorSubida;

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
  if (datos.regalias.length > 0) {
    const detalle = datos.regalias.map(r => `${r.quantity}× ${r.productName}`).join(', ');
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
