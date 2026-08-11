// =====================================================================
// HUELLA DEL VISITANTE — TELEMETRÍA DE LA TIENDA
// =====================================================================
// Identifica el APARATO desde el que entra cada visitante y guarda qué
// es: IP, sistema operativo, navegador y, cuando el navegador lo
// permite, marca y modelo. Sirve para dos cosas concretas:
//
//   · saber a quién se le está bloqueando y desde dónde entra, y
//   · poder aplicar un baneo total con fundamento cuando hay fraude o
//     abuso, en vez de bloquear una IP a ciegas.
//
// ---------------------------------------------------------------------
// LO QUE ESTE ARCHIVO NO HACE, A PROPÓSITO
// ---------------------------------------------------------------------
// NO pide permiso de ubicación. A un cliente que solo viene a comprar
// jamás le va a saltar el aviso del GPS: eso queda reservado para las
// cuentas administrativas, y vive en otro archivo (adminLogin.ts). La IP
// ya dice el país y la provincia, que es lo que hace falta para un
// reclamo legal o administrativo, y no cuesta fricción ni desconfianza.
//
// Tampoco usa canvas fingerprinting ni ninguna de esas técnicas que
// identifican a alguien a espaldas suyas entre sitios distintos. La
// marca es un número al azar guardado en ESTE navegador y solo sirve
// dentro de esta tienda.
//
// ---------------------------------------------------------------------
// LÍMITES HONESTOS
// ---------------------------------------------------------------------
//   · Si el visitante borra los datos del navegador o entra en modo
//     incógnito, la marca se pierde y aparecerá como aparato nuevo.
//   · El modelo exacto ("Samsung SM-S911B") solo lo entregan los
//     navegadores basados en Chromium. En Safari e iOS lo más preciso a
//     lo que se llega es "iPhone" y la versión de iOS. No es un fallo:
//     Apple lo oculta a propósito.
//   · Nada de esto es una cerradura. Todo viaja desde el navegador y en
//     teoría se puede falsear. La cerradura de verdad son el bloqueo por
//     IP en Cloudflare y las políticas de la base de datos.
// =====================================================================

import { supabase } from '../supabaseClient';

/** La misma llave que usa el reconocimiento de dispositivo del panel:
 *  un solo aparato, una sola identidad en todo el sistema. */
const LLAVE_DISPOSITIVO = 'technoverse_device_id';

/** La misma marca, copiada a una cookie para que Cloudflare la vea. */
export const COOKIE_DISPOSITIVO = 'tv_device';

/** Cuándo se envió la última huella, para no llamar a la base en cada
 *  clic. Media hora es de sobra: esto no es analítica de tráfico. */
const LLAVE_ULTIMO_ENVIO = 'technoverse_huella_enviada';
const CADA_MS = 30 * 60 * 1000;

// ---------------------------------------------------------------------
// IDENTIDAD DEL APARATO
// ---------------------------------------------------------------------

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
    // Modo incógnito o almacenamiento bloqueado: se sigue sin marca.
    return null;
  }
}

/**
 * Copia la marca del aparato a una cookie.
 *
 * POR QUÉ HACE FALTA, si ya está en localStorage: el localStorage NO se
 * manda con las peticiones. Cloudflare, que es quien puede cortar el
 * acceso ANTES de entregar el HTML, nunca lo ve. Las cookies sí viajan
 * en cada petición del documento, y son la única forma de que el portero
 * del borde sepa qué aparato está llamando.
 *
 * Es la misma marca, no una segunda: si se borra la cookie, se vuelve a
 * escribir desde el localStorage en la siguiente visita.
 *
 * `SameSite=Lax` evita que la cookie viaje en peticiones que dispare otro
 * sitio; no lleva ningún dato personal, solo un número al azar.
 */
function sembrarCookie(id: string): void {
  try {
    if (typeof document === 'undefined') return;
    if (document.cookie.includes(`${COOKIE_DISPOSITIVO}=${id}`)) return;
    const seguro = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie =
      `${COOKIE_DISPOSITIVO}=${encodeURIComponent(id)}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax${seguro}`;
  } catch {
    /* sin cookies el bloqueo del borde no aplica, pero el de la aplicación sí */
  }
}

// ---------------------------------------------------------------------
// LECTURA DEL NAVEGADOR
// ---------------------------------------------------------------------

export interface DatosDelAparato {
  user_agent: string;
  navegador: string;
  version_navegador: string;
  sistema: string;
  version_sistema: string;
  dispositivo: string;
  tipo: 'Móvil' | 'Tablet' | 'Escritorio';
  plataforma: string;
  idioma: string;
  zona_horaria: string;
  pantalla: string;
  memoria_gb: string;
  nucleos: string;
  touch: string;
  origen: 'web' | 'apk';
  ruta: string;
}

/** El orden importa: Edge y Opera también dicen "Chrome" en su UA, así
 *  que hay que descartarlos ANTES de dar por bueno Chrome. */
function leerNavegador(ua: string): { nombre: string; version: string } {
  const buscar = (re: RegExp) => {
    const m = ua.match(re);
    return m ? m[1] : '';
  };

  if (/Edg\//.test(ua))                  return { nombre: 'Edge',    version: buscar(/Edg\/([\d.]+)/) };
  if (/OPR\/|Opera/.test(ua))            return { nombre: 'Opera',   version: buscar(/(?:OPR|Opera)\/([\d.]+)/) };
  if (/SamsungBrowser/.test(ua))         return { nombre: 'Samsung Internet', version: buscar(/SamsungBrowser\/([\d.]+)/) };
  if (/Firefox\/|FxiOS/.test(ua))        return { nombre: 'Firefox', version: buscar(/(?:Firefox|FxiOS)\/([\d.]+)/) };
  // En iOS TODOS los navegadores usan el motor de Safari; Chrome en
  // iPhone se anuncia como CriOS.
  if (/CriOS\//.test(ua))                return { nombre: 'Chrome (iOS)', version: buscar(/CriOS\/([\d.]+)/) };
  if (/Chrome\//.test(ua))               return { nombre: 'Chrome',  version: buscar(/Chrome\/([\d.]+)/) };
  if (/Safari\//.test(ua))               return { nombre: 'Safari',  version: buscar(/Version\/([\d.]+)/) };
  return { nombre: 'Desconocido', version: '' };
}

function leerSistema(ua: string): { nombre: string; version: string } {
  const buscar = (re: RegExp) => {
    const m = ua.match(re);
    return m ? m[1].replace(/_/g, '.') : '';
  };

  if (/Android/.test(ua))                return { nombre: 'Android', version: buscar(/Android ([\d.]+)/) };
  if (/iPhone|iPod/.test(ua))            return { nombre: 'iOS',     version: buscar(/OS ([\d_]+)/) };
  if (/iPad/.test(ua))                   return { nombre: 'iPadOS',  version: buscar(/OS ([\d_]+)/) };
  if (/Windows NT/.test(ua)) {
    const nt = buscar(/Windows NT ([\d.]+)/);
    // Windows 11 miente: su UA sigue diciendo NT 10.0. No hay forma de
    // distinguirlo desde el UA clásico, solo con userAgentData.
    const nombre = nt === '10.0' ? 'Windows 10/11' : 'Windows';
    return { nombre, version: nt };
  }
  if (/Mac OS X/.test(ua))               return { nombre: 'macOS',   version: buscar(/Mac OS X ([\d_]+)/) };
  if (/CrOS/.test(ua))                   return { nombre: 'ChromeOS', version: '' };
  if (/Linux/.test(ua))                  return { nombre: 'Linux',   version: '' };
  return { nombre: 'Desconocido', version: '' };
}

/** Modelo del aparato deducido del User-Agent. Es lo que se puede sacar
 *  sin permisos; Chromium después lo mejora con el modelo real. */
function leerDispositivo(ua: string): string {
  // Android pone el modelo entre el nivel de API y "Build":
  //   (Linux; Android 14; SM-S911B Build/UP1A...)
  const android = ua.match(/Android [\d.]+;\s*([^;)]+?)(?:\s+Build\/|[;)])/);
  if (android && android[1]) {
    const capturado = android[1].trim();
    // Firefox en Android no pone el modelo, pone la palabra "Mobile":
    //   (Android 14; Mobile; rv:130.0)
    // Sin este filtro el panel mostraría "Mobile" como si fuera el
    // aparato. Lo mismo con "wv", que solo indica que es un WebView.
    if (!/^(wv|mobile|tablet)$/i.test(capturado)) return capturado;
  }
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua))   return 'iPad';
  if (/iPod/.test(ua))   return 'iPod';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows NT/.test(ua)) return 'PC Windows';
  return '';
}

function leerTipo(ua: string): 'Móvil' | 'Tablet' | 'Escritorio' {
  if (/iPad|Tablet|PlayBook|Silk/.test(ua)) return 'Tablet';
  // Android sin "Mobile" en el UA es una tablet.
  if (/Android/.test(ua) && !/Mobile/.test(ua)) return 'Tablet';
  if (/Mobi|Android|iPhone|iPod|Windows Phone/.test(ua)) return 'Móvil';
  return 'Escritorio';
}

/** ¿Corriendo dentro del APK de Capacitor o en el navegador? */
function leerOrigen(): 'web' | 'apk' {
  try {
    const w = window as any;
    if (w?.Capacitor?.isNativePlatform?.()) return 'apk';
    if (/^(capacitor|ionic|file):$/.test(location.protocol)) return 'apk';
  } catch {
    /* sin window utilizable se asume web */
  }
  return 'web';
}

/**
 * Junta todo lo que el navegador está dispuesto a contar.
 *
 * `userAgentData.getHighEntropyValues` es lo que da el modelo y la
 * versión REAL del sistema en Chromium — el User-Agent clásico está cada
 * vez más recortado y ahí Windows 11 aparece como Windows 10. Si no
 * existe o falla, se sigue con lo leído del UA y ya.
 */
export async function leerDatosDelAparato(): Promise<DatosDelAparato> {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  const nav = leerNavegador(ua);
  const sis = leerSistema(ua);

  const datos: DatosDelAparato = {
    user_agent: ua.slice(0, 512),
    navegador: nav.nombre,
    version_navegador: nav.version,
    sistema: sis.nombre,
    version_sistema: sis.version,
    dispositivo: leerDispositivo(ua),
    tipo: leerTipo(ua),
    plataforma: (navigator as any)?.platform || '',
    idioma: navigator?.language || '',
    zona_horaria: '',
    pantalla: '',
    memoria_gb: '',
    nucleos: '',
    touch: '',
    origen: leerOrigen(),
    ruta: '',
  };

  try { datos.zona_horaria = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* da igual */ }
  try { datos.pantalla = `${screen.width}x${screen.height}@${window.devicePixelRatio || 1}`; } catch { /* da igual */ }
  try {
    const mem = (navigator as any)?.deviceMemory;
    if (typeof mem === 'number') datos.memoria_gb = String(mem);
  } catch { /* da igual */ }
  try {
    const nucleos = navigator?.hardwareConcurrency;
    if (typeof nucleos === 'number') datos.nucleos = String(nucleos);
  } catch { /* da igual */ }
  try {
    datos.touch = String((navigator?.maxTouchPoints || 0) > 0);
  } catch { /* da igual */ }
  try {
    datos.ruta = (location.pathname || '/').slice(0, 200);
  } catch { /* da igual */ }

  // Datos de alta entropía: solo Chromium, y solo si los concede.
  try {
    const uaData = (navigator as any)?.userAgentData;
    if (uaData?.getHighEntropyValues) {
      const alta = await uaData.getHighEntropyValues([
        'platform', 'platformVersion', 'model', 'uaFullVersion', 'architecture',
      ]);
      if (alta?.model)            datos.dispositivo       = alta.model;
      if (alta?.platform)         datos.sistema           = alta.platform;
      if (alta?.platformVersion)  datos.version_sistema   = alta.platformVersion;
      if (alta?.uaFullVersion)    datos.version_navegador = alta.uaFullVersion;
      if (alta?.architecture)     datos.plataforma        = alta.architecture;

      // Aquí sí se puede separar Windows 11 de Windows 10: Microsoft
      // devuelve platformVersion 13 o mayor para Windows 11.
      if (alta?.platform === 'Windows' && alta?.platformVersion) {
        const mayor = parseInt(String(alta.platformVersion).split('.')[0], 10);
        if (Number.isFinite(mayor)) {
          datos.sistema = mayor >= 13 ? 'Windows 11' : 'Windows 10';
        }
      }
    }
  } catch {
    /* sin datos de alta entropía se queda lo del User-Agent */
  }

  return datos;
}

// ---------------------------------------------------------------------
// ENVÍO
// ---------------------------------------------------------------------

/**
 * Registra la visita. Es "dispara y olvida": no devuelve nada útil, no
 * lanza excepciones y no retrasa el arranque de la tienda. Si Supabase
 * está caído o la llamada falla, el cliente ni se entera.
 */
export async function registrarVisita(): Promise<void> {
  try {
    const huella = obtenerDeviceId();
    if (!huella) return;   // sin almacenamiento no hay a quién atribuir la visita

    // No repetir el envío en cada navegación dentro de la misma media hora.
    try {
      const ultimo = Number(localStorage.getItem(LLAVE_ULTIMO_ENVIO) || 0);
      if (Number.isFinite(ultimo) && Date.now() - ultimo < CADA_MS) return;
    } catch {
      /* si no se puede leer el reloj, se envía igual: es una llamada */
    }

    const datos = await leerDatosDelAparato();
    const { error } = await supabase.rpc('registrar_huella', {
      p_huella: huella,
      p_datos: datos,
    });

    // Solo se marca la hora si de verdad se guardó; si falló, que lo
    // reintente la próxima visita.
    if (!error) {
      try { localStorage.setItem(LLAVE_ULTIMO_ENVIO, String(Date.now())); } catch { /* da igual */ }
    }
  } catch {
    // Que la telemetría nunca sea el motivo de que alguien no pueda comprar.
  }
}
