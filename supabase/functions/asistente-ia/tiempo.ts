// =====================================================================
// LA HORA Y LAS CUENTAS DE TIEMPO, HECHAS POR EL CÓDIGO
// =====================================================================
// Los modelos de lenguaje calculan mal el tiempo: Javier dijo «04:22» (sin
// hora en el prompt) y después «quedan 19 h 38 min para que termine el día»
// cuando eran las 2:55 p. m. (faltaban 9 h 5 min). Aquí se calcula todo en
// código, en hora de Costa Rica, y dos cosas se usan:
//  · `datosDeTiempo()`: líneas ya calculadas para el prompt (el modelo copia, no calcula).
//  · `respuestaDeTiempo(texto)`: si la pregunta es SOLO de hora, día o «cuánto falta para que
//    termine el día», se contesta sin IA (más rápido y exacto).
// =====================================================================

const ZONA = 'America/Costa_Rica';

export interface PartesTiempo { h: number; m: number; s: number; diaSemana: string; fechaLarga: string; hora12: string }

export function partesCR(ahora = new Date()): PartesTiempo {
  const f = new Intl.DateTimeFormat('es-CR', { timeZone: ZONA, hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false });
  const p = Object.fromEntries(f.formatToParts(ahora).map(x => [x.type, x.value]));
  const h = Number(p.hour) % 24, m = Number(p.minute), s = Number(p.second);
  return {
    h, m, s,
    diaSemana: new Intl.DateTimeFormat('es-CR', { timeZone: ZONA, weekday: 'long' }).format(ahora),
    fechaLarga: new Intl.DateTimeFormat('es-CR', { timeZone: ZONA, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(ahora),
    hora12: new Intl.DateTimeFormat('es-CR', { timeZone: ZONA, hour: 'numeric', minute: '2-digit', hour12: true }).format(ahora),
  };
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
/** «9 horas y 5 minutos». */
export function duracion(minutos: number): string {
  const h = Math.floor(minutos / 60), m = minutos % 60;
  if (h && m) return `${plural(h, 'hora', 'horas')} y ${plural(m, 'minuto', 'minutos')}`;
  if (h) return plural(h, 'hora', 'horas');
  return plural(m, 'minuto', 'minutos');
}

/** Minutos que faltan para las 12 de la noche (el día termina a medianoche). */
export function minutosParaMedianoche(t: PartesTiempo): number {
  return 24 * 60 - (t.h * 60 + t.m) - (t.s > 0 ? 1 : 0);
}

/** Líneas ya calculadas para el prompt: el modelo las copia, no hace cuentas. */
export function datosDeTiempo(ahora = new Date()): string {
  const t = partesCR(ahora);
  const falta = minutosParaMedianoche(t);
  return `AHORA: ${t.fechaLarga}, ${t.hora12} (hora de Costa Rica). Para que termine el día (medianoche) faltan ${duracion(falta)}. Estos datos están calculados: si preguntan la hora, el día, la fecha o cuánto falta para que termine el día, copiá ESTOS valores; no hagas cuentas de tiempo de cabeza ni uses horas de mensajes anteriores.`;
}

// Palabras de otros temas: «cuántas horas faltan para entregar la orden» NO es de este reloj.
const OTRO_TEMA = /\b(orden(es)?|taller|entrega\w*|cliente|pedido|reparaci[oó]n|garant[ií]a|turno|cita|reuni[oó]n|alarma|temporizador|agenda|pendiente|trabajo|sueldo|pago|factura|vuelo|bus|partido)\b/;
const norm = (t: string) => t.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[¿?¡!.,;:]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Si el mensaje es solo de hora, día o fin del día, la respuesta (sin IA). Si no, null.
 * Conservadora a propósito: ante la duda deja que conteste el modelo (que igual recibe los datos).
 */
export function respuestaDeTiempo(texto: string, ahora = new Date()): string | null {
  const q = norm(texto).replace(/^(oye|hola|ey|javier|phill|dime|decime|por favor|porfa|ya|a ver)\s+/g, '').replace(/^(javier|phill)\s+/, '');
  if (!q || q.length > 70 || OTRO_TEMA.test(q)) return null;
  const t = partesCR(ahora);
  if (/\bque hora (es|son|tenemos)\b|\bhora (es|son) (ahora|ya|actual)\b|\bla hora (actual|exacta)\b|\bme (decis|dices|das|dec[ií]s) la hora\b|^la hora$|\bcuantas son\b|\bhora actual\b/.test(q)) {
    const h12 = t.h % 12 === 0 ? 12 : t.h % 12;
    const m = String(t.m).padStart(2, '0');
    const sufijo = t.h < 12 ? 'a. m.' : 'p. m.';
    // «sufijo» ya termina en punto («p. m.»).
    return `${h12 === 1 ? 'Es la' : 'Son las'} ${h12}:${m} ${sufijo}`;
  }
  if (/\bque dia (es|son|estamos)\b|\ba (cuantos|que fecha) estamos\b|\bque fecha (es|tenemos)\b|\bfecha de hoy\b|\bque dia de la semana\b/.test(q)) {
    return `Hoy es ${t.fechaLarga}.`;
  }
  // «¿Cuántas horas quedan todavía?», «cuánto falta para que termine el día», «cuántas horas tiene el día todavía».
  const horas = /\bhoras?\b/.test(q), pide = /\b(quedan?|faltan?|falta|todavia|aun)\b/.test(q);
  const fin = /\b(termine|acabe|termina|acaba|fin|final)\b.*\bdia\b|\bmedianoche\b|\blas 12\b|\bdoce de la noche\b|\bque (se )?acabe\b/.test(q);
  if ((horas && pide) || (pide && fin) || /\bcuanto (tiempo )?(queda|falta) (de|del|para que (termine|acabe)) (hoy|el dia)\b/.test(q)) {
    const falta = minutosParaMedianoche(t);
    return falta <= 0 ? `Falta menos de un minuto para que termine el día (son las ${t.hora12}).` : `Faltan ${duracion(falta)} para que termine el día (son las ${t.hora12}).`;
  }
  return null;
}
