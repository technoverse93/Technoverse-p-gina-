// =====================================================================
// LECTURA DE TEXTO DE ARCHIVOS — importador de listas de precios
// =====================================================================
// Extrae el texto real de un PDF o de un archivo de texto plano, para que
// el parser de InventarioControl.tsx (`parseTextToProducts`) trabaje sobre
// lo que el proveedor realmente mandó, no sobre datos de muestra.
//
// pdf.js se importa de forma DINÁMICA: solo se descarga cuando alguien de
// verdad usa el importador, igual que jsPDF y qrcode en el resto del
// proyecto — no tiene sentido cargarlo en el arranque del panel.
// =====================================================================

/** Extrae todo el texto de un PDF, página por página, en orden. */
export async function extractTextFromPdf(file: File): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist');
  // `new URL(..., import.meta.url)` es el patrón que Vite bundlea como asset
  // aparte automáticamente, sin necesitar una declaración de tipos extra
  // (a diferencia del sufijo `?url`, que TypeScript no reconoce aquí).
  const workerUrl = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

  const paginas: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const pagina = await pdf.getPage(i);
    const contenido = await pagina.getTextContent();
    // pdf.js entrega el texto como fragmentos sueltos (uno por "run" de la
    // fuente original), no por línea. Unirlos con espacio y separar cada
    // página con salto de línea es suficiente para el parser por líneas:
    // una lista de precios tabular casi siempre trae cada artículo en su
    // propia línea dentro del PDF de origen.
    const texto = contenido.items.map((it: any) => ('str' in it ? it.str : '')).join(' ');
    paginas.push(texto);
  }
  return paginas.join('\n');
}

/** Lee un archivo de texto plano (.txt) tal cual. */
export function extractTextFromPlainText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer el archivo.'));
    reader.readAsText(file);
  });
}

/** Decide cómo leer el archivo según su extensión/tipo real. */
export async function extractTextFromFile(file: File): Promise<string> {
  const esPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  return esPdf ? extractTextFromPdf(file) : extractTextFromPlainText(file);
}
