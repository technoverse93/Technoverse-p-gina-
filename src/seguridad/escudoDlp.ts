// =====================================================================
// ESCUDO DLP — anti-captura del lado del personal (Zero Trust · Etapa 4)
// =====================================================================
// Regla base: NADIE captura. El Superadmin habilita excepciones por cuenta
// y por capa (web / APK) desde la Consola de Capturas. Este módulo es el
// que obedece esa lista en el aparato de cada quien.
//
// Tres defensas, más la nativa:
//
//   1. IMPRESIÓN EN BLANCO — una hoja de estilo `@media print` que oculta
//      el documento entero. Cubre "Imprimir" y "Guardar como PDF", que es
//      la fuga más fácil y la que nadie vigila.
//
//   2. PrintScreen — al soltar la tecla se pisa el portapapeles con vacío,
//      así lo que se haya copiado deja de servir. Ctrl/Cmd+P se cancela
//      antes de que abra el diálogo.
//
//   3. VELO AL PERDER EL FOCO — si la ventana pasa a segundo plano o se
//      oculta la pestaña, se tapa todo con un panel opaco. Eso mata la
//      vista previa del conmutador de apps y las grabaciones de pantalla
//      que capturan una ventana en segundo plano.
//
//   4. FLAG_SECURE (APK) — el único bloqueo REAL, delegado a flagSecure.ts.
//
// ---------------------------------------------------------------------
// HONESTIDAD, QUE ES PARTE DEL DISEÑO
// ---------------------------------------------------------------------
// En la web esto DISUADE, no blinda. Nada impide una foto con otro
// teléfono, una máquina virtual o las herramientas del navegador. Se
// implementa igual porque sube mucho el costo del descuido —el 99% de las
// fugas reales son una captura rápida, no un ataque—, pero no debe
// venderse como blindaje. En la APK, FLAG_SECURE sí bloquea de verdad.
//
// FALLA CERRADO: si la consulta de permisos falla, el escudo se PONE. Un
// error de red nunca destapa la pantalla.
// =====================================================================

import { supabase } from '../supabaseClient';
import { esStaff } from '../utils/roles';
import { fijarFlagSecure, esNativo } from './flagSecure';
import type { User } from '../types';

const ID_ESTILO = 'tv-dlp-impresion';
const ID_VELO = 'tv-dlp-velo';
/** Red de seguridad por si un evento de Realtime se pierde. */
const RESINCRONIZAR_MS = 60000;

let usuario: User | null = null;
let canal: any = null;
let reloj: ReturnType<typeof setInterval> | null = null;
let puesto = false;

// ---------------------------------------------------------------------
// Piezas del escudo
// ---------------------------------------------------------------------

function hojaDeImpresion(): void {
  if (document.getElementById(ID_ESTILO)) return;
  const estilo = document.createElement('style');
  estilo.id = ID_ESTILO;
  // `visibility` en vez de `display:none`: algunos navegadores cancelan la
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

function velo(): HTMLElement {
  const previo = document.getElementById(ID_VELO);
  if (previo) return previo;
  const el = document.createElement('div');
  el.id = ID_VELO;
  el.setAttribute('aria-hidden', 'true');
  // NEGRO PURO, estilo "Netflix": si una captura llega a colarse, que lo
  // que salga sea una lámina negra, no una versión atenuada del panel. El
  // z-index es el máximo posible y se pinta con su propio color de fondo
  // opaco, sin depender de ningún filtro que el sistema pudiera ignorar al
  // capturar.
  //
  // SE QUEDA MONTADO Y SE ENCIENDE CON `visibility`, NO CON `display`.
  // Con `display:none` el navegador tiene que rehacer el layout de la
  // página entera antes de poder pintar el negro, y eso son varios
  // milisegundos justo en el instante en que la captura ya está saliendo.
  // Montado desde el principio, promovido a su propia capa con
  // `translateZ(0)` y `will-change`, encenderlo es solo un cambio de
  // composición: se pinta en el siguiente fotograma sin recalcular nada.
  el.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:2147483647',
    'background:#000',
    'display:flex', 'visibility:hidden', 'opacity:0',
    'align-items:center', 'justify-content:center',
    'padding:24px', 'text-align:center',
    'color:#4b5563', 'font:600 13px system-ui,sans-serif',
    'letter-spacing:.01em', 'user-select:none',
    'pointer-events:none',
    'transform:translateZ(0)', 'will-change:opacity,visibility',
  ].join(';');
  el.textContent = 'Contenido protegido.';
  document.body.appendChild(el);
  return el;
}

/** Enciende o apaga el velo ya montado. Sin recalcular layout. */
function pintarVelo(el: HTMLElement, encendido: boolean): void {
  el.style.visibility = encendido ? 'visible' : 'hidden';
  el.style.opacity = encendido ? '1' : '0';
  el.style.pointerEvents = encendido ? 'auto' : 'none';
}

/** Cuánto se sostiene el negro tras un intento de captura. */
const DESTELLO_MS = 1200;
let destelloTimer: ReturnType<typeof setTimeout> | null = null;

function taparPantalla(tapar: boolean): void {
  if (!puesto) return;
  // Un destello en curso manda: no lo cortamos con un focus intermedio.
  if (!tapar && destelloTimer) return;
  pintarVelo(velo(), tapar);
}

/**
 * Blackout inmediato ante un INTENTO de captura por atajo del sistema.
 * En la web no se puede impedir la captura, pero muchos atajos —el Recorte
 * de Windows (Win+Shift+S), la captura de macOS (Cmd+Shift+3/4/5)— dejan un
 * instante entre que se pulsa la tecla y el sistema congela la pantalla.
 * Pintar el negro en ese instante hace que lo que se capture sea la lámina.
 * No es garantía (a veces el sistema gana la carrera), pero sube mucho el
 * costo del descuido, que es de lo que se trata.
 */
function destelloBlackout(): void {
  if (!puesto) return;
  pintarVelo(velo(), true);
  if (destelloTimer) clearTimeout(destelloTimer);
  destelloTimer = setTimeout(() => {
    destelloTimer = null;
    // Solo se baja si la ventana está al frente; si no, lo mantiene el
    // velo normal de pérdida de foco.
    if (document.visibilityState === 'visible' && document.hasFocus()) {
      pintarVelo(velo(), false);
    }
  }, DESTELLO_MS);
}

/**
 * Pisa el portapapeles VARIAS VECES tras un PrintScreen.
 *
 * Windows no copia la imagen en el mismo instante en que se suelta la
 * tecla: la escribe un poco después. Pisarlo una sola vez, de inmediato,
 * llegaba ANTES que el sistema — se borraba el portapapeles vacío y el
 * sistema escribía la captura encima, tan tranquilo. Repitiéndolo durante
 * el segundo siguiente, el último en escribir somos nosotros y lo que
 * quede al pegar es vacío.
 *
 * `writeText` exige que el documento tenga el foco; si lo perdió, el
 * intento falla en silencio y lo cubre el siguiente.
 */
function pisarPortapapeles(): void {
  const intentar = () => {
    try {
      if (!document.hasFocus()) return;
      void navigator.clipboard?.writeText('')?.catch?.(() => {});
    } catch { /* sin permiso */ }
  };
  intentar();
  [120, 350, 800, 1500].forEach(ms => setTimeout(intentar, ms));
}

const alPerderFoco = () => taparPantalla(true);
const alRecuperarFoco = () => taparPantalla(false);
const alCambiarVisibilidad = () => taparPantalla(document.visibilityState === 'hidden');

function esCombinacionDeCaptura(e: KeyboardEvent): boolean {
  // Windows: Win+Shift+S (Recorte). El navegador ve la Meta + Shift + S.
  if (e.shiftKey && e.metaKey && (e.key === 'S' || e.key === 's')) return true;
  // macOS: Cmd+Shift+3/4/5. La 5 abre la barra de grabación.
  if (e.shiftKey && e.metaKey && ['3', '4', '5'].includes(e.key)) return true;
  // ADELANTARSE: la tecla Windows / Cmd SOLA. Los atajos de recorte
  // empiezan siempre por ella, y entre que se pulsa y llega la S pasan
  // decenas de milisegundos — una eternidad comparada con el fotograma
  // que necesita el velo. Poniendo el negro ya en la modificadora, el
  // recorte encuentra la lámina puesta en vez de llegar tarde.
  // Si no era una captura, el destello se retira solo en 1,2 s.
  if (e.key === 'Meta' || e.key === 'OS') return true;
  return false;
}

function alTeclear(e: KeyboardEvent): void {
  // Imprimir / Guardar como PDF: se corta antes de abrir el diálogo.
  if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  // Atajos de recorte del sistema: negro de inmediato.
  if (esCombinacionDeCaptura(e) || e.key === 'PrintScreen') destelloBlackout();
}

function alSoltarTecla(e: KeyboardEvent): void {
  if (e.key !== 'PrintScreen') return;
  // La tecla ya disparó la captura del sistema: no se puede cancelar. Se
  // pisa el portapapeles para que lo capturado no sirva al pegarlo, y se
  // deja el negro puesto un instante por si la captura fuera diferida.
  pisarPortapapeles();
  destelloBlackout();
}

// ---------------------------------------------------------------------
// Poner / quitar
// ---------------------------------------------------------------------

/**
 * Motivos por los que el escudo está puesto ahora mismo.
 *
 * Hay DOS fuentes independientes y no pueden pisarse: la lista blanca del
 * personal ('dlp') y el chat abierto de un cliente ('chat'). Sin contarlos,
 * cerrar el chat retiraría también el escudo de un empleado bloqueado, y
 * sincronizar la lista blanca lo retiraría con el chat abierto. El escudo
 * se pone si hay AL MENOS un motivo y se retira solo cuando no queda
 * ninguno.
 */
const motivos = new Set<string>();

function pedirEscudo(motivo: string): void {
  motivos.add(motivo);
  aplicarEscudo();
}

function soltarEscudo(motivo: string): void {
  motivos.delete(motivo);
  if (motivos.size === 0) quitarEscudo();
}

/**
 * Escudo para el CLIENTE mientras tiene el chat abierto.
 *
 * No pasa por la lista blanca —un cliente no está en ella— porque protege
 * otra cosa: la conversación que el administrador puede borrar. Se activa
 * al abrir el chat y se retira al cerrarlo, para no dejar la tienda entera
 * a oscuras cada vez que alguien cambia de aplicación.
 */
export function escudoDeChat(activo: boolean): void {
  if (typeof window === 'undefined') return;
  if (activo) pedirEscudo('chat');
  else soltarEscudo('chat');
}

function aplicarEscudo(): void {
  if (puesto) return;
  puesto = true;
  hojaDeImpresion();
  velo();
  window.addEventListener('blur', alPerderFoco);
  window.addEventListener('focus', alRecuperarFoco);
  document.addEventListener('visibilitychange', alCambiarVisibilidad);
  window.addEventListener('keydown', alTeclear, true);
  window.addEventListener('keyup', alSoltarTecla, true);
}

function quitarEscudo(): void {
  if (!puesto) return;
  puesto = false;
  if (destelloTimer) { clearTimeout(destelloTimer); destelloTimer = null; }
  window.removeEventListener('blur', alPerderFoco);
  window.removeEventListener('focus', alRecuperarFoco);
  document.removeEventListener('visibilitychange', alCambiarVisibilidad);
  window.removeEventListener('keydown', alTeclear, true);
  window.removeEventListener('keyup', alSoltarTecla, true);
  document.getElementById(ID_ESTILO)?.remove();
  document.getElementById(ID_VELO)?.remove();
}

// ---------------------------------------------------------------------
// Lectura del permiso propio
// ---------------------------------------------------------------------

/**
 * ¿Esta cuenta puede capturar EN ESTA CAPA?
 *
 * Lee su PROPIA fila —la RLS solo le deja ver esa— y falla cerrado: sin
 * fila, con error o sin permiso para la capa actual, la respuesta es no.
 */
async function puedeCapturar(): Promise<boolean> {
  if (!usuario) return false;
  try {
    const { data, error } = await supabase
      .from('dlp_whitelist')
      .select('allow_web, allow_apk')
      .eq('user_id', usuario.id)
      .maybeSingle();
    if (error || !data) return false;
    return esNativo() ? data.allow_apk === true : data.allow_web === true;
  } catch {
    return false;
  }
}

async function sincronizar(): Promise<void> {
  if (!usuario) return;
  const permitido = await puedeCapturar();
  if (permitido) soltarEscudo('dlp');
  else pedirEscudo('dlp');
  // El bloqueo nativo sigue la misma decisión (no-op fuera de la APK).
  void fijarFlagSecure(!permitido);
}

// ---------------------------------------------------------------------
// API
// ---------------------------------------------------------------------

/**
 * Arranca el escudo para una sesión de PERSONAL. Idempotente.
 *
 * MANDA LA LISTA BLANCA, INCLUIDO EL SUPERADMIN. Antes el Superadmin
 * quedaba exento por código, y el efecto práctico era que quien administra
 * el sistema no podía comprobar nunca si el escudo funcionaba: probaba una
 * captura en su propia sesión, no pasaba nada, y parecía que el escudo
 * estaba roto. Ahora la regla es una sola para todos —sin fila en la lista
 * blanca, escudo puesto— y el Superadmin se concede a sí mismo el permiso
 * desde la Consola de Capturas cuando necesite documentar el sistema.
 *
 * Un Cliente nunca entra aquí — la tienda pública jamás se escuda, que
 * sería hostil con quien viene a comprar. Su chat sí, por `escudoDeChat`.
 */
export function iniciarEscudoDlp(user: User): void {
  if (typeof window === 'undefined' || !user || !esStaff(user.role)) return;
  detenerEscudoDlp();

  usuario = user;
  void sincronizar();

  // La tabla tiene REPLICA IDENTITY FULL, así que el DELETE de una
  // revocación también trae el user_id y este filtro lo reconoce.
  canal = supabase
    .channel(`dlp-${user.id}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'dlp_whitelist', filter: `user_id=eq.${user.id}` },
      () => { void sincronizar(); }
    )
    .subscribe();

  reloj = setInterval(() => void sincronizar(), RESINCRONIZAR_MS);
}

/** Retira el escudo por completo. Llamar al cerrar sesión. */
export function detenerEscudoDlp(): void {
  if (reloj) { clearInterval(reloj); reloj = null; }
  if (canal) { try { supabase.removeChannel(canal); } catch { /* nada */ } canal = null; }
  // Solo se suelta el motivo del personal: si el cliente tiene el chat
  // abierto, su escudo sigue en pie.
  soltarEscudo('dlp');
  void fijarFlagSecure(false);
  usuario = null;
}
