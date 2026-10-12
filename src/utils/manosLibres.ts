// =====================================================================
// MANOS LIBRES — las reglas de la conversación continua
// =====================================================================
// · Cuándo lo que dijiste es una despedida («gracias, Phill», «eso es
//   todo»): Phill contesta y sale del modo, sin que toqués nada.
// · El saludo con que Phill abre la conversación (instantáneo, sin gastar
//   IA): hora del día, tu nombre y los avisos que tenés sin ver.
// · Qué tan rápido da por terminado lo que decís (la pausa de silencio) y
//   la frase corta con que Phill llena la espera si está consultando algo.
// Lógica pura: se prueba sin micrófono.
// =====================================================================

/** Una despedida COMPLETA y corta. «Gracias, ¿y las ventas?» no cuenta. */
const DESPEDIDA = /^\W*(?:(?:ok|okay|listo|bueno|perfecto|muy bien|excelente|vale)\W+)?(?:(?:muchas |mil )?gracias|chao|chau|adi[oó]s|hasta luego|hasta ma[nñ]ana|eso es todo|es todo|nada m[aá]s|terminamos)(?:\W+(?:jarvis|phill?|fil|por hoy|por ahora|eso es todo|es todo|nos vemos|por favor))*\W*$/i;

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

// ------------------------- ritmo de la conversación -------------------------
/** Cuánto silencio, después de hablar, cuenta como «terminé». */
export type PausaVoz = 'corta' | 'normal' | 'larga';
export const PAUSAS_MS: Record<PausaVoz, number> = { corta: 900, normal: 1200, larga: 1800 };
export const PAUSAS: { id: PausaVoz; nombre: string; ayuda: string }[] = [
  { id: 'corta', nombre: 'Corta', ayuda: 'Contesta casi al instante; si hacés pausas para pensar, te puede cortar.' },
  { id: 'normal', nombre: 'Normal', ayuda: 'Espera un segundo y poquito antes de contestar.' },
  { id: 'larga', nombre: 'Larga', ayuda: 'Te deja pensar con calma antes de contestar.' },
];
const CLAVE_PAUSA = 'tv_voz_pausa';
export function pausaElegida(): PausaVoz {
  try { const v = localStorage.getItem(CLAVE_PAUSA); return v === 'corta' || v === 'larga' ? v : 'normal'; } catch { return 'normal'; }
}
export function fijarPausa(p: PausaVoz): void { try { localStorage.setItem(CLAVE_PAUSA, p); } catch { /* sin almacenamiento */ } }

/** Cuánto espera Phill, consultando, antes de decir algo corto para que no haya silencio muerto. */
export const ESPERA_RELLENO_MS = 2600;
const RELLENOS = ['Un momento.', 'Lo reviso.', 'Ya lo miro.', 'Dame un segundo.'];
let turnoRelleno = 0;
export function fraseRelleno(): string { return RELLENOS[turnoRelleno++ % RELLENOS.length]; }
