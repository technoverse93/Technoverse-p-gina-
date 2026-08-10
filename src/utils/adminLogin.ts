import { supabase } from '../supabaseClient';

// =====================================================================
// ACCESO VIGILADO (telemetría de intentos + baneo de IP)
// =====================================================================
// Este módulo es el ÚNICO punto por el que la aplicación inicia sesión.
// En vez de hablarle directo a Supabase Auth, le pide permiso primero a
// la Edge Function `admin-login`, que:
//
//   · registra el intento con IP, ubicación, fecha y dispositivo, y
//   · rechaza de plano a las conexiones que ya están bloqueadas.
//
// Se usa tanto desde la tienda como desde el panel, y funciona igual en
// la web y dentro de la APK.
//
// REGLA DE ORO: esto NUNCA puede dejar al dueño fuera de su propio panel.
// Si el portero no responde (sin internet, Supabase caído, la función
// falla), se entra por el camino de siempre — el mismo que existía antes
// de todo esto. Perder la vigilancia de un intento es molesto; perder el
// acceso al negocio es inaceptable.
// =====================================================================

export interface ResultadoAcceso {
  /** true solo si la sesión quedó realmente iniciada. */
  ok: boolean;
  /** id del usuario autenticado, para leer su perfil después. */
  userId?: string;
  /** true si el rechazo fue por lista negra y no por contraseña. */
  bloqueado?: boolean;
  /** true si se tuvo que entrar por el camino de respaldo. */
  porteroCaido?: boolean;
  /** texto ya listo para mostrarle a la persona. */
  mensaje?: string;
}

// Si el portero tarda más que esto, se asume caído y se entra directo.
// Doce segundos es tolerante con una conexión 4G lenta sin llegar a
// sentirse como que la aplicación se colgó.
const TIEMPO_LIMITE_MS = 12000;

const MENSAJE_CREDENCIALES = 'Credenciales inválidas. Por favor verifique el correo y contraseña.';

// ---------------------------------------------------------------------
// MARCA DEL DISPOSITIVO
// ---------------------------------------------------------------------
// La ubicación por IP solo da la ciudad: dos operadores distintos
// devuelven la misma coordenada porque es el centro del cantón, no un
// lugar. La pregunta que sí se puede responder bien es otra: "¿es el
// mismo aparato de siempre?". Para eso se guarda una marca al azar en
// este navegador y viaja con cada intento de ingreso.
//
// Dos límites que conviene tener claros:
//   · Si se borran los datos del navegador o se entra en modo incógnito,
//     la marca se pierde y el aparato aparecerá como NUEVO aunque sea
//     suyo. Es molesto, no es un fallo.
//   · La marca la manda el navegador, así que en teoría se puede falsear.
//     Sirve como señal de alerta, no como cerradura.
const LLAVE_DISPOSITIVO = 'technoverse_device_id';

function obtenerDeviceId(): string | null {
  try {
    let id = localStorage.getItem(LLAVE_DISPOSITIVO);
    if (!id) {
      id = (crypto?.randomUUID?.() ||
        `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
      localStorage.setItem(LLAVE_DISPOSITIVO, id);
    }
    return id;
  } catch {
    // Modo incógnito o almacenamiento bloqueado: se sigue sin marca.
    return null;
  }
}

// ---------------------------------------------------------------------
// UBICACIÓN REAL (GPS) — SOLO PARA CUENTAS ADMINISTRATIVAS
// ---------------------------------------------------------------------
// Se ejecuta DESPUÉS de que la sesión ya quedó iniciada, y nunca la
// demora: si la persona tarda en responder el permiso, o lo niega, o el
// aparato no tiene GPS, no pasa absolutamente nada.
//
// A un cliente de la tienda jamás se le pide: se comprueba el rol antes
// de siquiera llamar al navegador, para que el aviso de ubicación no le
// aparezca a alguien que solo vino a comprar.
//
// Y hay que decirlo claro: un intruso nunca va a autorizar el GPS. Esto
// sirve para confirmar los ingresos propios ("sí, ese fui yo, desde mi
// casa"), no para ubicar a quien intenta entrar.
async function capturarUbicacionPrecisa(logId: number | null): Promise<void> {
  try {
    if (!logId || typeof navigator === 'undefined' || !navigator.geolocation) return;

    const { data: sesion } = await supabase.auth.getUser();
    const uid = sesion?.user?.id;
    if (!uid) return;

    const { data: perfil } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', uid)
      .maybeSingle();
    if (!perfil || perfil.role === 'Cliente') return;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        supabase.rpc('registrar_ubicacion_precisa', {
          p_log_id: logId,
          p_lat: pos.coords.latitude,
          p_lon: pos.coords.longitude,
          p_precision_m: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
        }).then(
          () => { /* listo */ },
          () => { /* si no se pudo guardar, el ingreso ya quedó registrado igual */ }
        );
      },
      () => { /* permiso negado o GPS sin señal: se queda la ciudad por IP */ },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  } catch {
    /* la ubicación jamás puede afectar al inicio de sesión */
  }
}

/** Distingue la APK de la web, para saberlo al revisar la bitácora. */
function detectarOrigen(): 'apk' | 'web' {
  try {
    const cap = (window as any)?.Capacitor;
    const nativo = typeof cap?.isNativePlatform === 'function'
      ? cap.isNativePlatform()
      : !!cap?.isNative;
    return nativo ? 'apk' : 'web';
  } catch {
    return 'web';
  }
}

function conTope<T>(promesa: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promesa,
    new Promise<T>((_, rechazar) =>
      setTimeout(() => rechazar(new Error('tiempo agotado')), ms)
    ),
  ]);
}

/**
 * Camino de respaldo: el de toda la vida, contra Supabase Auth directo.
 * Se usa únicamente cuando el portero no está disponible.
 */
async function accesoDirecto(correo: string, password: string): Promise<ResultadoAcceso> {
  const { data, error } = await supabase.auth.signInWithPassword({ email: correo, password });
  if (error || !data?.user) {
    return { ok: false, porteroCaido: true, mensaje: MENSAJE_CREDENCIALES };
  }
  return { ok: true, userId: data.user.id, porteroCaido: true };
}

/**
 * Inicia sesión pasando por el portero. Devuelve siempre un resultado
 * con un mensaje listo para mostrar; nunca lanza excepciones.
 */
export async function iniciarSesionVigilada(email: string, password: string): Promise<ResultadoAcceso> {
  const correo = (email || '').trim().toLowerCase();

  let respuesta: any = null;
  let estadoHttp = 0;
  let porteroCaido = false;

  try {
    const { data, error } = await conTope(
      supabase.functions.invoke('admin-login', {
        body: {
          email: correo,
          password,
          origen: detectarOrigen(),
          device_id: obtenerDeviceId(),
        },
      }),
      TIEMPO_LIMITE_MS
    );

    if (error) {
      // supabase-js empaqueta la respuesta HTTP real dentro de
      // error.context. Sin leerla no se puede distinguir "contraseña
      // incorrecta" (401) de "IP bloqueada" (429) ni de "el portero se
      // cayó" (503) — y son tres situaciones que hay que tratar distinto.
      const contexto = (error as any)?.context;
      estadoHttp = Number(contexto?.status) || 0;
      if (contexto && typeof contexto.json === 'function') {
        try { respuesta = await contexto.json(); } catch { respuesta = null; }
      }
      // Sin status (no hubo red) o error del servidor: portero caído.
      if (!estadoHttp || estadoHttp >= 500) porteroCaido = true;
    } else {
      respuesta = data;
      estadoHttp = 200;
    }
  } catch {
    // Se agotó el tiempo o reventó el fetch.
    porteroCaido = true;
  }

  if (porteroCaido) {
    return await accesoDirecto(correo, password);
  }

  if (estadoHttp === 429) {
    return {
      ok: false,
      bloqueado: true,
      mensaje: respuesta?.error || 'Esta conexión está bloqueada temporalmente por intentos fallidos.',
    };
  }

  if (estadoHttp !== 200 || !respuesta?.success || !respuesta?.session) {
    return { ok: false, mensaje: respuesta?.error || MENSAJE_CREDENCIALES };
  }

  // El portero ya validó la contraseña contra Supabase Auth y devolvió los
  // tokens. Instalarlos deja la sesión exactamente igual que si se hubiera
  // llamado a signInWithPassword: de aquí en adelante todo el resto de la
  // aplicación (RLS, perfiles, guardados) funciona sin enterarse del cambio.
  const { error: errorSesion } = await supabase.auth.setSession({
    access_token: respuesta.session.access_token,
    refresh_token: respuesta.session.refresh_token,
  });

  if (errorSesion) {
    // Caso raro: el portero dijo que sí pero la sesión no se pudo montar.
    // Antes que dejar a la persona afuera, se reintenta por el camino directo.
    return await accesoDirecto(correo, password);
  }

  // Ya adentro. Se intenta guardar la ubicación real, sin esperar por ella:
  // el `void` es a propósito, para que la pantalla no se quede congelada
  // mientras la persona decide si acepta el permiso de ubicación.
  void capturarUbicacionPrecisa(respuesta.log_id ?? null);

  return { ok: true, userId: respuesta.user?.id };
}

/**
 * Devuelve la IP y la ubicación desde las que se está conectando este
 * dispositivo. Lo usa el panel de ciberseguridad para ofrecer agregar la
 * conexión propia a la lista blanca.
 */
export async function obtenerMiConexion(): Promise<{ ip: string | null; geo: any } | null> {
  try {
    const { data, error } = await conTope(
      supabase.functions.invoke('admin-login', { body: { accion: 'mi-ip' } }),
      TIEMPO_LIMITE_MS
    );
    if (error || !data) return null;
    return { ip: data.ip ?? null, geo: data.geo ?? {} };
  } catch {
    return null;
  }
}
