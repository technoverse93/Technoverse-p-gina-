// ============================================================================
// Motor de comprobantes fiscales CR v4.3 (registro interno)
// ============================================================================
// IMPORTANTE — alcance real: este módulo genera un PDF con el FORMATO correcto
// de Hacienda (Clave de 50 dígitos, Consecutivo de 20, CAABYS, IVA 13%
// desglosado, QR) para uso INTERNO — contabilidad propia y comprobante para el
// cliente. NO es una transmisión real a Hacienda: eso exige firmar el XML con
// un certificado digital (.p12) emitido por el Banco Central/ATV y enviarlo a
// la API real de Hacienda, que responde con Aceptado/Rechazado. Este sistema
// queda con la numeración y el formato ya correctos para conectar esa pieza
// el día que exista certificado + credenciales, sin tocar el resto.
//
// jspdf y qrcode se importan de forma DINÁMICA (import() perezoso): solo se
// descargan/parsean cuando el cliente realmente confirma una compra, nunca en
// la carga inicial de la tienda — clave para el rendimiento en el Galaxy A12.

export type IdentificacionTipo = '01' | '02' | '03' | '04';
export type TipoDoc = '01' | '04';
export type MedioPago = '01' | '02' | '04';

const IDENTIFICACION_LABELS: Record<IdentificacionTipo, string> = {
  '01': 'Cédula Física',
  '02': 'Cédula Jurídica',
  '03': 'DIMEX',
  '04': 'NITE'
};

const MEDIO_PAGO_LABELS: Record<MedioPago, string> = {
  '01': 'Efectivo',
  '02': 'Tarjeta',
  '04': 'SINPE Móvil'
};

/**
 * Valida el FORMATO (longitud, solo dígitos) de una identificación de Costa
 * Rica. Hacienda no publica un dígito verificador/checksum para estos tipos
 * (a diferencia de otros países), así que validar longitud+numérico es lo
 * mismo que hacen en la práctica los sistemas de facturación certificados.
 */
export function validateCedula(tipo: IdentificacionTipo, rawValue: string): string | null {
  const digits = (rawValue || '').replace(/\D/g, '');
  if (!digits) return 'La identificación es obligatoria.';
  switch (tipo) {
    case '01':
      if (digits.length !== 9) return 'La Cédula Física debe tener 9 dígitos.';
      return null;
    case '02':
      if (digits.length !== 10) return 'La Cédula Jurídica debe tener 10 dígitos.';
      return null;
    case '03':
      if (digits.length !== 11 && digits.length !== 12) return 'El DIMEX debe tener 11 o 12 dígitos.';
      return null;
    case '04':
      if (digits.length !== 10) return 'El NITE debe tener 10 dígitos.';
      return null;
    default:
      return 'Tipo de identificación inválido.';
  }
}

// Redondeo estricto a 2 decimales (evita arrastre de error de punto flotante
// en montos fiscales; Hacienda exige exactamente 2 decimales por línea/total).
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface InvoiceLineInput {
  caabys: string;
  description: string;
  qty: number;
  unitPrice: number; // precio unitario SIN IVA
}

export interface InvoiceLineComputed extends InvoiceLineInput {
  lineSubtotal: number;
  lineIva: number;
  lineTotal: number;
}

const IVA_RATE = 0.13;

/** Calcula el desglose fiscal (subtotal/IVA 13%/total) por línea y global. */
export function computeInvoiceTotals(lines: InvoiceLineInput[]): {
  items: InvoiceLineComputed[];
  subtotal: number;
  ivaTotal: number;
  total: number;
} {
  let subtotal = 0;
  let ivaTotal = 0;
  const items: InvoiceLineComputed[] = lines.map(l => {
    const lineSubtotal = round2(l.qty * l.unitPrice);
    const lineIva = round2(lineSubtotal * IVA_RATE);
    const lineTotal = round2(lineSubtotal + lineIva);
    subtotal = round2(subtotal + lineSubtotal);
    ivaTotal = round2(ivaTotal + lineIva);
    return { ...l, lineSubtotal, lineIva, lineTotal };
  });
  const total = round2(subtotal + ivaTotal);
  return { items, subtotal, ivaTotal, total };
}

export interface InvoiceData {
  id: string;
  clave: string;
  consecutivo: string;
  tipoDoc: TipoDoc;
  fechaISO: string;
  emisorCedula: string;
  emisorNombre: string;
  emisorDireccion?: string;
  emisorTelefono?: string;
  customerIdentificationType: IdentificacionTipo;
  customerIdentification: string;
  customerName: string;
  customerEmail?: string;
  medioPago: MedioPago;
  items: InvoiceLineComputed[];
  subtotal: number;
  ivaTotal: number;
  total: number;
}

function formatColones(n: number): string {
  return '₡' + n.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Texto plano codificado en el QR: respaldo interno, NO un enlace oficial de Hacienda. */
export function buildQrPayload(data: InvoiceData): string {
  return [
    `CLAVE:${data.clave}`,
    `CONSECUTIVO:${data.consecutivo}`,
    `EMISOR:${data.emisorCedula}`,
    `RECEPTOR:${data.customerIdentification || 'N/A'}`,
    `TOTAL:${data.total.toFixed(2)}`,
    `FECHA:${data.fechaISO}`
  ].join('|');
}

/** QR como data URL (PNG), para mostrarlo también en la UI de confirmación sin regenerar el PDF. */
export async function generateQrDataUrl(text: string): Promise<string> {
  const QRCodeMod = await import('qrcode');
  const QRCode: any = (QRCodeMod as any).default || QRCodeMod;
  return QRCode.toDataURL(text, { margin: 1, width: 220 });
}

/**
 * Genera el PDF v4.3 (una página): header fiscal, datos del receptor, tabla
 * CAABYS/IVA, desglose financiero en ₡ y QR de respaldo. Devuelve el Blob
 * listo para subir a Storage/descargar, sin ninguna dependencia pesada
 * cargada por adelantado (jspdf/qrcode se traen aquí mismo, perezosos).
 */
export async function buildInvoicePdfBlob(data: InvoiceData): Promise<{ blob: Blob; qrText: string }> {
  const [{ jsPDF }, QRCodeMod] = await Promise.all([
    import('jspdf'),
    import('qrcode')
  ]);
  const QRCode: any = (QRCodeMod as any).default || QRCodeMod;

  const qrText = buildQrPayload(data);
  const qrDataUrl: string = await QRCode.toDataURL(qrText, { margin: 1, width: 220 });

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 14;
  let y = 16;

  // ---- Encabezado fiscal ----
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(data.emisorNombre, marginX, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  y += 6;
  doc.text(`Cédula Jurídica: ${data.emisorCedula}`, marginX, y);
  if (data.emisorDireccion) { y += 4.5; doc.text(data.emisorDireccion, marginX, y); }
  if (data.emisorTelefono) { y += 4.5; doc.text(`Tel: ${data.emisorTelefono}`, marginX, y); }

  const docTitle = data.tipoDoc === '01' ? 'FACTURA ELECTRÓNICA' : 'TIQUETE ELECTRÓNICO';
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(docTitle, pageWidth - marginX, 16, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const rightLines = [
    `Consecutivo: ${data.consecutivo}`,
    `Fecha: ${new Date(data.fechaISO).toLocaleString('es-CR')}`,
    `Clave:`,
    data.clave
  ];
  let ry = 22;
  rightLines.forEach(line => { doc.text(line, pageWidth - marginX, ry, { align: 'right' }); ry += 4.2; });

  y = Math.max(y, ry) + 6;
  doc.setDrawColor(180);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 6;

  // ---- Receptor ----
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Datos del Receptor', marginX, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Nombre/Razón Social: ${data.customerName}`, marginX, y); y += 4.5;
  doc.text(`${IDENTIFICACION_LABELS[data.customerIdentificationType]}: ${data.customerIdentification || 'N/A'}`, marginX, y); y += 4.5;
  if (data.customerEmail) { doc.text(`Correo: ${data.customerEmail}`, marginX, y); y += 4.5; }
  doc.text(`Medio de Pago: ${MEDIO_PAGO_LABELS[data.medioPago]}`, marginX, y); y += 8;

  // ---- Tabla de líneas (CAABYS / IVA) ----
  const colX = { n: marginX, caabys: marginX + 8, desc: marginX + 38, qty: pageWidth - 74, price: pageWidth - 58, iva: pageWidth - 40, total: pageWidth - 16 };
  doc.setFillColor(30, 41, 59);
  doc.rect(marginX, y, pageWidth - marginX * 2, 7, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.text('#', colX.n + 2, y + 4.8);
  doc.text('CAABYS', colX.caabys, y + 4.8);
  doc.text('Descripción', colX.desc, y + 4.8);
  doc.text('Cant.', colX.qty, y + 4.8, { align: 'right' });
  doc.text('P. Unit', colX.price, y + 4.8, { align: 'right' });
  doc.text('IVA 13%', colX.iva, y + 4.8, { align: 'right' });
  doc.text('Total', colX.total, y + 4.8, { align: 'right' });
  y += 7;
  doc.setTextColor(20, 20, 20);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);

  data.items.forEach((it, idx) => {
    if (y > 265) { doc.addPage(); y = 20; }
    const rowH = 6.5;
    if (idx % 2 === 0) {
      doc.setFillColor(245, 246, 248);
      doc.rect(marginX, y, pageWidth - marginX * 2, rowH, 'F');
    }
    doc.text(String(idx + 1), colX.n + 2, y + 4.4);
    doc.text(it.caabys, colX.caabys, y + 4.4);
    const descLines = doc.splitTextToSize(it.description, colX.qty - colX.desc - 4);
    doc.text(descLines[0] || '', colX.desc, y + 4.4);
    doc.text(String(it.qty), colX.qty, y + 4.4, { align: 'right' });
    doc.text(formatColones(it.unitPrice), colX.price, y + 4.4, { align: 'right' });
    doc.text(formatColones(it.lineIva), colX.iva, y + 4.4, { align: 'right' });
    doc.text(formatColones(it.lineTotal), colX.total, y + 4.4, { align: 'right' });
    y += rowH;
  });

  y += 4;
  doc.setDrawColor(210);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 6;

  // ---- Desglose financiero ----
  const totalsX = pageWidth - marginX - 55;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('Subtotal:', totalsX, y);
  doc.text(formatColones(data.subtotal), pageWidth - marginX, y, { align: 'right' }); y += 5;
  doc.text('IVA (13%):', totalsX, y);
  doc.text(formatColones(data.ivaTotal), pageWidth - marginX, y, { align: 'right' }); y += 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('TOTAL:', totalsX, y);
  doc.text(formatColones(data.total), pageWidth - marginX, y, { align: 'right' });

  // ---- QR + aviso de alcance ----
  const qrSize = 32;
  const qrY = y - 26;
  doc.addImage(qrDataUrl, 'PNG', marginX, qrY, qrSize, qrSize);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(90, 90, 90);
  const disclaimerLines = doc.splitTextToSize(
    'Este código QR es un respaldo de verificación INTERNO de Technoverse (no oficial de Hacienda). ' +
    'Comprobante de uso contable/interno mientras se activa la transmisión electrónica real ante el Ministerio de Hacienda.',
    60
  );
  doc.text(disclaimerLines, marginX + qrSize + 4, qrY + 6);

  const blob = doc.output('blob');
  return { blob, qrText };
  }
              
