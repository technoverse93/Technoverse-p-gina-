// =====================================================================
// DESBLOQUEO LOCAL — PIN numérico o patrón visual
// =====================================================================
// Es el método ALTERNATIVO a la huella para abrir una sesión que ya vive
// en este aparato. No es una forma de iniciar sesión desde cero: igual
// que la huella, lo único que hace es quitar el cerrojo
// (`marcarBloqueo(false)` en biometriaNativa.ts) de una sesión que ya
// estaba guardada. Sin sesión guardada no abre nada.
//
// ---------------------------------------------------------------------
// POR QUÉ VIVE EN EL APARATO Y NO EN EL SERVIDOR
// ---------------------------------------------------------------------
// Tres razones concretas, en orden de importancia:
//
//   1. Tiene que funcionar SIN INTERNET. El cerrojo salta justo cuando se
//      saca el teléfono del bolsillo, que es cuando peor anda la red. La
//      huella ya funciona sin cobertura (ver el "atajo" en
//      `entrarConBiometriaNativa`); si el PIN necesitara consultar al
//      servidor, sería peor que la huella justo en el caso que viene a
//      cubrir.
//   2. Es un cerrojo POR APARATO, igual que la huella. El PIN del
//      teléfono del mostrador no tiene por qué abrir la tablet de la
//      oficina.
//   3. No toca la base de datos de producción: sin migración, sin una
//      columna nueva con un hash de PIN por cuenta.
//
// ---------------------------------------------------------------------
// HASTA DÓNDE PROTEGE ESTO, DICHO SIN ADORNOS
// ---------------------------------------------------------------------
// Un PIN de 4 dígitos son 10.000 combinaciones. Quien consiga EXTRAER el
// almacenamiento del navegador de este aparato puede probarlas todas por
// su cuenta, sin pasar por esta pantalla y sin que el conteo de intentos
// de aquí lo frene. Subir las iteraciones de PBKDF2 encarece esa prueba
// pero no la impide: con un espacio tan chico, ninguna cantidad de
// derivación lo vuelve seguro contra una extracción real.
//
// O sea que esto protege contra alguien que AGARRA EL APARATO —el caso
// real que se quiere cubrir: el teléfono desatendido en el mostrador—, no
// contra un análisis forense del equipo. Es exactamente el mismo nivel
// que ya tiene el pase guardado detrás de la huella (ver el comentario
// "LA DIFERENCIA, DICHA SIN ADORNOS" en biometriaNativa.ts), y por eso se
// ofrece como su alternativa y no como algo más fuerte.
//
// La defensa de fondo sigue siendo la misma de siempre: el bloqueo de
// pantalla del propio aparato, y que la sesión se pueda revocar desde el
// servidor.
// =====================================================================

/** Los dos métodos alternativos a la huella. Se guardan diferenciados a propósito. */
export type MetodoDesbloqueo = 'pin' | 'patron';

const LLAVE_CREDENCIAL = 'technoverse_desbloqueo_local';
const LLAVE_INTENTOS = 'technoverse_desbloqueo_intentos';

/**
 * PBKDF2-SHA256. Ver arriba por qué este número no es lo que da la
 * seguridad aquí: se elige para que derivar sea imperceptible en un
 * Galaxy A12 (gama baja, el equipo de referencia del negocio) sin
 * regalar el trabajo de más si alguien prueba combinaciones a mano.
 */
const ITERACIONES = 200_000;

/** Mínimos. El PIN admite hasta 8 por si alguien quiere uno más largo. */
export const PIN_MIN = 4;
export const PIN_MAX = 8;
export const PATRON_MIN_PUNTOS = 4;

interface CredencialGuardada {
  version: 1;
  metodo: MetodoDesbloqueo;
  /** base64 */
  salt: string;
  /** base64 */
  hash: string;
  iteraciones: number;
  /**
   * Correo de la cuenta que configuró esto, en minúsculas.
   *
   * Sin esto, un PIN configurado por una persona abriría la sesión que
   * otra dejó guardada en el mismo aparato. Se comprueba al verificar.
   */
  cuenta: string;
  /**
   * Cuántos dígitos tiene el PIN (no aplica al patrón).
   *
   * Se guarda para que el candado pueda dibujar esa cantidad de puntitos
   * y comprobar solo al completarlos, como el bloqueo del teléfono, en
   * vez de obligar a un toque extra en "Desbloquear".
   *
   * No debilita nada que ya no estuviera debilitado: quien pueda leer
   * este almacenamiento tiene el hash al lado, y con 10.000
   * combinaciones la longitud no es lo que lo protege (ver el bloque de
   * honestidad al principio del archivo).
   */
  longitudPin?: number;
}

interface EstadoIntentos {
  fallos: number;
  /** Marca de tiempo (ms) hasta la que no se admite ningún intento. */
  esperaHasta: number;
}

// ---------------------------------------------------------------------
// Almacenamiento (nunca lanza: sin localStorage simplemente no hay PIN)
// ---------------------------------------------------------------------

function leerCredencial(): CredencialGuardada | null {
  try {
    const crudo = localStorage.getItem(LLAVE_CREDENCIAL);
    if (!crudo) return null;
    const dato = JSON.parse(crudo) as CredencialGuardada;
    if (dato?.version !== 1 || !dato.hash || !dato.salt) return null;
    if (dato.metodo !== 'pin' && dato.metodo !== 'patron') return null;
    return dato;
  } catch {
    return null;
  }
}

function escribirCredencial(dato: CredencialGuardada | null): boolean {
  try {
    if (dato) localStorage.setItem(LLAVE_CREDENCIAL, JSON.stringify(dato));
    else localStorage.removeItem(LLAVE_CREDENCIAL);
    return true;
  } catch {
    return false;
  }
}

function leerIntentos(): EstadoIntentos {
  try {
    const crudo = localStorage.getItem(LLAVE_INTENTOS);
    if (!crudo) return { fallos: 0, esperaHasta: 0 };
    const dato = JSON.parse(crudo) as EstadoIntentos;
    return {
      fallos: Number(dato?.fallos) || 0,
      esperaHasta: Number(dato?.esperaHasta) || 0,
    };
  } catch {
    return { fallos: 0, esperaHasta: 0 };
  }
}

function escribirIntentos(estado: EstadoIntentos): void {
  try { localStorage.setItem(LLAVE_INTENTOS, JSON.stringify(estado)); } catch { /* sin storage no hay freno que guardar */ }
}

// ---------------------------------------------------------------------
// Derivación
// ---------------------------------------------------------------------

function aBase64(bytes: Uint8Array): string {
  let binario = '';
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario);
}

function deBase64(texto: string): Uint8Array {
  const binario = atob(texto);
  const salida = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) salida[i] = binario.charCodeAt(i);
  return salida;
}

/**
 * El secreto se normaliza ANTES de derivar, y el método entra en la
 * mezcla.
 *
 * Meter el método adentro evita que un PIN "1234" y un patrón que se
 * codifique como "1234" produzcan el mismo hash — serían secretos
 * distintos con la misma huella, y cambiar de método no invalidaría el
 * anterior.
 */
function material(metodo: MetodoDesbloqueo, secreto: string): Uint8Array {
  return new TextEncoder().encode(`${metodo}:${secreto}`);
}

async function derivar(metodo: MetodoDesbloqueo, secreto: string, salt: Uint8Array, iteraciones: number): Promise<string> {
  const clave = await crypto.subtle.importKey('raw', material(metodo, secreto), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations: iteraciones, hash: 'SHA-256' },
    clave,
    256
  );
  return aBase64(new Uint8Array(bits));
}

/**
 * Comparación en tiempo constante.
 *
 * Contra un atacante con el aparato en la mano no cambia nada (ver el
 * bloque de honestidad de arriba), pero comparar con `===` sobre un
 * secreto es una costumbre que no vale la pena tener.
 */
function igualesEnTiempoConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diferencia = 0;
  for (let i = 0; i < a.length; i++) diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferencia === 0;
}

// ---------------------------------------------------------------------
// Validación de formato
// ---------------------------------------------------------------------

/** Devuelve el motivo del rechazo, o null si el secreto sirve. */
export function motivoSecretoInvalido(metodo: MetodoDesbloqueo, secreto: string): string | null {
  if (metodo === 'pin') {
    if (!new RegExp(`^\\d{${PIN_MIN},${PIN_MAX}}$`).test(secreto)) {
      return `El PIN debe tener entre ${PIN_MIN} y ${PIN_MAX} dígitos.`;
    }
    // Un PIN de un solo dígito repetido ("0000") o una escalera ("1234")
    // es lo primero que prueba cualquiera que agarre el aparato.
    if (/^(\d)\1+$/.test(secreto)) return 'Ese PIN es demasiado fácil de adivinar: no use el mismo dígito repetido.';
    const ascendente = secreto.split('').every((d, i, a) => i === 0 || Number(d) === Number(a[i - 1]) + 1);
    const descendente = secreto.split('').every((d, i, a) => i === 0 || Number(d) === Number(a[i - 1]) - 1);
    if (ascendente || descendente) return 'Ese PIN es demasiado fácil de adivinar: no use dígitos seguidos.';
    return null;
  }

  // Patrón: se codifica como los índices de los puntos tocados, en orden,
  // separados por guion ("0-1-2-5"). Cada punto va de 0 a 8 (cuadrícula
  // de 3x3) y no se puede repetir, igual que en el patrón de Android.
  const puntos = secreto.split('-').filter(Boolean);
  if (puntos.length < PATRON_MIN_PUNTOS) {
    return `El patrón debe unir al menos ${PATRON_MIN_PUNTOS} puntos.`;
  }
  if (puntos.some(p => !/^[0-8]$/.test(p))) return 'El patrón tiene puntos inválidos.';
  if (new Set(puntos).size !== puntos.length) return 'El patrón no puede repetir un punto.';
  return null;
}

// ---------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------

/** ¿Hay un PIN o patrón configurado en ESTE aparato? */
export function hayDesbloqueoLocal(): boolean {
  return leerCredencial() !== null;
}

/**
 * Qué método está configurado, para que la pantalla sepa si dibujar el
 * teclado numérico o la cuadrícula. Null si no hay ninguno.
 *
 * Esta es la diferenciación explícita que se pidió: el sistema sabe en
 * todo momento si esta cuenta se está protegiendo con Biometría, PIN o
 * Patrón, y no los mezcla.
 */
export function metodoDesbloqueoLocal(): MetodoDesbloqueo | null {
  return leerCredencial()?.metodo ?? null;
}

/** Cuántos dígitos tiene el PIN configurado (4 si no se sabe). */
export function longitudPinLocal(): number {
  return leerCredencial()?.longitudPin || PIN_MIN;
}

/** El correo al que quedó atado el PIN/patrón de este aparato. */
export function cuentaDelDesbloqueoLocal(): string | null {
  return leerCredencial()?.cuenta ?? null;
}

export interface ResultadoDesbloqueo {
  ok: boolean;
  mensaje: string;
  /** Milisegundos que faltan para poder reintentar, si está frenado. */
  esperaMs?: number;
}

/**
 * Configura (o reemplaza) el PIN/patrón de este aparato.
 *
 * Reemplazar no exige el anterior A PROPÓSITO: para llegar aquí hay que
 * tener la sesión abierta dentro del panel, que ya es una prueba de
 * identidad más fuerte que el propio PIN. Es la misma regla que sigue
 * "Activar en este aparato" de la huella.
 */
export async function configurarDesbloqueoLocal(
  metodo: MetodoDesbloqueo,
  secreto: string,
  cuenta: string,
): Promise<ResultadoDesbloqueo> {
  const invalido = motivoSecretoInvalido(metodo, secreto);
  if (invalido) return { ok: false, mensaje: invalido };

  const correo = (cuenta || '').trim().toLowerCase();
  if (!correo) return { ok: false, mensaje: 'No se pudo identificar la cuenta. Vuelva a entrar e inténtelo otra vez.' };

  try {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await derivar(metodo, secreto, salt, ITERACIONES);
    const guardado = escribirCredencial({
      version: 1,
      metodo,
      salt: aBase64(salt),
      hash,
      iteraciones: ITERACIONES,
      cuenta: correo,
      longitudPin: metodo === 'pin' ? secreto.length : undefined,
    });
    if (!guardado) {
      return { ok: false, mensaje: 'Este navegador no permite guardar datos, así que no se puede usar PIN ni patrón aquí.' };
    }
    // Un método recién configurado arranca con el contador limpio: si
    // quedaba un freno de intentos fallidos del método anterior, sería
    // absurdo aplicarlo a un secreto que todavía no se ha probado nunca.
    escribirIntentos({ fallos: 0, esperaHasta: 0 });
    return {
      ok: true,
      mensaje: metodo === 'pin' ? 'PIN configurado en este aparato.' : 'Patrón configurado en este aparato.',
    };
  } catch {
    return { ok: false, mensaje: 'No se pudo preparar el PIN en este aparato.' };
  }
}

/** Quita el PIN/patrón de este aparato. */
export function quitarDesbloqueoLocal(): void {
  escribirCredencial(null);
  escribirIntentos({ fallos: 0, esperaHasta: 0 });
}

/**
 * Escalón de espera según cuántas veces seguidas se falló.
 *
 * Frena el tanteo a mano sin castigar el error honesto: los primeros
 * fallos no esperan nada, porque equivocarse una vez al escribir un PIN
 * es normal y hacer esperar por eso solo molesta.
 */
function esperaPorFallos(fallos: number): number {
  if (fallos < 5) return 0;
  if (fallos < 8) return 30_000;          // 30 s
  if (fallos < 11) return 5 * 60_000;     // 5 min
  return 30 * 60_000;                     // 30 min
}

/** Cuántos milisegundos faltan antes de poder volver a intentar (0 si ya se puede). */
export function esperaRestanteMs(): number {
  const { esperaHasta } = leerIntentos();
  return Math.max(0, esperaHasta - Date.now());
}

/**
 * Comprueba el PIN/patrón contra lo guardado en este aparato.
 *
 * `cuentaEsperada` es el correo de la sesión que se está intentando
 * abrir. Si no coincide con la que configuró el secreto, se rechaza
 * aunque el secreto sea correcto — ver el campo `cuenta` de
 * `CredencialGuardada`.
 */
export async function verificarDesbloqueoLocal(
  secreto: string,
  cuentaEsperada?: string | null,
): Promise<ResultadoDesbloqueo> {
  const credencial = leerCredencial();
  if (!credencial) return { ok: false, mensaje: 'No hay PIN ni patrón configurado en este aparato.' };

  const esperaMs = esperaRestanteMs();
  if (esperaMs > 0) {
    return { ok: false, esperaMs, mensaje: mensajeDeEspera(esperaMs) };
  }

  const correo = (cuentaEsperada || '').trim().toLowerCase();
  if (correo && credencial.cuenta && correo !== credencial.cuenta) {
    return {
      ok: false,
      mensaje: 'Este PIN pertenece a otra cuenta de este aparato. Entre con su contraseña.',
    };
  }

  let hash: string;
  try {
    hash = await derivar(credencial.metodo, secreto, deBase64(credencial.salt), credencial.iteraciones || ITERACIONES);
  } catch {
    return { ok: false, mensaje: 'No se pudo comprobar el PIN en este aparato.' };
  }

  if (!igualesEnTiempoConstante(hash, credencial.hash)) {
    const estado = leerIntentos();
    const fallos = estado.fallos + 1;
    const espera = esperaPorFallos(fallos);
    escribirIntentos({ fallos, esperaHasta: espera > 0 ? Date.now() + espera : 0 });
    if (espera > 0) return { ok: false, esperaMs: espera, mensaje: mensajeDeEspera(espera) };
    return {
      ok: false,
      mensaje: credencial.metodo === 'pin' ? 'PIN incorrecto.' : 'El patrón no coincide.',
    };
  }

  escribirIntentos({ fallos: 0, esperaHasta: 0 });
  return { ok: true, mensaje: 'Verificado.' };
}

function mensajeDeEspera(ms: number): string {
  const minutos = Math.ceil(ms / 60_000);
  if (ms <= 60_000) return `Demasiados intentos fallidos. Espere ${Math.ceil(ms / 1000)} segundos.`;
  return `Demasiados intentos fallidos. Espere ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}.`;
}
