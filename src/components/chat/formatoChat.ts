// =====================================================================
// FORMATO DE FECHAS DEL CHAT
// =====================================================================
// Compartido entre el hilo del panel (ChatThread) y el de la tienda
// (LiveChat) a propósito. Las dos pantallas muestran la MISMA
// conversación desde los dos lados: si una dijera "Ayer" y la otra
// "12 de agosto" para el mismo mensaje, sería confuso al compararlas —
// y con la lógica duplicada eso pasa en cuanto alguien toque una sola.
// =====================================================================

/**
 * Etiqueta del separador de día: "Hoy", "Ayer" o la fecha escrita.
 *
 * Sin separadores, un hilo de varias semanas es una tira continua donde
 * la hora sola engaña: "9:40" puede ser de esta mañana o del martes
 * pasado, y no hay forma de distinguirlo.
 */
// Locale fijo, no el del navegador. "Hoy" y "Ayer" están escritos en
// español aquí mismo: si la fecha larga se dejara al idioma del dispositivo,
// un teléfono en inglés mezclaría "Ayer" con "August 25" en la misma tira de
// separadores. La tienda es de Costa Rica y el resto de la interfaz está en
// español, así que las fechas también.
const LOCALE = 'es-CR';

export function etiquetaDeDia(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hoy = new Date();
  const ayer = new Date();
  ayer.setDate(hoy.getDate() - 1);
  const mismoDia = (a: Date, b: Date) =>
    a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  if (mismoDia(d, hoy)) return 'Hoy';
  if (mismoDia(d, ayer)) return 'Ayer';
  return d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'long' });
}

/**
 * ¿Este mensaje abre un día distinto del anterior?
 *
 * Se compara por ETIQUETA y no por fecha cruda: así el corte cae
 * exactamente donde el separador va a cambiar de texto, sin casos raros
 * en el salto de "Ayer" a una fecha con nombre.
 */
export function abreDiaNuevo(actual: string, anterior?: string): boolean {
  if (!anterior) return true;
  return etiquetaDeDia(actual) !== etiquetaDeDia(anterior);
}

/**
 * Compacta el meridiano.
 *
 * `es-CR` lo escribe "a. m.", con espacios adentro (y uno de ellos es un
 * espacio fino especial). Dentro de una burbuja, en cuerpo pequeño y pegado
 * al texto del mensaje, esos espacios parten la hora en tres pedazos y se
 * lee como un error de formato, no como una hora.
 */
function compactarMeridiano(hora: string): string {
  return hora
    .replace(/\s*a\.\s*m\./i, ' a.m.')
    .replace(/\s*p\.\s*m\./i, ' p.m.');
}

/**
 * Solo la hora, que es lo que va dentro de la burbuja.
 *
 * Sin cero a la izquierda: "8:40" y no "08:40". El cero solo suma un
 * caracter que nadie lee y desalinea la hora respecto al texto.
 */
export function soloHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return compactarMeridiano(d.toLocaleTimeString(LOCALE, { hour: 'numeric', minute: '2-digit' }));
}

/**
 * Sello de la lista de conversaciones: la hora si el último mensaje es de
 * hoy, y el día si no.
 *
 * En una bandeja, la hora sola de un mensaje de la semana pasada no dice
 * nada; el día sí. Y para lo de hoy pasa al revés: "Hoy" sobra cuando lo
 * que se quiere saber es si fue hace diez minutos o esta madrugada.
 */
export function selloDeLista(iso: string): string {
  const etiqueta = etiquetaDeDia(iso);
  if (!etiqueta) return '';
  return etiqueta === 'Hoy' ? soloHora(iso) : etiqueta;
}

// ---------------------------------------------------------------------
// PRESENCIA DEL VISITANTE (ver chat_visitante_presente en la BD)
// ---------------------------------------------------------------------
// El visitante avisa cada 20 s mientras tiene el chat abierto. Si el último
// aviso tiene menos de un minuto, está en línea; si no, se muestra hace
// cuánto se fue.
const EN_LINEA_MS = 60_000;

export function estaEnLinea(iso?: string, ahora = Date.now()): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && ahora - t < EN_LINEA_MS;
}

/** "hace 5 min", "hace 2 h", "ayer"… */
export function haceCuanto(iso?: string, ahora = Date.now()): string | null {
  if (!iso) return null;
  const ms = ahora - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'ayer' : `hace ${d} días`;
}

/**
 * Inicial para el avatar de un nombre, bien hecha.
 *
 * `charAt(0)` parte en dos los caracteres fuera del plano básico: un nombre
 * escrito con letras "decoradas" (𝐌𝐚𝐫𝐢𝐚𝐧, muy común en redes) daba media
 * letra y el avatar mostraba un símbolo roto. Se toma el primer carácter
 * COMPLETO y se normaliza (NFKC convierte 𝐌 en M).
 */
export function inicialDe(nombre?: string | null): string {
  const limpio = (nombre || '').normalize('NFKC').trim();
  const primero = Array.from(limpio)[0];
  return primero ? primero.toUpperCase() : '?';
}

/** Nombre legible: las letras decoradas se muestran como texto normal. */
export function nombreLegible(nombre?: string | null): string {
  return (nombre || '').normalize('NFKC').trim();
}

const COLORES_AVATAR = ['#2F7D63', '#6D5BD0', '#C07A1E', '#2B6CB0', '#B83280', '#2C7A7B'];
/** Color estable por conversación (el mismo cliente, siempre el mismo color). */
export function colorDe(clave: string): string {
  let h = 0;
  for (const ch of clave) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORES_AVATAR[h % COLORES_AVATAR.length];
}
