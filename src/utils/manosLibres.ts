// =====================================================================
// MANOS LIBRES — las reglas de la conversación continua
// =====================================================================
// · Cuándo lo que dijiste es una despedida («gracias, Jarvis», «eso es
//   todo»): Jarvis contesta y sale del modo, sin que toqués nada.
// · El saludo con que Jarvis abre la conversación (instantáneo, sin gastar
//   IA): hora del día, tu nombre y los avisos que tenés sin ver.
// Lógica pura: se prueba sin micrófono.
// =====================================================================

/** Una despedida COMPLETA y corta. «Gracias, ¿y las ventas?» no cuenta. */
const DESPEDIDA = /^\W*(?:(?:ok|okay|listo|bueno|perfecto|muy bien|excelente|vale)\W+)?(?:(?:muchas |mil )?gracias|chao|chau|adi[oó]s|hasta luego|hasta ma[nñ]ana|eso es todo|es todo|nada m[aá]s|terminamos)(?:\W+(?:jarvis|por hoy|por ahora|eso es todo|es todo|nos vemos|por favor))*\W*$/i;

export function esDespedida(dicho: string): boolean {
  const t = String(dicho || '').trim();
  return t.length > 0 && t.length <= 60 && DESPEDIDA.test(t);
}

/** «Buenas tardes, Jorge. Tenés 2 avisos sin ver. Te escucho.» */
export function saludoManos(nombre?: string | null, avisos = 0, ahora = new Date()): string {
  const h = Number(new Intl.DateTimeFormat('es-CR', { hour: 'numeric', hour12: false, timeZone: 'America/Costa_Rica' }).format(ahora)) % 24;
  const sal = h >= 5 && h < 12 ? 'Buenos días' : h >= 12 && h < 19 ? 'Buenas tardes' : 'Buenas noches';
  const n = String(nombre || '').trim().split(/\s+/)[0];
  const partes = [`${sal}${n ? `, ${n}` : ''}.`];
  if (avisos > 0) partes.push(`Tenés ${avisos} aviso${avisos === 1 ? '' : 's'} sin ver.`);
  partes.push('Te escucho.');
  return partes.join(' ');
}
