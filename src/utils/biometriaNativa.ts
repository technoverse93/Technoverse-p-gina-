// =====================================================================
// BIOMETRÍA DENTRO DE LA APK (huella / Face ID nativos)
// =====================================================================
// POR QUÉ HAY DOS SISTEMAS DE BIOMETRÍA Y NO UNO
// ---------------------------------------------------------------------
// En la web se usa WebAuthn (`biometria.ts`): el teléfono firma un reto
// con una llave que nunca sale de su chip seguro. Es lo más fuerte que
// existe.
//
// Dentro de la APK eso NO se puede usar: el WebView de Android no
// implementa WebAuthn. No es un fallo de esta aplicación — el sistema
// informa correctamente que no hay lector disponible, y por eso el botón
// no aparecía. Ninguna cantidad de código lo arregla desde el WebView.
//
// Lo que sí se puede, y es lo que hace la mayoría de las aplicaciones
// bancarias y de comercio: pedirle al SISTEMA que verifique la huella y,
// si la da por buena, liberar una sesión que quedó guardada en el
// almacén seguro del teléfono (Keystore en Android, Keychain en iOS).
//
// ---------------------------------------------------------------------
// LA DIFERENCIA, DICHA SIN ADORNOS
// ---------------------------------------------------------------------
// WebAuthn guarda una llave que solo sirve para FIRMAR: aunque alguien la
// robara no podría usarla fuera de ese aparato. Esto guarda un TOKEN, que
// es un pase al portador: quien lo extraiga puede usarlo.
//
// Extraerlo no es sencillo —está en el almacén cifrado del sistema y hace
// falta un teléfono con root—, pero es un nivel de protección distinto y
// conviene saberlo. Es el precio de que funcione dentro de la APK.
//
// Dos consecuencias prácticas:
//   · Si se cambia la contraseña de la cuenta, el pase deja de servir y
//     la huella deja de entrar hasta volver a activarla. Es lo correcto.
//   · Si en el teléfono hay dos huellas registradas, las dos abren la
//     sesión. Eso lo decide Android, igual que con WebAuthn.
//
// ---------------------------------------------------------------------
// POR QUÉ EL PLUGIN SE LLAMA POR EL OBJETO GLOBAL Y NO CON UN `import`
// ---------------------------------------------------------------------
// `capacitor-native-biometric` solo existe dentro de la APK. Si se
// importara arriba, el bundle de la WEB tendría que resolverlo también, y
// una compilación de la web fallaría o cargaría código nativo que ahí no
// sirve para nada. Capacitor publica los plugins instalados en
// `window.Capacitor.Plugins`, así que se leen de ahí en el momento de
// usarlos: la web ni se entera de que existe.
// =====================================================================

import { supabase } from '../supabaseClient';

/** Identificador del "servidor" bajo el que se guarda el pase. */
const LLAVERO = 'technoverse.cr';

/**
 * Marca de "este teléfono tiene la huella activada".
 *
 * Está SEPARADA del pase guardado, y esa separación es justo lo que
 * arregla el fallo: el pase caduca y se renueva constantemente, pero la
 * decisión de haber activado la huella no debería perderse por eso. Antes
 * las dos cosas eran la misma, así que en cuanto el pase dejaba de servir
 * el teléfono "olvidaba" que la huella estaba activada y el botón
 * desaparecía.
 */
const LLAVE_ACTIVA = 'technoverse_biometria_activa';

function marcarActiva(valor: boolean): void {
  try {
    if (valor) localStorage.setItem(LLAVE_ACTIVA, '1');
    else localStorage.removeItem(LLAVE_ACTIVA);
  } catch { /* sin almacenamiento se pierde la marca, no es grave */ }
}

function estaMarcadaActiva(): boolean {
  try { return localStorage.getItem(LLAVE_ACTIVA) === '1'; } catch { return false; }
}

interface PluginBiometrico {
  isAvailable(opciones?: any): Promise<{ isAvailable: boolean; biometryType?: number }>;
  verifyIdentity(opciones?: any): Promise<void>;
  setCredentials(opciones: { username: string; password: string; server: string }): Promise<void>;
  getCredentials(opciones: { server: string }): Promise<{ username: string; password: string }>;
  deleteCredentials(opciones: { server: string }): Promise<void>;
}

/** ¿Estamos dentro de la APK? */
export function esAplicacionNativa(): boolean {
  try {
    const cap = (window as any)?.Capacitor;
    return typeof cap?.isNativePlatform === 'function' ? cap.isNativePlatform() : !!cap?.isNative;
  } catch {
    return false;
  }
}

/** El plugin, si está instalado. Null en la web. */
function plugin(): PluginBiometrico | null {
  try {
    const p = (window as any)?.Capacitor?.Plugins?.NativeBiometric;
    return p && typeof p.isAvailable === 'function' ? (p as PluginBiometrico) : null;
  } catch {
    return null;
  }
}

/**
 * ¿Este teléfono tiene lector y está configurado?
 *
 * Devuelve false si no hay plugin, si no hay sensor, o si el usuario
 * nunca registró una huella. Los tres casos significan lo mismo para la
 * pantalla: no ofrecer el botón.
 */
export async function soportaBiometriaNativa(): Promise<boolean> {
  try {
    const p = plugin();
    if (!p) return false;
    const r = await p.isAvailable({ useFallback: false });
    return r?.isAvailable === true;
  } catch {
    return false;
  }
}

/**
 * ¿Este teléfono tiene la huella activada?
 *
 * Responde por la MARCA, no por el pase. Es deliberado: el pase se
 * renueva y puede quedar inservible, pero mientras la persona no la
 * desactive a mano, la huella sigue activada y el botón tiene que
 * seguir apareciendo. Si el pase resultó viejo, se le pedirá la
 * contraseña una vez y se rearma solo.
 */
export async function hayAccesoGuardado(): Promise<boolean> {
  if (!plugin()) return false;
  return estaMarcadaActiva();
}

/** Corta una espera que se alarga demasiado. */
async function conTope<T>(promesa: PromiseLike<T>, ms: number): Promise<T> {
  return await Promise.race([
    Promise.resolve(promesa),
    new Promise<T>((_, rechazar) =>
      setTimeout(() => rechazar(new Error('tiempo agotado')), ms)
    ),
  ]);
}

export interface ResultadoNativo {
  ok: boolean;
  mensaje?: string;
  /** true si la persona canceló: no hay que regañarla por eso. */
  cancelado?: boolean;
}

/**
 * Guarda la sesión actual detrás de la huella.
 *
 * Se guarda el `refresh_token`, no la contraseña. Es importante: la
 * contraseña abre la cuenta desde cualquier parte y no caduca nunca; el
 * token se puede revocar y solo sirve para renovar esta sesión.
 */
export async function activarBiometriaNativa(): Promise<ResultadoNativo> {
  try {
    const p = plugin();
    if (!p) return { ok: false, mensaje: 'Esta función solo está disponible en la aplicación.' };

    const { data } = await supabase.auth.getSession();
    const token = data?.session?.refresh_token;
    const correo = data?.session?.user?.email || '';
    if (!token) return { ok: false, mensaje: 'Debe iniciar sesión antes de activar la huella.' };

    // Se pide la huella ANTES de guardar: así se confirma que quien
    // activa esto es quien tiene el dedo, no alguien que agarró el
    // teléfono desbloqueado.
    await p.verifyIdentity({
      reason: 'Confirme su identidad para activar el acceso con huella',
      title: 'Technoverse',
      subtitle: correo,
      description: '',
    });

    await p.setCredentials({ username: correo, password: token, server: LLAVERO });
    marcarActiva(true);
    return { ok: true, mensaje: 'Acceso con huella activado en este teléfono.' };
  } catch (e: any) {
    return interpretar(e);
  }
}

/**
 * Entra con la huella. Si sale bien, la sesión queda abierta igual que
 * con contraseña.
 */
export async function entrarConBiometriaNativa(): Promise<ResultadoNativo> {
  try {
    const p = plugin();
    if (!p) return { ok: false, mensaje: 'Esta función solo está disponible en la aplicación.' };

    let guardado: { username: string; password: string };
    try {
      guardado = await p.getCredentials({ server: LLAVERO });
    } catch {
      return { ok: false, mensaje: 'Todavía no ha activado la huella en este teléfono.' };
    }
    if (!guardado?.password) {
      return { ok: false, mensaje: 'Todavía no ha activado la huella en este teléfono.' };
    }

    await p.verifyIdentity({
      reason: 'Confirme su identidad para entrar',
      title: 'Technoverse',
      subtitle: guardado.username || '',
      description: '',
    });

    // Tope de espera. Sin él, con la red caída o muy lenta la promesa no
    // vuelve nunca y el botón se queda en "Verificando…" para siempre, sin
    // forma de reintentar ni de escribir la contraseña. Quince segundos son
    // de sobra en 4G y cortos como para no desesperar a nadie.
    const { data, error } = await conTope(
      supabase.auth.refreshSession({ refresh_token: guardado.password }),
      15000
    );
    if (error) {
      // El pase dejó de servir: contraseña cambiada o sesión revocada.
      //
      // OJO CON LO QUE **NO** SE HACE AQUÍ: antes esto borraba también la
      // marca de "huella activada", y era el fallo. La persona entraba una
      // vez, el pase se consumía, el siguiente intento fallaba, y el
      // teléfono se olvidaba de la huella para siempre. Ahora solo se tira
      // el pase inservible: la marca se queda, así que el botón sigue ahí
      // y en cuanto entre con su contraseña se rearma solo.
      await tirarPaseInservible();
      return {
        ok: false,
        mensaje: 'La sesión guardada caducó. Entre con su contraseña una vez y la huella vuelve a quedar lista.',
      };
    }

    // EL PASE ES DE UN SOLO USO. Supabase entrega uno nuevo en cada
    // renovación e invalida el anterior; si no se guardara el nuevo, la
    // huella funcionaría UNA vez y nunca más. Esta línea es la corrección
    // central del fallo.
    await guardarPaseActual(data?.session?.refresh_token, data?.session?.user?.email);

    return { ok: true, mensaje: 'Bienvenido.' };
  } catch (e: any) {
    return interpretar(e);
  }
}

/** Quita el acceso por huella de este teléfono, a petición de la persona. */
export async function borrarBiometriaNativa(): Promise<void> {
  marcarActiva(false);
  await tirarPaseInservible();
}

/** Tira solo el pase, conservando la marca de "huella activada". */
async function tirarPaseInservible(): Promise<void> {
  try {
    await plugin()?.deleteCredentials({ server: LLAVERO });
  } catch {
    /* si no había nada guardado, no hay nada que borrar */
  }
}

/**
 * Guarda el pase vigente, sin pedir la huella.
 *
 * No hace falta pedirla: quien llega hasta aquí YA está autenticado. Y
 * pedirla en cada renovación de sesión —que ocurre sola cada hora— sería
 * insoportable.
 */
async function guardarPaseActual(token?: string | null, correo?: string | null): Promise<void> {
  try {
    const p = plugin();
    if (!p || !token || !estaMarcadaActiva()) return;
    await p.setCredentials({
      username: correo || '',
      password: token,
      server: LLAVERO,
    });
  } catch {
    /* si no se pudo guardar, se reintenta en la próxima renovación */
  }
}

/**
 * Mantiene el pase al día y cierra sesión sin romper la huella.
 *
 * ---------------------------------------------------------------------
 * EL FALLO QUE ESTO CORRIGE, EXPLICADO
 * ---------------------------------------------------------------------
 * Supabase ROTA el pase: cada vez que la sesión se renueva entrega uno
 * nuevo e invalida el anterior. La versión anterior guardaba el pase una
 * sola vez, al activar la huella, y no lo volvía a tocar. En cuanto la
 * sesión se renovaba —sola, cada hora— ese pase quedaba muerto.
 *
 * Peor todavía: entrar con la huella ES una renovación, así que el propio
 * ingreso consumía el pase guardado. Por eso funcionaba perfecto la
 * primera vez y nunca más.
 *
 * Con esto, cada vez que la sesión se renueva o se inicia, el pase
 * guardado se actualiza al vigente.
 */
export function iniciarSincronizacionBiometrica(): void {
  if (!esAplicacionNativa()) return;
  try {
    supabase.auth.onAuthStateChange((evento, sesion) => {
      if (evento === 'SIGNED_IN' || evento === 'TOKEN_REFRESHED' || evento === 'INITIAL_SESSION') {
        void guardarPaseActual(sesion?.refresh_token, sesion?.user?.email);
      }
    });
  } catch {
    /* sin sincronización la huella seguirá fallando, pero nada se rompe */
  }
}

/**
 * Cierra la sesión SIN invalidar el pase guardado.
 *
 * `signOut()` sin argumentos usa alcance global: le dice al servidor que
 * revoque TODOS los pases de esa cuenta, incluido el que está guardado
 * detrás de la huella. Con eso, cerrar sesión mataba la biometría aunque
 * el pase estuviera al día.
 *
 * `scope: 'local'` borra la sesión de este aparato y deja el pase válido,
 * que es exactamente lo que se necesita para volver a entrar con la
 * huella. En la web se mantiene el cierre global de siempre.
 */
export async function cerrarSesionConservandoBiometria(): Promise<void> {
  try {
    if (esAplicacionNativa() && estaMarcadaActiva()) {
      await supabase.auth.signOut({ scope: 'local' });
      return;
    }
    await supabase.auth.signOut();
  } catch {
    /* si falla, se intenta el cierre normal para no dejar la sesión viva */
    try { await supabase.auth.signOut(); } catch { /* nada más que hacer */ }
  }
}

/** Traduce los errores del plugin a algo que se pueda leer. */
function interpretar(e: any): ResultadoNativo {
  const codigo = String(e?.code ?? e?.message ?? '');
  if (/tiempo agotado/i.test(codigo)) {
    return { ok: false, mensaje: 'No hubo respuesta del servidor. Revise su conexión e inténtelo otra vez.' };
  }
  // 10 = cancelado por la persona, 14 = no hay huellas registradas,
  // 15 = no hay bloqueo de pantalla configurado.
  if (/10|cancel/i.test(codigo)) {
    return { ok: false, cancelado: true, mensaje: 'Se canceló la verificación.' };
  }
  if (/14|not enrolled|no biometrics/i.test(codigo)) {
    return { ok: false, mensaje: 'No hay ninguna huella registrada en este teléfono. Agréguela en los ajustes de Android.' };
  }
  if (/15|no.*credential|passcode/i.test(codigo)) {
    return { ok: false, mensaje: 'Configure un bloqueo de pantalla en el teléfono para poder usar la huella.' };
  }
  return { ok: false, mensaje: e?.message || 'No se pudo verificar la huella.' };
}
