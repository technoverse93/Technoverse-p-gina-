// ============================================================================
// Motor de comprobantes fiscales CR v4.3 (registro interno) — plantilla única
// Minimalista / Compacta (elegida como definitiva para producción).
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
  unitPrice: number; // precio unitario FINAL, el mismo que se anuncia en la tienda (IVA incluido)
  warranty?: string; // ej. "12 meses"; se muestra en la columna de garantía cuando aplica
}

export interface InvoiceLineComputed extends InvoiceLineInput {
  lineSubtotal: number;
  lineIva: number;
  lineTotal: number;
}

const IVA_RATE = 0.13;

/**
 * Calcula el desglose fiscal (subtotal/IVA 13%/total) por línea y global.
 * `unitPrice` es el precio FINAL anunciado (el que realmente paga el
 * cliente) — el desglose para Hacienda se calcula HACIA ATRÁS a partir de
 * ese total, nunca sumando un 13% adicional encima:
 *   lineTotal    = qty * unitPrice          (exactamente lo anunciado)
 *   lineSubtotal = lineTotal / 1.13         (base imponible/neto)
 *   lineIva      = lineTotal - lineSubtotal (por resta exacta: subtotal + iva === total siempre)
 */
export function computeInvoiceTotals(lines: InvoiceLineInput[]): {
  items: InvoiceLineComputed[];
  subtotal: number;
  ivaTotal: number;
  total: number;
} {
  let subtotal = 0;
  let ivaTotal = 0;
  let total = 0;
  const items: InvoiceLineComputed[] = lines.map(l => {
    const lineTotal = round2(l.qty * l.unitPrice);
    const lineSubtotal = round2(lineTotal / (1 + IVA_RATE));
    const lineIva = round2(lineTotal - lineSubtotal);
    subtotal = round2(subtotal + lineSubtotal);
    ivaTotal = round2(ivaTotal + lineIva);
    total = round2(total + lineTotal);
    return { ...l, lineSubtotal, lineIva, lineTotal };
  });
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
 * Intenta cargar el logo oficial ya publicado en /logo.png (el mismo que usa
 * el favicon/header del sitio — ver index.html). Nunca bloquea ni rompe la
 * generación del comprobante: si falla (offline, ruta distinta, etc.) las
 * plantillas simplemente omiten el logo y siguen con el nombre en texto.
 */
export async function fetchLogoDataUrl(): Promise<string | null> {
  try {
    const res = await fetch('/logo.png');
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Dibuja un monto en colones con el símbolo ₡ construido VECTORIALMENTE (una
 * "C" con dos líneas horizontales encima). Es necesario porque los 14 fuentes
 * estándar de PDF (Helvetica/Times/Courier con WinAnsiEncoding) no tienen el
 * glifo del colón costarricense (U+20A1): jsPDF lo termina mapeando al byte
 * 0xA1 de WinAnsi, que es "¡" — así el comprobante mostraba "¡12.345" en vez
 * de "₡12.345". La alternativa real (embeber una fuente Unicode completa)
 * agrega cientos de KB al bundle solo por un símbolo; dibujarlo a mano cuesta
 * cero bytes y es 100% fiel en cualquier lector de PDF.
 */
function drawColones(doc: any, amount: number, x: number, y: number, opts: { align?: 'left' | 'right'; color?: [number, number, number] } = {}): number {
  const align = opts.align || 'left';
  const text = amount.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fontSize = doc.getFontSize();
  const scale = doc.internal.scaleFactor;
  const unit = fontSize / scale; // "em" en unidades del documento (mm)
  const cWidth = (doc.getStringUnitWidth('C') * fontSize) / scale;
  const gap = unit * 0.12;
  const numWidth = (doc.getStringUnitWidth(text) * fontSize) / scale;
  const totalWidth = cWidth + gap + numWidth;
  const startX = align === 'right' ? x - totalWidth : x;

  doc.text('C', startX, y);

  const barInset = cWidth * 0.12;
  const barX = startX + barInset;
  const barWidth = Math.max(cWidth - barInset * 1.6, 0.5);
  const capHeight = unit * 0.62;
  const barY1 = y - capHeight * 0.62;
  const barY2 = y - capHeight * 0.26;

  const prevLineWidth = doc.getLineWidth();
  if (opts.color) doc.setDrawColor(opts.color[0], opts.color[1], opts.color[2]);
  doc.setLineWidth(Math.max(unit * 0.05, 0.12));
  doc.line(barX, barY1, barX + barWidth, barY1);
  doc.line(barX, barY2, barX + barWidth, barY2);
  doc.setLineWidth(prevLineWidth);
  if (opts.color) doc.setDrawColor(0, 0, 0);

  doc.text(text, startX + cWidth + gap, y);
  return totalWidth;
}

interface PreparedInvoice {
  qrText: string;
  qrDataUrl: string;
  logoDataUrl: string | null;
  docTitle: string;
}

async function prepareInvoice(data: InvoiceData): Promise<PreparedInvoice> {
  const qrText = buildQrPayload(data);
  const [qrDataUrl, logoDataUrl] = await Promise.all([
    generateQrDataUrl(qrText),
    fetchLogoDataUrl()
  ]);
  const docTitle = data.tipoDoc === '01' ? 'FACTURA ELECTRÓNICA' : 'TIQUETE ELECTRÓNICO';
  return { qrText, qrDataUrl, logoDataUrl, docTitle };
}

const hasWarranty = (data: InvoiceData) => data.items.some(it => !!it.warranty);

// ============================================================================
// Plantilla Minimalista / Compacta: una sola columna, sin color ni cajas,
// líneas finas de separación, tipografía condensada — la definitiva en producción.
// ============================================================================
async function buildInvoicePdfMinimalista(data: InvoiceData): Promise<{ blob: Blob; qrText: string }> {
  const { jsPDF } = await import('jspdf');
  const { qrText, qrDataUrl, logoDataUrl, docTitle } = await prepareInvoice(data);

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 16;
  let y = 16;

  if (logoDataUrl) {
    try { doc.addImage(logoDataUrl, 'PNG', marginX, y - 4, 12, 12, undefined, 'FAST'); } catch { /* logo opcional */ }
  }
  const textX = logoDataUrl ? marginX + 15 : marginX;
  doc.setTextColor(20, 20, 20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(data.emisorNombre, textX, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text(docTitle, pageWidth - marginX, y, { align: 'right' });
  y += 4.5;
  doc.text(`Cédula Jurídica: ${data.emisorCedula}`, textX, y);
  doc.text(`Consecutivo: ${data.consecutivo}`, pageWidth - marginX, y, { align: 'right' });
  y += 4;
  doc.text(`Fecha: ${new Date(data.fechaISO).toLocaleString('es-CR')}`, pageWidth - marginX, y, { align: 'right' });
  y += 4;
  doc.setFontSize(6.5);
  doc.setTextColor(90, 90, 90);
  doc.text(`Clave: ${data.clave}`, textX, y);
  y += 4;

  doc.setDrawColor(160);
  doc.setLineWidth(0.2);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 4;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(20, 20, 20);
  doc.text(`Receptor: ${data.customerName}`, marginX, y); y += 3.8;
  doc.text(`${IDENTIFICACION_LABELS[data.customerIdentificationType]}: ${data.customerIdentification || 'N/A'}   |   Pago: ${MEDIO_PAGO_LABELS[data.medioPago]}`, marginX, y); y += 3.8;
  if (data.customerEmail) { doc.text(`Correo: ${data.customerEmail}`, marginX, y); y += 3.8; }
  y += 2;

  // ---- Tabla de líneas (solo líneas, sin relleno) ----
  y = renderItemsTable(doc, data, y, {
    headerFill: null,
    headerText: [20, 20, 20],
    altRowFill: null,
    borders: false,
    compact: true,
    warranty: hasWarranty(data)
  });

  y += 3;
  doc.setDrawColor(160);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 5;

  // ---- Totales (alineados a la derecha, sin caja) ----
  const totalsX = pageWidth - marginX - 50;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text('Subtotal', totalsX, y);
  drawColones(doc, data.subtotal, pageWidth - marginX, y, { align: 'right' }); y += 4.2;
  doc.text('IVA (13%)', totalsX, y);
  drawColones(doc, data.ivaTotal, pageWidth - marginX, y, { align: 'right' }); y += 4.2;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('TOTAL', totalsX, y);
  drawColones(doc, data.total, pageWidth - marginX, y, { align: 'right' });

  // ---- QR pequeño + aviso ----
  const qrSize = 16;
  const qrY = y - 12;
  doc.addImage(qrDataUrl, 'PNG', marginX, qrY, qrSize, qrSize, undefined, 'FAST');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.8);
  doc.setTextColor(120, 120, 120);
  const disclaimer = doc.splitTextToSize(
    'QR de verificación interna (no oficial de Hacienda). Uso contable mientras se activa la transmisión electrónica real.',
    totalsX - marginX - qrSize - 6
  );
  doc.text(disclaimer, marginX + qrSize + 3, qrY + 4);

  const blob = doc.output('blob');
  return { blob, qrText };
}

// ============================================================================
// Tabla de líneas compartida (CAABYS / Descripción / Garantía / Cant. /
// P.Unit / IVA / Total): un solo renderer parametrizable para que las 3
// plantillas mantengan la MISMA estructura fiscal exacta y solo cambien su
// piel visual — evita triplicar la lógica de columnas/paginación.
// ============================================================================
function renderItemsTable(
  doc: any,
  data: InvoiceData,
  startY: number,
  style: {
    headerFill: [number, number, number] | null;
    headerText: [number, number, number];
    altRowFill: [number, number, number] | null;
    borders: boolean;
    fontFamily?: string;
    compact?: boolean;
    warranty: boolean;
  }
): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = style.compact ? 16 : 14;
  const usableW = pageWidth - marginX * 2;
  const font = style.fontFamily || 'helvetica';
  let y = startY;

  // Anchos de columna (mm). "Garantía" solo aparece si algún ítem la trae.
  const wN = 6, wCaabys = 20, wQty = 10, wPrice = 22, wIva = 20, wTotal = 24;
  const wWarranty = style.warranty ? 16 : 0;
  const wDesc = usableW - (wN + wCaabys + wQty + wPrice + wIva + wTotal + wWarranty);

  const colX = { n: marginX, caabys: marginX + wN, desc: marginX + wN + wCaabys };
  const descEnd = colX.desc + wDesc;
  const warrantyX = descEnd;
  const qtyX = warrantyX + wWarranty;
  const priceX = qtyX + wQty;
  const ivaX = priceX + wPrice;
  const totalX = ivaX + wIva;

  const headerH = style.compact ? 5.5 : 7;
  if (style.headerFill) {
    doc.setFillColor(...style.headerFill);
    doc.rect(marginX, y, usableW, headerH, 'F');
  }
  if (style.borders) doc.rect(marginX, y, usableW, headerH);
  doc.setTextColor(...style.headerText);
  doc.setFont(font, 'bold');
  doc.setFontSize(style.compact ? 6.5 : 7.2);
  const headerBaseline = y + headerH - (style.compact ? 1.6 : 2.2);
  doc.text('#', colX.n + 1.5, headerBaseline);
  doc.text('CAABYS', colX.caabys, headerBaseline);
  doc.text('Descripción', colX.desc, headerBaseline);
  if (style.warranty) doc.text('Garantía', warrantyX, headerBaseline);
  doc.text('Cant.', qtyX + wQty - 1.5, headerBaseline, { align: 'right' });
  doc.text('P. Unit', priceX + wPrice - 1.5, headerBaseline, { align: 'right' });
  doc.text('IVA 13%', ivaX + wIva - 1.5, headerBaseline, { align: 'right' });
  doc.text('Total', totalX + wTotal - 1.5, headerBaseline, { align: 'right' });
  y += headerH;

  doc.setFont(font, 'normal');
  doc.setFontSize(style.compact ? 6.8 : 7.5);
  const rowH = style.compact ? 5.2 : 6.5;
  const textColor: [number, number, number] = [20, 20, 20];

  data.items.forEach((it, idx) => {
    if (y > 265) { doc.addPage(); y = 20; }
    if (style.altRowFill && idx % 2 === 0) {
      doc.setFillColor(...style.altRowFill);
      doc.rect(marginX, y, usableW, rowH, 'F');
    }
    if (style.borders) doc.rect(marginX, y, usableW, rowH);
    doc.setTextColor(...textColor);
    const baseline = y + rowH - (style.compact ? 1.4 : 2);
    doc.text(String(idx + 1), colX.n + 1.5, baseline);
    doc.text(it.caabys, colX.caabys, baseline);
    const descLines = doc.splitTextToSize(it.description, wDesc - 2);
    doc.text(descLines[0] || '', colX.desc, baseline);
    if (style.warranty) doc.text(it.warranty || '—', warrantyX, baseline);
    doc.text(String(it.qty), qtyX + wQty - 1.5, baseline, { align: 'right' });
    drawColones(doc, it.unitPrice, priceX + wPrice - 1.5, baseline, { align: 'right' });
    drawColones(doc, it.lineIva, ivaX + wIva - 1.5, baseline, { align: 'right' });
    drawColones(doc, it.lineTotal, totalX + wTotal - 1.5, baseline, { align: 'right' });
    y += rowH;
  });

  return y;
}

/** Punto de entrada usado por el checkout y las notas de crédito. */
export async function buildInvoicePdfBlob(data: InvoiceData): Promise<{ blob: Blob; qrText: string }> {
  return buildInvoicePdfMinimalista(data);
}
