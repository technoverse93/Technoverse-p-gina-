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
