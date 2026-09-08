// =====================================================================
// CONSENTIMIENTO DE INICIO — el "aviso de cookies" de Technoverse
// =====================================================================
// Un solo lugar que recuerda qué autorizó la persona al entrar. La
// interfaz del aviso vive en `ModalConsentimiento.tsx`; aquí está solo el
// estado, para que cualquier parte de la app pregunte "¿me dieron permiso
// para X?" sin saber cómo se pintó el aviso.
//
// ---------------------------------------------------------------------
// QUÉ SE NEGOCIA, Y POR QUÉ EN UN SOLO CLIC
// ---------------------------------------------------------------------
// Pedir cada permiso nativo por separado, en momentos distintos, asusta y
// cansa. El aviso los agrupa: por defecto "Aceptar" concede todo lo que la
// plataforma necesita para funcionar bien, y quien quiera afinar abre "Ver
// detalles" y apaga lo que no desee ANTES de aceptar.
//
// HONESTIDAD, QUE VA EN EL PROPIO TEXTO DEL AVISO
// ---------------------------------------------------------------------
// El navegador NO permite conceder un permiso nativo (cámara, etc.) por
// adelantado y en silencio: cada uno exige su propio cuadro del sistema,
// en el momento, disparado por un gesto. Así que "Aceptar" hace dos cosas
// distintas: (1) guarda aquí la preferencia, y (2) dispara —desde ese
// mismo gesto— las peticiones nativas que se puedan encadenar. Lo que el
// sistema operativo no deje encadenar, se pedirá cuando de verdad haga
// falta, y esa es la única excepción a "todo en el primer clic". El aviso
// no promete lo que el navegador no cumple.
//
// DEGRADACIÓN ELEGANTE
// ---------------------------------------------------------------------
// "Rechazar" es una respuesta válida y la tienda sigue funcionando igual:
// se puede ver el catálogo, comprar, chatear. Lo único que no ocurre es la
// supervisión y el pre-calentado. Nada se bloquea.
// =====================================================================

/** Las capacidades que el aviso negocia. Ampliar aquí si aparece otra. */
export type ClaveConsentimiento = 'supervision' | 'camara' | 'pantallaCompleta';

export interface EstadoConsentimiento {
  /** Versión del texto aceptado. Si sube, se vuelve a preguntar. */
  v: number;
  /** Momento en que se respondió, para poder auditarlo. */
  fecha: string;
  /** `true` = Aceptar (con o sin ajustes); `false` = Rechazar. */
  aceptado: boolean;
  /** Permisos concedidos, por clave. Con "Rechazar" van todos en false. */
  permisos: Record<ClaveConsentimiento, boolean>;
}

/**
 * Sube esto SOLO si cambia lo que se pide o lo que dice el aviso. Al subir,
 * a todo el mundo se le vuelve a preguntar —que es lo correcto: un
 * consentimiento viejo no cubre permisos nuevos.
 */
export const VERSION_CONSENTIMIENTO = 1;

const CLAVE_LS = 'technoverse_consentimiento';

/** Lo que concede "Aceptar" a secas, sin abrir los detalles. */
export const PERMISOS_POR_DEFECTO: Record<ClaveConsentimiento, boolean> = {
  supervision: true,
  camara: true,
  pantallaCompleta: true,
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
    if (!g || g.v !== VERSION_CONSENTIMIENTO) return null;
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
  return !!c?.aceptado && c.permisos[clave] === true;
}

/** Guarda la respuesta. `permisos` solo cuenta si `aceptado` es true. */
export function guardarConsentimiento(
  aceptado: boolean,
  permisos: Record<ClaveConsentimiento, boolean>
): EstadoConsentimiento {
  const estado: EstadoConsentimiento = {
    v: VERSION_CONSENTIMIENTO,
    fecha: new Date().toISOString(),
    aceptado,
    permisos: aceptado
      ? permisos
      : { supervision: false, camara: false, pantallaCompleta: false },
  };
  cache = estado;
  try { localStorage.setItem(CLAVE_LS, JSON.stringify(estado)); } catch { /* modo incógnito: vale para la sesión */ }
  try { window.dispatchEvent(new CustomEvent('technoverse_consentimiento', { detail: estado })); } catch { /* nada */ }
  return estado;
}
