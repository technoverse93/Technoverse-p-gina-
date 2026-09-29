// =====================================================================
// CONSULTA DE IDENTIFICACIÓN — nombre y tipo desde Hacienda
// =====================================================================
// Recibe una cédula (física, jurídica, DIMEX o NITE) y devuelve el nombre
// con el que está inscrita ante Tributación, para autocompletar el
// formulario de cobro y el de facturación de la tienda.
//
// ---------------------------------------------------------------------
// POR QUÉ PASA POR AQUÍ Y NO SE LLAMA DESDE EL NAVEGADOR
// ---------------------------------------------------------------------
//   1. CORS: la API pública de Hacienda no está pensada para que la
//      llamen páginas web; desde el navegador puede fallar sin que se
//      pueda arreglar del lado nuestro.
//   2. Tope de tiempo y caché: si Hacienda tarda o se cae, esta función
//      responde igual en pocos segundos y el formulario sigue siendo
//      utilizable a mano. Nada del cobro depende de esta consulta.
//
// Es un proxy de UNA sola URL fija con la entrada validada: no acepta
// ninguna otra dirección, así que no sirve para reenviar peticiones
// arbitrarias.
//
// LO QUE DEVUELVE HACIENDA: nombre, tipo de identificación y situación
// tributaria. NO devuelve correo ni teléfono; esos campos siguen siendo
// del cliente.
// =====================================================================

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const URL_HACIENDA = 'https://api.hacienda.go.cr/fe/ae';
const TOPE_RED_MS = 6000;
const VIDA_CACHE_MS = 10 * 60 * 1000;
const MAX_CACHE = 500;

interface Hallazgo {
  nombre: string;
  tipo: string | null;
  regimen: string | null;
  estado: string | null;
}

const cache = new Map<string, { hasta: number; valor: Hallazgo | null }>();

function responder(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/** El texto tal cual, sin espacios de más. Vacío se trata como ausente. */
function limpio(v: unknown): string | null {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  return s || null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const cuerpo = await req.json().catch(() => ({}));
    const id = String(cuerpo?.identificacion ?? '').replace(/\D/g, '');

    // 9 (física) · 10 (jurídica / NITE) · 11-12 (DIMEX). Nada más pasa: la
    // entrada validada es lo que impide usar esto de proxy abierto.
    if (id.length < 9 || id.length > 12) {
      return responder({ ok: false, error: 'La identificación debe tener entre 9 y 12 dígitos.' }, 400);
    }

    const guardado = cache.get(id);
    if (guardado && guardado.hasta > Date.now()) {
      return responder({ ok: true, encontrado: guardado.valor !== null, ...(guardado.valor ?? {}), cache: true });
    }

    const corte = new AbortController();
    const temporizador = setTimeout(() => corte.abort(), TOPE_RED_MS);
    let r: Response;
    try {
      r = await fetch(`${URL_HACIENDA}?identificacion=${encodeURIComponent(id)}`, {
        signal: corte.signal,
        headers: { Accept: 'application/json', 'User-Agent': 'TechnoverseCR/1.0' },
      });
    } catch {
      // Sin respuesta a tiempo: NO es "no encontrado", es "no se pudo
      // consultar". La pantalla los distingue para no decirle a nadie que
      // su cédula no existe cuando en realidad Hacienda estaba caída.
      return responder({ ok: false, error: 'Hacienda no respondió a tiempo. Complete los datos a mano.' }, 502);
    } finally {
      clearTimeout(temporizador);
    }

    // 404 y 400 son la forma en que Hacienda dice "esa identificación no
    // está inscrita". Cualquier otro estado es una falla del servicio.
    if (r.status === 404 || r.status === 400) {
      guardar(id, null);
      return responder({ ok: true, encontrado: false });
    }
    if (!r.ok) {
      return responder({ ok: false, error: `Hacienda respondió con error (${r.status}).` }, 502);
    }

    let dato: any;
    try { dato = await r.json(); } catch { dato = null; }

    const nombre = limpio(dato?.nombre);
    if (!nombre) {
      guardar(id, null);
      return responder({ ok: true, encontrado: false });
    }

    const valor: Hallazgo = {
      nombre,
      tipo: limpio(dato?.tipoIdentificacion),
      regimen: limpio(dato?.regimen?.descripcion),
      estado: limpio(dato?.situacion?.estado),
    };
    guardar(id, valor);
    return responder({ ok: true, encontrado: true, ...valor });
  } catch (e) {
    return responder({ ok: false, error: e instanceof Error ? e.message : 'No se pudo consultar la identificación.' }, 500);
  }
});

function guardar(id: string, valor: Hallazgo | null) {
  if (cache.size >= MAX_CACHE) {
    const primera = cache.keys().next().value;
    if (primera !== undefined) cache.delete(primera);
  }
  cache.set(id, { hasta: Date.now() + VIDA_CACHE_MS, valor });
}
