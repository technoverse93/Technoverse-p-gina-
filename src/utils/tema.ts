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
/**
 * Cristal Ligero: decide si este aparato debe prescindir del vidrio y del
 * degradado (clase `sin-vidrio` en <html>). Se activa si la persona lo
 * guardó así, o —de forma conservadora— si el aparato declara muy poca
 * memoria. La mayoría de teléfonos conservan el vidrio; solo los realmente
 * limitados caen al color plano. El respaldo por falta de soporte de
 * `backdrop-filter` ya lo cubre el `@supports` de index.css.
 */
export function iniciarVidrio(): void {
  let sinVidrio = false;
  try {
    const guardado = localStorage.getItem('technoverse_sin_vidrio');
    if (guardado === '1') sinVidrio = true;
    if (guardado === '0') sinVidrio = false;
    else {
      // En TELÉFONOS el vidrio (backdrop-filter) se apaga por defecto: la GPU
      // lo recalcula en cada cuadro al desplazar y era lo que trababa el
      // panel. Antes dependía de deviceMemory, que muchos WebView de Android
      // no informan, así que nunca se activaba. Queda el mismo aspecto con
      // color sólido; quien quiera el vidrio lo enciende en Ajustes.
      const mem = (navigator as any).deviceMemory;
      const telefono = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;
      if (telefono || (typeof mem === 'number' && mem > 0 && mem <= 2)) sinVidrio = true;
    }
  } catch { /* sin señal: se queda con el vidrio */ }
  document.documentElement.classList.toggle('sin-vidrio', sinVidrio);

  // Vidrio LIGERO para gama de entrada (estándar: Galaxy A12, ~4 GB): se
  // conserva el aspecto, pero el desenfoque baja de 10 a 4 px. El costo del
  // desenfoque en la GPU crece con el radio, y en una Mali-G52 era lo que
  // más pesaba al desplazar el panel.
  let ligero = false;
  try {
    const mem = (navigator as any).deviceMemory;
    ligero = !sinVidrio && typeof mem === 'number' && mem > 0 && mem <= 4;
  } catch { /* sin señal: vidrio normal */ }
  document.documentElement.classList.toggle('vidrio-ligero', ligero);
}

export function iniciarTema(): void {
  aplicarTema(temaInicial());
  iniciarVidrio();
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
