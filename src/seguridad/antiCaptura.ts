// =====================================================================
// ANTI-CAPTURA WEB — lo poco que un navegador SÍ puede hacer
// =====================================================================
// Regla: NADIE captura, para todos por igual. Sin lista blanca, sin
// excepciones, sin consola de administración: se activa una vez al
// arrancar y queda así siempre.
//
// ---------------------------------------------------------------------
// HONESTIDAD TÉCNICA, PORQUE IMPORTA
// ---------------------------------------------------------------------
// Un sitio web NO PUEDE bloquear una captura de pantalla de verdad. Es una
// limitación del navegador y del sistema operativo, no de este código:
// cualquier herramienta del sistema (Recorte, PrtScn, otro teléfono
// fotografiando la pantalla) siempre puede capturar lo que se ve. Nada de
// lo que sigue cambia eso — son dos molestias puntuales, no una barrera:
//
//   1. IMPRESIÓN EN BLANCO — una hoja `@media print` oculta el documento
//      al imprimir o "Guardar como PDF", que es la fuga más fácil y la
//      que nadie vigila a simple vista.
//
//   2. PrintScreen — al soltar la tecla se pisa el portapapeles con
//      vacío, así una captura reciente no sirve al pegarla. La captura ya
//      se tomó igual: esto no la evita, solo estorba reusarla al toque.
//
// El bloqueo REAL en la APK (Android) es otro archivo, flagSecure.ts, que
// sí impide la captura de verdad porque lo aplica el sistema operativo.
// =====================================================================

const ID_ESTILO = 'tv-anti-captura-impresion';
let puesto = false;

function hojaDeImpresion(): void {
  if (document.getElementById(ID_ESTILO)) return;
  const estilo = document.createElement('style');
  estilo.id = ID_ESTILO;
  // `visibility` y no `display:none`: algunos navegadores cancelan la
  // impresión si el documento queda sin caja, y una impresión cancelada
  // deja la duda de si salió algo. Así sale una hoja, pero en blanco.
  estilo.textContent = `@media print {
    html body > * { visibility: hidden !important; }
    html body::after {
      content: "Contenido protegido - Technoverse";
      visibility: visible !important;
      position: fixed; inset: 0;
      display: flex; align-items: center; justify-content: center;
      font: 600 12pt system-ui, sans-serif; color: #999;
    }
  }`;
  document.head.appendChild(estilo);
}

/**
 * Pisa el portapapeles VARIAS VECES tras un PrintScreen.
 *
 * Windows no copia la imagen en el mismo instante en que se suelta la
 * tecla: la escribe un poco después. Pisarlo una sola vez, de inmediato,
 * llegaba ANTES que el sistema — se borraba el portapapeles vacío y el
 * sistema escribía la captura encima, tan tranquilo. Repitiéndolo durante
 * el segundo siguiente, el último en escribir somos nosotros.
 */
function pisarPortapapeles(): void {
  const intentar = () => {
    try {
      if (!document.hasFocus()) return;
      void navigator.clipboard?.writeText('')?.catch?.(() => {});
    } catch { /* sin permiso de portapapeles */ }
  };
  intentar();
  [120, 350, 800, 1500].forEach(ms => setTimeout(intentar, ms));
}

function alTeclear(e: KeyboardEvent): void {
  // Imprimir / Guardar como PDF: se corta antes de abrir el diálogo.
  if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
    e.preventDefault();
    e.stopPropagation();
  }
}

function alSoltarTecla(e: KeyboardEvent): void {
  if (e.key !== 'PrintScreen') return;
  pisarPortapapeles();
}

/**
 * Activa el escudo web, una sola vez, para toda la aplicación (tienda y
 * panel, con y sin sesión). Idempotente.
 */
export function iniciarAntiCaptura(): void {
  if (typeof window === 'undefined' || puesto) return;
  puesto = true;
  hojaDeImpresion();
  window.addEventListener('keydown', alTeclear, true);
  window.addEventListener('keyup', alSoltarTecla, true);
}
