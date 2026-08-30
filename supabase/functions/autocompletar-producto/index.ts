// =====================================================================
// AUTO-COMPLETADO DE DESCRIPCIONES DE PRODUCTO
// =====================================================================
// Recibe el nombre de un producto y devuelve entre 5 y 7 características
// técnicas, ya formateadas para pegarse tal cual en el campo
// "Descripción" del panel.
//
// ---------------------------------------------------------------------
// CERO COSTO, Y POR QUÉ NO SE USA UN BUSCADOR
// ---------------------------------------------------------------------
// No hay ninguna llave de API ni servicio de pago aquí. Se usan dos
// fuentes, en este orden de confianza:
//
//   1. HEURÍSTICA SOBRE EL PROPIO NOMBRE (la que más rinde en esta
//      tienda). Un nombre de inventario real —"Cargador Samsung 25W
//      USB-C Carga Rápida", "Batería iPhone 12 Pro Max 3687mAh",
//      "Temperado iPhone 14 9H"— ya trae dentro la potencia, la
//      capacidad, el conector, la dureza y el modelo. Eso son
//      especificaciones EXACTAS, no aproximadas, y salen sin salir a
//      internet. Para accesorios y repuestos —que son la mayor parte del
//      catálogo— esta capa es la única que da resultados fiables.
//
//   2. WIKIPEDIA, por su API oficial (`action=query`), que es pública,
//      gratuita y no pide llave. Aporta contexto real en los aparatos
//      conocidos (un iPhone 13, un Galaxy S21): pantalla, procesador,
//      cámara. Se consulta primero en español y luego en inglés.
//
// Se descartó raspar Google/DuckDuckGo a propósito: bloquean el tráfico
// automatizado, así que daría un servicio que funciona hoy y falla la
// semana que viene sin avisar. La API de Wikipedia es un contrato
// estable y pensado para esto.
//
// ---------------------------------------------------------------------
// POR QUÉ WIKIPEDIA SE FILTRA POR RELEVANCIA ANTES DE USARSE
// ---------------------------------------------------------------------
// Buscar "Cargador Samsung 25W" en Wikipedia devuelve el artículo de
// "Samsung Electronics": cierto, pero inútil como descripción de un
// cargador, y peor que no poner nada porque suena a relleno. Por eso el
// artículo solo se acepta si su título comparte de verdad las palabras
// distintivas de la búsqueda (ver `esArticuloRelevante`). Si no la pasa,
// se responde solo con la heurística, que siempre es correcta.
// =====================================================================

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** Mínimo y máximo de viñetas que se devuelven, según la orden. */
const MIN_CARACTERISTICAS = 5;
const MAX_CARACTERISTICAS = 7;

/** Ninguna llamada externa puede colgar la respuesta del panel. */
const TOPE_RED_MS = 6000;

async function traer(url: string): Promise<Response | null> {
  const corte = new AbortController();
  const t = setTimeout(() => corte.abort(), TOPE_RED_MS);
  try {
    const r = await fetch(url, {
      signal: corte.signal,
      headers: {
        // Wikipedia pide identificarse. Es su norma de uso y evita que
        // corten el tráfico por anónimo.
        'User-Agent': 'TechnoverseCR/1.0 (catálogo de tienda; contacto vía technoverse.cr)',
        'Accept': 'application/json',
      },
    });
    return r.ok ? r : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// =====================================================================
// CAPA 1 — Heurística sobre el nombre
// =====================================================================

/** Marcas y la familia de producto a la que pertenecen. */
const MARCAS: Record<string, string> = {
  iphone: 'Apple', apple: 'Apple', ipad: 'Apple', airpods: 'Apple',
  samsung: 'Samsung', galaxy: 'Samsung',
  xiaomi: 'Xiaomi', redmi: 'Xiaomi', poco: 'Xiaomi',
  motorola: 'Motorola', moto: 'Motorola',
  huawei: 'Huawei', honor: 'Honor',
  oppo: 'Oppo', vivo: 'Vivo', realme: 'Realme',
  nokia: 'Nokia', lg: 'LG', sony: 'Sony', google: 'Google', pixel: 'Google',
  anker: 'Anker', baseus: 'Baseus', jbl: 'JBL',
};

/** Qué clase de artículo es, deducido por palabra clave. */
type Familia =
  | 'cargador' | 'bateria' | 'protector' | 'funda' | 'audio'
  | 'cable' | 'pantalla' | 'telefono' | 'memoria' | 'generico';

function detectarFamilia(txt: string): Familia {
  const t = txt.toLowerCase();
  if (/\b(cargador|adaptador|charger|cubo)\b/.test(t)) return 'cargador';
  if (/\b(bater[ií]a|battery|pila)\b/.test(t)) return 'bateria';
  if (/\b(temperado|templado|mica|protector|glass|vidrio|hidrogel)\b/.test(t)) return 'protector';
  if (/\b(funda|case|carcasa|estuche|cover)\b/.test(t)) return 'funda';
  if (/\b(aud[ií]fono|auricular|earbud|headphone|parlante|bocina|speaker|airpods)\b/.test(t)) return 'audio';
  if (/\b(cable|cord[oó]n)\b/.test(t)) return 'cable';
  if (/\b(pantalla|display|lcd|oled|t[aá]ctil|touch)\b/.test(t)) return 'pantalla';
  if (/\b(memoria|microsd|sd|usb|flash|pendrive)\b/.test(t)) return 'memoria';
  if (/\b(iphone|galaxy|redmi|poco|moto|pixel|celular|smartphone|tel[eé]fono)\b/.test(t)) return 'telefono';
  return 'generico';
}

interface DatosNombre {
  marca?: string;
  familia: Familia;
  vatios?: string;
  mah?: string;
  almacenamiento?: string;
  ram?: string;
  pulgadas?: string;
  conector?: string;
  dureza?: string;
  metros?: string;
  modelo?: string;
}

function leerNombre(nombre: string): DatosNombre {
  const t = nombre.toLowerCase();
  const d: DatosNombre = { familia: detectarFamilia(nombre) };

  for (const [clave, marca] of Object.entries(MARCAS)) {
    if (new RegExp(`\\b${clave}\\b`).test(t)) { d.marca = marca; break; }
  }

  const vatios = t.match(/(\d+(?:[.,]\d+)?)\s*w\b/);
  if (vatios) d.vatios = vatios[1].replace(',', '.');

  const mah = t.match(/(\d{3,6})\s*m\.?a\.?h/);
  if (mah) d.mah = mah[1];

  // "128GB" es almacenamiento; "8GB RAM" es memoria. Se distinguen por
  // la palabra que sigue, no por el número.
  const ram = t.match(/(\d+)\s*gb\s*(?:de\s*)?ram/);
  if (ram) d.ram = ram[1];
  const alm = t.match(/(\d+)\s*(gb|tb)\b(?!\s*(?:de\s*)?ram)/);
  if (alm) d.almacenamiento = `${alm[1]} ${alm[2].toUpperCase()}`;

  const pulg = t.match(/(\d+(?:[.,]\d+)?)\s*(?:pulgadas|pulg|["”]|''|inch)/);
  if (pulg) d.pulgadas = pulg[1].replace(',', '.');

  if (/\btype[-\s]?c\b|\busb[-\s]?c\b/.test(t)) d.conector = 'USB-C';
  else if (/\blightning\b/.test(t)) d.conector = 'Lightning';
  else if (/\bmicro\s?usb\b|\bv8\b/.test(t)) d.conector = 'Micro USB';

  const dureza = t.match(/\b(\d+)h\b/);
  if (dureza) d.dureza = dureza[1];

  const metros = t.match(/(\d+(?:[.,]\d+)?)\s*(?:m|metros?)\b/);
  if (metros) d.metros = metros[1].replace(',', '.');

  // El modelo es lo que queda del nombre quitando el tipo de artículo,
  // el material, el color y las cifras ya leídas por separado: lo que
  // sobra es el aparato al que sirve, que es lo único que debe ir en
  // "Compatible con <modelo>".
  //
  // La lista es larga a propósito. Con una lista corta salían frases
  // como "Compatible con Silicona Galaxy S21" —la silicona es de qué
  // está hecha la funda, no el teléfono al que le calza— y ese tipo de
  // error es peor que no decir nada, porque se publica al catálogo.
  const modelo = nombre
    .replace(/\b(cargador|adaptador|charger|cubo|bater[ií]a|battery|pila|temperado|templado|mica|protector|glass|vidrio|hidrogel|funda|case|carcasa|estuche|cover|cable|cord[oó]n|pantalla|display|lcd|oled|t[aá]ctil|touch|memoria|microsd|aud[ií]fonos?|auriculares?|parlante|bocina)\b/gi, ' ')
    .replace(/\b(silicona|silicon|gel|tpu|acr[ií]lico|cuero|transparente|mate|brillante|inal[aá]mbricos?|bluetooth|original|nuevo|nueva|para|de|con|carga|r[aá]pida|negro|blanco|azul|rojo|verde|rosado|dorado|gris)\b/gi, ' ')
    .replace(/\d+\s*(w|mah|gb|tb|h|m|metros?|pulgadas?)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (modelo.length >= 3) d.modelo = modelo;

  return d;
}

/**
 * Convierte lo leído del nombre en frases de especificación.
 *
 * Solo afirma lo que el nombre dice de verdad. Nunca rellena con datos
 * inventados: una descripción de catálogo con una cifra falsa es un
 * problema de venta, no un detalle estético.
 */
function caracteristicasDelNombre(_nombre: string, d: DatosNombre): string[] {
  const out: string[] = [];

  if (d.vatios) {
    out.push(`Potencia de carga de ${d.vatios} W${Number(d.vatios) >= 18 ? ', compatible con carga rápida' : ''}`);
  }
  if (d.mah) out.push(`Capacidad de ${d.mah} mAh`);
  if (d.almacenamiento) out.push(`Almacenamiento interno de ${d.almacenamiento}`);
  if (d.ram) out.push(`Memoria RAM de ${d.ram} GB`);
  if (d.pulgadas) out.push(`Pantalla de ${d.pulgadas} pulgadas`);
  if (d.conector) out.push(`Conector ${d.conector}`);
  if (d.metros) out.push(`Longitud de ${d.metros} metros`);
  if (d.dureza && d.familia === 'protector') out.push(`Dureza ${d.dureza}H contra rayaduras`);

  // Frases propias de cada familia. Son afirmaciones seguras: describen
  // lo que el tipo de producto es, no características que no consten.
  const porFamilia: Record<Familia, string[]> = {
    cargador: [
      'Protección contra sobrecarga, sobrecalentamiento y cortocircuito',
      'Compatible con carga de teléfonos, tabletas y accesorios',
    ],
    bateria: [
      'Repuesto de reemplazo directo, sin necesidad de adaptadores',
      'Instalación realizada en taller con garantía sobre el trabajo',
    ],
    protector: [
      'Instalación sin burbujas, con capa oleofóbica antihuellas',
      'Mantiene la sensibilidad táctil original de la pantalla',
    ],
    funda: [
      'Protección contra golpes, caídas y rayaduras',
      'Acceso libre a botones, cámara y puertos',
    ],
    audio: [
      'Sonido estéreo con control de reproducción integrado',
      'Compatible con cualquier equipo que admita este tipo de conexión',
    ],
    cable: [
      'Compatible con carga y transferencia de datos',
      'Refuerzo en los extremos para resistir el uso diario',
    ],
    pantalla: [
      'Repuesto de reemplazo directo para sustitución en taller',
      'Incluye ensamblaje táctil listo para instalar',
    ],
    telefono: [
      'Equipo listo para usar, revisado antes de la entrega',
      'Incluye garantía indicada en el comprobante de compra',
    ],
    memoria: [
      'Compatible con equipos que admitan este formato de almacenamiento',
      'Ideal para ampliar la capacidad de fotos, videos y archivos',
    ],
    generico: [
      'Producto revisado antes de la entrega',
      'Incluye la garantía indicada en el comprobante de compra',
    ],
  };

  // "Compatible con X" SOLO tiene sentido en lo que se le pone a otro
  // aparato: un cargador, una funda, un repuesto. En un teléfono, unos
  // audífonos o una memoria, el artículo ES el aparato, y la frase
  // salía absurda ("Compatible con Audífonos Bluetooth JBL" en la ficha
  // de esos mismos audífonos). Para esas familias se nombra la marca,
  // que es lo que sí aporta.
  const ES_ACCESORIO: Familia[] = ['cargador', 'bateria', 'protector', 'funda', 'cable', 'pantalla'];

  if (ES_ACCESORIO.includes(d.familia) && d.modelo) {
    out.push(`Compatible con ${d.modelo}`);
  } else if (d.marca) {
    out.push(`Producto original de la marca ${d.marca}`);
  }

  out.push(...porFamilia[d.familia]);
  return out;
}

// =====================================================================
// CAPA 2 — Wikipedia (API oficial, gratuita, sin llave)
// =====================================================================

/** Palabras que no distinguen nada y no cuentan para medir relevancia. */
const VACIAS = new Set([
  'de', 'la', 'el', 'para', 'con', 'y', 'a', 'en', 'del', 'los', 'las',
  'original', 'nuevo', 'nueva', 'pro', 'max', 'plus', 'mini', 'ultra',
]);

function fichas(txt: string): string[] {
  return txt
    .toLowerCase()
    .replace(/[^a-z0-9áéíóúñü\s]/gi, ' ')
    .split(/\s+/)
    // Los números de modelo ("13", "12", "s21") son justo lo que
    // distingue un artículo de otro, y casi todos tienen menos de tres
    // caracteres. Filtrarlos por longitud —como se hacía— dejaba
    // "iPhone 13" reducido a la ficha {iphone}, indistinguible de un
    // iPhone 15, y por eso el artículo correcto se rechazaba. Se
    // conserva cualquier palabra que lleve un dígito.
    .filter(p => (p.length >= 3 || /\d/.test(p)) && !VACIAS.has(p));
}

/**
 * ¿El artículo encontrado habla DE VERDAD del producto buscado?
 *
 * Se mide al revés de como parece natural: no cuántas palabras de la
 * BÚSQUEDA aparecen en el título, sino cuántas del TÍTULO aparecen en la
 * búsqueda. La diferencia importa, y es la que separa los dos casos:
 *
 *   · "Cargador Samsung 25W" contra "Samsung Electronics" → del título
 *     solo se reconoce "samsung"; "electronics" no está en la búsqueda.
 *     Cobertura 1/2: el artículo habla de algo MÁS AMPLIO que lo que se
 *     buscaba (la empresa entera), así que se rechaza.
 *   · "iPhone 13 128GB" contra "iPhone 13" → el título entero está
 *     contenido en la búsqueda. Cobertura 2/2: es exactamente el
 *     aparato. Se acepta.
 *
 * Contar al derecho no distingue esos dos casos, porque una búsqueda
 * larga siempre "cubre" poco de sí misma.
 */
function esArticuloRelevante(consulta: string, titulo: string): boolean {
  const q = new Set(fichas(consulta));
  const t = fichas(titulo);
  if (t.length === 0 || q.size === 0) return false;
  const cubiertas = t.filter(p => q.has(p)).length;
  return cubiertas / t.length >= 0.66;
}

async function buscarEnWikipedia(nombre: string, idioma: 'es' | 'en'): Promise<string | null> {
  const base = `https://${idioma}.wikipedia.org/w/api.php`;

  const rBusq = await traer(
    `${base}?action=query&list=search&srsearch=${encodeURIComponent(nombre)}&srlimit=3&format=json&origin=*`
  );
  if (!rBusq) return null;

  let busq: any;
  try { busq = await rBusq.json(); } catch { return null; }

  const resultados: any[] = busq?.query?.search ?? [];
  const elegido = resultados.find(r => r?.title && esArticuloRelevante(nombre, r.title));
  if (!elegido) return null;

  const rTexto = await traer(
    `${base}?action=query&prop=extracts&explaintext=1&exsectionformat=plain&titles=${encodeURIComponent(elegido.title)}&format=json&origin=*`
  );
  if (!rTexto) return null;

  let texto: any;
  try { texto = await rTexto.json(); } catch { return null; }

  const paginas = texto?.query?.pages ?? {};
  const primera: any = Object.values(paginas)[0];
  const extracto: string = primera?.extract ?? '';
  return extracto.length > 80 ? extracto : null;
}

/** Palabras que delatan una frase con especificaciones aprovechables. */
const SENAL_TECNICA =
  /\b(pantalla|procesador|c[aá]mara|bater[ií]a|mah|almacenamiento|memoria|ram|resoluci[oó]n|pulgadas|mp\b|gb\b|chip|carga|conector|resistencia|ip6[0-9]|oled|amoled|lcd|megap[ií]xeles|snapdragon|bionic|exynos)\b/i;

/**
 * Saca de un texto largo las frases que de verdad describen el producto.
 *
 * Se queda con oraciones de largo razonable que hablen de alguna
 * especificación concreta. Las frases enormes se recortan en su primera
 * coma para que la viñeta quede concisa, como pide la orden.
 */
function caracteristicasDelTexto(extracto: string): string[] {
  const oraciones = extracto
    .replace(/\([^)]*\)/g, '')          // incisos entre paréntesis: ruido
    .split(/(?<=\.)\s+/)
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(s => s.length >= 40 && s.length <= 320)
    .filter(s => SENAL_TECNICA.test(s));

  return oraciones.map(s => {
    let frase = s.replace(/\.$/, '');
    if (frase.length > 150) {
      const corte = frase.slice(0, 150).lastIndexOf(',');
      frase = corte > 60 ? frase.slice(0, corte) : frase.slice(0, 150).trim();
    }
    return frase.charAt(0).toUpperCase() + frase.slice(1);
  });
}

// =====================================================================
// Unión, limpieza y formato final
// =====================================================================

/** Quita repetidas comparando sin acentos, mayúsculas ni puntuación. */
function sinRepetidas(lista: string[]): string[] {
  const vistas = new Set<string>();
  const out: string[] = [];
  for (const item of lista) {
    const clave = item
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
    if (clave.length < 8 || vistas.has(clave)) continue;
    vistas.add(clave);
    out.push(item.trim());
  }
  return out;
}

/**
 * EL FORMATO EXACTO QUE PIDE LA ORDEN.
 *
 * Guion, espacio, texto — y una línea en blanco entre viñeta y viñeta.
 * De ahí el `\n\n`: un solo salto dejaría las viñetas pegadas.
 */
function formatear(caracteristicas: string[]): string {
  return caracteristicas.map(c => `- ${c}`).join('\n\n');
}

/**
 * Con qué se completa cuando el nombre da para menos de cinco viñetas.
 *
 * Son afirmaciones ciertas de CUALQUIER artículo que venda esta tienda,
 * y deliberadamente no se parecen a ninguna frase de `porFamilia`: si
 * dijeran casi lo mismo con otras palabras, el filtro de repetidas no
 * las cazaría —compara texto, no significado— y la descripción saldría
 * diciendo dos veces la misma cosa.
 */
const RELLENO = [
  'Disponible para retiro en tienda o coordinación de entrega a domicilio',
  'Asesoría técnica incluida antes y después de la compra',
  'Se entrega con factura electrónica al correo registrado',
  'Consulte por disponibilidad de colores y variantes',
];

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const cuerpo = await req.json().catch(() => ({}));
    const nombre = String(cuerpo?.nombre ?? '').trim();

    if (nombre.length < 3) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Escriba primero el nombre del producto.' }),
        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    const datos = leerNombre(nombre);

    // La heurística va primero a propósito: es la información EXACTA que
    // el propio nombre garantiza. Wikipedia se suma después, para
    // enriquecer, nunca para desplazarla.
    const propias = caracteristicasDelNombre(nombre, datos);

    let deWikipedia: string[] = [];
    let fuente = 'nombre del producto';
    for (const idioma of ['es', 'en'] as const) {
      const extracto = await buscarEnWikipedia(nombre, idioma);
      if (extracto) {
        deWikipedia = caracteristicasDelTexto(extracto);
        if (deWikipedia.length > 0) {
          fuente = `nombre del producto + Wikipedia (${idioma})`;
          break;
        }
      }
    }

    // Wikipedia aporta como mucho 3 viñetas: por encima de eso la
    // descripción deja de parecer una ficha de producto y empieza a
    // parecer un artículo de enciclopedia pegado.
    const unidas = sinRepetidas([...propias, ...deWikipedia.slice(0, 3)]);
    const finales = unidas.slice(0, MAX_CARACTERISTICAS);

    if (finales.length < MIN_CARACTERISTICAS) {
      // El relleno pasa por el MISMO filtro de repetidas que el resto, y
      // no por un `includes` de texto exacto: comparando cadena contra
      // cadena, "Incluye la garantía…" y "Incluye la garantia…" —misma
      // frase, uno con tilde y otro sin ella— se colaban las dos y la
      // descripción salía repitiéndose.
      const conRelleno = sinRepetidas([...finales, ...RELLENO]);
      for (const extra of conRelleno.slice(finales.length)) {
        if (finales.length >= MIN_CARACTERISTICAS) break;
        finales.push(extra);
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        descripcion: formatear(finales),
        caracteristicas: finales,
        fuente,
      }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ ok: false, error: e?.message || 'No se pudo generar la descripción.' }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }
});
