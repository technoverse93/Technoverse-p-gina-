// =====================================================================
// CATÁLOGO DE EQUIPOS DEL TALLER
// =====================================================================
// Categoría → Marca → Modelo, para la recepción de equipos.
//
// ---------------------------------------------------------------------
// POR QUÉ ESTÁ ARMADO ASÍ (dos capas)
// ---------------------------------------------------------------------
// 1. CATÁLOGO BASE — la lista de aquí abajo. Vive en el código, así que
//    está SIEMPRE disponible: sin internet, con Supabase caído, o dentro
//    del APK recién instalado. Son 513 modelos, escogidos por lo que de
//    verdad circula en Costa Rica.
//
// 2. AGREGADOS DEL PANEL — la tabla `device_catalog` de Supabase. Ahí va
//    solo lo que usted añade o esconde desde el taller. Es pequeña por
//    diseño: no duplica el catálogo base.
//
// El catálogo que ve el técnico es la suma de las dos: base + agregados
// − escondidos. Si la consulta a Supabase falla, se usa el base y el
// taller sigue funcionando igual; lo único que pasa es que no aparecen
// los modelos que se hayan añadido a mano.
//
// ---------------------------------------------------------------------
// LO QUE ESTO NO ES
// ---------------------------------------------------------------------
// No es "todos los modelos de teléfono y laptop que existen". Esa lista
// no existe como fuente descargable: hay decenas de miles de modelos,
// cambian cada semana y ningún fabricante publica un catálogo abierto.
// Lo que sí resuelve el problema real es esto: los modelos comunes ya
// están, cualquier otro se escribe a mano en dos segundos, y si es uno
// que va a repetirse se agrega al catálogo desde el mismo formulario y
// queda para siempre.
//
// Por eso TODA lista de modelos termina ofreciendo "Otro": nunca puede
// pasar que un equipo no se pueda recibir porque no está en la lista.
// =====================================================================

import { supabase } from '../supabaseClient';

export type Catalogo = Record<string, Record<string, string[]>>;

/** Se ofrece al final de cada lista para permitir escribir a mano. */
export const OPCION_OTRO = 'Otro';
/** Marca comodín, para cuando la marca tampoco está en la lista. */
export const MARCA_OTRA = 'Otra';

// ---------------------------------------------------------------------
// CATÁLOGO BASE
// ---------------------------------------------------------------------
const BASE: Catalogo = {
  'Celular': {
    'Apple': [
      'iPhone 6', 'iPhone 6 Plus', 'iPhone 6s', 'iPhone 6s Plus', 'iPhone SE (2016)', 'iPhone 7',
      'iPhone 7 Plus', 'iPhone 8', 'iPhone 8 Plus', 'iPhone X', 'iPhone XR', 'iPhone XS',
      'iPhone XS Max', 'iPhone 11', 'iPhone 11 Pro', 'iPhone 11 Pro Max', 'iPhone SE (2020)',
      'iPhone 12', 'iPhone 12 Mini', 'iPhone 12 Pro', 'iPhone 12 Pro Max', 'iPhone 13',
      'iPhone 13 Mini', 'iPhone 13 Pro', 'iPhone 13 Pro Max', 'iPhone SE (2022)', 'iPhone 14',
      'iPhone 14 Plus', 'iPhone 14 Pro', 'iPhone 14 Pro Max', 'iPhone 15', 'iPhone 15 Plus',
      'iPhone 15 Pro', 'iPhone 15 Pro Max', 'iPhone 16', 'iPhone 16 Plus', 'iPhone 16 Pro',
      'iPhone 16 Pro Max', 'iPhone 16e', 'iPhone 17', 'iPhone 17 Pro', 'iPhone 17 Pro Max'
    ],
    'Samsung': [
      'Galaxy J2', 'Galaxy J5', 'Galaxy J7', 'Galaxy A03', 'Galaxy A03 Core', 'Galaxy A04',
      'Galaxy A04e', 'Galaxy A05', 'Galaxy A05s', 'Galaxy A06', 'Galaxy A10', 'Galaxy A11',
      'Galaxy A12', 'Galaxy A13', 'Galaxy A14', 'Galaxy A15', 'Galaxy A16', 'Galaxy A20',
      'Galaxy A21s', 'Galaxy A22', 'Galaxy A23', 'Galaxy A24', 'Galaxy A25', 'Galaxy A26',
      'Galaxy A30', 'Galaxy A31', 'Galaxy A32', 'Galaxy A33', 'Galaxy A34', 'Galaxy A35',
      'Galaxy A36', 'Galaxy A50', 'Galaxy A51', 'Galaxy A52', 'Galaxy A53', 'Galaxy A54',
      'Galaxy A55', 'Galaxy A56', 'Galaxy A70', 'Galaxy A71', 'Galaxy A72', 'Galaxy M14',
      'Galaxy M34', 'Galaxy S9', 'Galaxy S9+', 'Galaxy S10', 'Galaxy S10+', 'Galaxy S20',
      'Galaxy S20 FE', 'Galaxy S20 Ultra', 'Galaxy S21', 'Galaxy S21 FE', 'Galaxy S21 Ultra',
      'Galaxy S22', 'Galaxy S22+', 'Galaxy S22 Ultra', 'Galaxy S23', 'Galaxy S23 FE',
      'Galaxy S23 Ultra', 'Galaxy S24', 'Galaxy S24+', 'Galaxy S24 Ultra', 'Galaxy S25',
      'Galaxy S25+', 'Galaxy S25 Ultra', 'Galaxy Note 9', 'Galaxy Note 10', 'Galaxy Note 20',
      'Galaxy Note 20 Ultra', 'Galaxy Z Flip 3', 'Galaxy Z Flip 4', 'Galaxy Z Flip 5',
      'Galaxy Z Flip 6', 'Galaxy Z Fold 3', 'Galaxy Z Fold 4', 'Galaxy Z Fold 5', 'Galaxy Z Fold 6'
    ],
    'Xiaomi': [
      'Redmi 9', 'Redmi 9A', 'Redmi 9C', 'Redmi 10', 'Redmi 10C', 'Redmi 12', 'Redmi 12C',
      'Redmi 13', 'Redmi 13C', 'Redmi 14C', 'Redmi A1', 'Redmi A2', 'Redmi A3', 'Redmi Note 9',
      'Redmi Note 10', 'Redmi Note 10 Pro', 'Redmi Note 11', 'Redmi Note 11 Pro', 'Redmi Note 12',
      'Redmi Note 12 Pro', 'Redmi Note 13', 'Redmi Note 13 Pro', 'Redmi Note 14',
      'Redmi Note 14 Pro', 'Poco M5', 'Poco M6', 'Poco X3', 'Poco X4', 'Poco X5', 'Poco X6',
      'Poco X7', 'Poco F5', 'Poco F6', 'Mi 10', 'Mi 11', 'Mi 11 Lite', 'Xiaomi 12', 'Xiaomi 13',
      'Xiaomi 14', 'Xiaomi 15'
    ],
    'Motorola': [
      'Moto E6', 'Moto E7', 'Moto E13', 'Moto E14', 'Moto G8', 'Moto G9', 'Moto G10', 'Moto G13',
      'Moto G14', 'Moto G22', 'Moto G23', 'Moto G24', 'Moto G34', 'Moto G50', 'Moto G54', 'Moto G60',
      'Moto G73', 'Moto G84', 'Moto G85', 'Moto Edge 30', 'Moto Edge 40', 'Moto Edge 50',
      'Moto One Fusion', 'Moto Razr 40'
    ],
    'Huawei': [
      'Y5', 'Y6', 'Y7', 'Y9', 'Y9 Prime', 'P20', 'P20 Lite', 'P30', 'P30 Lite', 'P40', 'P40 Lite',
      'Mate 20', 'Mate 20 Lite', 'Mate 30', 'Mate 40', 'Nova 5T', 'Nova 9', 'Nova 11', 'Nova 12'
    ],
    'Honor': [
      'Honor 8X', 'Honor 9X', 'Honor 50', 'Honor 70', 'Honor 90', 'Honor X6', 'Honor X7', 'Honor X8',
      'Honor X9', 'Magic 5', 'Magic 6'
    ],
    'Oppo': [
      'A17', 'A38', 'A58', 'A78', 'A79', 'A98', 'Reno 8', 'Reno 10', 'Reno 11', 'Reno 12', 'Find X5',
      'Find X6'
    ],
    'Realme': [
      'C33', 'C35', 'C51', 'C53', 'C55', 'C67', 'Note 50', 'Realme 10', 'Realme 11', 'Realme 12',
      'GT Neo 5'
    ],
    'Google': [
      'Pixel 5', 'Pixel 6', 'Pixel 6a', 'Pixel 7', 'Pixel 7a', 'Pixel 8', 'Pixel 8a', 'Pixel 9',
      'Pixel 9 Pro'
    ],
    'OnePlus': [
      'Nord N20', 'Nord N30', 'Nord CE 3', 'OnePlus 9', 'OnePlus 10 Pro', 'OnePlus 11', 'OnePlus 12'
    ],
    'LG': [
      'K22', 'K40', 'K41S', 'K50', 'K51', 'K61', 'K62', 'Q60', 'Velvet', 'G8 ThinQ'
    ],
    'Nokia': [
      'Nokia 1.4', 'Nokia 2.4', 'Nokia 3.4', 'Nokia 5.4', 'Nokia G11', 'Nokia G21', 'Nokia C21',
      'Nokia C32'
    ],
    'ZTE': [
      'Blade A31', 'Blade A51', 'Blade A53', 'Blade A73', 'Blade V40', 'Nubia Neo'
    ],
    'Tecno': [
      'Spark 10', 'Spark 20', 'Camon 20', 'Pova 5', 'Pop 7'
    ],
    'Infinix': [
      'Hot 30', 'Hot 40', 'Note 30', 'Note 40', 'Smart 8'
    ],
    'Alcatel': [
      '1S', '1B', '3L', '5 Series'
    ],
    'Otra': [],
  },
  'Tablet': {
    'Apple': [
      'iPad 7 (2019)', 'iPad 8 (2020)', 'iPad 9 (2021)', 'iPad 10 (2022)', 'iPad Air 3',
      'iPad Air 4', 'iPad Air 5', 'iPad Air M2', 'iPad Mini 5', 'iPad Mini 6', 'iPad Pro 11"',
      'iPad Pro 12.9"'
    ],
    'Samsung': [
      'Galaxy Tab A7', 'Galaxy Tab A8', 'Galaxy Tab A9', 'Galaxy Tab S6 Lite', 'Galaxy Tab S7',
      'Galaxy Tab S8', 'Galaxy Tab S9', 'Galaxy Tab S10'
    ],
    'Lenovo': [
      'Tab M8', 'Tab M9', 'Tab M10', 'Tab P11', 'Tab P12'
    ],
    'Xiaomi': [
      'Redmi Pad', 'Redmi Pad SE', 'Xiaomi Pad 5', 'Xiaomi Pad 6'
    ],
    'Amazon': [
      'Fire 7', 'Fire HD 8', 'Fire HD 10'
    ],
    'Otra': [],
  },
  'Laptop': {
    'Apple': [
      'MacBook Air 13" (Intel)', 'MacBook Air M1', 'MacBook Air M2', 'MacBook Air M3',
      'MacBook Air M4', 'MacBook Pro 13" (Intel)', 'MacBook Pro 13" M1', 'MacBook Pro 13" M2',
      'MacBook Pro 14" M1 Pro', 'MacBook Pro 14" M2 Pro', 'MacBook Pro 14" M3', 'MacBook Pro 14" M4',
      'MacBook Pro 16" M1 Max', 'MacBook Pro 16" M2 Max', 'MacBook Pro 16" M3', 'MacBook Pro 16" M4'
    ],
    'Dell': [
      'Inspiron 14', 'Inspiron 15', 'Inspiron 16', 'Latitude 3000', 'Latitude 5000', 'Latitude 7000',
      'Vostro 14', 'Vostro 15', 'XPS 13', 'XPS 15', 'XPS 17', 'G15 Gaming', 'Alienware M16'
    ],
    'HP': [
      'Pavilion 14', 'Pavilion 15', 'Pavilion x360', 'Envy 13', 'Envy 15', 'Envy x360',
      'ProBook 440', 'ProBook 450', 'EliteBook 840', 'EliteBook 850', 'Victus 15', 'Victus 16',
      'Omen 16', 'HP 14', 'HP 15', 'Stream 11'
    ],
    'Lenovo': [
      'IdeaPad 1', 'IdeaPad 3', 'IdeaPad 5', 'IdeaPad Slim 3', 'IdeaPad Gaming 3', 'ThinkPad E14',
      'ThinkPad E15', 'ThinkPad T14', 'ThinkPad X1 Carbon', 'ThinkBook 14', 'ThinkBook 15',
      'Legion 5', 'Legion 7', 'Legion Slim 5', 'Yoga 7i', 'Yoga 9i'
    ],
    'Asus': [
      'VivoBook 14', 'VivoBook 15', 'VivoBook S14', 'VivoBook Pro', 'ZenBook 14', 'ZenBook 15',
      'ZenBook Duo', 'ROG Strix G15', 'ROG Zephyrus G14', 'TUF Gaming A15', 'TUF Gaming F15',
      'Chromebook C204'
    ],
    'Acer': [
      'Aspire 3', 'Aspire 5', 'Aspire 7', 'Nitro 5', 'Nitro V15', 'Predator Helios 300', 'Swift 3',
      'Swift Go', 'TravelMate P2', 'Chromebook 314'
    ],
    'MSI': [
      'Modern 14', 'Modern 15', 'Katana 15', 'Thin GF63', 'Stealth 16', 'Raider GE78'
    ],
    'Toshiba': [
      'Satellite C55', 'Satellite L50', 'Tecra A50'
    ],
    'Samsung': [
      'Galaxy Book', 'Galaxy Book 2', 'Galaxy Book 3', 'Notebook 9'
    ],
    'Huawei': [
      'MateBook D14', 'MateBook D15', 'MateBook X Pro'
    ],
    'Otra': [],
  },
  'PC': {
    'Ensamblado': [
      'Torre Gamer', 'Torre Oficina', 'Torre Diseño', 'Torre Servidor', 'Mini PC'
    ],
    'HP': [
      'Pavilion Desktop', 'All-in-One 22', 'All-in-One 24', 'ProDesk 400', 'EliteDesk 800',
      'Omen 25L', 'Slim Desktop'
    ],
    'Dell': [
      'OptiPlex 3000', 'OptiPlex 5000', 'OptiPlex 7000', 'Inspiron Desktop', 'Vostro Desktop',
      'XPS Desktop', 'Alienware Aurora'
    ],
    'Lenovo': [
      'IdeaCentre 3', 'IdeaCentre AIO', 'ThinkCentre M70', 'ThinkCentre M90', 'Legion Tower 5'
    ],
    'Asus': [
      'ExpertCenter', 'ROG Strix GA15', 'Vivo AiO'
    ],
    'Acer': [
      'Aspire TC', 'Veriton', 'Predator Orion'
    ],
    'Apple': [
      'iMac 21.5"', 'iMac 24" M1', 'iMac 24" M3', 'Mac Mini M1', 'Mac Mini M2', 'Mac Mini M4',
      'Mac Studio'
    ],
    'Otra': [],
  },
  'Consola': {
    'Sony (PlayStation)': [
      'PS3', 'PS3 Slim', 'PS4', 'PS4 Slim', 'PS4 Pro', 'PS5', 'PS5 Digital', 'PS5 Slim', 'PS5 Pro',
      'PS Vita', 'PSP'
    ],
    'Microsoft (Xbox)': [
      'Xbox 360', 'Xbox One', 'Xbox One S', 'Xbox One X', 'Xbox Series S', 'Xbox Series X'
    ],
    'Nintendo': [
      'Wii', 'Wii U', 'Switch', 'Switch Lite', 'Switch OLED', 'Switch 2', '3DS', 'New 3DS XL'
    ],
    'Otra': [],
  },
  'Smartwatch': {
    'Apple': [
      'Apple Watch Series 4', 'Apple Watch Series 5', 'Apple Watch Series 6', 'Apple Watch SE',
      'Apple Watch Series 7', 'Apple Watch Series 8', 'Apple Watch Series 9',
      'Apple Watch Series 10', 'Apple Watch Ultra', 'Apple Watch Ultra 2'
    ],
    'Samsung': [
      'Galaxy Watch 4', 'Galaxy Watch 5', 'Galaxy Watch 6', 'Galaxy Watch 7', 'Galaxy Watch Ultra',
      'Galaxy Fit 3'
    ],
    'Xiaomi': [
      'Mi Band 7', 'Mi Band 8', 'Mi Band 9', 'Redmi Watch 3', 'Redmi Watch 4', 'Watch S1'
    ],
    'Huawei': [
      'Watch GT 3', 'Watch GT 4', 'Band 8', 'Band 9'
    ],
    'Amazfit': [
      'Bip 5', 'GTS 4', 'GTR 4', 'T-Rex 3'
    ],
    'Otra': [],
  },
  'Otro equipo': {
    'Otra': [],
  },};

// ---------------------------------------------------------------------
// MEZCLA CON LO QUE SE AGREGÓ DESDE EL PANEL
// ---------------------------------------------------------------------

interface FilaCatalogo {
  categoria: string;
  marca: string;
  modelo: string;
  oculto: boolean;
}

/** Copia honda del base, para no modificarlo nunca por accidente. */
function clonarBase(): Catalogo {
  const salida: Catalogo = {};
  for (const [categoria, marcas] of Object.entries(BASE)) {
    salida[categoria] = {};
    for (const [marca, modelos] of Object.entries(marcas)) {
      salida[categoria][marca] = [...modelos];
    }
  }
  return salida;
}

function mezclar(filas: FilaCatalogo[]): Catalogo {
  const salida = clonarBase();

  for (const fila of filas) {
    const categoria = (fila.categoria || '').trim();
    const marca = (fila.marca || '').trim();
    const modelo = (fila.modelo || '').trim();
    if (!categoria || !marca || !modelo) continue;

    if (fila.oculto) {
      const lista = salida[categoria]?.[marca];
      if (lista) {
        const i = lista.indexOf(modelo);
        if (i >= 0) lista.splice(i, 1);
      }
      continue;
    }

    // Una categoría o una marca nuevas nacen solas al agregar el primer
    // modelo: no hay que darlas de alta aparte.
    if (!salida[categoria]) salida[categoria] = {};
    if (!salida[categoria][marca]) salida[categoria][marca] = [];
    if (!salida[categoria][marca].includes(modelo)) {
      salida[categoria][marca].push(modelo);
    }
  }

  // Orden alfabético dentro de cada marca, para que lo agregado a mano no
  // quede siempre pegado al final y cueste encontrarlo.
  for (const marcas of Object.values(salida)) {
    for (const modelos of Object.values(marcas)) {
      modelos.sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
    }
  }

  return salida;
}

// Se guarda en memoria para no consultar la base cada vez que se abre el
// formulario de recepción. `recargarCatalogo()` la vacía.
let cacheCatalogo: Catalogo | null = null;
let cargaEnCurso: Promise<Catalogo> | null = null;

/**
 * Devuelve el catálogo completo. Nunca lanza y nunca devuelve vacío: ante
 * cualquier fallo entrega el catálogo base, que es suficiente para
 * trabajar.
 */
export async function cargarCatalogo(): Promise<Catalogo> {
  if (cacheCatalogo) return cacheCatalogo;
  if (cargaEnCurso) return cargaEnCurso;

  cargaEnCurso = (async () => {
    try {
      const { data, error } = await supabase
        .from('device_catalog')
        .select('categoria, marca, modelo, oculto');
      if (error) throw error;
      cacheCatalogo = mezclar((data as FilaCatalogo[]) || []);
    } catch {
      // Sin conexión o tabla inaccesible: se trabaja con el base.
      cacheCatalogo = clonarBase();
    } finally {
      cargaEnCurso = null;
    }
    return cacheCatalogo as Catalogo;
  })();

  return cargaEnCurso;
}

/** El catálogo base, sin consultar nada. Para el primer render. */
export function catalogoBase(): Catalogo {
  return clonarBase();
}

export function recargarCatalogo(): void {
  cacheCatalogo = null;
}

// ---------------------------------------------------------------------
// CONSULTAS
// ---------------------------------------------------------------------

export function categoriasDe(catalogo: Catalogo): string[] {
  return Object.keys(catalogo).sort((a, b) => a.localeCompare(b, 'es'));
}

/** Marcas de una categoría, con "Otra" siempre al final. */
export function marcasDe(catalogo: Catalogo, categoria: string): string[] {
  const marcas = Object.keys(catalogo[categoria] || {})
    .filter(m => m !== MARCA_OTRA)
    .sort((a, b) => a.localeCompare(b, 'es'));
  return [...marcas, MARCA_OTRA];
}

/**
 * Modelos de una combinación, con "Otro" siempre al final.
 *
 * Que "Otro" esté siempre es lo que garantiza que ningún equipo se quede
 * sin poder recibirse por no estar en la lista.
 */
export function modelosDe(catalogo: Catalogo, categoria: string, marca: string): string[] {
  const modelos = (catalogo[categoria]?.[marca] || []).filter(m => m !== OPCION_OTRO);
  return [...modelos, OPCION_OTRO];
}

// ---------------------------------------------------------------------
// EDICIÓN DESDE EL PANEL
// ---------------------------------------------------------------------

/**
 * Agrega un modelo al catálogo. Devuelve un mensaje de error o null si
 * todo salió bien.
 *
 * Se apoya en el índice único (categoria, marca, modelo) de la tabla:
 * si el modelo ya existe, `upsert` lo deja como está en vez de duplicarlo.
 */
export async function agregarModelo(
  categoria: string,
  marca: string,
  modelo: string,
  creadoPor?: string
): Promise<string | null> {
  const c = (categoria || '').trim();
  const ma = (marca || '').trim();
  const mo = (modelo || '').trim();

  if (!c || !ma || !mo) return 'Faltan datos: categoría, marca y modelo son obligatorios.';
  if (mo.toLowerCase() === OPCION_OTRO.toLowerCase()) {
    return '"Otro" ya está disponible en todas las listas; no hace falta agregarlo.';
  }
  if (mo.length > 80) return 'El nombre del modelo es demasiado largo.';

  const { error } = await supabase
    .from('device_catalog')
    .upsert(
      { categoria: c, marca: ma, modelo: mo, oculto: false, creado_por: creadoPor || null },
      { onConflict: 'categoria,marca,modelo' }
    );
  if (error) return error.message;

  recargarCatalogo();
  return null;
}

/**
 * Esconde un modelo de las listas. No borra nada: las órdenes de
 * reparación que ya lo usan conservan su texto tal cual, porque el modelo
 * se guarda como texto en la orden, no como una referencia.
 */
export async function ocultarModelo(
  categoria: string,
  marca: string,
  modelo: string,
  creadoPor?: string
): Promise<string | null> {
  const { error } = await supabase
    .from('device_catalog')
    .upsert(
      { categoria, marca, modelo, oculto: true, creado_por: creadoPor || null },
      { onConflict: 'categoria,marca,modelo' }
    );
  if (error) return error.message;

  recargarCatalogo();
  return null;
}

/** Vuelve a mostrar un modelo escondido. */
export async function mostrarModelo(
  categoria: string,
  marca: string,
  modelo: string
): Promise<string | null> {
  const { error } = await supabase
    .from('device_catalog')
    .update({ oculto: false })
    .match({ categoria, marca, modelo });
  if (error) return error.message;

  recargarCatalogo();
  return null;
}

/** Cuántos modelos tiene el catálogo en total. Para mostrarlo en el panel. */
export function contarModelos(catalogo: Catalogo): number {
  let total = 0;
  for (const marcas of Object.values(catalogo)) {
    for (const modelos of Object.values(marcas)) total += modelos.length;
  }
  return total;
}
