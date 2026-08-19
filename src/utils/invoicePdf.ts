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

// Nombre con el que se registra la fuente incrustada dentro del documento.
const FONT = 'WorkSans';

/**
 * Registra Work Sans (recortada, ver src/utils/invoiceFont.ts) dentro del
 * documento y la deja activa.
 *
 * Esta es la corrección DEFINITIVA del problema de tipografía/codificación:
 * con una fuente Unicode real incrustada, el símbolo ₡ y todos los acentos
 * del español se escriben como TEXTO normal — seleccionable, copiable y
 * buscable en cualquier lector de PDF. Antes se dibujaban con líneas
 * vectoriales, lo que producía un glifo que no correspondía al colón y dejaba
 * los montos como dibujo en vez de texto.
 *
 * La fuente se importa de forma dinámica junto a jsPDF, así que sus 20 KB solo
 * viajan cuando se genera un comprobante — nunca en la carga de la tienda.
 */
async function registerFont(doc: any): Promise<void> {
  const { WORK_SANS_REGULAR_B64, WORK_SANS_BOLD_B64 } = await import('./invoiceFont');
  doc.addFileToVFS('WorkSans-Regular.ttf', WORK_SANS_REGULAR_B64);
  doc.addFont('WorkSans-Regular.ttf', FONT, 'normal');
  doc.addFileToVFS('WorkSans-Bold.ttf', WORK_SANS_BOLD_B64);
  doc.addFont('WorkSans-Bold.ttf', FONT, 'bold');
  doc.setFont(FONT, 'normal');
}

/**
 * Formatea un monto con el formato monetario ESTRICTO de Costa Rica:
 *   - separador de MILES  = punto      (₡1.234.567,89)
 *   - separador DECIMAL   = coma
 *   - siempre 2 decimales (exigido por Hacienda por línea y en totales)
 *
 * No se usa `toLocaleString('es-CR')` a secas porque su resultado depende del
 * motor de Intl del dispositivo: en algunos Android el locale es-CR no está
 * instalado y cae a en-US, invirtiendo los separadores (₡1,234,567.89). En un
 * documento fiscal eso no es aceptable, así que el formato se construye a mano
 * y queda idéntico en web, APK y en el PDF.
 */
export function formatCRC(amount: number): string {
  const negativo = amount < 0;
  const fixed = Math.abs(amount).toFixed(2);
  const [entero, decimales] = fixed.split('.');
  const conMiles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negativo ? '-' : ''}₡${conMiles},${decimales}`;
}

/**
 * Escribe un monto en colones como texto real de la fuente incrustada.
 * Devuelve el ancho ocupado, por compatibilidad con los llamados existentes.
 */
function drawColones(doc: any, amount: number, x: number, y: number, opts: { align?: 'left' | 'right'; color?: [number, number, number] } = {}): number {
  const text = formatCRC(amount);
  const prev = doc.getTextColor?.();
  if (opts.color) doc.setTextColor(opts.color[0], opts.color[1], opts.color[2]);
  doc.text(text, x, y, { align: opts.align || 'left' });
  if (opts.color && prev) doc.setTextColor(prev);
  return (doc.getStringUnitWidth(text) * doc.getFontSize()) / doc.internal.scaleFactor;
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

// Paleta de marca (misma familia que el naranja de la app — ver --accent en
// src/index.css). Un solo color de acento, usado con moderación: banda del
// encabezado, cabecera de la tabla y el monto TOTAL. Todo lo demás queda en
// grises neutros para que el documento se lea serio, no como un flyer.
const BRAND: [number, number, number] = [194, 65, 12];
const BRAND_SOFT: [number, number, number] = [253, 237, 227];
const INK: [number, number, number] = [26, 26, 28];
const INK_SOFT: [number, number, number] = [110, 114, 122];
const LINE: [number, number, number] = [225, 227, 231];
const PANEL: [number, number, number] = [247, 248, 250];

/**
 * Recuadro con esquinas redondeadas + texto en blanco, usado como "chip" de
 * estado (tipo de documento, medio de pago). Reemplaza el texto plano suelto
 * que hacía ver el comprobante como una nota de bloc de notas.
 */
function drawChip(doc: any, text: string, x: number, y: number, opts: { align?: 'left' | 'right'; fill: [number, number, number]; textColor: [number, number, number]; fontSize?: number } ) {
  const fontSize = opts.fontSize || 7;
  doc.setFont(FONT, 'bold');
  doc.setFontSize(fontSize);
  const scale = doc.internal.scaleFactor;
  const unit = fontSize / scale; // 1 em, en mm
  const padX = unit * 0.9;
  const w = (doc.getStringUnitWidth(text) * fontSize) / scale + padX * 2;
  const h = unit * 2.2;
  const startX = opts.align === 'right' ? x - w : x;
  doc.setFillColor(...opts.fill);
  doc.roundedRect(startX, y, w, h, h / 2, h / 2, 'F');
  doc.setTextColor(...opts.textColor);
  // Centrado vertical: la línea base de un texto se ve ópticamente centrada
  // cuando queda ~0.32em por debajo del centro geométrico de la caja.
  doc.text(text, startX + w / 2, y + h / 2 + unit * 0.32, { align: 'center' });
  return { width: w, height: h };
}

// ============================================================================
// Plantilla "Profesional": banda de marca en el encabezado, chips de estado,
// tabla con cabecera de color y filas alternadas, panel de totales resaltado
// y pie de agradecimiento — misma estructura fiscal exacta de siempre (Clave
// de 50 dígitos, Consecutivo, CAABYS, IVA 13% desglosado, QR de verificación),
// solo que ahora se ve como el comprobante de un negocio serio y no como una
// hoja de texto plano.
// ============================================================================
async function buildInvoicePdfProfesional(data: InvoiceData): Promise<{ blob: Blob; qrText: string }> {
  const { jsPDF } = await import('jspdf');
  const { qrText, qrDataUrl, logoDataUrl, docTitle } = await prepareInvoice(data);

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  // Debe ir ANTES de cualquier doc.text(): registra la fuente Unicode y la
  // deja activa, para que ₡ y los acentos salgan como texto real.
  await registerFont(doc);

  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 16;
  let y = 0;

  // ---------------------------------------------------------------- Banda ---
  const bandH = 30;
  doc.setFillColor(...BRAND);
  doc.rect(0, 0, pageWidth, bandH, 'F');

  if (logoDataUrl) {
    try {
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(marginX, 8, 14, 14, 2.5, 2.5, 'F');
      doc.addImage(logoDataUrl, 'PNG', marginX + 1.3, 9.3, 11.4, 11.4, undefined, 'FAST');
    } catch { /* logo opcional */ }
  }
  const textX = logoDataUrl ? marginX + 18 : marginX;
  doc.setTextColor(255, 255, 255);
  doc.setFont(FONT, 'bold');
  doc.setFontSize(13);
  doc.text(data.emisorNombre, textX, 15);
  doc.setFont(FONT, 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(255, 235, 225);
  // El emisor es una persona física, no una sociedad: la etiqueta decía
  // "Cédula Jurídica" y era incorrecta en cada comprobante emitido. Se deja
  // como "Cédula" a secas, que vale para la identificación personal y no
  // afirma una figura legal que no corresponde.
  //
  // NADA MÁS del diseño cambia: misma posición, misma fuente, mismo tamaño.
  doc.text(`Cédula ${data.emisorCedula}`, textX, 20.5);
  if (data.emisorTelefono) doc.text(data.emisorTelefono, textX, 24.5);

  drawChip(doc, docTitle, pageWidth - marginX, 8, { align: 'right', fill: [255, 255, 255], textColor: BRAND, fontSize: 8 });
  doc.setFont(FONT, 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(255, 235, 225);
  doc.text(`Consecutivo: ${data.consecutivo}`, pageWidth - marginX, 18.5, { align: 'right' });
  doc.text(new Date(data.fechaISO).toLocaleString('es-CR'), pageWidth - marginX, 22.5, { align: 'right' });

  y = bandH + 6;
  doc.setFont(FONT, 'normal');
  doc.setFontSize(6);
  doc.setTextColor(...INK_SOFT);
  doc.text(`Clave: ${data.clave}`, marginX, y);
  y += 6;

  // -------------------------------------------------------- Panel receptor ---
  const panelH = data.customerEmail ? 20 : 16;
  doc.setFillColor(...PANEL);
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.2);
  doc.roundedRect(marginX, y, pageWidth - marginX * 2, panelH, 2, 2, 'FD');

  const padIn = 5;
  let ry = y + 6;
  doc.setFont(FONT, 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(...INK_SOFT);
  doc.text('FACTURADO A', marginX + padIn, ry);
  ry += 4.2;
  doc.setFont(FONT, 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  doc.text(data.customerName, marginX + padIn, ry);
  ry += 4.4;
  doc.setFont(FONT, 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...INK_SOFT);
  doc.text(`${IDENTIFICACION_LABELS[data.customerIdentificationType]}: ${data.customerIdentification || 'N/A'}`, marginX + padIn, ry);
  if (data.customerEmail) { ry += 4; doc.text(data.customerEmail, marginX + padIn, ry); }

  drawChip(doc, MEDIO_PAGO_LABELS[data.medioPago], pageWidth - marginX - padIn, y + 6, { align: 'right', fill: BRAND_SOFT, textColor: BRAND, fontSize: 7.5 });

  y += panelH + 7;

  // ------------------------------------------------------------- Tabla ---
  doc.setFont(FONT, 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...INK);
  doc.text('Detalle de la compra', marginX, y);
  y += 4;

  y = renderItemsTable(doc, data, y, {
    headerFill: BRAND,
    headerText: [255, 255, 255],
    altRowFill: PANEL,
    borders: false,
    compact: false,
    warranty: hasWarranty(data)
  });

  y = renderCaabys(doc, data, y, marginX);
  y += 5;

  // --------------------------------------------------- QR + Totales ---
  const qrSize = 24;
  const qrY = y;
  doc.setDrawColor(...LINE);
  doc.roundedRect(marginX, qrY, qrSize + 6, qrSize + 6, 2, 2, 'D');
  doc.addImage(qrDataUrl, 'PNG', marginX + 3, qrY + 3, qrSize, qrSize, undefined, 'FAST');
  doc.setFont(FONT, 'normal');
  doc.setFontSize(5.6);
  doc.setTextColor(...INK_SOFT);
  const disclaimer = doc.splitTextToSize(
    'QR de verificación interna (no oficial de Hacienda). Uso contable mientras se activa la transmisión electrónica real.',
    qrSize + 6
  );
  doc.text(disclaimer, marginX, qrY + qrSize + 11);

  const boxW = 68;
  const boxX = pageWidth - marginX - boxW;
  const boxH = 34;
  doc.setFillColor(...PANEL);
  doc.setDrawColor(...LINE);
  doc.roundedRect(boxX, qrY, boxW, boxH, 2, 2, 'FD');
  const padBox = 6;
  let ty = qrY + 8;
  doc.setFont(FONT, 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...INK_SOFT);
  doc.text('Subtotal', boxX + padBox, ty);
  drawColones(doc, data.subtotal, boxX + boxW - padBox, ty, { align: 'right', color: INK_SOFT });
  ty += 6;
  doc.text('IVA (13%)', boxX + padBox, ty);
  drawColones(doc, data.ivaTotal, boxX + boxW - padBox, ty, { align: 'right', color: INK_SOFT });
  ty += 4;
  doc.setDrawColor(...LINE);
  doc.line(boxX + padBox, ty, boxX + boxW - padBox, ty);
  ty += 6.5;
  doc.setFont(FONT, 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...INK);
  doc.text('TOTAL', boxX + padBox, ty);
  doc.setFontSize(12.5);
  drawColones(doc, data.total, boxX + boxW - padBox, ty, { align: 'right', color: BRAND });

  // ------------------------------------------------------------- Pie ---
  const footerY = qrY + qrSize + 22;
  doc.setDrawColor(...BRAND);
  doc.setLineWidth(0.6);
  doc.line(marginX, footerY, pageWidth - marginX, footerY);

  doc.setFont(FONT, 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...INK);
  doc.text('¡Gracias por su compra en Technoverse Costa Rica!', pageWidth / 2, footerY + 7, { align: 'center' });

  doc.setFont(FONT, 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(...INK_SOFT);
  const contactBits = [data.emisorTelefono, data.emisorDireccion].filter(Boolean).join('  ·  ');
  if (contactBits) doc.text(contactBits, pageWidth / 2, footerY + 12, { align: 'center' });

  doc.setFontSize(5.6);
  const legal = doc.splitTextToSize(
    'Comprobante generado como registro interno con el formato oficial de Hacienda (Clave, Consecutivo, CAABYS, IVA desglosado). ' +
    'Conserve este documento para efectos de garantía y contables.',
    pageWidth - marginX * 2
  );
  doc.text(legal, pageWidth / 2, footerY + 17, { align: 'center' });

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
  const font = style.fontFamily || FONT;
  let y = startY;

  // Anchos de columna (mm). "Garantía" solo aparece si algún ítem la trae.
  //
  // EL CAABYS YA NO ES UNA COLUMNA. Tenía 20 mm asignados y sus 13 dígitos
  // ocupan más: jsPDF no recorta el texto que se sale de su hueco, así que
  // el código se derramaba encima del nombre del producto y las dos cosas
  // quedaban ilegibles. Ahora va listado debajo de la tabla, por número de
  // línea (ver `renderCaabys`), que además devuelve esos 20 mm a la
  // descripción — donde antes se perdía la mitad del texto.
  const wN = 6, wQty = 10, wPrice = 22, wIva = 20, wTotal = 24;
  const wWarranty = style.warranty ? 16 : 0;
  const wDesc = usableW - (wN + wQty + wPrice + wIva + wTotal + wWarranty);

  const colX = { n: marginX, desc: marginX + wN };
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
  doc.text('Descripción', colX.desc, headerBaseline);
  if (style.warranty) doc.text('Garantía', warrantyX, headerBaseline);
  doc.text('Cant.', qtyX + wQty - 1.5, headerBaseline, { align: 'right' });
  doc.text('P. Unit', priceX + wPrice - 1.5, headerBaseline, { align: 'right' });
  doc.text('IVA 13%', ivaX + wIva - 1.5, headerBaseline, { align: 'right' });
  doc.text('Total', totalX + wTotal - 1.5, headerBaseline, { align: 'right' });
  y += headerH;

  doc.setFont(font, 'normal');
  doc.setFontSize(style.compact ? 6.8 : 7.5);
  const baseRowH = style.compact ? 5.2 : 6.5;
  const firstLineOffset = style.compact ? 3.8 : 4.5;
  const lineH = style.compact ? 2.9 : 3.5;
  const textColor: [number, number, number] = [20, 20, 20];

  data.items.forEach((it, idx) => {
    // FALLO CORREGIDO: antes solo se imprimía `descLines[0]` y el resto de
    // la descripción se descartaba sin avisar (jsPDF no recorta el texto
    // que no cabe, así que "cortar a lo que entra en una línea" era en
    // realidad "perder todo lo que no entra en la primera"). Un nombre de
    // insumo o un detalle de servicio un poco largo salía mutilado en el
    // comprobante — el límite que reportaba el cajero como "corta el
    // texto" no estaba en ningún input de la pantalla, sino aquí. Ahora la
    // fila crece hacia abajo lo que haga falta para imprimir la
    // descripción COMPLETA, en tantas líneas como ocupe.
    const descLines: string[] = doc.splitTextToSize(it.description, wDesc - 2);
    const rowH = Math.max(baseRowH, descLines.length * lineH + (style.compact ? 2.3 : 2.8));
    if (y + rowH > 270) { doc.addPage(); y = 20; }
    if (style.altRowFill && idx % 2 === 0) {
      doc.setFillColor(...style.altRowFill);
      doc.rect(marginX, y, usableW, rowH, 'F');
    }
    if (style.borders) doc.rect(marginX, y, usableW, rowH);
    doc.setTextColor(...textColor);
    const baseline = y + firstLineOffset;
    doc.text(String(idx + 1), colX.n + 1.5, baseline);
    descLines.forEach((linea, li) => doc.text(linea, colX.desc, baseline + li * lineH));
    if (style.warranty) doc.text(it.warranty || '—', warrantyX, baseline);
    doc.text(String(it.qty), qtyX + wQty - 1.5, baseline, { align: 'right' });
    drawColones(doc, it.unitPrice, priceX + wPrice - 1.5, baseline, { align: 'right' });
    drawColones(doc, it.lineIva, ivaX + wIva - 1.5, baseline, { align: 'right' });
    drawColones(doc, it.lineTotal, totalX + wTotal - 1.5, baseline, { align: 'right' });
    y += rowH;
  });

  return y;
}

/**
 * Códigos CAABYS, listados debajo de la tabla.
 *
 * Hacienda los exige por línea, así que tienen que constar en el
 * documento; pero son un dato de clasificación fiscal que ningún cliente
 * lee, y no merecían una columna que además no le cabía.
 *
 * Se imprimen referidos al número de línea —"1) 8399000000000"— para que
 * la correspondencia con cada artículo siga siendo exacta. Si todas las
 * líneas comparten el mismo código, que es el caso habitual en un cobro
 * de taller, se escribe una sola vez.
 */
function renderCaabys(doc: any, data: InvoiceData, startY: number, marginX: number): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const codigos = data.items.map(i => i.caabys || '');
  const unicos = Array.from(new Set(codigos.filter(Boolean)));
  if (unicos.length === 0) return startY;

  const texto = unicos.length === 1
    ? `Código CAABYS (todas las líneas): ${unicos[0]}`
    : `Códigos CAABYS: ${codigos.map((c, i) => `${i + 1}) ${c}`).join('   ')}`;

  doc.setFont(FONT, 'normal');
  doc.setFontSize(5.8);
  doc.setTextColor(...INK_SOFT);
  const lineas = doc.splitTextToSize(texto, pageWidth - marginX * 2);
  doc.text(lineas, marginX, startY + 3.2);
  return startY + 3.2 + lineas.length * 2.4;
}

/** Punto de entrada usado por el checkout y las notas de crédito. */
export async function buildInvoicePdfBlob(data: InvoiceData): Promise<{ blob: Blob; qrText: string }> {
  return buildInvoicePdfProfesional(data);
}
