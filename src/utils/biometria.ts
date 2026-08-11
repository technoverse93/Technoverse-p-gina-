// =====================================================================
// ACCESO BIOMÉTRICO — LADO DEL NAVEGADOR
// =====================================================================
// Face ID, Touch ID y huella dactilar. Este archivo solo habla con el
// navegador y con la Edge Function `webauthn`; toda la verificación de
// verdad ocurre en el servidor.
//
// ---------------------------------------------------------------------
// QUÉ VIAJA Y QUÉ NO
// ---------------------------------------------------------------------
// La cara y la huella NO salen del teléfono. Ni siquiera llegan a este
// código: el navegador no tiene forma de leerlas. Lo único que devuelve
// `navigator.credentials` es una FIRMA hecha con una llave que vive
// dentro del chip seguro del aparato y que solo se libera cuando su
// dueño se identifica.
//
// Por eso la biometría de una persona no puede abrir la cuenta de otra:
// no se comparan caras en ninguna parte. Se comprueba una firma, y esa
// firma solo la puede producir la llave privada de ESE aparato, que está
// registrada contra UNA cuenta concreta.
//
// ---------------------------------------------------------------------
// EL LÍMITE QUE HAY QUE TENER CLARO
// ---------------------------------------------------------------------
// Si en un mismo teléfono hay dos caras registradas en Face ID (o dos
// huellas), las dos desbloquean ese teléfono y por lo tanto las dos
// pueden usar las llaves que guarda. Eso lo decide iOS/Android y no hay
// forma de impedirlo desde acá. El aislamiento entre cuentas es total
// ENTRE APARATOS; dentro de un mismo aparato es el que dé el sistema.
//
// ---------------------------------------------------------------------
// POR QUÉ LAS CONVERSIONES A MANO
// ---------------------------------------------------------------------
// WebAuthn trabaja con búferes binarios y el servidor con texto
// base64url. Normalmente eso lo resuelve la librería
// `@simplewebauthn/browser`, pero son treinta líneas y agregar una
// dependencia al bundle de la tienda por eso no vale la pena.
// =====================================================================

import { supabase } from '../supabaseClient';
import { obtenerDeviceId } from './huella';

// ---------------------------------------------------------------------
// base64url ↔ binario
// ---------------------------------------------------------------------

function aBuffer(base64url: string): Uint8Array {
  const normal = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const relleno = normal + '='.repeat((4 - (normal.length % 4)) % 4);
  const binario = atob(relleno);
  const salida = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) salida[i] = binario.charCodeAt(i);
  return salida;
}

function aTexto(buffer: ArrayBuffer | null): string {
  if (!buffer) return '';
  const bytes = new Uint8Array(buffer);
  let binario = '';
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---------------------------------------------------------------------
// DISPONIBILIDAD
// ---------------------------------------------------------------------

/**
 * ¿Este aparato puede usar biometría?
 *
 * Se pregunta por un autenticador "de plataforma" —el sensor del propio
 * aparato— y no por una llave USB: en un celular eso significa Face ID,
 * Touch ID o el lector de huella.
 *
 * Ojo con dos cosas que hacen que devuelva false y no son un fallo:
 *   · La página tiene que servirse por HTTPS (o localhost).
 *   · Dentro de la APK, el WebView tiene que estar en un origen https
 *     real; con `file://` WebAuthn no existe.
 */
export async function soportaBiometria(): Promise<boolean> {
  try {
    if (typeof window === 'undefined' || !window.PublicKeyCredential) return false;
    const fn = (window.PublicKeyCredential as any)
      .isUserVerifyingPlatformAuthenticatorAvailable;
    if (typeof fn !== 'function') return false;
    return await fn.call(window.PublicKeyCredential);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------
// LLAMADAS A LA EDGE FUNCTION
// ---------------------------------------------------------------------

async function llamar(cuerpo: Record<string, unknown>): Promise<any> {
  const { data, error } = await supabase.functions.invoke('webauthn', {
    body: { ...cuerpo, device_uuid: obtenerDeviceId() },
  });
  if (error) {
    // supabase-js esconde el cuerpo real del error aquí dentro; sin esto
    // el usuario vería siempre "Edge Function returned a non-2xx status".
    let detalle = '';
    try { detalle = (await (error as any).context?.json())?.error || ''; } catch { /* sin detalle */ }
    throw new Error(detalle || error.message || 'No se pudo contactar el servidor.');
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export interface ResultadoBiometria {
  ok: boolean;
  mensaje?: string;
  /** true cuando la persona canceló el aviso: no es un error que reportar. */
  cancelado?: boolean;
}

/** Traduce los errores del navegador a algo que se pueda leer. */
function mensajeDeError(e: any): ResultadoBiometria {
  const nombre = e?.name || '';
  if (nombre === 'NotAllowedError') {
    // Es el mismo error para "canceló" y para "se agotó el tiempo": el
    // navegador no los distingue, a propósito, para no filtrar información.
    return { ok: false, cancelado: true, mensaje: 'Se canceló la verificación.' };
  }
  if (nombre === 'InvalidStateError') {
    return { ok: false, mensaje: 'Este aparato ya está registrado en la cuenta.' };
  }
  if (nombre === 'SecurityError') {
    return { ok: false, mensaje: 'El dominio no coincide con el registrado. Abra el sitio por su dirección normal.' };
  }
  if (nombre === 'NotSupportedError') {
    return { ok: false, mensaje: 'Este aparato no soporta acceso biométrico.' };
  }
  return { ok: false, mensaje: e?.message || 'No se pudo completar la verificación.' };
}

// ---------------------------------------------------------------------
// REGISTRAR
// ---------------------------------------------------------------------

/**
 * Registra la biometría de ESTA persona en ESTE aparato.
 *
 * Exige tener la sesión abierta, y es a propósito: registrar una llave
 * equivale a decir "este aparato puede entrar a esta cuenta". Si se
 * pudiera hacer sin haber entrado antes, cualquiera registraría su cara
 * contra un correo ajeno.
 */
export async function registrarBiometria(etiqueta?: string): Promise<ResultadoBiometria> {
  try {
    const { data: sesion } = await supabase.auth.getSession();
    if (!sesion?.session) {
      return { ok: false, mensaje: 'Debe iniciar sesión antes de registrar su biometría.' };
    }

    const { opciones } = await llamar({ accion: 'registro-opciones' });
    if (!opciones) return { ok: false, mensaje: 'El servidor no devolvió las opciones.' };

    const publicKey: any = {
      ...opciones,
      challenge: aBuffer(opciones.challenge),
      user: { ...opciones.user, id: aBuffer(opciones.user.id) },
      excludeCredentials: (opciones.excludeCredentials || []).map((c: any) => ({
        ...c,
        id: aBuffer(c.id),
      })),
    };

    const credencial = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential | null;
    if (!credencial) return { ok: false, cancelado: true, mensaje: 'Se canceló el registro.' };

    const respuestaAttestation = credencial.response as AuthenticatorAttestationResponse;
    const respuesta = {
      id: credencial.id,
      rawId: aTexto(credencial.rawId),
      type: credencial.type,
      clientExtensionResults: credencial.getClientExtensionResults(),
      authenticatorAttachment: (credencial as any).authenticatorAttachment ?? undefined,
      response: {
        clientDataJSON: aTexto(respuestaAttestation.clientDataJSON),
        attestationObject: aTexto(respuestaAttestation.attestationObject),
        transports: typeof (respuestaAttestation as any).getTransports === 'function'
          ? (respuestaAttestation as any).getTransports()
          : undefined,
      },
    };

    await llamar({ accion: 'registro-verificar', respuesta, etiqueta });
    return { ok: true, mensaje: 'Acceso biométrico activado en este aparato.' };
  } catch (e) {
    return mensajeDeError(e);
  }
}

// ---------------------------------------------------------------------
// ENTRAR
// ---------------------------------------------------------------------

/**
 * Entra con Face ID / huella. Si sale bien, la sesión de Supabase queda
 * abierta igual que con contraseña.
 *
 * El correo es opcional y solo sirve para acotar qué llaves ofrecer. La
 * cuenta a la que se entra la decide la LLAVE QUE FIRMÓ, no este
 * parámetro: por eso la biometría de una persona nunca puede abrir el
 * perfil de otra, aunque escriba el correo ajeno.
 */
export async function entrarConBiometria(email?: string): Promise<ResultadoBiometria> {
  try {
    const correo = (email || '').trim().toLowerCase();
    const { opciones } = await llamar({ accion: 'acceso-opciones', email: correo || undefined });
    if (!opciones) return { ok: false, mensaje: 'El servidor no devolvió las opciones.' };

    const publicKey: any = {
      ...opciones,
      challenge: aBuffer(opciones.challenge),
      allowCredentials: (opciones.allowCredentials || []).map((c: any) => ({
        ...c,
        id: aBuffer(c.id),
      })),
    };

    const credencial = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential | null;
    if (!credencial) return { ok: false, cancelado: true, mensaje: 'Se canceló el acceso.' };

    const assertion = credencial.response as AuthenticatorAssertionResponse;
    const respuesta = {
      id: credencial.id,
      rawId: aTexto(credencial.rawId),
      type: credencial.type,
      clientExtensionResults: credencial.getClientExtensionResults(),
      authenticatorAttachment: (credencial as any).authenticatorAttachment ?? undefined,
      response: {
        clientDataJSON: aTexto(assertion.clientDataJSON),
        authenticatorData: aTexto(assertion.authenticatorData),
        signature: aTexto(assertion.signature),
        userHandle: assertion.userHandle ? aTexto(assertion.userHandle) : undefined,
      },
    };

    const datos = await llamar({ accion: 'acceso-verificar', respuesta, email: correo || undefined });
    if (!datos?.token_hash) return { ok: false, mensaje: 'El servidor no devolvió la sesión.' };

    // El token es de un solo uso y dura segundos. Canjearlo es lo que
    // abre la sesión de verdad.
    const { error } = await supabase.auth.verifyOtp({
      token_hash: datos.token_hash,
      type: 'email',
    });
    if (error) return { ok: false, mensaje: 'No se pudo abrir la sesión: ' + error.message };

    return { ok: true, mensaje: 'Bienvenido.' };
  } catch (e) {
    return mensajeDeError(e);
  }
}

// ---------------------------------------------------------------------
// GESTIÓN
// ---------------------------------------------------------------------

export interface LlaveBiometrica {
  id: number;
  etiqueta: string | null;
  creado_en: string;
  ultimo_uso: string | null;
  device_uuid: string | null;
}

/** Las llaves de la cuenta que tiene la sesión abierta. Nunca las de otra. */
export async function misLlaves(): Promise<LlaveBiometrica[]> {
  try {
    const datos = await llamar({ accion: 'mis-llaves' });
    return (datos?.llaves as LlaveBiometrica[]) || [];
  } catch {
    return [];
  }
}

export async function borrarLlave(id: number): Promise<ResultadoBiometria> {
  try {
    await llamar({ accion: 'borrar-llave', id });
    return { ok: true, mensaje: 'Llave eliminada.' };
  } catch (e) {
    return { ok: false, mensaje: (e as Error)?.message };
  }
}
