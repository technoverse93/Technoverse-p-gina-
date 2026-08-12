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

/**
 * Marca de "la aplicación está cerrada con llave".
 *
 * ---------------------------------------------------------------------
 * EL FALLO QUE ESTO CORRIGE, Y POR QUÉ EL INTENTO ANTERIOR NO PODÍA
 * FUNCIONAR
 * ---------------------------------------------------------------------
 * La versión anterior cerraba sesión con `signOut({ scope: 'local' })`
 * creyendo que "local" significaba "no le avises al servidor". No es
 * eso. supabase-js manda igualmente `POST /logout?scope=local` con el
 * JWT, y para GoTrue `local` quiere decir "cierra SOLO esta sesión, no
 * las de los demás aparatos". El servidor revoca el pase de esa sesión
 * de todas formas — y ese pase es justo el que estaba guardado detrás
 * de la huella.
 *
 * De ahí el síntoma exacto que se reportó: con la sesión abierta la
 * huella entraba, y al cerrar sesión y volver a intentarlo saltaba "La
 * sesión guardada caducó". No era un pase viejo: era un pase que el
 * propio cierre de sesión acababa de matar.
 *
 * NO HAY forma de conservar un pase a través de un cierre de sesión de
 * verdad: está diseñado para lo contrario. Así que el modelo cambia. En
 * la APK, con la huella activada, "cerrar sesión" pasa a significar
 * CERRAR CON LLAVE: la sesión se conserva en el aparato y la aplicación
 * se comporta como si no hubiera nadie dentro hasta que la huella la
 * abra. Es lo que hacen las aplicaciones de banco, y es lo único
 * compatible con "entrar con la huella sin escribir la contraseña".
 *
 * En la web, y en la APK sin huella activada, el cierre de sesión sigue
 * siendo un cierre real y global, como siempre.
 */
const LLAVE_BLOQUEO = 'technoverse_sesion_bloqueada';

function marcarBloqueo(valor: boolean): void {
  try {
    if (valor) localStorage.setItem(LLAVE_BLOQUEO, '1');
    else localStorage.removeItem(LLAVE_BLOQUEO);
  } catch { /* sin almacenamiento no se puede bloquear; se cierra de verdad */ }
}

/**
 * ¿Hay una sesión viva que la aplicación debe tratar como cerrada?
 *
 * La consulta App al arrancar: si está puesta, NO restaura al usuario
 * aunque la sesión exista, y se muestra la pantalla de acceso con el
 * botón de huella.
 */
export function sesionBloqueada(): boolean {
  try { return localStorage.getItem(LLAVE_BLOQUEO) === '1'; } catch { return false; }
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
  /**
   * Identidad de la sesión que se acaba de abrir.
   *
   * ---------------------------------------------------------------------
   * POR QUÉ SE DEVUELVE Y NO SE CONSULTA DESPUÉS
   * ---------------------------------------------------------------------
   * La pantalla necesita el id para leer el perfil y terminar de entrar.
   * Antes lo pedía con `supabase.auth.getUser()` JUSTO DESPUÉS de esta
   * llamada, y ahí estaba una de las causas del fallo reportado: ese
   * método sale a internet otra vez, sin límite de espera. Con la red
   * lenta —o con el teléfono cambiando de wifi a datos, que es lo normal
   * al sacarlo del bolsillo— la promesa no volvía nunca: la huella se
   * aceptaba, la sesión quedaba abierta de verdad, y aun así la pantalla
   * se quedaba clavada en "Verificando…".
   *
   * La renovación ya trae el usuario dentro. Devolverlo aquí elimina esa
   * segunda salida a la red por completo.
   */
  userId?: string;
  email?: string;
}

/**
 * ¿Esta sesión sigue siendo utilizable dentro de un minuto?
 *
 * El margen de 60 segundos evita el caso tonto de dar por buena una
 * sesión que caduca mientras se lee el perfil.
 */
function sesionVigente(sesion: any): boolean {
  if (!sesion?.access_token || !sesion?.user?.id) return false;
  const caduca = Number(sesion.expires_at || 0);
  if (!caduca) return true;
  return caduca * 1000 - Date.now() > 60_000;
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

    // -----------------------------------------------------------------
    // ATAJO: si la sesión de este aparato TODAVÍA sirve, no se renueva.
    // -----------------------------------------------------------------
    // Es el caso más frecuente con diferencia —se cierra la aplicación y
    // se vuelve a abrir al rato— y es el que peor se comportaba: se
    // gastaba una renovación de red para llegar exactamente a la sesión
    // que ya estaba en el teléfono. Con la red mala eso se traducía en
    // una espera larga, o en el mensaje de "entre con su contraseña"
    // teniendo la sesión viva delante.
    //
    // Con el atajo, la huella entra SIN salir a internet: se aprueba el
    // dedo y se está dentro. Es además lo que hace que funcione sin
    // cobertura.
    const { data: yaHabia } = await supabase.auth.getSession();
    if (sesionVigente(yaHabia?.session)) {
      const s = yaHabia!.session!;
      await guardarPaseActual(s.refresh_token, s.user?.email);
      marcarBloqueo(false);   // la huella abre la llave
      return { ok: true, mensaje: 'Bienvenido.', userId: s.user?.id, email: s.user?.email || undefined };
    }

    // -----------------------------------------------------------------
    // Camino normal: canjear el pase guardado por una sesión nueva.
    // -----------------------------------------------------------------
    // El tope de espera evita que la pantalla se quede colgada, pero por
    // sí solo NO basta, y aquí estaba la segunda causa del fallo: si el
    // temporizador vence, la petición ya salió y el servidor puede
    // haberla atendido igual. El pase queda consumido en el servidor
    // aunque aquí se haya dado por perdido, y el siguiente intento
    // fracasa con "la sesión guardada caducó" — el síntoma exacto que se
    // reportó, apareciendo justo después de una huella aceptada.
    //
    // Por eso, ante CUALQUIER final malo, se comprueba primero si la
    // sesión llegó de todas formas antes de declarar el fallo.
    let sesion: any = null;
    try {
      const { data, error } = await conTope(
        supabase.auth.refreshSession({ refresh_token: guardado.password }),
        20000
      );
      if (!error) sesion = data?.session ?? null;
    } catch {
      /* se resuelve abajo mirando la sesión real */
    }

    if (!sesionVigente(sesion)) {
      // Segunda oportunidad: supabase-js guarda la sesión en cuanto la
      // recibe, así que si la renovación llegó al servidor, está aquí
      // aunque la promesa se haya caído.
      const { data: rescate } = await supabase.auth.getSession();
      if (sesionVigente(rescate?.session)) sesion = rescate!.session;
    }

    if (!sesionVigente(sesion)) {
      // Ahora sí: el pase no sirve. Contraseña cambiada, sesión revocada
      // desde otro aparato o cuenta suspendida.
      //
      // OJO CON LO QUE **NO** SE HACE AQUÍ: no se borra la marca de
      // "huella activada". Si se borrara, un fallo puntual dejaría al
      // teléfono sin biometría para siempre. Se tira solo el pase
      // inservible; la marca se queda, el botón sigue ahí, y en cuanto
      // se entre una vez con la contraseña se rearma solo.
      await tirarPaseInservible();
      return {
        ok: false,
        mensaje: 'La sesión guardada caducó. Entre con su contraseña una vez y la huella vuelve a quedar lista.',
      };
    }

    // EL PASE ES DE UN SOLO USO. Supabase entrega uno nuevo en cada
    // renovación e invalida el anterior; si no se guardara el nuevo, la
    // huella funcionaría UNA vez y nunca más.
    await guardarPaseActual(sesion.refresh_token, sesion.user?.email);
    marcarBloqueo(false);   // la huella abre la llave

    return {
      ok: true,
      mensaje: 'Bienvenido.',
      userId: sesion.user?.id,
      email: sesion.user?.email || undefined,
    };
  } catch (e: any) {
    return interpretar(e);
  }
}

/** Quita el acceso por huella de este teléfono, a petición de la persona. */
export async function borrarBiometriaNativa(): Promise<void> {
  marcarActiva(false);
  // Sin huella no puede haber llave: si quedara puesta, la aplicación
  // se vería "cerrada" para siempre y sin forma de abrirla, porque el
  // único gesto que la abre acaba de desactivarse.
  marcarBloqueo(false);
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
      // Entrar con la contraseña abre la llave igual que la huella: si
      // no, alguien que escribiera su contraseña seguiría viendo la
      // pantalla de acceso al reabrir la aplicación.
      if (evento === 'SIGNED_IN') marcarBloqueo(false);
      // Un cierre de sesión REAL (web, o APK sin huella) retira
      // cualquier llave pendiente: ya no hay sesión que proteger.
      if (evento === 'SIGNED_OUT') marcarBloqueo(false);
    });
  } catch {
    /* sin sincronización la huella seguirá fallando, pero nada se rompe */
  }
}

/**
 * Termina la sesión de la forma que corresponda a este aparato.
 *
 * ---------------------------------------------------------------------
 * NO HAY NINGÚN `signOut` QUE CONSERVE EL PASE. NINGUNO.
 * ---------------------------------------------------------------------
 * Conviene dejarlo escrito porque el comentario que ocupaba este sitio
 * afirmaba lo contrario —que `scope: 'local'` "borra la sesión de este
 * aparato y deja el pase válido"— y esa frase es exactamente la creencia
 * que produjo el fallo.
 *
 * Lo que ocurre de verdad: supabase-js manda `POST /logout?scope=local`
 * CON el JWT de la sesión, y para GoTrue `local` significa "cierra solo
 * esta sesión, no las de los demás aparatos". El pase de esta sesión
 * —el que está guardado detrás de la huella— se revoca igual.
 *
 * Así que hay dos comportamientos, y ninguno intenta lo imposible:
 *
 *   · APK con la huella activada → se echa la LLAVE. No se llama a
 *     `signOut` en absoluto. La sesión sigue viva en el aparato y la
 *     aplicación la trata como cerrada hasta que la huella la abra.
 *
 *   · Web, o APK sin huella activada → cierre real y global de siempre.
 */
export async function cerrarSesionConservandoBiometria(): Promise<void> {
  const cerrarConLlave = esAplicacionNativa() && estaMarcadaActiva();

  if (cerrarConLlave) {
    // El `try` envuelve solo el refresco del pase. Es importante que el
    // fallo de ESTO no acabe llamando a `signOut`: antes, un tropiezo
    // de `getSession()` caía al bloque de rescate de más abajo, que
    // cerraba sesión de verdad y revocaba el pase — reintroduciendo el
    // fallo justo en el camino que debía protegerlo.
    try {
      const { data } = await supabase.auth.getSession();
      await guardarPaseActual(data?.session?.refresh_token, data?.session?.user?.email);
    } catch {
      /* si no se pudo refrescar, sirve el pase anterior: sigue siendo válido */
    }
    marcarBloqueo(true);
    return;
  }

  try {
    await supabase.auth.signOut();
  } catch {
    /* si falla, se reintenta para no dejar la sesión viva por error */
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
