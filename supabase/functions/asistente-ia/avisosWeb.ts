// =====================================================================
// AVISOS WEB (Web Push estándar) — llegan con el navegador cerrado, sin Firebase
// =====================================================================
// La APK necesita Firebase para avisar con la app cerrada (push.ts), y eso
// pide un proyecto de Google del dueño. Chrome (en el teléfono o en la
// compu), Edge, Firefox y Safari traen su propio servicio de avisos: basta
// con una llave VAPID propia (RFC 8292) y cifrar cada aviso para ESE
// navegador (RFC 8291, «aes128gcm»). El servicio de Google/Mozilla/Apple
// solo transporta bytes cifrados: no puede leer el mensaje.
//
// · El navegador se suscribe desde el panel (src/utils/avisosWeb.ts) y su
//   service worker (public/sw-avisos.js) muestra el aviso.
// · Las suscripciones viven en `avisos_web` (supabase/migracion_avisos_web.sql):
//   solo el personal, solo servicios de avisos conocidos.
// Secreto necesario (Supabase → Edge Functions → Secrets):
//   VAPID_PRIVADA  la llave privada P-256 en formato JWK (JSON). La pública
//                  va en src/utils/avisosWeb.ts; tienen que ser el mismo par.
// Si falta, no pasa nada: no se manda (y se dice en el log).
// =====================================================================

type Db = any;

/** Quién manda los avisos (lo pide el estándar para que el servicio pueda avisar si algo anda mal). */
const SUJETO = 'https://technoverse-cr.technoversecr.workers.dev';
const VIGENCIA_S = 86_400;

const txt = (s: string) => new TextEncoder().encode(s);
export const aB64u = (b: Uint8Array | string): string => {
  const bytes = typeof b === 'string' ? txt(b) : b;
  let s = '';
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export const deB64u = (t: string): Uint8Array => {
  const s = t.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s + '='.repeat((4 - (s.length % 4)) % 4)), c => c.charCodeAt(0));
};
const unir = (...partes: Uint8Array[]): Uint8Array => {
  const r = new Uint8Array(partes.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of partes) { r.set(p, i); i += p.length; }
  return r;
};
async function hmac(clave: Uint8Array, datos: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', clave, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, datos));
}

// ------------------------------ cifrado (RFC 8291) ------------------------------
/**
 * Cifra `texto` para un navegador (sus claves `p256dh` y `auth` de la suscripción). `fijo` es solo para las
 * pruebas (sal y llave efímera conocidas); en uso real son nuevas en cada aviso.
 */
export async function cifrarAviso(texto: string, p256dh: string, auth: string, fijo?: { sal: Uint8Array; efimera: CryptoKeyPair }): Promise<Uint8Array> {
  const delNavegador = deB64u(p256dh);
  const secretoAuth = deB64u(auth);
  if (delNavegador.length !== 65 || secretoAuth.length !== 16) throw new Error('suscripción con claves inválidas');
  const efimera = fijo?.efimera || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const mia = new Uint8Array(await crypto.subtle.exportKey('raw', efimera.publicKey));
  const suya = await crypto.subtle.importKey('raw', delNavegador, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const compartido = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: suya }, efimera.privateKey, 256));
  // IKM = HKDF(auth, ecdh, "WebPush: info\0" || ua_public || as_public, 32)
  const prkClave = await hmac(secretoAuth, compartido);
  const ikm = await hmac(prkClave, unir(txt('WebPush: info\0'), delNavegador, mia, new Uint8Array([1])));
  const sal = fijo?.sal || crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(sal, ikm);
  const cek = (await hmac(prk, unir(txt('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, unir(txt('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
  const llave = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // Un solo registro: el texto y el delimitador 0x02 («último registro»), sin relleno.
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, llave, unir(txt(texto), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 0x10, 0]); // 4096
  return unir(sal, rs, new Uint8Array([mia.length]), mia, cifrado);
}

// ------------------------------ VAPID (RFC 8292) ------------------------------
let vapid: { privada: CryptoKey; publica: string } | null | undefined;
async function llavesVapid(): Promise<{ privada: CryptoKey; publica: string } | null> {
  if (vapid !== undefined) return vapid;
  const crudo = Deno.env.get('VAPID_PRIVADA');
  if (!crudo) return (vapid = null);
  try {
    const jwk = JSON.parse(crudo);
    const privada = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d, ext: true },
      { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    return (vapid = { privada, publica: aB64u(unir(new Uint8Array([4]), deB64u(jwk.x), deB64u(jwk.y))) });
  } catch {
    console.log('avisos web: VAPID_PRIVADA no es una llave P-256 en JWK');
    return (vapid = null);
  }
}

export async function cabeceraVapid(endpoint: string, l: { privada: CryptoKey; publica: string }, ahora = Date.now()): Promise<string> {
  const cabeza = aB64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const cuerpo = aB64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(ahora / 1000) + 12 * 3600, sub: SUJETO }));
  // WebCrypto firma ECDSA en el formato que pide JWS (r || s, 64 bytes).
  const firma = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, l.privada, txt(`${cabeza}.${cuerpo}`)));
  return `vapid t=${cabeza}.${cuerpo}.${aB64u(firma)}, k=${l.publica}`;
}

// ------------------------------ envío ------------------------------
export interface ResultadoWeb { enviados: number; fallidos: number; suscripciones: number; sinConfig?: boolean }

/** Manda a los navegadores de esas personas lo que cada una tiene que ver. Borra los que ya no existen. */
export async function enviarAvisosWeb(admin: Db, porPersona: Map<string, Record<string, string>>): Promise<ResultadoWeb> {
  const ids = [...porPersona.keys()];
  if (!ids.length) return { enviados: 0, fallidos: 0, suscripciones: 0 };
  const { data: filas, error } = await admin.from('avisos_web').select('endpoint,p256dh,auth,user_id').in('user_id', ids).limit(200);
  if (error) return { enviados: 0, fallidos: 0, suscripciones: 0 }; // sin la migración todavía
  const subs = (filas || []) as { endpoint: string; p256dh: string; auth: string; user_id: string }[];
  if (!subs.length) return { enviados: 0, fallidos: 0, suscripciones: 0 };
  const l = await llavesVapid();
  if (!l) { console.log('avisos web: sin VAPID_PRIVADA, no se manda nada'); return { enviados: 0, fallidos: 0, suscripciones: subs.length, sinConfig: true }; }
  let enviados = 0, fallidos = 0;
  await Promise.all(subs.map(async s => {
    const datos = porPersona.get(s.user_id);
    if (!datos) return;
    // La llave de «Responder» es de la notificación nativa de la APK: el navegador no la usa.
    const { llave: _sinLlave, ...visibles } = datos;
    try {
      const r = await fetch(s.endpoint, {
        method: 'POST',
        headers: {
          TTL: String(VIGENCIA_S), Urgency: 'high', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
          Authorization: await cabeceraVapid(s.endpoint, l),
        },
        body: await cifrarAviso(JSON.stringify(visibles), s.p256dh, s.auth),
      });
      if (r.ok) { enviados++; return; }
      fallidos++;
      // 404/410: el navegador se dio de baja (o se borraron sus datos): ya no sirve.
      if (r.status === 404 || r.status === 410) await admin.from('avisos_web').delete().eq('endpoint', s.endpoint);
      else console.log(`avisos web: ${new URL(s.endpoint).host} respondió ${r.status}: ${(await r.text().catch(() => '')).slice(0, 160)}`);
    } catch (e) { fallidos++; console.log(`avisos web: ${e instanceof Error ? e.message : e}`); }
  }));
  return { enviados, fallidos, suscripciones: subs.length };
}
