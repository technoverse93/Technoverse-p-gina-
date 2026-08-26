// =====================================================================
// TEMA CLARO / OSCURO
// =====================================================================
// Toda la plataforma consume variables CSS (`--bg-base`, `--accent`…),
// definidas en index.css para los dos temas. Cambiar de tema es por tanto
// poner o quitar UNA clase en <html>: no hay que tocar componentes ni
// pasar props por media aplicación.
//
// ---------------------------------------------------------------------
// POR QUÉ UN MÓDULO Y NO ESTADO EN App.tsx
// ---------------------------------------------------------------------
// La versión anterior guardaba el tema en App.tsx y lo bajaba por props
// (`theme`, `toggleTheme`) hasta PublicStore y AdminPanel, que a su vez
// lo pasaban a AdminShell y AdminDashboard. Cada componente nuevo que
// quisiera saber el tema obligaba a añadir un eslabón más a esa cadena, y
// olvidar uno dejaba la mitad de una pantalla con el tema equivocado.
//
// Aquí el estado vive fuera de React y se avisa por evento: cualquier
// componente llama a `useTema()` y ya, sin que nadie tenga que pasarle
// nada desde arriba.
// =====================================================================

export type Tema = 'claro' | 'oscuro';

const CLAVE = 'technoverse_tema';
const EVENTO = 'technoverse_tema_cambiado';

/**
 * Tema inicial, en este orden de prioridad:
 *   1. Lo que la persona eligió antes (queda guardado en el aparato).
 *   2. Lo que tenga configurado su sistema operativo.
 *   3. Claro.
 *
 * El acceso a localStorage va en try/catch a propósito: en la APK con
 * almacenamiento restringido, o en una ventana privada, `getItem` puede
 * lanzar, y un fallo al leer una preferencia visual no puede tumbar el
 * arranque de la aplicación.
 */
export function temaInicial(): Tema {
  try {
    const guardado = localStorage.getItem(CLAVE);
    if (guardado === 'claro' || guardado === 'oscuro') return guardado;
  } catch { /* sin preferencia guardada */ }
  try {
    if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'oscuro';
  } catch { /* el navegador no reporta preferencia */ }
  return 'claro';
}

/** Pinta el tema en el documento. Es lo único que cambia el aspecto. */
export function aplicarTema(tema: Tema): void {
  const raiz = document.documentElement;
  raiz.classList.toggle('dark', tema === 'oscuro');
  // `color-scheme` le dice al navegador de qué color pintar las barras de
  // scroll nativas y los controles de formulario. Sin esto, en tema oscuro
  // los desplegables nativos salían blancos sobre fondo carbón.
  raiz.style.colorScheme = tema === 'oscuro' ? 'dark' : 'light';
}

/** Guarda la elección, la aplica y avisa a quien esté escuchando. */
export function fijarTema(tema: Tema): void {
  try { localStorage.setItem(CLAVE, tema); } catch { /* no es crítico */ }
  aplicarTema(tema);
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: { tema } }));
}

export function alternarTema(): Tema {
  const siguiente: Tema = document.documentElement.classList.contains('dark') ? 'claro' : 'oscuro';
  fijarTema(siguiente);
  return siguiente;
}

/**
 * Se llama UNA vez, lo antes posible en el arranque. Aplica el tema y deja
 * escuchando el cambio de preferencia del sistema operativo, pero solo
 * mientras la persona no haya elegido explícitamente: quien ya escogió
 * claro no quiere que su teléfono se lo cambie a oscuro al anochecer.
 */
export function iniciarTema(): void {
  aplicarTema(temaInicial());
  try {
    const consulta = window.matchMedia('(prefers-color-scheme: dark)');
    consulta.addEventListener?.('change', e => {
      let hayEleccion = false;
      try { hayEleccion = !!localStorage.getItem(CLAVE); } catch { /* asume que no */ }
      if (hayEleccion) return;
      aplicarTema(e.matches ? 'oscuro' : 'claro');
      window.dispatchEvent(new CustomEvent(EVENTO, { detail: { tema: e.matches ? 'oscuro' : 'claro' } }));
    });
  } catch { /* sin soporte de matchMedia: se queda con el tema inicial */ }
}

export const EVENTO_TEMA = EVENTO;
