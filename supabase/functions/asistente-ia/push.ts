// =====================================================================
// AVISOS AL TELÉFONO (push) — llegan aunque la app esté cerrada
// =====================================================================
// · Cuando un cliente escribe en el chat, la base (gatillo chat_empujar →
//   jarvis_llamar('push_chat')) le avisa a esta función, que manda el aviso
//   a los teléfonos del personal por Firebase Cloud Messaging (FCM, gratis).
//   Es un mensaje de DATOS: el teléfono arma la notificación nativa (con el
//   botón «Responder» para contestar sin abrir la app, como WhatsApp).
// · Cada aviso de chat lleva una «llave de respuesta»: firmada por el
//   servidor, vale 24 h, para UNA conversación y UNA persona. Con ella, y
//   solo con ella, el teléfono puede mandar la respuesta escrita en la
//   notificación (accion «responder_push»). No es una sesión: no sirve para
//   leer nada ni para otra conversación.
// · También avisa lo que Phill vigila (chats esperando, existencias,
//   seguridad…), para que lleguen con la app cerrada.
// Secreto necesario (Supabase → Edge Functions → Secrets):
//   FCM_SERVICE_ACCOUNT  el JSON de la cuenta de servicio de Firebase.
// Si falta, no pasa nada: simplemente no se manda (y se dice en el log).
// =====================================================================

type Db = any;
export type DatosPush = Record<string, string>;

const MAX_TEXTO = 2000;
/** La conversación de mentira del aviso de prueba: contestarla no toca ningún chat real. */
export const CONV_PRUEBA = 'PRUEBA';
const VIGENCIA_LLAVE_MS = 24 * 3600_000;

// ------------------------------ utilidades ------------------------------
const aBase64Url = (b: ArrayBuffer | Uint8Array | string): string => {
  const bytes = typeof b === 'string' ? new TextEncoder().encode(b) : b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = '';
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const deBase64Url = (t: string): string => {
  const s = t.replace(/-/g, '+').replace(/_/g, '/');
  return decodeURIComponent(escape(atob(s + '='.repeat((4 - (s.length % 4)) % 4))));
};
const recortar = (t: unknown, n: number) => { const s = String(t ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

// ------------------------ la llave de respuesta ------------------------
let semilla: string | null = null;
async function claveSecreta(admin: Db): Promise<string | null> {
  if (semilla) return semilla;
  const { data } = await admin.from('jarvis_cron').select('clave').eq('id', 1).maybeSingle();
  semilla = data?.clave ? `push-respuesta:${data.clave}` : null;
  return semilla;
}
async function firma(clave: string, texto: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(clave), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return aBase64Url(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(texto)));
}
const iguales = (a: string, b: string) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };

/** La llave que viaja con el aviso: «quién|conversación|vence» + firma. */
export async function firmarRespuesta(admin: Db, uid: string, conversacion: string, ahora = Date.now()): Promise<string | null> {
  const clave = await claveSecreta(admin);
  if (!clave) return null;
  const cuerpo = aBase64Url(`${uid}|${conversacion}|${ahora + VIGENCIA_LLAVE_MS}`);
  return `${cuerpo}.${await firma(clave, cuerpo)}`;
}
export async function verificarRespuesta(admin: Db, llave: string, ahora = Date.now()): Promise<{ uid: string; conversacion: string } | null> {
  const clave = await claveSecreta(admin);
  const [cuerpo, f] = String(llave || '').split('.');
  if (!clave || !cuerpo || !f || llave.length > 600) return null;
  if (!iguales(f, await firma(clave, cuerpo))) return null;
  let partes: string[];
  try { partes = deBase64Url(cuerpo).split('|'); } catch { return null; }
  if (partes.length !== 3 || !(Number(partes[2]) > ahora)) return null;
  return { uid: partes[0], conversacion: partes[1] };
}

// ------------------------------- FCM -------------------------------
let tokenCache: { valor: string; proyecto: string; vence: number } | null = null;
async function accesoFcm(): Promise<{ token: string; proyecto: string } | null> {
  if (tokenCache && tokenCache.vence > Date.now() + 60_000) return { token: tokenCache.valor, proyecto: tokenCache.proyecto };
  const crudo = Deno.env.get('FCM_SERVICE_ACCOUNT');
  if (!crudo) return null;
  let cuenta: any;
  try { cuenta = JSON.parse(crudo); } catch { console.log('push: FCM_SERVICE_ACCOUNT no es un JSON válido'); return null; }
  if (!cuenta?.client_email || !cuenta?.private_key || !cuenta?.project_id) { console.log('push: a FCM_SERVICE_ACCOUNT le faltan campos'); return null; }
  const ahora = Math.floor(Date.now() / 1000);
  const cabeza = aBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const reclamo = aBase64Url(JSON.stringify({ iss: cuenta.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: ahora, exp: ahora + 3600 }));
  const der = Uint8Array.from(atob(String(cuenta.private_key).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), c => c.charCodeAt(0));
  const llave = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const firmado = aBase64Url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', llave, new TextEncoder().encode(`${cabeza}.${reclamo}`)));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${cabeza}.${reclamo}.${firmado}` }),
  });
  if (!r.ok) { console.log(`push: Google rechazó la cuenta de servicio (${r.status}): ${(await r.text().catch(() => '')).slice(0, 160)}`); return null; }
  const d = await r.json();
  tokenCache = { valor: d.access_token, proyecto: cuenta.project_id, vence: Date.now() + Number(d.expires_in || 3600) * 1000 };
  return { token: tokenCache.valor, proyecto: tokenCache.proyecto };
}

/** Manda `datos` a todos los teléfonos de esas personas. Borra los que ya no existen. */
export async function enviarPush(admin: Db, porPersona: Map<string, DatosPush>): Promise<{ enviados: number; fallidos: number; sinConfig?: boolean; sinTelefonos?: boolean }> {
  const ids = [...porPersona.keys()];
  if (!ids.length) return { enviados: 0, fallidos: 0 };
  const { data: filas } = await admin.from('dispositivos_push').select('token,user_id').in('user_id', ids).limit(200);
  const telefonos = (filas || []) as { token: string; user_id: string }[];
  if (!telefonos.length) return { enviados: 0, fallidos: 0, sinTelefonos: true };
  const acceso = await accesoFcm();
  if (!acceso) { console.log('push: sin FCM_SERVICE_ACCOUNT, no se manda nada'); return { enviados: 0, fallidos: 0, sinConfig: true }; }
  let enviados = 0, fallidos = 0;
  await Promise.all(telefonos.map(async t => {
    const datos = porPersona.get(t.user_id);
    if (!datos) return;
    try {
      const r = await fetch(`https://fcm.googleapis.com/v1/projects/${acceso.proyecto}/messages:send`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${acceso.token}` },
        body: JSON.stringify({ message: { token: t.token, data: datos, android: { priority: 'HIGH', ttl: '86400s' } } }),
      });
      if (r.ok) { enviados++; return; }
      fallidos++;
      const cuerpo = await r.text().catch(() => '');
      // Teléfono dado de baja o app desinstalada: ya no sirve.
      if (r.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(cuerpo)) await admin.from('dispositivos_push').delete().eq('token', t.token);
      else console.log(`push: FCM ${r.status}: ${cuerpo.slice(0, 160)}`);
    } catch (e) { fallidos++; console.log(`push: ${e instanceof Error ? e.message : e}`); }
  }));
  return { enviados, fallidos };
}

// --------------------------- un mensaje de chat ---------------------------
const PERSONAL = ['superadmin', 'admin', 'empleado'];
const resumenMensaje = (m: any) => recortar(m.text, 300) || (m.image_url ? '📷 Imagen' : m.audio_url ? '🎤 Nota de voz' : m.video_url ? '🎬 Video' : 'Mensaje nuevo');

/** Un cliente escribió: avisa al personal (solo al superadmin si el chat es exclusivo). */
export async function empujarChat(admin: Db, mensajeId: string): Promise<Record<string, unknown>> {
  const { data: m } = await admin.from('chat_messages').select('id,conversation_id,sender,text,image_url,audio_url,video_url,is_internal_note,created_at').eq('id', mensajeId).maybeSingle();
  if (!m || m.sender !== 'customer' || m.is_internal_note) return { ok: true, nada: 'no es un mensaje de cliente' };
  const { data: c } = await admin.from('chat_conversations').select('id,customer_name,exclusivo_superadmin').eq('id', m.conversation_id).maybeSingle();
  if (!c) return { ok: true, nada: 'conversación no encontrada' };
  const { data: personal } = await admin.from('profiles').select('id,role').in('role', c.exclusivo_superadmin ? ['superadmin'] : PERSONAL).limit(50);
  const porPersona = new Map<string, DatosPush>();
  for (const p of (personal || []) as { id: string }[]) {
    const llave = await firmarRespuesta(admin, p.id, c.id);
    porPersona.set(p.id, {
      tipo: 'chat', conv: String(c.id), cliente: recortar(c.customer_name || 'Un cliente', 60), texto: resumenMensaje(m), msg: String(m.id),
      ts: String(new Date(m.created_at || Date.now()).getTime()), ...(llave ? { llave } : {}),
    });
  }
  return { ok: true, ...(await enviarPush(admin, porPersona)) };
}

/** El aviso de prueba (botón «Probar» de Ajustes): un chat de mentira al teléfono de quien lo pide. */
export async function enviarPrueba(admin: Db, uid: string) {
  const llave = await firmarRespuesta(admin, uid, CONV_PRUEBA);
  return enviarPush(admin, new Map([[uid, { tipo: 'chat', conv: CONV_PRUEBA, cliente: 'Prueba de Technoverse', texto: 'Si ves esto, los avisos funcionan. Tocá «Responder» para probar también la respuesta.', msg: `prueba-${Date.now()}`, ts: String(Date.now()), ...(llave ? { llave } : {}) }]]));
}

/** Un aviso de Phill: a la persona dueña, con el módulo al que lleva. */
export async function empujarAviso(admin: Db, uid: string, a: { tipo: string; titulo: string; cuerpo: string; nivel?: string; destino?: string }): Promise<void> {
  await enviarPush(admin, new Map([[uid, { tipo: 'aviso', subtipo: a.tipo, titulo: recortar(a.titulo, 80), texto: recortar(a.cuerpo, 400), nivel: a.nivel || 'info', ...(a.destino ? { destino: a.destino } : {}) }]])).catch(e => console.log(`push aviso: ${e instanceof Error ? e.message : e}`));
}

// ---------------------- responder desde la notificación ----------------------
/** Manda al chat lo que se escribió en la notificación. La autoridad es la llave firmada. */
export async function responderDesdePush(admin: Db, llave: string, texto: unknown): Promise<{ ok: boolean; error?: string; codigo?: string }> {
  const t = String(texto ?? '').trim();
  if (!t) return { ok: false, error: 'Escribí algo para responder.', codigo: 'vacio' };
  if (t.length > MAX_TEXTO) return { ok: false, error: 'El mensaje es muy largo.', codigo: 'largo' };
  const v = await verificarRespuesta(admin, llave);
  if (!v) return { ok: false, error: 'La respuesta rápida venció. Abrí la app para contestar.', codigo: 'vencida' };
  const [{ data: perfil }, { data: c }] = await Promise.all([
    admin.from('profiles').select('role,email').eq('id', v.uid).maybeSingle(),
    v.conversacion === CONV_PRUEBA ? Promise.resolve({ data: null }) : admin.from('chat_conversations').select('id,exclusivo_superadmin').eq('id', v.conversacion).maybeSingle(),
  ]);
  if (!perfil || !PERSONAL.includes(perfil.role)) return { ok: false, error: 'Tu cuenta ya no tiene acceso al chat.', codigo: 'sin_acceso' };
  if (v.conversacion === CONV_PRUEBA) return { ok: true }; // la prueba: el botón «Responder» funciona de punta a punta
  if (!c) return { ok: false, error: 'Esa conversación ya no existe.', codigo: 'no_existe' };
  if (c.exclusivo_superadmin && perfil.role !== 'superadmin') return { ok: false, error: 'Ese chat es exclusivo del superadmin.', codigo: 'sin_acceso' };
  const id = `MSG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { error } = await admin.from('chat_messages').insert({ id, conversation_id: c.id, sender: 'support', text: t, created_at: new Date().toISOString(), image_url: null, video_url: null, audio_url: null, is_internal_note: false });
  if (error) { console.log(`push: no se pudo guardar la respuesta: ${error.message}`); return { ok: false, error: 'No se pudo enviar. Probá de nuevo.', codigo: 'guardar' }; }
  // Igual que al contestar en la app: lo respondido deja de estar «sin leer».
  await Promise.all([
    admin.from('chat_conversations').update({ unread_count: 0 }).eq('id', c.id),
    admin.from('audit_logs').insert({ id: `LOG-${Date.now()}-${crypto.randomUUID().slice(0, 4)}`, user_email: perfil.email || null, module: 'Soporte', action: 'Respuesta Chat', detail: `Conversación ${c.id} (desde la notificación)` }),
  ]);
  return { ok: true };
}
