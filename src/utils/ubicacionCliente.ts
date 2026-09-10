// =====================================================================
// UBICACIÓN DEL CLIENTE — modelo de tienda en línea, opcional y puntual
// =====================================================================
// Reemplaza a la captura de ubicación que existía antes, que venía atada
// a la supervisión y se pedía sola. Aquí la regla es la de cualquier
// e-commerce serio:
//
//   1. NUNCA se pide sola. `pedirUbicacion()` solo se llama desde el clic
//      de la persona, y solo en el paso de entrega del checkout — donde
//      la razón para pedirla es evidente.
//   2. Es OPCIONAL. Si la niega o no la usa, la compra sigue igual: la
//      referencia escrita a mano es la que manda para entregar.
//   3. Se usa para UNA cosa: saber la zona, para coordinar la entrega y
//      cotizar el envío. No alimenta ninguna vigilancia.
//   4. Se guarda en ESTE aparato (localStorage), no se rastrea a nadie.
//      `olvidarUbicacion()` la borra.
//
// ---------------------------------------------------------------------
// LA PROVINCIA ES UNA APROXIMACIÓN, Y SE DICE
// ---------------------------------------------------------------------
// Se resuelve por cercanía a la cabecera de cada provincia, sin llamar a
// ningún servicio de mapas (no hay clave de API que pagar ni un tercero
// al que mandarle la posición del cliente). Eso acierta en el Valle
// Central, que es de donde viene casi toda la compra, pero puede errar en
// cantones alejados —alguien en Pérez Zeledón puede caer en la provincia
// vecina—. Por eso la provincia es una PISTA para cotizar, y la nota de
// entrega escrita a mano sigue siendo la fuente de verdad.
// =====================================================================

/** Las mismas 7 que acepta el CHECK de `province` en la base. */
export type ProvinciaCR =
  | 'San José' | 'Alajuela' | 'Cartago' | 'Heredia'
  | 'Guanacaste' | 'Puntarenas' | 'Limón';

export interface UbicacionCliente {
  provincia: ProvinciaCR;
  lat: number;
  lon: number;
  /** Precisión declarada por el aparato, en metros. */
  precisionM: number | null;
  /** Cuándo se capturó, para no reutilizar una posición vieja sin avisar. */
  ts: string;
}

/** Cabeceras de provincia. Datos geográficos públicos, no del negocio. */
const CABECERAS: { provincia: ProvinciaCR; lat: number; lon: number }[] = [
  { provincia: 'San José', lat: 9.9333, lon: -84.0833 },
  { provincia: 'Alajuela', lat: 10.0162, lon: -84.2116 },
  { provincia: 'Cartago', lat: 9.8644, lon: -83.9194 },
  { provincia: 'Heredia', lat: 9.9981, lon: -84.1169 },
  { provincia: 'Guanacaste', lat: 10.6339, lon: -85.4377 },
  { provincia: 'Puntarenas', lat: 9.9763, lon: -84.8384 },
  { provincia: 'Limón', lat: 9.9907, lon: -83.0359 },
];

const CLAVE = 'technoverse_ubicacion_envio';

function distanciaKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Provincia más cercana a una posición. Ver la advertencia de la cabecera. */
export function provinciaAproximada(lat: number, lon: number): ProvinciaCR {
  let mejor = CABECERAS[0];
  let mejorDist = Infinity;
  for (const c of CABECERAS) {
    const d = distanciaKm(lat, lon, c.lat, c.lon);
    if (d < mejorDist) { mejorDist = d; mejor = c; }
  }
  return mejor.provincia;
}

/** ¿Este aparato puede siquiera dar ubicación? */
export function hayGeolocalizacion(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.geolocation;
}

export function ubicacionGuardada(): UbicacionCliente | null {
  try {
    const bruto = localStorage.getItem(CLAVE);
    if (!bruto) return null;
    const u = JSON.parse(bruto) as UbicacionCliente;
    return u && typeof u.lat === 'number' && typeof u.lon === 'number' ? u : null;
  } catch {
    return null;
  }
}

/** La borra de este aparato. Es lo que hace el botón "Quitar". */
export function olvidarUbicacion(): void {
  try { localStorage.removeItem(CLAVE); } catch { /* nada que borrar */ }
}

/**
 * Pide la ubicación UNA vez. DEBE llamarse desde el `onClick` de la
 * persona: sin gesto detrás, el navegador la niega y además nadie
 * debería encontrarse un cuadro de permiso que no pidió.
 *
 * Devuelve `null` si la niega, si no hay señal o si el aparato no tiene
 * GPS. En los tres casos la compra sigue su curso sin ubicación.
 */
export function pedirUbicacion(): Promise<UbicacionCliente | null> {
  return new Promise((resolver) => {
    if (!hayGeolocalizacion()) { resolver(null); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const u: UbicacionCliente = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          precisionM: Number.isFinite(pos.coords.accuracy) ? Math.round(pos.coords.accuracy) : null,
          provincia: provinciaAproximada(pos.coords.latitude, pos.coords.longitude),
          ts: new Date().toISOString(),
        };
        try { localStorage.setItem(CLAVE, JSON.stringify(u)); } catch { /* incógnito: vale para esta compra */ }
        resolver(u);
      },
      () => resolver(null),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  });
}

/** Enlace de mapa para que quien entrega vea el punto exacto. */
export function enlaceMapa(u: UbicacionCliente): string {
  return `https://www.google.com/maps?q=${u.lat},${u.lon}`;
}

/**
 * Línea lista para pegar en la nota de entrega. Va el enlace, porque es
 * lo único que le sirve de verdad a quien va manejando.
 */
export function referenciaParaEntrega(u: UbicacionCliente): string {
  const prec = u.precisionM != null ? ` (±${u.precisionM} m)` : '';
  return `Ubicación compartida: ${u.provincia}${prec} — ${enlaceMapa(u)}`;
}
