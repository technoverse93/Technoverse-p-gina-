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
        body: { email: correo, password, origen: detectarOrigen() },
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
