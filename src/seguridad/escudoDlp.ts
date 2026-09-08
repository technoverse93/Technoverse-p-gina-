// =====================================================================
// ESCUDO DLP — anti-captura de TODA la aplicación (Zero Trust · Etapa 4)
// =====================================================================
// Regla base: NADIE captura. Ni el personal, ni el visitante anónimo de la
// tienda pública. El Superadmin habilita excepciones por cuenta y por capa
// (web / APK) desde la Consola de Capturas; este módulo obedece esa lista
// en el aparato de cada quien.
//
// La tienda pública estuvo fuera del escudo un tiempo, y era deliberado:
// tapar el catálogo cada vez que alguien cambia de aplicación se lee como
// que la app se rompió. El dueño pidió cubrirla igualmente, así que la
// regla es una sola para todos. Para revertirlo basta con no llamar a
// `iniciarEscudoGlobal()` desde App.tsx.
//
// Tres defensas, más la nativa:
//
//   1. IMPRESIÓN EN BLANCO — una hoja de estilo `@media print` que oculta
//      el documento entero. Cubre "Imprimir" y "Guardar como PDF", que es
//      la fuga más fácil y la que nadie vigila.
//
//   2. PrintScreen — al soltar la tecla se pisa el portapapeles con vacío,
//      así lo que se haya copiado deja de servir. Ctrl/Cmd+P se cancela
//      antes de que abra el diálogo. Ninguna de las dos tapa la pantalla.
//
//   3. VELO AL OCULTARSE LA PÁGINA — y SOLO entonces. Se enciende cuando
//      `document.visibilityState` pasa a 'hidden': minimizar, cambiar de
//      pestaña, irse a la pantalla de inicio. Eso mata la vista previa del
//      conmutador de apps.
//      NO se enciende con el teclado del teléfono, la galería, la barra de
//      notificaciones ni las teclas del sistema: la página sigue visible
//      debajo y la supervisión no se puede cortar por eso.
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

/**
 * Enciende o apaga el velo ya montado. Sin recalcular layout.
 *
 * NUNCA captura el puntero, ni encendido. El velo es un tapón visual, no
 * una barrera: si por un fallo de foco se quedara puesto, con
 * `pointer-events:auto` la tienda quedaría inservible —pantalla negra que
 * no responde— y eso es mucho peor que una captura. Dejándolo transparente
 * al puntero, en el peor caso se sigue pudiendo comprar a ciegas, y el
 * primer toque lo retira (ver `alTocar`).
 */
function pintarVelo(el: HTMLElement, encendido: boolean): void {
  el.style.visibility = encendido ? 'visible' : 'hidden';
  el.style.opacity = encendido ? '1' : '0';
}

function taparPantalla(tapar: boolean): void {
  if (!puesto) return;
  pintarVelo(velo(), tapar);
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

/**
 * ÚNICA condición para el velo: la página deja de ser visible.
 *
 * ---------------------------------------------------------------------
 * POR QUÉ SE FUE `window.blur`
 * ---------------------------------------------------------------------
 * `blur` dispara con CUALQUIER cosa que se robe el foco sin que la persona
 * se vaya a ningún lado: abrir el teclado del teléfono, elegir una foto de
 * la galería, bajar la barra de notificaciones para mirar un WhatsApp,
 * pulsar una tecla del sistema. En todos esos casos la página sigue ahí,
 * debajo, perfectamente viva — y sin embargo el escudo la tapaba y la
 * supervisión se cortaba a media frase. Eran falsos positivos, y bastantes
 * como para volver inútil el espejo.
 *
 * `document.visibilityState` responde a la pregunta correcta: ¿esta página
 * dejó de verse? Solo pasa a 'hidden' cuando se minimiza el navegador, se
 * cambia de pestaña o se va uno a la pantalla de inicio del teléfono. El
 * teclado y la barra de notificaciones NO la ocultan, así que el DOM sigue
 * transmitiéndose intacto.
 *
 * Lo que se pierde con esto queda dicho: el velo ya no salta con los
 * atajos de recorte (Win+Shift+S y compañía), porque esos no ocultan la
 * página. Es el precio de no tener falsos positivos, y fue una decisión
 * explícita del dueño.
 */
const alCambiarVisibilidad = () => taparPantalla(document.visibilityState === 'hidden');

/**
 * Teclas: ya NO encienden el velo.
 *
 * ---------------------------------------------------------------------
 * POR QUÉ SE FUE EL DESTELLO POR TECLADO
 * ---------------------------------------------------------------------
 * Se llegó a pintar el negro con la tecla Windows/Cmd sola, para adelantarse
 * a los atajos de recorte. Funcionaba para eso, pero la tecla Windows se usa
 * cien veces al día para cosas que no son capturar, y cada una tapaba la
 * pantalla 1,2 segundos y le cortaba la supervisión al Superadmin. Falso
 * positivo puro.
 *
 * La regla ahora es una sola y sin excepciones: el velo se enciende cuando
 * la página deja de verse, y nada más.
 *
 * Lo que SÍ se conserva, porque no tapa nada ni corta la supervisión:
 *   · Ctrl/Cmd+P se cancela antes de abrir el diálogo de impresión.
 *   · Tras un PrintScreen se pisa el portapapeles, así lo capturado no
 *     sirve al pegarlo.
 *
 * Consecuencia asumida: Win+Shift+S y los atajos de recorte de macOS ya no
 * se llevan una lámina negra. En la web nunca fue una garantía —el sistema
 * captura antes de que la página se entere— y el bloqueo real sigue siendo
 * FLAG_SECURE en la APK de Android.
 */
function alTeclear(e: KeyboardEvent): void {
  // Imprimir / Guardar como PDF: se corta antes de abrir el diálogo.
  if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
    e.preventDefault();
    e.stopPropagation();
  }
}

function alSoltarTecla(e: KeyboardEvent): void {
  if (e.key !== 'PrintScreen') return;
  // La tecla ya disparó la captura del sistema: no se puede cancelar. Se
  // pisa el portapapeles para que lo capturado no sirva al pegarlo. Esto
  // no tapa la pantalla, así que la supervisión sigue sin cortarse.
  pisarPortapapeles();
}

// ---------------------------------------------------------------------
// Poner / quitar
// ---------------------------------------------------------------------

/**
 * Motivos por los que el escudo está puesto ahora mismo.
 *
 * Varias partes de la aplicación lo piden por su cuenta ('global' desde el
 * arranque, 'chat' mientras el cliente tiene la conversación abierta) y no
 * pueden pisarse entre ellas: sin contarlos, cerrar el chat retiraría
 * también el escudo general. Se pone si hay AL MENOS un motivo.
 */
const motivos = new Set<string>();

/**
 * La lista blanca autorizó a ESTA cuenta en ESTA capa (web o APK).
 *
 * Es un permiso, no un motivo: MANDA sobre todos los motivos juntos. Sin
 * esto, quien el Superadmin autoriza expresamente a capturar seguiria con
 * la pantalla en negro por el motivo 'global', y el permiso no serviria
 * para nada.
 */
let exento = false;

function recalcular(): void {
  const debeEscudar = motivos.size > 0 && !exento;
  if (debeEscudar) aplicarEscudo();
  else quitarEscudo();
  // El bloqueo nativo sigue exactamente la misma decisión. En la APK esto
  // es lo ÚNICO que impide de verdad la captura, y ahora tambien lo lleva
  // puesto el visitante anónimo de la tienda.
  void fijarFlagSecure(debeEscudar);
}

function pedirEscudo(motivo: string): void {
  motivos.add(motivo);
  recalcular();
}

function soltarEscudo(motivo: string): void {
  motivos.delete(motivo);
  recalcular();
}

/**
 * Escudo GENERAL: toda la aplicación, para todo el mundo.
 *
 * Se llama una vez al arrancar, antes de saber siquiera si hay sesión. La
 * tienda pública estaba fuera del escudo a propósito —tapar el catálogo en
 * cada cambio de aplicación se lee como que la app se rompió—, pero el
 * dueño pidió expresamente que tambien quedara cubierta, para anónimos y
 * para personal por igual, asi que la regla ahora es una sola.
 *
 * Para volver a dejar la tienda pública sin escudo basta con no llamar a
 * esta función desde App.tsx: los motivos 'chat' y el permiso de la lista
 * blanca siguen funcionando solos.
 */
export function iniciarEscudoGlobal(): void {
  if (typeof window === 'undefined') return;
  pedirEscudo('global');
}

/**
 * Escudo para el CLIENTE mientras tiene el chat abierto.
 *
 * Queda por debajo del escudo general, pero se mantiene aparte a propósito:
 * protege otra cosa —la conversación que el administrador puede borrar— y
 * sigue en pie aunque algún día se retire el escudo de la tienda.
 */
export function escudoDeChat(activo: boolean): void {
  if (typeof window === 'undefined') return;
  if (activo) pedirEscudo('chat');
  else soltarEscudo('chat');
}

/**
 * Válvula de seguridad: cualquier toque con la ventana al frente retira el
 * velo. Si alguna combinación rara de foco lo dejara puesto, la persona lo
 * quita tocando la pantalla en vez de quedarse con la tienda en negro.
 */
function alTocar(): void {
  if (!puesto) return;
  if (document.visibilityState !== 'visible') return;
  pintarVelo(velo(), false);
}

function aplicarEscudo(): void {
  if (puesto) return;
  puesto = true;
  hojaDeImpresion();
  velo();
  document.addEventListener('visibilitychange', alCambiarVisibilidad);
  window.addEventListener('keydown', alTeclear, true);
  window.addEventListener('keyup', alSoltarTecla, true);
  window.addEventListener('pointerdown', alTocar, true);
}

function quitarEscudo(): void {
  if (!puesto) return;
  puesto = false;
  document.removeEventListener('visibilitychange', alCambiarVisibilidad);
  window.removeEventListener('keydown', alTeclear, true);
  window.removeEventListener('keyup', alSoltarTecla, true);
  window.removeEventListener('pointerdown', alTocar, true);
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
  // El permiso de la lista blanca es lo único que levanta el escudo, y lo
  // levanta entero: escudo web y FLAG_SECURE nativo a la vez.
  exento = await puedeCapturar();
  recalcular();
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
 * Un Cliente no entra aquí, pero YA VA ESCUDADO: el escudo general de
 * `iniciarEscudoGlobal()` cubre la tienda pública desde el arranque, para
 * anónimos y personal por igual. Lo que esta función añade es la única vía
 * para LEVANTARLO: la lista blanca.
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

/**
 * Suelta la vigilancia de la lista blanca. Llamar al cerrar sesión.
 *
 * NO retira el escudo: retira el PERMISO. Al salir de una cuenta
 * autorizada, la exención se pierde y el escudo general vuelve a caer solo
 * —que es lo correcto: el permiso era de esa cuenta, no del aparato.
 */
export function detenerEscudoDlp(): void {
  if (reloj) { clearInterval(reloj); reloj = null; }
  if (canal) { try { supabase.removeChannel(canal); } catch { /* nada */ } canal = null; }
  usuario = null;
  exento = false;
  recalcular();
}
