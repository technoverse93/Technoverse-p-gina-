// =====================================================================
// TELÉFONO — lo que Phill le pide al celular del dueño
// =====================================================================
// Alarmas, temporizadores, abrir apps, llamar, WhatsApp, SMS, calendario,
// mapas, música, linterna, ajustes y enlaces. La función NO hace nada en el
// teléfono: valida y normaliza el pedido y se lo manda a la app (evento
// «telefono»), que lo ejecuta en el aparato (src/utils/telefono.ts y el
// complemento nativo native-android/telefono/).
//
// PRIVACIDAD: los números de teléfono nunca llegan a la IA (el carril
// privado los cambia por marcas como [TEL·1]). Para llamar o escribir se
// pasa el NOMBRE del contacto: la app lo busca en los contactos del teléfono.
// =====================================================================

export type AccionTelefono =
  | 'alarma' | 'temporizador' | 'abrir_app' | 'llamar' | 'whatsapp' | 'sms'
  | 'calendario' | 'mapa' | 'musica' | 'linterna' | 'ajustes' | 'enlace';

export const ACCIONES_TELEFONO: AccionTelefono[] = ['alarma', 'temporizador', 'abrir_app', 'llamar', 'whatsapp', 'sms', 'calendario', 'mapa', 'musica', 'linterna', 'ajustes', 'enlace'];
export const PANTALLAS_AJUSTES = ['wifi', 'bluetooth', 'sonido', 'pantalla', 'bateria', 'aplicaciones', 'ubicacion', 'general'] as const;

/** Estas solo se pueden en la app del teléfono (en el navegador no hay cómo). */
export const SOLO_APK: AccionTelefono[] = ['alarma', 'temporizador', 'abrir_app', 'musica', 'linterna', 'ajustes'];

export interface PedidoTelefono {
  id: string;
  accion: AccionTelefono;
  /** Cómo se lo cuenta a quien mira la tarjeta (sin números de teléfono). */
  titulo: string;
  datos: Record<string, unknown>;
}
export type ResultadoPedido = { ok: true; pedido: PedidoTelefono } | { ok: false; error: string };

const texto = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const numero = (v: unknown): number | null => {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

const DIAS: Record<string, number> = { // Calendar.SUNDAY = 1 … SATURDAY = 7
  domingo: 1, dom: 1, lunes: 2, lun: 2, martes: 3, mar: 3, miercoles: 4, mie: 4, jueves: 5, jue: 5, viernes: 6, vie: 6, sabado: 7, sab: 7,
};
const NOMBRE_DIA = ['', 'dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** «6:30», «06:30», «18:30», «6:30 pm», «6 pm», «seis y media» no (eso lo convierte la IA). */
export function leerHora(v: unknown): { h: number; m: number } | null {
  const t = sinTildes(String(v ?? '')).replace(/\./g, '').trim();
  const r = /^(\d{1,2})(?:[:h](\d{2}))?\s*(am|pm|a m|p m)?$/.exec(t);
  if (!r) return null;
  let h = Number(r[1]); const m = r[2] ? Number(r[2]) : 0;
  const ap = r[3]?.replace(/\s/g, '');
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 23 || m > 59) return null;
  return { h, m };
}
/** «6:30 a. m.», «12:05 p. m.». */
export function horaBonita(h: number, m: number): string {
  const ap = h < 12 ? 'a. m.' : 'p. m.';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ap}`;
}

/** Días de la semana (números de Calendar) a partir de lo que dijo la IA. */
export function leerDias(v: unknown): number[] {
  const out = new Set<number>();
  const crudo = (Array.isArray(v) ? v.join(',') : typeof v === 'string' ? v : '');
  let k = sinTildes(crudo);
  // Frases de varias palabras, antes de partir por comas y «y».
  if (/\b(todos los dias|todos|diario|a diario|cada dia)\b/.test(k)) for (let d = 1; d <= 7; d++) out.add(d);
  if (/\b(entre semana|laborales|dias habiles)\b/.test(k)) for (let d = 2; d <= 6; d++) out.add(d);
  if (/\b(fin de semana|fines de semana|finde)\b/.test(k)) { out.add(1); out.add(7); }
  k = k.replace(/todos los dias|entre semana|fin(es)? de semana|dias habiles/g, ' ');
  for (const x of k.split(/[,;\s]+|\by\b/)) { const d = DIAS[x.trim()]; if (d) out.add(d); }
  return [...out].sort((a, b) => a - b);
}

/** «10 min», «1 h 30 min», «45 s». */
export function duracionBonita(seg: number): string {
  const h = Math.floor(seg / 3600), m = Math.floor((seg % 3600) / 60), s = seg % 60;
  const partes = [h ? `${h} h` : '', m ? `${m} min` : '', s ? `${s} s` : ''].filter(Boolean);
  return partes.join(' ') || '0 s';
}

/** «2026-10-14T15:00», «2026-10-14 15:00» (hora de Costa Rica) o solo la fecha. */
export function leerFechaHora(v: unknown): { ms: number; soloFecha: boolean } | null {
  const t = String(v ?? '').trim();
  const r = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{1,2}):(\d{2}))?$/.exec(t);
  if (!r) return null;
  const [, a, mes, d, hh, mm] = r;
  const ms = Date.parse(`${a}-${mes}-${d}T${String(hh ?? '00').padStart(2, '0')}:${mm ?? '00'}:00-06:00`);
  return Number.isFinite(ms) ? { ms, soloFecha: hh === undefined } : null;
}
const fechaBonita = (ms: number, soloFecha: boolean) => new Intl.DateTimeFormat('es-CR', {
  weekday: 'short', day: 'numeric', month: 'short', ...(soloFecha ? {} : { hour: 'numeric', minute: '2-digit', hour12: true }), timeZone: 'America/Costa_Rica',
}).format(new Date(ms));

/** Un número para marcar: marca del carril privado (se queda tal cual) o dígitos. */
export function leerNumero(v: unknown): string | null {
  const t = String(v ?? '').trim();
  if (/^\[[A-ZÉ]+·\d+\]$/.test(t)) return t;
  const d = t.replace(/[^\d+]/g, '');
  const digitos = d.replace(/\D/g, '');
  return digitos.length >= 7 && digitos.length <= 15 ? (d.startsWith('+') ? `+${digitos}` : digitos) : null;
}

/** Valida y normaliza lo que pidió la IA. */
export function prepararTelefono(args: Record<string, unknown>, id: string): ResultadoPedido {
  const accion = String(args?.accion ?? '') as AccionTelefono;
  if (!ACCIONES_TELEFONO.includes(accion)) return { ok: false, error: `Acción desconocida. Las que hago: ${ACCIONES_TELEFONO.join(', ')}.` };
  const pedido = (titulo: string, datos: Record<string, unknown>): ResultadoPedido => ({ ok: true, pedido: { id, accion, titulo, datos } });
  const quien = () => {
    const contacto = texto(args?.contacto, 60);
    const num = leerNumero(args?.numero);
    return { contacto, num };
  };

  switch (accion) {
    case 'alarma': {
      const hora = leerHora(args?.hora);
      if (!hora) return { ok: false, error: 'No entendí la hora de la alarma. Preguntale a qué hora y pasala como 06:30 o 18:30.' };
      const dias = leerDias(args?.dias);
      const etiqueta = texto(args?.etiqueta, 60);
      const cuando = `${horaBonita(hora.h, hora.m)}${dias.length === 7 ? ', todos los días' : dias.length ? ` (${dias.map(d => NOMBRE_DIA[d]).join(', ')})` : ''}`;
      return pedido(`Alarma a las ${cuando}${etiqueta ? ` · ${etiqueta}` : ''}`, { hora: hora.h, minutos: hora.m, dias, etiqueta });
    }
    case 'temporizador': {
      const seg = Math.round((numero(args?.horas) ?? 0) * 3600 + (numero(args?.minutos) ?? 0) * 60 + (numero(args?.segundos) ?? 0));
      if (!(seg >= 1)) return { ok: false, error: 'No entendí cuánto dura el temporizador. Preguntale cuántos minutos.' };
      if (seg > 86400) return { ok: false, error: 'Un temporizador no puede pasar de 24 horas.' };
      const etiqueta = texto(args?.etiqueta, 60);
      return pedido(`Temporizador de ${duracionBonita(seg)}${etiqueta ? ` · ${etiqueta}` : ''}`, { segundos: seg, etiqueta });
    }
    case 'abrir_app': {
      const app = texto(args?.app, 40);
      if (app.length < 2) return { ok: false, error: 'Decime qué app abrir.' };
      return pedido(`Abrir ${app}`, { app });
    }
    case 'llamar': {
      const { contacto, num } = quien();
      if (!contacto && !num) return { ok: false, error: 'Falta a quién llamar: el nombre del contacto o el número que dictó.' };
      return pedido(`Llamar a ${contacto || 'el número que dictaste'}`, { contacto, numero: num });
    }
    case 'whatsapp': {
      const { contacto, num } = quien();
      if (!contacto && !num) return { ok: false, error: 'Falta a quién escribirle: el nombre del contacto o el número que dictó.' };
      const mensaje = texto(args?.mensaje, 1000);
      // «WhatsApp Business» (o «el del negocio») se abre en esa app, no en el WhatsApp normal.
      const negocio = /business|negocio|empresa/i.test(texto(args?.app, 40));
      return pedido(`WhatsApp${negocio ? ' Business' : ''} a ${contacto || 'el número que dictaste'}`, { contacto, numero: num, mensaje, ...(negocio ? { negocio: true } : {}) });
    }
    case 'sms': {
      const { contacto, num } = quien();
      if (!contacto && !num) return { ok: false, error: 'Falta a quién mandarle el mensaje: el nombre del contacto o el número que dictó.' };
      const mensaje = texto(args?.mensaje, 600);
      return pedido(`Mensaje de texto a ${contacto || 'el número que dictaste'}`, { contacto, numero: num, mensaje });
    }
    case 'calendario': {
      const titulo = texto(args?.titulo, 100);
      if (titulo.length < 2) return { ok: false, error: 'Falta el nombre del evento.' };
      const ini = leerFechaHora(args?.inicio);
      if (!ini) return { ok: false, error: 'No entendí cuándo es el evento. Pasá la fecha y hora como 2026-10-14T15:00 (hora de Costa Rica).' };
      const fin = leerFechaHora(args?.fin);
      const dur = numero(args?.duracion_min);
      let finMs = fin && fin.ms > ini.ms ? fin.ms : ini.ms + (ini.soloFecha ? 86_400_000 : Math.min(Math.max(dur ?? 60, 5), 1440) * 60_000);
      if (finMs <= ini.ms) finMs = ini.ms + 3_600_000;
      const lugar = texto(args?.lugar, 120), descripcion = texto(args?.descripcion, 300);
      return pedido(`Evento «${titulo}» · ${fechaBonita(ini.ms, ini.soloFecha)}`, { titulo, inicioMs: ini.ms, finMs, todoElDia: ini.soloFecha, lugar, descripcion });
    }
    case 'mapa': {
      const consulta = texto(args?.consulta, 200);
      if (consulta.length < 2) return { ok: false, error: 'Falta el lugar o la dirección.' };
      const navegar = args?.navegar === true;
      return pedido(navegar ? `Cómo llegar a ${consulta}` : `Buscar ${consulta} en el mapa`, { consulta, navegar });
    }
    case 'musica': {
      const consulta = texto(args?.consulta, 100);
      if (consulta.length < 2) return { ok: false, error: 'Decime qué música poner (artista, canción o género).' };
      return pedido(`Poner música: ${consulta}`, { consulta });
    }
    case 'linterna': {
      const encender = args?.encender !== false;
      return pedido(encender ? 'Prender la linterna' : 'Apagar la linterna', { encender });
    }
    case 'ajustes': {
      const pantalla = sinTildes(String(args?.pantalla ?? 'general'));
      if (!(PANTALLAS_AJUSTES as readonly string[]).includes(pantalla)) return { ok: false, error: `Esa pantalla de ajustes no la tengo. Las que sí: ${PANTALLAS_AJUSTES.join(', ')}.` };
      return pedido(`Abrir los ajustes de ${pantalla}`, { pantalla });
    }
    case 'enlace': {
      const url = String(args?.url ?? '').trim().slice(0, 500);
      if (!/^https?:\/\/[^\s]+$/i.test(url)) return { ok: false, error: 'El enlace tiene que empezar con http:// o https://.' };
      return pedido('Abrir un enlace', { url });
    }
  }
}
