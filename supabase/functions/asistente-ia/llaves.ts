// =====================================================================
// LLAVES DEL MINI-WIDGET — acceso del widget del teléfono sin huella
// =====================================================================
// El superadmin activa el mini-widget desde la app (con su sesión y su
// huella, como siempre). En ese momento se crea una LLAVE aleatoria que se
// entrega UNA sola vez al teléfono, que la guarda cifrada con el Keystore
// de Android. Aquí solo queda su huella SHA-256: con lo que hay en la base
// no se puede reconstruir la llave.
//
// Con esa llave, la ventanita del widget pregunta sin huella y sin abrir la
// app (lo pidió el dueño: el teléfono es solo suyo). Alcance:
//   · Solo la puerta widget.ts la acepta (la función de la app no).
//   · Solo para la cuenta superadmin que la creó, y solo para PREGUNTAR:
//     nada de acciones (cobros, bloqueos, chats), ver nucleo.ts.
//   · Se revoca desde Jarvis → Ajustes → Mini-widget, o al desactivarla en
//     el teléfono. Activar otra vez en el mismo teléfono revoca la anterior.
//   · Límite de uso por llave para que, si alguien la sacara del teléfono,
//     no pueda vaciar el cupo de la IA.
// =====================================================================

type Db = any;

const FORMATO = /^jvw_[A-Za-z0-9_-]{40,60}$/;
const VENTANA_MS = 10 * 60_000;
const MAX_POR_VENTANA = 40;
const usos = new Map<string, number[]>();

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function hashLlave(llave: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(llave));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Llave nueva (256 bits aleatorios) y la huella que se guarda en la base. */
export async function crearLlave(): Promise<{ llave: string; hash: string }> {
  const llave = `jvw_${base64url(crypto.getRandomValues(new Uint8Array(32)))}`;
  return { llave, hash: await hashLlave(llave) };
}

/** Límite por llave dentro de esta instancia (amortigua un abuso). */
function dentroDelLimite(hash: string): boolean {
  const ahora = Date.now();
  const lista = (usos.get(hash) || []).filter(t => ahora - t < VENTANA_MS);
  if (lista.length >= MAX_POR_VENTANA) { usos.set(hash, lista); return false; }
  lista.push(ahora); usos.set(hash, lista);
  return true;
}

export type LlaveValida = { id: string; usuario: { id: string; email: string | null } };
export type LlaveInvalida = { error: string; codigo: string; status: number };

export async function validarLlaveWidget(admin: Db, llave: string): Promise<LlaveValida | LlaveInvalida> {
  const NO_ACTIVA: LlaveInvalida = { error: 'El mini-widget no está activado en este teléfono. Activalo desde Jarvis → Ajustes → Mini-widget.', codigo: 'llave', status: 401 };
  if (!FORMATO.test(llave)) return NO_ACTIVA;
  const hash = await hashLlave(llave);
  if (!dentroDelLimite(hash)) return { error: 'Demasiadas preguntas seguidas desde el widget. Esperá unos minutos.', codigo: 'limite', status: 429 };
  const { data: fila, error } = await admin.from('ia_widget_llaves').select('id,user_id,usos,revocada_en').eq('hash', hash).maybeSingle();
  if (error) {
    console.log(`widget: ${error.message}`);
    return /does not exist|schema cache|could not find/i.test(error.message)
      ? { error: 'Falta instalar el mini-widget en la base de datos.', codigo: 'sin_tabla', status: 503 }
      : { error: 'No se pudo comprobar el widget. Probá de nuevo.', codigo: 'error', status: 500 };
  }
  if (!fila || fila.revocada_en) return NO_ACTIVA;
  const { data: u } = await admin.auth.admin.getUserById(fila.user_id);
  if (!u?.user) return NO_ACTIVA;
  // Último uso (para verlo en Ajustes); no hace falta esperarlo.
  void admin.from('ia_widget_llaves').update({ ultimo_uso: new Date().toISOString(), usos: (fila.usos || 0) + 1 }).eq('id', fila.id)
    .then(({ error: e }: { error: { message: string } | null }) => { if (e) console.log(`widget uso: ${e.message}`); });
  return { id: fila.id, usuario: { id: u.user.id, email: u.user.email ?? null } };
}
