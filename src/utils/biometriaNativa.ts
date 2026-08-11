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

/** ¿Ya hay una sesión guardada tras la huella en este teléfono? */
export async function hayAccesoGuardado(): Promise<boolean> {
  try {
    const p = plugin();
    if (!p) return false;
    const c = await p.getCredentials({ server: LLAVERO });
    return !!c?.password;
  } catch {
    // El plugin lanza cuando no hay nada guardado: eso no es un error.
    return false;
  }
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

    const { error } = await supabase.auth.refreshSession({ refresh_token: guardado.password });
    if (error) {
      // El pase dejó de servir: contraseña cambiada, sesión cerrada desde
      // otro lado, o cuenta suspendida. Se borra para no dejar al usuario
      // atrapado en un botón que nunca va a funcionar.
      await borrarBiometriaNativa();
      return {
        ok: false,
        mensaje: 'El acceso guardado ya no es válido. Entre con su contraseña y vuelva a activar la huella.',
      };
    }

    return { ok: true, mensaje: 'Bienvenido.' };
  } catch (e: any) {
    return interpretar(e);
  }
}

/** Quita el acceso por huella de este teléfono. */
export async function borrarBiometriaNativa(): Promise<void> {
  try {
    await plugin()?.deleteCredentials({ server: LLAVERO });
  } catch {
    /* si no había nada guardado, no hay nada que borrar */
  }
}

/** Traduce los errores del plugin a algo que se pueda leer. */
function interpretar(e: any): ResultadoNativo {
  const codigo = String(e?.code ?? e?.message ?? '');
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
