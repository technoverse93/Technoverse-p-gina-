/**
 * =====================================================================
 * PORTERO DEL SITIO WEB (Cloudflare Worker)
 * =====================================================================
 * Se ejecuta en el borde de Cloudflare ANTES de entregar una sola línea
 * de HTML. Su único trabajo es mirar QUÉ APARATO llega y, si está
 * baneado, devolver una pantalla de bloqueo con código 403 sin cargar
 * absolutamente nada de la aplicación: ni tienda, ni catálogo, ni
 * carrito, ni panel de administración.
 *
 * ---------------------------------------------------------------------
 * SE ABANDONÓ EL BLOQUEO POR IP
 * ---------------------------------------------------------------------
 * Antes esto miraba la dirección IP. Se quitó porque no servía para lo
 * que se quería:
 *
 *   · Una IP la comparte un edificio entero, un café, una oficina o toda
 *     una red móvil. Bloquear una IP castigaba a gente que no tenía nada
 *     que ver — y eso pasó de verdad.
 *   · A quien se quería bloquear le bastaba con apagar el WiFi y seguir
 *     con datos móviles para volver a entrar.
 *
 * Ahora se mira el identificador del aparato, que viaja en la cookie
 * `tv_device`. Ese identificador no cambia al cambiar de red, así que el
 * bloqueo sigue a la persona del WiFi a los datos móviles.
 *
 * LO QUE ESTO NO ES: la cookie se puede borrar, y borrándola el aparato
 * aparece como nuevo. Por eso esta capa es la que evita que el bloqueado
 * pueda siquiera VER la página, mientras la cerradura de verdad —la que
 * impide entrar a la cuenta y leer datos— vive en la base de datos y en
 * la función de acceso, donde no hay nada que borrar.
 *
 * Esto es distinto —y mucho más fuerte— que el bloqueo del inicio de
 * sesión que ya existía. Aquel vive dentro de la aplicación y solo cierra
 * la puerta del login; este corta antes, y no se puede saltar apagando
 * JavaScript ni llamando a la API por su cuenta, porque la respuesta
 * nunca llega a ser la página.
 *
 * ---------------------------------------------------------------------
 * POR QUÉ ESTE ARCHIVO TAMBIÉN PONE LAS CABECERAS
 * ---------------------------------------------------------------------
 * Cloudflare NO aplica el archivo `public/_headers` cuando hay un Worker
 * corriendo delante de los assets (`run_worker_first`). Si las cabeceras
 * se hubieran dejado solo allá, al activar este Worker se habrían perdido
 * en silencio tres cosas que ya estaban resueltas:
 *
 *   · el permiso de geolocalización (el GPS del panel dejaría de pedirse),
 *   · la defensa contra que el panel se incruste en un iframe ajeno, y
 *   · la regla de "no cachear" de /admin, que costó encontrar en su día.
 *
 * Por eso las reglas viven aquí, aplicadas a mano sobre cada respuesta.
 * `public/_headers` se conserva como documentación y como red de
 * seguridad si algún día se quita el Worker.
 *
 * ---------------------------------------------------------------------
 * REGLA DE ORO: ESTO NUNCA PUEDE TUMBAR EL SITIO
 * ---------------------------------------------------------------------
 * Si la consulta a la base de datos falla, tarda o devuelve cualquier
 * cosa rara, se DEJA PASAR. Un visitante bloqueado que se cuela es un
 * problema menor; la tienda entera caída porque Supabase tuvo un mal
 * minuto es un problema de negocio. Todo el camino está envuelto en
 * try/catch y con tope de tiempo.
 * =====================================================================
 */

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

// Se declara a mano en vez de instalar @cloudflare/workers-types: es lo
// único que hace falta de ese paquete, y agregar una dependencia de tipos
// obligaría a tocar tsconfig.json y package.json solo por esto. Wrangler
// compila igual; esto es para que `tsc` del proyecto no marque error.
interface ExecutionContext {
  waitUntil(promesa: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Las mismas llaves públicas que usa el navegador (src/supabaseClient.ts).
// Son públicas por diseño: la seguridad la dan las políticas RLS y el
// hecho de que `ip_bloqueada_total` solo devuelve un sí/no, nunca la
// lista de bloqueados.
const SUPABASE_URL = 'https://hzatdfrjcqiimgqxcwwh.supabase.co';
const SUPABASE_KEY = 'sb_publishable_M7Sw70peDBPoyhTri7abdg_ksB9gCMY';

// Tope de espera de la consulta. Por encima de esto se deja pasar.
const TOPE_CONSULTA_MS = 1200;

// Cuánto se recuerda la respuesta por IP, para no consultar la base en
// cada visita. Al bloqueado se le revisa más seguido que al permitido,
// porque levantar un bloqueo debe notarse rápido.
const CACHE_BLOQUEADO_S = 30;
const CACHE_PERMITIDO_S = 120;

// ---------------------------------------------------------------------

/** La cookie donde el navegador guarda la marca del aparato. */
const COOKIE_APARATO = 'tv_device';

/**
 * Lee una cookie de la petición.
 *
 * Se acota a 128 caracteres y a un alfabeto seguro: el valor va dentro de
 * una consulta a Supabase y de una llave de caché, y no hay razón para
 * aceptar algo que no parezca un identificador.
 */
function leerCookie(request: Request, nombre: string): string | null {
  const crudo = request.headers.get('Cookie');
  if (!crudo) return null;
  for (const parte of crudo.split(';')) {
    const igual = parte.indexOf('=');
    if (igual < 0) continue;
    if (parte.slice(0, igual).trim() !== nombre) continue;
    let valor = parte.slice(igual + 1).trim();
    try { valor = decodeURIComponent(valor); } catch { /* se usa tal cual */ }
    if (!valor || valor.length > 128) return null;
    return /^[A-Za-z0-9._-]+$/.test(valor) ? valor : null;
  }
  return null;
}

/** Los archivos con hash en el nombre: /assets/index-a1b2c3.js */
function esAsset(ruta: string): boolean {
  return ruta.startsWith('/assets/');
}

/**
 * ¿Es una página de la aplicación y no un archivo suelto?
 * Se decide por la ausencia de extensión, porque la app no usa librería
 * de rutas: /admin, /admin/inventario_productos y / son todas páginas que
 * Cloudflare resuelve al mismo index.html.
 */
function esDocumento(ruta: string): boolean {
  const ultimo = ruta.split('/').pop() || '';
  return !ultimo.includes('.') || ultimo.endsWith('.html');
}

/** Aplica las cabeceras que antes ponía public/_headers. */
function conCabeceras(respuesta: Response, ruta: string): Response {
  const salida = new Response(respuesta.body, respuesta);
  const h = salida.headers;

  h.set('X-Content-Type-Options', 'nosniff');
  h.set('X-Frame-Options', 'DENY');
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  // geolocation=(self) — NO `geolocation=()`. Con los paréntesis vacíos el
  // navegador prohíbe la ubicación hasta para el propio sitio y ni
  // siquiera muestra el aviso de permiso: el GPS del Centro de
  // Ciberseguridad quedaba muerto sin ningún mensaje de error.
  h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');

  if (esAsset(ruta)) {
    // Llevan hash en el nombre: su contenido nunca cambia.
    h.set('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (esDocumento(ruta)) {
    // index.html apunta a los assets con hash nuevo en cada despliegue.
    // Si el navegador se queda con una copia vieja pide archivos que ya
    // no existen y la aplicación no arranca.
    h.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  }

  return salida;
}

/** Pantalla de bloqueo. Sin JavaScript, sin recursos externos, sin la app. */
function pantallaDeBloqueo(ip: string | null): Response {
  const cuerpo = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Acceso bloqueado — Technoverse Costa Rica</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    padding: 24px; background: #F8FAFC; color: #0F172A;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  .caja {
    max-width: 520px; width: 100%; background: #FFFFFF;
    border: 1px solid #E4E8EF; border-radius: 16px; padding: 32px;
  }
  h1 { margin: 0 0 4px; font-size: 20px; letter-spacing: -0.01em; }
  .marca { font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: #0E6B4F; font-weight: 700; margin-bottom: 14px; }
  p { line-height: 1.65; color: #55617A; font-size: 14px; margin: 0 0 14px; }
  .dato { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #0F172A;
          background: #F1F4F8; border: 1px solid #E4E8EF; border-radius: 10px;
          padding: 10px 12px; margin: 18px 0; word-break: break-all; }
  a { color: #0E6B4F; }
  .pie { font-size: 11px; color: #8792A8; margin: 0; padding-top: 16px; border-top: 1px solid #EEF1F6; }
</style>
</head>
<body>
  <div class="caja">
    <div class="marca">Technoverse Costa Rica</div>
    <h1>Acceso bloqueado</h1>
    <p>Esta conexión fue bloqueada por el sistema de seguridad y por ahora no puede
       abrir el sitio.</p>
    <p>Si es un bloqueo temporal por intentos de ingreso fallidos, se levanta solo al
       cabo de un rato. Si cree que se trata de un error, escríbanos y le ayudamos.</p>
    <div class="dato">Su conexión: ${ip ? ip.replace(/[<>&"]/g, '') : 'desconocida'}</div>
    <p class="pie">Mencione esa dirección al contactarnos: es lo que necesitamos para
       desbloquearla.</p>
  </div>
</body>
</html>`;

  return new Response(cuerpo, {
    status: 403,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Jamás cachear esta pantalla: si se cachea, la persona la seguiría
      // viendo después de que se le levante el bloqueo.
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    },
  });
}

/**
 * ¿Este aparato tiene prohibido abrir el sitio?
 *
 * Se apoya en la caché del borde para no consultar la base en cada
 * visita. Devuelve false ante cualquier duda.
 */
async function tieneBloqueoTotal(
  aparato: string,
  ctx: ExecutionContext
): Promise<boolean> {
  const llave = new Request(
    `https://control-de-acceso.interno/aparato/${encodeURIComponent(aparato)}`
  );
  const cache = (caches as any).default as Cache;

  try {
    const guardado = await cache.match(llave);
    if (guardado) return (await guardado.text()) === '1';
  } catch {
    /* sin caché se sigue igual, solo cuesta una consulta más */
  }

  const abortar = new AbortController();
  const reloj = setTimeout(() => abortar.abort(), TOPE_CONSULTA_MS);
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/acceso_bloqueado_v2`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
      body: JSON.stringify({ p_device: aparato }),
      signal: abortar.signal,
    });
    if (!r.ok) return false;

    const bloqueada = (await r.json()) === true;
    const segundos = bloqueada ? CACHE_BLOQUEADO_S : CACHE_PERMITIDO_S;
    try {
      ctx.waitUntil(
        cache.put(
          llave,
          new Response(bloqueada ? '1' : '0', {
            headers: { 'Cache-Control': `max-age=${segundos}` },
          })
        )
      );
    } catch {
      /* que no se pueda guardar en caché no cambia la decisión */
    }
    return bloqueada;
  } catch {
    // Sin respuesta, con error o fuera de tiempo: se deja pasar.
    return false;
  } finally {
    clearTimeout(reloj);
  }
}

// ---------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const ruta = new URL(request.url).pathname;

    try {
      // Los archivos con hash no se revisan: son cientos de peticiones por
      // visita y no sirven de nada sin el HTML, que sí está protegido.
      if (!esAsset(ruta) && esDocumento(ruta)) {
        const aparato = leerCookie(request, COOKIE_APARATO);
        if (aparato && (await tieneBloqueoTotal(aparato, ctx))) {
          return pantallaDeBloqueo(request.headers.get('CF-Connecting-IP'));
        }
      }

      const respuesta = await env.ASSETS.fetch(request);
      return conCabeceras(respuesta, ruta);
    } catch (err) {
      // Último recurso: si algo de arriba reventó, se intenta servir el
      // sitio de todos modos. Nunca dejar la página caída por el portero.
      try {
        return await env.ASSETS.fetch(request);
      } catch {
        return new Response('Servicio temporalmente no disponible.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
        });
      }
    }
  },
};
