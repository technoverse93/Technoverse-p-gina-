// =====================================================================
// TELEMETRÍA LIGERA DEL APARATO — batería y red, tipo "estado de Discord"
// =====================================================================
// Solo lee APIs que el navegador YA expone sin pedir permiso: nada de
// esto dispara un diálogo ni necesita consentimiento nuevo. Cuando el
// navegador no las tiene (Safari/iOS no trae Battery API ni
// NetworkInformation, por ejemplo), se devuelve `null` en esa parte y el
// panel simplemente no la muestra — no es un error, es la realidad de
// ese aparato.
// =====================================================================

export interface EstadoBateria {
  /** 0 a 100. */
  nivel: number;
  cargando: boolean;
}

export interface EstadoRed {
  /** '4g', '3g', 'wifi'... lo que el navegador reporte; puede venir vacío. */
  tipo: string;
  /** Ida y vuelta estimada por el propio navegador, en ms. */
  rttMs: number | null;
  /** Ancho de banda estimado, en Mbps. */
  downlinkMbps: number | null;
}

export interface Telemetria {
  bateria: EstadoBateria | null;
  red: EstadoRed | null;
}

async function leerBateria(): Promise<EstadoBateria | null> {
  try {
    const obtener = (navigator as any)?.getBattery;
    if (typeof obtener !== 'function') return null;
    const b = await obtener.call(navigator);
    if (!b || typeof b.level !== 'number') return null;
    return { nivel: Math.round(b.level * 100), cargando: !!b.charging };
  } catch {
    return null;
  }
}

function leerRed(): EstadoRed | null {
  try {
    const con = (navigator as any)?.connection || (navigator as any)?.mozConnection || (navigator as any)?.webkitConnection;
    if (!con) return null;
    return {
      tipo: con.effectiveType || con.type || '',
      rttMs: typeof con.rtt === 'number' ? con.rtt : null,
      downlinkMbps: typeof con.downlink === 'number' ? con.downlink : null,
    };
  } catch {
    return null;
  }
}

/** Instantánea de ahora mismo. Nunca lanza, nunca pide permiso. */
export async function leerTelemetria(): Promise<Telemetria> {
  const [bateria, red] = await Promise.all([leerBateria(), Promise.resolve(leerRed())]);
  return { bateria, red };
}
