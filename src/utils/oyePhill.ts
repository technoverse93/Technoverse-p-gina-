// =====================================================================
// «OYE PHILL» — lo que no depende del teléfono (se prueba solo)
// =====================================================================
// Phill te escucha con el teléfono desbloqueado y se abre cuando decís «Oye
// Phill». El servicio nativo (native-android/oye/) hace el trabajo; acá van
// las frases, los textos de cada estado y la lista de lo que falta para que
// funcione (el oído, el micrófono, los permisos de Android).
// =====================================================================

export type Sens = 0 | 1 | 2;
export type MotorOye = 'apagado' | 'cargando' | 'escuchando' | 'pausa' | 'error';

/** Lo que cuenta el complemento nativo sobre «Oye Phill» en este teléfono. */
export interface EstadoOye {
  ok: boolean;
  version: number;
  /** ¿La APK trae el motor de voz (Vosk)? */
  vosk: boolean;
  modeloListo: boolean;
  modeloMB: number;
  bajando: boolean;
  permisoMic: boolean;
  notificaciones: boolean;
  /** «Mostrar sobre otras apps»: lo que deja a Phill abrirse solo desde el fondo. */
  overlay: boolean;
  bateriaLibre: boolean;
  /** Lo que la persona prendió. */
  activo: boolean;
  /** Si el servicio está corriendo ahora. */
  servicio: boolean;
  motor: MotorOye;
  detalle: string;
  probando: boolean;
  sensibilidad: Sens;
  frases: string[];
  ultimoOido: string;
  ultimaDecision: string;
  sdk: number;
}

export const FRASE_MIN_PALABRAS = 2;
export const FRASE_MAX_PALABRAS = 4;
export const FRASES_MAX = 8;

export const SENSIBILIDADES: { id: Sens; nombre: string; ayuda: string }[] = [
  { id: 0, nombre: 'Estricta', ayuda: 'Solo si decís el llamado solo, corto y claro. Casi nunca se activa de más.' },
  { id: 1, nombre: 'Normal', ayuda: 'Equilibrada: acepta el llamado con alguna palabra pegada.' },
  { id: 2, nombre: 'Sensible', ayuda: 'Se activa aunque sigas hablando justo después; puede activarse de más.' },
];

/** Por qué está en pausa (los mismos códigos que manda el servicio). */
export const MOTIVOS_PAUSA: Record<string, string> = {
  app: 'tenés Phill abierto (sale a escuchar cuando te vas)',
  pantalla: 'la pantalla está apagada',
  bloqueado: 'el teléfono está bloqueado (se abre solo con el teléfono desbloqueado)',
  llamada: 'hay una llamada',
  pausa: 'lo pausaste',
  despertando: 'abriendo Phill…',
  ruido: 'hay mucho ruido o música seguidos (descansa unos segundos)',
};

/** Minúsculas, sin tildes ni símbolos: «Oye, Phill» → «oye phill». */
export function normalizar(s: unknown): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Una frase como la entiende el oído: minúsculas (con tildes), solo letras, números y espacios. */
export function limpiarFrase(s: unknown): string {
  return String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
}

/** ¿Sirve como llamado? De 2 a 4 palabras (una sola se activaría con cualquier charla). */
export function esFraseUtil(s: unknown): boolean {
  const f = limpiarFrase(s);
  if (!f) return false;
  const p = f.split(' ');
  return p.length >= FRASE_MIN_PALABRAS && p.length <= FRASE_MAX_PALABRAS && p.every(w => w.length >= 2 && w !== 'unk');
}

/** Las frases buenas, sin repetir (aunque cambien tildes o mayúsculas) y hasta FRASES_MAX. */
export function frasesValidas(lista: unknown[]): string[] {
  const vistas = new Set<string>();
  const salida: string[] = [];
  for (const cruda of lista || []) {
    if (!esFraseUtil(cruda)) continue;
    const f = limpiarFrase(cruda);
    if (vistas.has(normalizar(f))) continue;
    vistas.add(normalizar(f));
    if (salida.length < FRASES_MAX) salida.push(f);
  }
  return salida;
}

export interface TextoEstado { tono: 'ok' | 'espera' | 'error' | 'apagado'; texto: string }

/** Una línea para el estado de «Oye Phill». */
export function textoEstado(e: Pick<EstadoOye, 'activo' | 'servicio' | 'motor' | 'detalle' | 'probando'>): TextoEstado {
  if (e.probando && e.motor === 'escuchando') return { tono: 'ok', texto: 'Probando: decí «Oye Phill» y mirá lo que oye.' };
  if (!e.activo) return { tono: 'apagado', texto: 'Apagado en este teléfono.' };
  if (e.motor === 'error') return { tono: 'error', texto: e.detalle || 'No pude escuchar.' };
  if (e.motor === 'cargando') return { tono: 'espera', texto: 'Preparando el oído de Phill…' };
  if (e.motor === 'pausa') return { tono: 'espera', texto: `En pausa: ${MOTIVOS_PAUSA[e.detalle] || 'esperando'}.` };
  if (e.motor === 'escuchando') return { tono: 'ok', texto: 'Te escucha: decí «Oye Phill».' };
  return { tono: 'espera', texto: e.servicio ? 'Arrancando…' : 'Activado, pero sin arrancar: abrí la app y tocá «Reiniciar».' };
}

export interface PasoOye {
  id: 'modelo' | 'mic' | 'notif' | 'overlay' | 'bateria';
  titulo: string;
  detalle: string;
  hecho: boolean;
  /** Sin esto no se puede activar. Lo demás es recomendado. */
  obligatorio: boolean;
}

/** Lo que hace falta (y lo recomendado) para que «Oye Phill» ande bien. */
export function pasosOye(e: Pick<EstadoOye, 'modeloListo' | 'modeloMB' | 'permisoMic' | 'notificaciones' | 'overlay' | 'bateriaLibre'>): PasoOye[] {
  return [
    { id: 'modelo', titulo: 'El oído de Phill', detalle: e.modeloListo ? `Listo (${e.modeloMB || '~50'} MB en el teléfono).` : 'Se baja una sola vez (~40 MB, mejor con wifi). Después escucha sin internet.', hecho: e.modeloListo, obligatorio: true },
    { id: 'mic', titulo: 'Micrófono', detalle: 'Para escucharte decir «Oye Phill».', hecho: e.permisoMic, obligatorio: true },
    { id: 'notif', titulo: 'Notificación fija', detalle: 'Android muestra un aviso mientras Phill te escucha; así sabés cuándo está activo.', hecho: e.notificaciones, obligatorio: false },
    { id: 'overlay', titulo: 'Mostrar sobre otras apps', detalle: 'Para que Phill se abra solo cuando lo llamás. Sin esto, te sale un aviso para tocar.', hecho: e.overlay, obligatorio: false },
    { id: 'bateria', titulo: 'Batería sin restricciones', detalle: 'Para que Android no cierre el oído al rato. En algunos teléfonos (Xiaomi, Huawei, Samsung) también hay que permitir el «inicio automático».', hecho: e.bateriaLibre, obligatorio: false },
  ];
}

/** ¿Ya se puede activar? (el oído y el micrófono; lo demás es recomendado) */
export function puedeActivar(e: Pick<EstadoOye, 'vosk' | 'modeloListo' | 'permisoMic'>): boolean {
  return !!e.vosk && !!e.modeloListo && !!e.permisoMic;
}

/** Lo que dijo el reconocedor en la prueba, listo para mostrar y para ofrecerlo como llamado. */
export function lineaDePrueba(texto: string): { texto: string; sirve: boolean } {
  const crudo = String(texto ?? '');
  const sinMarcas = crudo.replace(/\[unk\]/gi, ' ').replace(/\s+/g, ' ').trim();
  // Con «[unk]» (algo que no entendió) en el medio no se ofrece como llamado.
  return { texto: sinMarcas || crudo.trim(), sirve: !/\[unk\]/i.test(crudo) && esFraseUtil(sinMarcas) };
}
