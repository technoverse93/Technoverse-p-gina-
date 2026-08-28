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
 * Último pase que se logró escribir en el llavero, en memoria.
 *
 * Solo sirve para no repetir una escritura idéntica (ver
 * `guardarPaseActual`). Se pierde al cerrar la aplicación a propósito:
 * así, al volver a abrirla, la primera renovación siempre reescribe el
 * llavero aunque coincida con lo que ya había.
 */
let ultimoPaseGuardado: string | null = null;

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

/**
 * Se exporta a propósito: `appLock.ts` la llama DIRECTAMENTE y de forma
 * SÍNCRONA en cuanto detecta que la aplicación volvió de segundo plano —
 * ver el comentario de `comprobarSiHayQueBloquear()` allá para el porqué
 * exacto (cierra una condición de carrera real, no una precaución).
 */
export function marcarBloqueo(valor: boolean): void {
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

/**
 * Opciones del diálogo nativo de verificación.
 *
 * ---------------------------------------------------------------------
 * `maxAttempts`: LA CORRECCIÓN DE LOS SENSORES BAJO PANTALLA
 * ---------------------------------------------------------------------
 * El plugin trae `maxAttempts: 1` por omisión. Con ese valor, al PRIMER
 * roce que el sensor no reconoce el diálogo del sistema se cierra y la
 * app da el intento por fallido, obligando a pulsar el botón otra vez.
 *
 * En un lector óptico BAJO EL VIDRIO —Honor 600E, Galaxy S26 Ultra— ese
 * primer roce falla con muchísima más frecuencia que en un sensor
 * capacitivo tradicional: influyen el protector de pantalla, el dedo
 * seco, la presión y hasta el brillo de la pantalla en ese momento. De
 * ahí el "es inestable y exige múltiples intentos" reportado: no es que
 * el sensor no sirva, es que solo se le daba UNA oportunidad por
 * pulsación.
 *
 * Con 5 —el máximo que admite Android— los reintentos ocurren DENTRO
 * del propio diálogo del sistema, que es como se comporta cualquier otra
 * aplicación del teléfono. Face ID no se vio afectado nunca porque en
 * iOS este parámetro no existe: el sistema ya gestiona sus propios
 * reintentos.
 *
 * ---------------------------------------------------------------------
 * `useFallback` es SOLO DE iOS aquí — el comentario anterior se equivocaba
 * ---------------------------------------------------------------------
 * Decía que con `useFallback: true` el diálogo de Android ofrecería el
 * PIN/patrón como respaldo tras varios fallos del sensor. Las propias
 * definiciones del plugin dicen lo contrario, y explican por qué: en
 * `verifyIdentity()` Android IGNORA esta opción, porque el autenticador
 * DEVICE_CREDENTIAL y el botón de cancelar son mutuamente excluyentes en
 * la API de BiometricPrompt. Ese respaldo prometido nunca existió en
 * Android; conseguirlo exigiría `allowedBiometryTypes:
 * [DEVICE_CREDENTIAL]`, que a cambio quita el botón de cancelar. Se
 * mantiene la opción porque en iOS sí hace lo que dice (Face ID cae al
 * código del teléfono), y ahí sigue siendo lo que se quiere.
 *
 * `allowedBiometryTypes` se deja SIN especificar a propósito: así Android
 * admite todas las clases registradas —huella (fuerte) y rostro (débil en
 * muchos teléfonos)—, que es lo más compatible. Fijar la lista dejaría
 * fuera el desbloqueo facial justo en los aparatos que lo clasifican como
 * débil.
 */
function opcionesVerificacion(subtitulo: string, motivo: string) {
  return {
    reason: motivo,
    title: 'Technoverse',
    subtitle: subtitulo,
    description: '',
    useFallback: true,
    maxAttempts: 5,
  };
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
  const p = plugin();
  if (!p) return false;
  // FALLO CORREGIDO: `useFallback: false` le pide a Android que solo
  // reporte disponibilidad si hay biometría PURA configurada, sin
  // contar el bloqueo de pantalla como respaldo. En algunos teléfonos
  // con lector de huella EN PANTALLA (óptico, bajo el vidrio) el driver
  // reporta la biometría como "no disponible" bajo esa combinación
  // exacta de flags, aunque el sensor funcione perfectamente — es el
  // "fallo en sensores de huella en pantalla" reportado. Con
  // `useFallback: true`, Android evalúa la disponibilidad real
  // (biometría O bloqueo de pantalla) y deja de bloquear el botón en
  // esos teléfonos.
  //
  // FALLO CORREGIDO (hardware moderno): en algunos sensores ópticos en
  // pantalla, `BiometricManager` responde "no disponible" en la PRIMERA
  // consulta justo después de que el WebView termina de arrancar —el
  // demonio de biometría del sistema todavía no terminó de inicializar—
  // y sí responde bien medio segundo después. Sin reintento, esos
  // teléfonos veían el botón de huella desaparecer aunque el sensor
  // funcionara perfectamente. Un solo reintento, con una pausa breve,
  // cubre ese arranque en frío sin notarse en los teléfonos que sí
  // responden bien a la primera.
  for (let intento = 1; intento <= 2; intento++) {
    try {
      const r = await p.isAvailable({ useFallback: true });
      if (r?.isAvailable === true) return true;
    } catch {
      /* se reintenta abajo */
    }
    if (intento === 1) await new Promise(resolve => setTimeout(resolve, 400));
  }
  return false;
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
 * Renueva la sesión probando los pases disponibles, en un orden que
 * importa mucho.
 *
 * ---------------------------------------------------------------------
 * EL ERROR FATAL DE PERSISTENCIA QUE ESTO CORRIGE
 * ---------------------------------------------------------------------
 * Síntoma reportado: tras actualizar la aplicación o pasar uno o dos
 * días, la huella dejaba de entrar —sin borrarse, no había que volver a
 * registrarla— y obligaba a escribir la contraseña una vez; después de
 * eso volvía a funcionar sola.
 *
 * La causa es una DESINCRONIZACIÓN entre los dos sitios donde vive un
 * pase de renovación:
 *
 *   · El llavero del teléfono (Keystore/Keychain), que actualiza
 *     `guardarPaseActual`.
 *   · El almacenamiento de supabase-js, que rota el pase ÉL SOLO cada
 *     vez que renueva la sesión (cosa que hace por su cuenta, con la
 *     aplicación abierta, aproximadamente cada hora).
 *
 * Supabase invalida el pase anterior en cada rotación. Así que basta con
 * que UNA sola escritura al llavero no llegue a completarse —la app se
 * cierra en ese instante, una actualización OTA recarga el WebView a
 * medias, el Keystore falla— para que el llavero se quede con un pase ya
 * muerto mientras supabase-js tiene el bueno. Y una vez desincronizado
 * NADA lo reparaba: la versión anterior renovaba ÚNICAMENTE con el pase
 * del llavero, así que fallaba para siempre aunque el pase bueno
 * estuviera ahí al lado. Escribir la contraseña rearmaba el llavero y por
 * eso "se arreglaba solo" — ese login manual era un parche, no la cura.
 *
 * Cuantas más veces se abre y cierra la app, más probable es que alguna
 * escritura se pierda: de ahí que tardara "uno o dos días" en aparecer y
 * que una actualización lo disparara casi siempre.
 *
 * ---------------------------------------------------------------------
 * POR QUÉ EL PASE DE supabase-js VA PRIMERO
 * ---------------------------------------------------------------------
 * No es un detalle de estilo. Supabase detecta la REUTILIZACIÓN de un
 * pase ya rotado y, cuando la ve, revoca la familia entera de sesiones
 * por seguridad. Es decir: intentar primero con el pase viejo del
 * llavero no solo falla, sino que puede MATAR la sesión buena que
 * supabase-js tenía guardada — convirtiendo una desincronización
 * reparable en un cierre de sesión de verdad.
 *
 * Por eso se prueba primero el pase que supabase-js administra (es quien
 * lleva la rotación, así que es siempre el más fresco) y solo después el
 * del llavero, que es el respaldo para cuando el almacenamiento del
 * navegador se perdió —instalación limpia, datos borrados— y el llavero
 * es lo único que queda.
 */
async function renovarConCandidatos(
  paseDeSupabase?: string | null,
  paseDelLlavero?: string | null,
): Promise<any | null> {
  const candidatos: string[] = [];
  if (paseDeSupabase) candidatos.push(paseDeSupabase);
  if (paseDelLlavero && paseDelLlavero !== paseDeSupabase) candidatos.push(paseDelLlavero);

  for (const pase of candidatos) {
    let sesion: any = null;

    // El tope de espera evita que la pantalla se quede colgada, pero por
    // sí solo NO basta: si el temporizador vence, la petición ya salió y
    // el servidor puede haberla atendido igual. El pase queda consumido
    // allá aunque aquí se dé por perdido. Por eso, ante CUALQUIER final
    // malo, se mira la sesión real antes de pasar al siguiente candidato.
    try {
      const { data, error } = await conTope(
        supabase.auth.refreshSession({ refresh_token: pase }),
        20000
      );
      if (!error) sesion = data?.session ?? null;
    } catch {
      /* se resuelve justo abajo mirando la sesión real */
    }

    if (!sesionVigente(sesion)) {
      // supabase-js guarda la sesión en cuanto la recibe, así que si la
      // renovación llegó al servidor, está aquí aunque la promesa se
      // haya caído.
      const { data: rescate } = await supabase.auth.getSession();
      if (sesionVigente(rescate?.session)) sesion = rescate!.session;
    }

    if (sesionVigente(sesion)) return sesion;
  }

  return null;
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
    // teléfono desbloqueado. Ni aquí ni en ningún otro punto se borra
    // `LLAVE_ACTIVA` por un fallo del sensor — ver su comentario.
    await p.verifyIdentity(
      opcionesVerificacion(correo, 'Confirme su identidad para activar el acceso con huella')
    );

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

    // El pase del llavero. Que NO esté no es motivo para rendirse: el
    // llavero puede haber quedado vacío tras un fallo anterior mientras la
    // sesión de este mismo aparato sigue perfectamente viva. Mientras la
    // huella siga marcada como activada hay algo que rescatar, y de eso se
    // encarga `renovarConCandidatos` más abajo.
    let guardado: { username: string; password: string } | null = null;
    try {
      guardado = await p.getCredentials({ server: LLAVERO });
    } catch {
      guardado = null;
    }

    if (!guardado?.password && !estaMarcadaActiva()) {
      return { ok: false, mensaje: 'Todavía no ha activado la huella en este teléfono.' };
    }

    await p.verifyIdentity(
      opcionesVerificacion(guardado?.username || '', 'Confirme su identidad para entrar')
    );

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
    // Camino normal: canjear un pase por una sesión nueva.
    // -----------------------------------------------------------------
    const sesion = await renovarConCandidatos(
      yaHabia?.session?.refresh_token,
      guardado?.password
    );

    if (!sesion) {
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
  // Sin esto, el atajo de `guardarPaseActual` creería que el pase que se
  // acaba de borrar sigue en el llavero y se saltaría la reescritura que
  // lo rearma.
  ultimoPaseGuardado = null;
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
  const p = plugin();
  if (!p || !token || !estaMarcadaActiva()) return;

  // Escribir el mismo pase dos veces no aporta nada y abre otra ventana
  // para que una escritura se corte por la mitad. supabase-js emite
  // varios eventos por una sola renovación, así que esto se ahorra la
  // mayoría de las escrituras.
  if (token === ultimoPaseGuardado) return;

  // UN reintento. La escritura al llavero es justo el punto donde nacía
  // la desincronización descrita en `renovarConCandidatos`: fallaba en
  // silencio y nadie se enteraba hasta que la huella dejaba de entrar
  // días después. El reintento no lo vuelve infalible —por eso existe
  // también el respaldo de allá—, pero recorta muchísimo la ventana.
  for (let intento = 1; intento <= 2; intento++) {
    try {
      await p.setCredentials({
        username: correo || '',
        password: token,
        server: LLAVERO,
      });
      ultimoPaseGuardado = token;
      return;
    } catch {
      if (intento === 1) await new Promise(resolve => setTimeout(resolve, 300));
    }
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
  try {
    supabase.auth.onAuthStateChange((evento, sesion) => {
      // El guardado del pase SÍ es exclusivo de la APK: en la web no
      // existe el Keystore/Keychain donde guardarlo.
      if (esAplicacionNativa() && (evento === 'SIGNED_IN' || evento === 'TOKEN_REFRESHED' || evento === 'INITIAL_SESSION')) {
        void guardarPaseActual(sesion?.refresh_token, sesion?.user?.email);
      }
      // FALLO CORREGIDO: esto estaba detrás de un `if (!esAplicacionNativa())
      // return` al inicio de la función — en la web, `marcarBloqueo(false)`
      // NUNCA se llamaba. No importaba mientras el bloqueo por inactividad
      // solo se activara en la APK, pero ahora `comprobarSiHayQueBloquear()`
      // (appLock.ts) marca el bloqueo en las DOS plataformas de forma
      // síncrona para cerrar la condición de carrera de más abajo. Sin
      // sacar esto del guardado nativo-only, la web se hubiera quedado
      // bloqueada para siempre tras el primer regreso de segundo plano,
      // incluso con una contraseña correcta.
      //
      // Entrar con la contraseña (o con la huella, que además lo hace
      // directamente en `entrarConBiometriaNativa`) abre la llave: si no,
      // alguien que escribiera su contraseña seguiría viendo la pantalla
      // de acceso al reabrir la aplicación.
      if (evento === 'SIGNED_IN') marcarBloqueo(false);
      // Un cierre de sesión REAL retira cualquier llave pendiente: ya no
      // hay sesión que proteger.
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

/**
 * Traduce los errores del plugin a algo que se pueda leer.
 *
 * ---------------------------------------------------------------------
 * FALLO CORREGIDO: los códigos estaban desalineados con la tabla real
 * del plugin, y eso pegaba más fuerte en iOS que en Android
 * ---------------------------------------------------------------------
 * La versión anterior trataba el código 10 como "cancelado por la
 * persona" y el 14/15 como "no hay huella"/"falta bloqueo de pantalla".
 * Según la tabla de errores que documenta el propio plugin
 * (`@capgo/capacitor-native-biometric`, ver su README): 10 es
 * "Authentication Failed" —la persona SÍ lo intentó y el sensor no la
 * reconoció, no que haya cancelado nada—, 3 es "Biometrics Not
 * Enrolled" y 14 es en realidad "Passcode Not Set". Con la tabla vieja,
 * un intento fallido real se le mostraba a la persona como si hubiera
 * cancelado —silencioso, sin pista de qué pasó— y un teléfono sin
 * bloqueo de pantalla configurado le hubiera dicho "no hay huella
 * registrada", que es otra cosa.
 *
 * Esto afecta más a iOS que a Android porque iOS tiene sus PROPIOS
 * códigos que la tabla vieja no contemplaba en absoluto: 11 (App
 * Cancel), 12 (Invalid Context), 13 (Not Interactive), 15 (System
 * Cancel), 16 (User Cancel), 17 (User Fallback). Sin esos números, casi
 * cualquier cancelación de Face ID caía al mensaje genérico de error en
 * vez de tratarse como lo que es: la persona canceló, no hay nada que
 * reportarle como fallo.
 *
 * Se lee `e.code` como NÚMERO — antes se armaba un string mezclando
 * código y mensaje y se le aplicaban regex de texto, fáciles de que
 * matchearan por accidente (p. ej. cualquier mensaje que contuviera la
 * palabra "cancel" en otro idioma o contexto).
 */
function interpretar(e: any): ResultadoNativo {
  if (/tiempo agotado/i.test(String(e?.message ?? ''))) {
    return { ok: false, mensaje: 'No hubo respuesta del servidor. Revise su conexión e inténtelo otra vez.' };
  }

  const codigo = Number(e?.code);

  // Cancelado por la persona o por el sistema: nada que reportar como
  // error. 11/12/13/15/16/17 son de iOS; Android usa 15/16.
  if ([11, 12, 13, 15, 16, 17].includes(codigo)) {
    return { ok: false, cancelado: true, mensaje: 'Se canceló la verificación.' };
  }
  if (codigo === 3) {
    return { ok: false, mensaje: 'No hay ninguna huella ni rostro registrado en este teléfono. Agréguelo en los ajustes.' };
  }
  if (codigo === 14) {
    return { ok: false, mensaje: 'Configure un bloqueo de pantalla en el teléfono para poder usar la biometría.' };
  }
  if (codigo === 2 || codigo === 4) {
    return { ok: false, mensaje: 'Demasiados intentos fallidos. Espere un momento e intente de nuevo, o use su contraseña.' };
  }
  if (codigo === 10) {
    return { ok: false, mensaje: 'No se pudo verificar la identidad. Intente de nuevo.' };
  }
  if (codigo === 1) {
    return { ok: false, mensaje: 'La biometría no está disponible en este teléfono en este momento.' };
  }
  // 21 = NO_PROTECTED_CREDENTIALS_FOUND. Pasa, entre otros casos, cuando
  // el teléfono invalida lo guardado porque se registró o se quitó una
  // huella. No es un fallo de la aplicación y no hay que alarmar: se
  // vuelve a armar entrando una vez con la contraseña.
  if (codigo === 21) {
    return { ok: false, mensaje: 'Hubo un cambio en las huellas registradas del teléfono. Entre con su contraseña una vez y la huella vuelve a quedar lista.' };
  }

  // Respaldo si el código no llegó como número (versión vieja del
  // plugin, o un error fuera de esta lista): se mira el texto por si
  // acaso, pero ya no es el camino principal.
  const texto = String(e?.message ?? '');
  if (/cancel/i.test(texto)) {
    return { ok: false, cancelado: true, mensaje: 'Se canceló la verificación.' };
  }
  return { ok: false, mensaje: texto || 'No se pudo verificar la identidad.' };
}
