// =====================================================================
// MARCA DEL APARATO — UNA SOLA, PARA TODO EL SISTEMA
// =====================================================================
// Un número al azar por aparato, guardado en este navegador. Con él se
// reconoce el equipo entre visitas y se aplica el bloqueo por aparato.
//
// ---------------------------------------------------------------------
// POR QUÉ ESTE ARCHIVO EXISTE APARTE
// ---------------------------------------------------------------------
// La marca hace falta en tres sitios que no pueden depender unos de
// otros: el cliente de Supabase (`supabaseClient.ts`), la telemetría de
// la tienda (`huella.ts`) y el acceso vigilado (`adminLogin.ts`). Si
// viviera en cualquiera de ellos habría una importación circular —
// `supabaseClient` importaría `huella`, que importa `supabaseClient` — y
// el bundle se rompería de formas difíciles de rastrear.
//
// Por eso este archivo NO IMPORTA NADA. Es la pieza de más abajo.
//
// ---------------------------------------------------------------------
// LOS TRES CANALES POR LOS QUE VIAJA, Y POR QUÉ HACEN FALTA LOS TRES
// ---------------------------------------------------------------------
//   1. localStorage — es el original. No viaja en ninguna petición.
//   2. Cookie `tv_device` — es la única forma de que Cloudflare la vea y
//      pueda cortar el acceso ANTES de entregar el HTML.
//   3. Cabecera `X-Client-Info` — es la única forma de que la BASE DE
//      DATOS la vea y pueda rechazar una compra.
//
// El punto 3 es el que faltaba y por eso un aparato bloqueado seguía
// comprando desde la APK: la APK no pasa por Cloudflare —sus archivos
// están dentro del teléfono— así que el punto 2 no la alcanza. La API sí
// la usan las dos por igual.
//
// Se reutiliza `X-Client-Info` en vez de inventar una cabecera nueva
// porque supabase-js ya la envía en TODAS sus peticiones: al no ser una
// cabecera nueva, no hay ninguna posibilidad de que el navegador o el
// servidor la rechacen por CORS. Una cabecera nueva mal aceptada habría
// tumbado la tienda entera.
// =====================================================================

const LLAVE_DISPOSITIVO = 'technoverse_device_id';

/** La misma marca, copiada a una cookie para que Cloudflare la vea. */
export const COOKIE_DISPOSITIVO = 'tv_device';

/**
 * Devuelve la marca de este aparato, creándola la primera vez.
 *
 * Nunca lanza: en modo incógnito o con el almacenamiento bloqueado
 * devuelve null y el sistema sigue funcionando sin reconocer el equipo.
 */
export function obtenerDeviceId(): string | null {
  try {
    let id = localStorage.getItem(LLAVE_DISPOSITIVO);
    if (!id) {
      id =
        crypto?.randomUUID?.() ||
        `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      localStorage.setItem(LLAVE_DISPOSITIVO, id);
    }
    sembrarCookie(id);
    return id;
  } catch {
    return null;
  }
}

/**
 * Copia la marca a una cookie.
 *
 * El localStorage NO se manda con las peticiones, así que Cloudflare
 * —que es quien puede cortar el acceso antes de entregar el HTML— nunca
 * lo ve. Las cookies sí viajan en cada petición del documento.
 *
 * `SameSite=Lax` evita que viaje en peticiones disparadas por otro sitio.
 * No lleva ningún dato personal, solo un número al azar.
 */
function sembrarCookie(id: string): void {
  try {
    if (typeof document === 'undefined') return;
    if (document.cookie.includes(`${COOKIE_DISPOSITIVO}=${id}`)) return;
    const seguro = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie =
      `${COOKIE_DISPOSITIVO}=${encodeURIComponent(id)}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax${seguro}`;
  } catch {
    /* sin cookies el bloqueo del borde no aplica, pero el de la base sí */
  }
}

/**
 * El valor de `X-Client-Info` que debe mandar el cliente de Supabase.
 *
 * Se conserva el prefijo original de la librería y se le añade
 * `tvdev=<marca>` al final. Del lado de la base, la función
 * `dispositivo_del_solicitante()` extrae justamente ese trozo.
 */
export function cabeceraClientInfo(): string {
  const marca = obtenerDeviceId();
  return marca ? `supabase-js-web tvdev=${marca}` : 'supabase-js-web';
}
