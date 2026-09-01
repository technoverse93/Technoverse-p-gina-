// =====================================================================
// AUTO-COMPLETADO DE DESCRIPCIONES DE PRODUCTO
// =====================================================================
// Recibe el nombre de un producto y devuelve entre 5 y 7 BENEFICIOS, ya
// formateados para pegarse tal cual en el campo "Descripción" del panel.
//
// Beneficios y no especificaciones: quien lee la ficha en la tienda no
// sabe qué es la RAM ni cuántos mAh necesita. "8 GB de memoria" no dice
// nada; "cambia entre aplicaciones sin que se trabe" sí. La cifra se
// conserva —a quien la entiende le sirve— pero nunca va sola.
//
// Y nada sobre el trámite de compra: garantía, envío, formas de pago,
// precio y existencias viven en otros campos de la ficha. Repetirlos aquí
// ocupaba el lugar de una característica real. Hay un filtro explícito
// (`RUIDO_COMERCIAL`) que los bloquea vengan de donde vengan.
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
//   2. WIKIPEDIA EN ESPAÑOL, por su API oficial (`action=query`), que es
//      pública, gratuita y no pide llave. Aporta contexto real en los
//      aparatos conocidos (un iPhone 13, un Galaxy S21). De ahí NO se
//      copia ninguna oración: se buscan señales concretas —IP68, AMOLED,
//      NFC, mAh, vatios— y cada una emite una frase escrita aquí, en
//      español y en términos de para qué le sirve a la persona.
//
//      SOLO español. El respaldo en inglés que había antes es lo que
//      metía viñetas en inglés en el catálogo: cuando el artículo no
//      existía en español, se pegaban oraciones de la versión inglesa tal
//      cual. Si en español no hay nada, manda la capa 1, que siempre
//      está escrita en español.
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

// FALLO CORREGIDO — los plurales no se reconocían.
//
// Los patrones terminaban en `\b` justo después del singular, así que
// `\baud[ií]fono\b` NO casa con "audífonos": entre la "o" y la "s" no hay
// límite de palabra. Lo mismo le pasaba a "cargadores", "fundas",
// "baterías" y "cables" — es decir, a la forma en que la gente escribe de
// verdad el nombre de un producto. Esos artículos caían en `generico` y
// salían con cinco viñetas de relleno sin una sola palabra sobre lo que
// hacen: unos audífonos sin nada del sonido.
//
// Cada término lleva ahora su plural (`s?` o `es?`) y el `\b` va al final
// del grupo, después del sufijo.
function detectarFamilia(txt: string): Familia {
  const t = txt.toLowerCase();
  if (/\b(cargador(es)?|adaptador(es)?|charger|cubos?)\b/.test(t)) return 'cargador';
  if (/\b(bater[ií]as?|battery|batteries|pilas?)\b/.test(t)) return 'bateria';
  if (/\b(temperado|templado|micas?|protector(es)?|glass|vidrios?|hidrogel)\b/.test(t)) return 'protector';
  if (/\b(fundas?|case|cases|carcasas?|estuches?|cover)\b/.test(t)) return 'funda';
  if (/\b(aud[ií]fonos?|auricular(es)?|earbuds?|headphones?|parlantes?|bocinas?|speakers?|airpods)\b/.test(t)) return 'audio';
  if (/\b(cables?|cord[oó]n(es)?)\b/.test(t)) return 'cable';
  if (/\b(pantallas?|display|lcd|oled|t[aá]ctil|touch)\b/.test(t)) return 'pantalla';
  if (/\b(memorias?|microsd|sd|usb|flash|pendrive)\b/.test(t)) return 'memoria';
  if (/\b(iphone|galaxy|redmi|poco|moto|pixel|celular(es)?|smartphones?|tel[eé]fonos?)\b/.test(t)) return 'telefono';
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
    // El conector ya tiene su propia viñeta. Si además se quedaba dentro
    // del modelo, la descripción decía "Conexión USB-C" y justo debajo
    // "Compatible con USB-C": la misma cosa dos veces.
    .replace(/\b(usb[-\s]?c|type[-\s]?c|tipo\s?c|lightning|micro\s?usb|usb|v8)\b/gi, ' ')
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

  // Cada dato del nombre se dice CON SU CONSECUENCIA. "Memoria RAM de 8 GB"
  // no le dice nada a quien no sabe qué es la RAM; "cambia de aplicación sin
  // que se trabe" sí. El número se conserva —quien lo entiende lo quiere
  // ver— pero deja de ir solo.
  if (d.vatios) {
    out.push(
      Number(d.vatios) >= 18
        ? `Carga rápida de ${d.vatios} W: recupera buena parte de la batería en pocos minutos`
        : `Potencia de ${d.vatios} W, suficiente para cargar el equipo con tranquilidad`
    );
  }
  if (d.mah) out.push(`Batería de ${d.mah} mAh, pensada para llegar al final del día sin buscar un enchufe`);
  if (d.almacenamiento) out.push(`${d.almacenamiento} de espacio para fotos, videos y aplicaciones sin quedarse corto`);
  if (d.ram) out.push(`${d.ram} GB de memoria: cambia entre aplicaciones sin que se trabe`);
  if (d.pulgadas) out.push(`Pantalla de ${d.pulgadas} pulgadas, cómoda para ver videos y leer sin forzar la vista`);
  if (d.conector) out.push(`Conexión ${d.conector}, la misma que usan la mayoría de equipos con ese puerto`);
  if (d.metros) out.push(`${d.metros} metros de largo: alcanza desde el tomacorriente hasta la cama o el escritorio`);
  if (d.dureza && d.familia === 'protector') out.push(`Dureza ${d.dureza}H: aguanta el roce de llaves y monedas en el bolsillo`);

  // Frases propias de cada familia, escritas como BENEFICIO y no como
  // ficha técnica. Ninguna menciona garantía, entrega, pago ni precio: eso
  // vive en otros módulos del producto y aquí solo estorbaba.
  const porFamilia: Record<Familia, string[]> = {
    cargador: [
      'Protecciones internas contra sobrecarga y sobrecalentamiento: se puede dejar cargando sin estar pendiente',
      'Sirve para teléfonos, tabletas y otros accesorios, no solo para una marca',
    ],
    bateria: [
      'Devuelve la autonomía original: el equipo vuelve a aguantar el día completo',
      'Encaja en el lugar de la batería original, sin adaptadores ni piezas extra',
    ],
    protector: [
      'Se coloca sin burbujas y la capa antihuellas evita que queden marcas de dedos',
      'El táctil responde igual de bien que con la pantalla descubierta',
    ],
    funda: [
      'Amortigua los golpes y las caídas, y evita que la carcasa se raye',
      'Deja libres los botones, la cámara y los puertos: no hay que quitarla para nada',
    ],
    audio: [
      'Sonido claro y con buen volumen, tanto para música como para llamadas',
      'Funciona con cualquier equipo que admita este tipo de conexión',
    ],
    cable: [
      'Sirve igual para cargar que para pasar archivos a la computadora',
      'Extremos reforzados: aguanta el doblado de todos los días sin pelarse',
    ],
    pantalla: [
      'Devuelve la imagen y el táctil como venían de fábrica',
      'Viene ensamblada y lista para instalar, sin trabajo de armado aparte',
    ],
    telefono: [
      'Equipo revisado y probado pieza por pieza antes de entregarlo',
      'Listo para usar desde el primer día: se enciende, se configura y funciona',
    ],
    memoria: [
      'Amplía el espacio del equipo sin tener que borrar fotos ni aplicaciones',
      'Compatible con los equipos que aceptan este formato de tarjeta',
    ],
    generico: [
      'Producto revisado y probado antes de entregarlo',
      'Materiales pensados para aguantar el uso de todos los días',
    ],
  };

  // Lo que el propio nombre promete y antes se tiraba a la basura: la
  // palabra "bluetooth" o "inalámbricos" se borraba al calcular el modelo
  // y nunca llegaba a la descripción, aunque suele ser la razón por la que
  // alguien elige unos audífonos.
  const bruto = _nombre.toLowerCase();
  if (/inal[aá]mbric|bluetooth/.test(bruto)) {
    out.push(d.familia === 'cargador'
      ? 'Carga sin cables: basta con apoyar el equipo encima'
      : 'Se conecta sin cables: nada de enredos ni tirones al moverse');
  }
  if (/cancelaci[oó]n de ruido|anc\b/.test(bruto)) {
    out.push('Cancelación de ruido: aísla el ruido de la calle o del bus');
  }
  if (/resistente al agua|impermeable|ip6[78]|waterproof/.test(bruto)) {
    out.push('Resiste el agua y el polvo del día a día, incluida la lluvia');
  }

  // "Compatible con X" SOLO tiene sentido en lo que se le pone a otro
  // aparato: un cargador, una funda, un repuesto. En un teléfono, unos
  // audífonos o una memoria, el artículo ES el aparato, y la frase salía
  // absurda ("Compatible con Audífonos Bluetooth JBL" en la ficha de esos
  // mismos audífonos). Para esas familias se nombra la marca, que es lo
  // que sí aporta.
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

async function buscarEnWikipedia(nombre: string, idioma: 'es'): Promise<string | null> {
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

// =====================================================================
// FILTRO DE RUIDO COMERCIAL
// =====================================================================
// La descripción explica qué ES el producto y qué HACE. Todo lo que tenga
// que ver con el trámite de compra —garantía, envío, formas de pago,
// precio, existencias, "compre ya"— ya vive en otros campos de la ficha y
// en otros módulos del sistema. Repetirlo aquí no informa: ocupa el lugar
// de una característica real.
//
// Se aplica al FINAL sobre todas las viñetas, vengan de donde vengan, y no
// solo sobre las de Wikipedia. Es la única forma de que la regla siga
// valiendo cuando mañana se agregue otra fuente.
const RUIDO_COMERCIAL: RegExp[] = [
  /garant[ií]a|garantizad|respald[oa]\s+de\s+f[aá]brica/i,
  /env[ií]o|domicilio|retiro en tienda|encomienda|mensajer[ií]a|paqueter[ií]a/i,
  /\bpagos?\b|cuotas|financiamiento|sinpe|tarjeta de (cr[eé]dito|d[eé]bito)|efectivo|factura|comprobante/i,
  /precio|descuento|oferta|promoci[oó]n|rebaja|\$|₡|colones|d[oó]lares/i,
  /\bstock\b|existencias|disponibilidad|agotado|[uú]ltimas unidades|bajo pedido/i,
  /\bcompr(a|e|ar|as|en|ando)\b|ll[eé]vatelo|no te lo pierdas|apr[oó]vech|cotiz|consulte por|escr[ií]banos|ll[aá]menos|contáctenos/i,
  /devoluci[oó]n|reembolso|cambio por otro/i,
];

function esRuidoComercial(texto: string): boolean {
  return RUIDO_COMERCIAL.some(r => r.test(texto));
}

// =====================================================================
// De dato técnico a beneficio entendible
// =====================================================================
// Antes se copiaban oraciones enteras de Wikipedia si mencionaban alguna
// especificación. El resultado era enciclopedia pegada: nombres de chip,
// modulaciones y cifras sueltas que a quien compra un cargador no le dicen
// nada. Y con el respaldo en inglés activado, la mitad ni siquiera estaba
// en español.
//
// Ahora NO se copia ninguna oración. Se BUSCAN señales concretas en el
// texto y cada señal emite una frase propia, escrita de antemano, en
// español y en términos de para qué le sirve a la persona. Es menos
// ambicioso y mucho más fiable: lo que sale está escrito aquí, así que no
// puede salir en otro idioma ni con jerga.
const SENALES: { patron: RegExp; beneficio: (m: RegExpMatchArray) => string }[] = [
  { patron: /\bip6[78]\b/i,
    beneficio: () => 'Resiste el polvo y las salpicaduras de agua del día a día' },
  { patron: /cancelaci[oó]n (activa )?de ruido/i,
    beneficio: () => 'Cancelación de ruido: aísla el sonido de la calle o del bus' },
  { patron: /\b(amoled|oled)\b/i,
    beneficio: () => 'Pantalla con colores vivos y negros profundos, que se ve bien incluso de frente al sol' },
  { patron: /\bnfc\b/i,
    beneficio: () => 'Permite pagar acercando el equipo al datáfono, sin sacar la tarjeta' },
  { patron: /gorilla glass|cristal templado/i,
    beneficio: () => 'Cristal reforzado que aguanta mejor los golpes y las rayaduras' },
  { patron: /bluetooth\s*([\d.]+)/i,
    beneficio: m => `Bluetooth ${m[1]}: se enlaza rápido y mantiene la señal estable sin cortes` },
  { patron: /carga inal[aá]mbrica/i,
    beneficio: () => 'Carga sin cables: basta con apoyarlo en la base' },
  { patron: /(\d{3,5})\s*mah\b/i,
    beneficio: m => `Batería de ${m[1]} mAh, pensada para aguantar la jornada completa` },
  { patron: /\b(\d{2,3})\s*w\b/i,
    beneficio: m => `Carga de ${m[1]} W: recupera batería en bastante menos tiempo que un cargador común` },
  { patron: /resistente al agua|sumergible/i,
    beneficio: () => 'Aguanta el agua sin dañarse: sirve para la lluvia y las salpicaduras' },
  { patron: /(usb[- ]?c|tipo c)/i,
    beneficio: () => 'Puerto USB-C, reversible: entra de los dos lados y no hay que buscar la posición' },
  { patron: /huella|lector de huellas/i,
    beneficio: () => 'Se desbloquea con la huella, más rápido que escribir la clave' },
  { patron: /\b(\d{2,3})\s*(mp|megap[ií]xeles)\b/i,
    beneficio: m => `Cámara de ${m[1]} MP: fotos nítidas que aguantan el recorte y la ampliación` },
];

/**
 * Convierte un texto en beneficios, sin copiar ni una frase del original.
 *
 * Cada señal aporta como mucho una viñeta, y solo si la señal está de
 * verdad en el texto. Si el texto no dice nada reconocible, no se inventa
 * nada: se devuelve vacío y manda lo que ya dio el nombre del producto.
 */
function beneficiosDelTexto(extracto: string): string[] {
  const out: string[] = [];
  for (const { patron, beneficio } of SENALES) {
    const m = extracto.match(patron);
    if (!m) continue;
    const frase = beneficio(m);
    if (!esRuidoComercial(frase)) out.push(frase);
  }
  return out;
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
 * Son afirmaciones ciertas de CUALQUIER artículo que venda esta tienda y
 * referidas al PRODUCTO, nunca al proceso de compra. La versión anterior
 * hablaba de retiro en tienda, entrega a domicilio, asesoría y factura
 * electrónica: cuatro viñetas seguidas sobre trámites, en el campo que
 * debería explicar qué es la cosa y para qué sirve.
 *
 * Deliberadamente no se parecen a ninguna frase de `porFamilia`: si
 * dijeran casi lo mismo con otras palabras, el filtro de repetidas no
 * las cazaría —compara texto, no significado— y la descripción saldría
 * diciendo dos veces la misma cosa.
 */
const RELLENO = [
  'Materiales resistentes, pensados para el uso diario y no para durar una temporada',
  'Sencillo de usar: funciona conectándolo, sin configuraciones complicadas',
  'Tamaño práctico para llevarlo en el bolso o la mochila sin que estorbe',
  'Acabado cuidado, cómodo de sostener y de manipular',
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

    // SOLO Wikipedia en español. El respaldo en inglés que había aquí es
    // lo que metía viñetas en inglés en la ficha: cuando el artículo no
    // existía en español, se copiaban oraciones de la versión inglesa tal
    // cual. Si en español no hay nada, se prescinde de esta capa: el
    // nombre del producto ya da viñetas, y todas están escritas aquí.
    let deWikipedia: string[] = [];
    let fuente = 'nombre del producto';
    const extracto = await buscarEnWikipedia(nombre, 'es');
    if (extracto) {
      deWikipedia = beneficiosDelTexto(extracto);
      if (deWikipedia.length > 0) fuente = 'nombre del producto + Wikipedia (es)';
    }

    // Wikipedia aporta como mucho 3 viñetas: por encima de eso la
    // descripción deja de parecer una ficha de producto y empieza a
    // parecer un artículo de enciclopedia pegado.
    //
    // El filtro comercial se pasa AQUÍ, sobre la lista ya unida, y no en
    // cada fuente por separado: así vale para lo que salga del nombre,
    // de Wikipedia y de cualquier fuente que se agregue después.
    const unidas = sinRepetidas([...propias, ...deWikipedia.slice(0, 3)])
      .filter(c => !esRuidoComercial(c));
    const finales = unidas.slice(0, MAX_CARACTERISTICAS);

    if (finales.length < MIN_CARACTERISTICAS) {
      // El relleno pasa por el MISMO filtro de repetidas que el resto, y
      // no por un `includes` de texto exacto: comparando cadena contra
      // cadena, "Incluye la garantía…" y "Incluye la garantia…" —misma
      // frase, uno con tilde y otro sin ella— se colaban las dos y la
      // descripción salía repitiéndose.
      const conRelleno = sinRepetidas([...finales, ...RELLENO])
        .filter(c => !esRuidoComercial(c));
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
