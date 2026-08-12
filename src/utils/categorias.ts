// =====================================================================
// CATEGORÍAS DE PRODUCTO — UNA SOLA FUENTE DE VERDAD
// =====================================================================
// FALLO QUE ESTO CORRIGE
// ---------------------------------------------------------------------
// Había DOS listas de categorías, en dos archivos distintos, que no se
// parecían en nada:
//
//   · La tienda (PublicStore) ofrecía: Dispositivos, Estuches,
//     Cargadores, Audio.
//   · El inventario guardaba: Fundas, Cables, Protectores, Teclados,
//     Mouse, Audífonos, Otros.
//
// Entre las dos había una tabla de traducción escrita a mano. Funcionaba
// para algunas —"Mouse" salía bajo Dispositivos— pero "Otros" no
// correspondía a NINGUNA categoría de la tienda. Y ahí estaban 2 de los 3
// productos del catálogo: el cliente los veía en "Todos" y desaparecían
// en cuanto tocaba cualquier filtro.
//
// Desde aquí las dos pantallas leen la MISMA lista. Al dar de alta un
// producto solo se puede escoger una categoría que la tienda sepa
// mostrar, así que el problema no puede volver a aparecer.
//
// ---------------------------------------------------------------------
// POR QUÉ SE CONSERVA LA TRADUCCIÓN DE LOS NOMBRES VIEJOS
// ---------------------------------------------------------------------
// En la base ya hay productos guardados con los nombres antiguos. Si esta
// lista simplemente los ignorara, esos productos desaparecerían del
// catálogo el día del cambio. `normalizarCategoria()` los traduce al
// vuelo, así que siguen viéndose sin tener que tocar la base de datos ni
// arriesgar los datos que ya existen.
// =====================================================================

/** Repuestos: nunca se muestran en el catálogo público. */
export const CATEGORIAS_REPUESTO = [
  'LCD', 'Batería', 'Rack de Carga', 'Tapa', 'Desbloqueo', 'Flex', 'Conector', 'Otra',
];

/**
 * Insumos: artículos pequeños que se consumen en el trabajo o se
 * entregan como regalía. Tampoco se muestran en el catálogo público.
 *
 * ---------------------------------------------------------------------
 * POR QUÉ ESTOS NOMBRES Y NO "Estuches" O "Cargadores"
 * ---------------------------------------------------------------------
 * Son deliberadamente DISTINTOS de los de CATEGORIAS_TIENDA, y de los
 * que traduce EQUIVALENCIAS más abajo. Si un insumo se llamara
 * "Estuche", `normalizarCategoria()` lo convertiría en "Estuches" —una
 * categoría de la tienda— y ese insumo aparecería a la venta en el
 * catálogo público al precio de costo. El mismo choque ocurriría con
 * "Cable" (→ Cargadores) o "Audífono" (→ Audio).
 *
 * De ahí el sufijo "de taller": deja claro para qué es y garantiza que
 * ninguna traducción lo empuje al escaparate.
 */
export const CATEGORIAS_INSUMO = [
  'Temperado',
  'Mica',
  'Estuche de taller',
  'Cable de taller',
  'Adaptador',
  'Limpieza',
  'Empaque',
  'Otro insumo',
];

/**
 * Las categorías reales del catálogo. Esta es la lista que ve el cliente
 * y la única entre las que se puede escoger al ingresar stock.
 *
 * "Accesorios" existe a propósito: es el destino de lo que antes caía en
 * "Otros". Sin ella, cualquier producto que no encaje en las otras cuatro
 * quedaría otra vez invisible bajo los filtros — que es justo el fallo
 * que se está corrigiendo.
 */
export const CATEGORIAS_TIENDA = [
  'Dispositivos',
  'Estuches',
  'Cargadores',
  'Audio',
  'Accesorios',
] as const;

export type CategoriaTienda = typeof CATEGORIAS_TIENDA[number];

/** Con "Todos" al frente: para las barras de filtro. */
export const CATEGORIAS_CON_TODOS = ['Todos', ...CATEGORIAS_TIENDA];

// ---------------------------------------------------------------------
// Traducción de los nombres antiguos
// ---------------------------------------------------------------------
const EQUIVALENCIAS: Record<string, CategoriaTienda> = {
  // → Estuches
  'fundas': 'Estuches',
  'funda': 'Estuches',
  'protectores': 'Estuches',
  'protector': 'Estuches',
  'estuches': 'Estuches',
  'estuche': 'Estuches',
  'carcasas': 'Estuches',
  // → Cargadores
  'cables': 'Cargadores',
  'cable': 'Cargadores',
  'cargador': 'Cargadores',
  'cargadores': 'Cargadores',
  'power bank': 'Cargadores',
  // → Audio
  'audífonos': 'Audio',
  'audifonos': 'Audio',
  'parlantes': 'Audio',
  'audio': 'Audio',
  // → Dispositivos
  'teclados': 'Dispositivos',
  'teclado': 'Dispositivos',
  'mouse': 'Dispositivos',
  'dispositivos': 'Dispositivos',
  'celulares': 'Dispositivos',
  'laptops': 'Dispositivos',
  // → Accesorios (el antiguo cajón de sastre)
  'otros': 'Accesorios',
  'otro': 'Accesorios',
  'accesorios': 'Accesorios',
  'varios': 'Accesorios',
};

/**
 * Devuelve la categoría de tienda que le corresponde a un producto,
 * traduzca o no de un nombre antiguo.
 *
 * Nunca devuelve null: lo que no reconoce cae en "Accesorios". Es
 * deliberado — es preferible que un producto salga en una categoría poco
 * precisa a que no salga en ninguna y el cliente no pueda encontrarlo.
 */
export function normalizarCategoria(categoria?: string | null): CategoriaTienda {
  const limpia = (categoria || '').trim().toLowerCase();
  if (!limpia) return 'Accesorios';

  const exacta = EQUIVALENCIAS[limpia];
  if (exacta) return exacta;

  // Coincidencia parcial, por si viene algo como "Fundas de silicón".
  for (const [clave, destino] of Object.entries(EQUIVALENCIAS)) {
    if (limpia.includes(clave)) return destino;
  }

  return 'Accesorios';
}

/** ¿Este producto entra en la categoría que el cliente escogió? */
export function coincideCategoria(categoriaProducto: string, categoriaTienda: string): boolean {
  if (!categoriaTienda || categoriaTienda === 'Todos') return true;
  return normalizarCategoria(categoriaProducto) === categoriaTienda;
}

/** ¿Es un repuesto de taller y por lo tanto NO va al catálogo público? */
export function esRepuesto(categoria?: string | null): boolean {
  return CATEGORIAS_REPUESTO.includes((categoria || '').trim());
}

/** ¿Es un insumo de taller? */
export function esInsumo(categoria?: string | null): boolean {
  return CATEGORIAS_INSUMO.includes((categoria || '').trim());
}

/**
 * ¿Es material de uso interno —repuesto o insumo— y por tanto NO debe
 * verse en la tienda?
 *
 * Existe para que la exclusión del catálogo se pregunte en UN solo sitio.
 * Cuando solo había repuestos, la tienda preguntaba `esRepuesto()`
 * directamente; al añadir los insumos, ese mismo filtro habría dejado
 * los temperados y las micas a la venta al precio de costo, junto a los
 * teléfonos. Con esta función, añadir una tercera familia mañana no
 * obliga a acordarse de tocar la tienda.
 */
export function esInterno(categoria?: string | null): boolean {
  return esRepuesto(categoria) || esInsumo(categoria);
}
