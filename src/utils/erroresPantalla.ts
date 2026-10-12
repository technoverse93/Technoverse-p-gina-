// =====================================================================
// ERRORES DE PANTALLA — para que una pantalla oscura deje rastro
// =====================================================================
// Cuando la pantalla se rompe en un teléfono no hay consola que mirar. Acá se
// guardan en el propio aparato los últimos errores (solo el mensaje y dónde
// pasó, nunca datos de nadie) y, cuando el personal vuelve a entrar, se anotan
// en la bitácora del sistema para poder verlos y arreglarlos.
// =====================================================================

const CLAVE = 'tv_errores_pantalla';
const MAX_GUARDADOS = 6;

export interface ErrorPantalla {
  /** Cuándo pasó (ISO). */
  cuando: string;
  /** Quién lo detectó: «render» (la pantalla se rompió), «js» (error suelto) o «promesa». */
  origen: string;
  mensaje: string;
  /** Las primeras líneas de la pila, para ubicar el sitio. */
  pila: string;
  /** Qué compilación estaba corriendo. */
  version: string;
}

/** Ruido conocido que no rompe nada: no vale la pena guardarlo. */
const RUIDO = [
  /plugin is not implemented/i,
  /is not implemented on (android|ios|web)/i,
  /ResizeObserver loop/i,
  /^Script error\.?$/i,
  // Un fallo de red suelto («Failed to fetch» a secas): no es de la pantalla. «Failed to fetch dynamically
  // imported module» (un archivo de la app que no cargó) SÍ se guarda.
  /^(TypeError: )?Failed to fetch$/i,
  /^NetworkError/i,
  /^Load failed$/i,
  /AbortError/i,
  /The operation was aborted/i,
  /User cancell?ed|cancelad[oa]/i,
];

function versionActual(): string {
  const build = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : '?';
  const commit = typeof __COMMIT__ === 'string' && __COMMIT__ ? __COMMIT__ : '';
  return commit ? `${build} (${commit})` : build;
}

function aTexto(e: unknown): { mensaje: string; pila: string } {
  if (e instanceof Error) return { mensaje: String(e.message || e.name || 'Error'), pila: String(e.stack || '') };
  if (typeof e === 'string') return { mensaje: e, pila: '' };
  try { return { mensaje: JSON.stringify(e).slice(0, 300), pila: '' }; } catch { return { mensaje: String(e), pila: '' }; }
}

export function leerErroresPantalla(): ErrorPantalla[] {
  try {
    const lista = JSON.parse(localStorage.getItem(CLAVE) || '[]');
    return Array.isArray(lista) ? lista : [];
  } catch { return []; }
}

export function limpiarErroresPantalla(): void {
  try { localStorage.removeItem(CLAVE); } catch { /* sin almacenamiento */ }
}

/** Guarda un error (los últimos pocos, sin repetidos seguidos). Nunca lanza. */
export function anotarErrorPantalla(origen: string, error: unknown, extra?: string): void {
  try {
    const { mensaje, pila } = aTexto(error);
    if (RUIDO.some(r => r.test(mensaje))) return;
    const lista = leerErroresPantalla();
    const nuevo: ErrorPantalla = {
      cuando: new Date().toISOString(),
      origen,
      mensaje: mensaje.slice(0, 300),
      pila: [extra, pila].filter(Boolean).join('\n').split('\n').map(l => l.trim()).filter(Boolean).slice(0, 8).join('\n').slice(0, 900),
      version: versionActual(),
    };
    const ultimo = lista[0];
    if (ultimo && ultimo.mensaje === nuevo.mensaje && ultimo.origen === nuevo.origen) return;
    localStorage.setItem(CLAVE, JSON.stringify([nuevo, ...lista].slice(0, MAX_GUARDADOS)));
  } catch { /* guardar el rastro nunca debe romper nada */ }
}

let puesto = false;
/** Engancha los errores sueltos de la página para dejarles rastro. Una sola vez. */
export function instalarRegistroDeErrores(): void {
  if (puesto || typeof window === 'undefined') return;
  puesto = true;
  window.addEventListener('error', ev => {
    // Los errores de carga de imágenes/hojas llegan sin `error` ni mensaje útil.
    if (!ev.error && !ev.message) return;
    anotarErrorPantalla('js', ev.error ?? ev.message, ev.filename ? `${ev.filename}:${ev.lineno}:${ev.colno}` : undefined);
  });
  window.addEventListener('unhandledrejection', ev => {
    anotarErrorPantalla('promesa', ev.reason);
  });
}

/**
 * Pasa los errores guardados a la bitácora del sistema (una línea por error) y
 * los borra del aparato. Se llama cuando entra una persona del personal.
 */
export async function enviarErroresPendientes(correo: string): Promise<void> {
  try {
    const lista = leerErroresPantalla();
    if (!lista.length) return;
    limpiarErroresPantalla();
    const { addAuditLog } = await import('./storage');
    for (const e of lista.slice().reverse()) {
      addAuditLog(
        correo, 'Sistema', 'Error de pantalla',
        `${e.cuando} · ${e.origen} · versión ${e.version} · ${e.mensaje}${e.pila ? ' · ' + e.pila.replace(/\s*\n\s*/g, ' | ') : ''}`.slice(0, 1200),
      );
    }
  } catch { /* la bitácora no frena nada */ }
}
