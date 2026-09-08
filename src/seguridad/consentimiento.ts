// =====================================================================
// CONSENTIMIENTO DE INICIO — el aviso estilo cookies de Technoverse
// =====================================================================
// Un solo lugar que recuerda qué autorizó la persona al entrar. La
// interfaz del aviso vive en `ModalConsentimiento.tsx`; aquí está solo el
// estado, para que cualquier parte de la app pregunte "¿me dieron permiso
// para X?" sin saber cómo se pintó el aviso.
//
// ---------------------------------------------------------------------
// CUATRO GRUPOS, DE CARA A LA PERSONA — CINCO PERMISOS, DE CARA AL CÓDIGO
// ---------------------------------------------------------------------
// El aviso muestra 4 interruptores (soporte técnico, ubicación, canal de
// comunicación, alertas de sesión). Por dentro son 5 capacidades técnicas
// distintas, porque "soporte técnico" agrupa DOS cosas que el resto de la
// app sigue tratando por separado (el espejo del DOM y la pantalla
// completa nativa/de escritorio son mecanismos y código distintos, aunque
// la persona los vea como un solo interruptor). `MAPA_GRUPO` es la única
// tabla de traducción entre las dos vistas.
export type ClaveConsentimiento =
  | 'supervision'
  | 'pantallaCompleta'
  | 'camara'
  | 'ubicacion'
  | 'alertas';

/** Los 4 grupos que la persona ve y decide. */
type Grupo = 'support_ti' | 'location' | 'communication' | 'alerts';

const MAPA_GRUPO: Record<ClaveConsentimiento, Grupo> = {
  supervision: 'support_ti',
  pantallaCompleta: 'support_ti',
  camara: 'communication',
  ubicacion: 'location',
  alertas: 'alerts',
};

/**
 * Estructura de guardado. Es la que se pidió tal cual: clave de
 * localStorage `app_user_consent_v1`, y este objeto exacto — sin campos
 * de más.
 */
export interface EstadoConsentimiento {
  /** Momento en que se respondió, para poder auditarlo. */
  timestamp: string;
  /** Versión del aviso aceptado. Si sube, se vuelve a preguntar. */
  version: number;
  /** true = tocó "Aceptar" directo, sin abrir "Configurar". */
  granted_all: boolean;
  preferences: Record<Grupo, boolean>;
}

/**
 * Sube esto SOLO si cambia lo que se pide o lo que dice el aviso. Al
 * subir, a todo el mundo se le vuelve a preguntar — un consentimiento
 * viejo no cubre permisos nuevos.
 */
export const VERSION_CONSENTIMIENTO = 2;

const CLAVE_LS = 'app_user_consent_v1';

/** Lo que concede "Aceptar" a secas, sin abrir "Configurar". */
export const PERMISOS_POR_DEFECTO: Record<Grupo, boolean> = {
  support_ti: true,
  location: true,
  communication: true,
  alerts: true,
};

let cache: EstadoConsentimiento | null = null;

export function leerConsentimiento(): EstadoConsentimiento | null {
  if (cache) return cache;
  if (typeof window === 'undefined') return null;
  try {
    const bruto = localStorage.getItem(CLAVE_LS);
    if (!bruto) return null;
    const g = JSON.parse(bruto) as EstadoConsentimiento;
    // Un consentimiento de una versión vieja no vale: se ignora y se
    // vuelve a preguntar. No se borra hasta que la persona responda de
    // nuevo, por si hiciera falta consultarlo.
    if (!g || g.version !== VERSION_CONSENTIMIENTO) return null;
    cache = g;
    return g;
  } catch {
    return null;
  }
}

/** ¿Ya respondió al aviso de esta versión? (aceptado o rechazado) */
export function yaRespondio(): boolean {
  return leerConsentimiento() !== null;
}

/** ¿Autorizó esta capacidad concreta? Falla cerrado: sin dato, no. */
export function permisoConcedido(clave: ClaveConsentimiento): boolean {
  const c = leerConsentimiento();
  if (!c) return false;
  return c.preferences[MAPA_GRUPO[clave]] === true;
}

/**
 * Guarda la respuesta.
 *
 * `grantedAll` es SOLO sobre el CAMINO que tomó la persona (tocó
 * "Aceptar" sin abrir "Configurar"), no sobre el resultado — alguien
 * puede abrir "Configurar", dejar todo prendido y guardar: eso sigue
 * siendo `grantedAll: false` porque pasó por la personalización.
 *
 * Rechazar se guarda llamando esto con `preferences` en falso para los
 * 4 grupos: no hace falta un campo aparte para "rechazado", porque
 * `permisoConcedido` ya lee `preferences` directo.
 */
export function guardarConsentimiento(
  grantedAll: boolean,
  preferences: Record<Grupo, boolean>
): EstadoConsentimiento {
  const estado: EstadoConsentimiento = {
    timestamp: new Date().toISOString(),
    version: VERSION_CONSENTIMIENTO,
    granted_all: grantedAll,
    preferences,
  };
  cache = estado;
  try { localStorage.setItem(CLAVE_LS, JSON.stringify(estado)); } catch { /* modo incógnito: vale para la sesión */ }
  try { window.dispatchEvent(new CustomEvent('technoverse_consentimiento', { detail: estado })); } catch { /* nada */ }
  return estado;
}
