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
// Dos defensas, las dos del NAVEGADOR (ya no hay bloqueo nativo):
//
//   1. IMPRESIÓN EN BLANCO — una hoja de estilo `@media print` que oculta
//      el documento entero. Cubre "Imprimir" y "Guardar como PDF", que es
//      la fuga más fácil y la que nadie vigila.
//
//   2. PrintScreen — al soltar la tecla se pisa el portapapeles con vacío,
//      así lo que se haya copiado deja de servir. Ctrl/Cmd+P se cancela
//      antes de que abra el diálogo. Ninguna de las dos tapa la pantalla.
//
// FLAG_SECURE (APK) YA NO SE USA — y no es un olvido:
//
// Era el único bloqueo REAL contra capturas, pero Android lo aplica sobre
// la ventana entera y ciega TODA captura por igual, incluida la pantalla
// completa nativa que el Superadmin necesita ver. No se puede pedir "cegá
// a los demás pero a mí no". El dueño eligió ver el teléfono; el precio,
// dicho claro, es que en la APK otras apps pueden grabar la pantalla y las
// capturas del sistema salen normales. Ver `recalcular()`.
//
// ---------------------------------------------------------------------
// EL VELO POR `visibilitychange` SE QUITÓ — Y POR QUÉ
// ---------------------------------------------------------------------
// Hasta acá hubo una tercera defensa: una lámina negra con el texto
// "Contenido protegido" que se encendía cuando `document.visibilityState`
// pasaba a 'hidden'. La idea era tapar la vista previa del conmutador de
// apps al minimizar.
//
// El problema es que ese apagón es un elemento del DOM como cualquier
// otro, y el espejo de supervisión (`motorEspejo.ts`, rrweb) clona el DOM
// tal cual está: en el instante en que el cliente o el personal se pasan
// a otra app (WhatsApp, por ejemplo) SIN cerrar esta, el mismo evento que
// encendía el velo local también lo mandaba al Superadmin — la
// supervisión se cortaba justo cuando más se quería verla, que es lo
// opuesto de lo que pide este sistema. Y en la web esto NUNCA fue una
// barrera real —ya lo decía este mismo archivo—, solo un disuasivo local
// contra la miniatura del conmutador de apps.
//
// Se retira entero: sin velo, sin apagón, sin "Contenido protegido".
//
// FALLA CERRADO: si la consulta de permisos falla, el escudo se PONE. Un
// error de red nunca destapa la pantalla.
// =====================================================================

import { supabase } from '../supabaseClient';
import { esStaff } from '../utils/roles';
import { fijarFlagSecure, esNativo } from './flagSecure';
import type { User } from '../types';

const ID_ESTILO = 'tv-dlp-impresion';
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
 * Teclas: nunca tapan la pantalla, solo estorban la fuga puntual.
 *
 * · Ctrl/Cmd+P se cancela antes de abrir el diálogo de impresión.
 * · Tras un PrintScreen se pisa el portapapeles, así lo capturado no
 *   sirve al pegarlo.
 *
 * Ninguna de las dos corta la supervisión ni pinta nada sobre la página,
 * así que no interfieren con el espejo ni con la pantalla completa.
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
  // FLAG_SECURE SE APAGA SIEMPRE EN LA APK — decisión del dueño.
  //
  // Android aplica esa bandera sobre la ventana entera y ciega A TODA
  // captura por igual: la de un tercero y la NUESTRA. Con la pantalla
  // completa nativa (capturaPantallaNativa.ts) en marcha, dejarla puesta
  // significaba que el Superadmin veía un rectángulo negro en vez del
  // teléfono. No hay forma de pedirle a Android "cegá a los demás pero a
  // mí no": es todo o nada, así que se eligió el "nada".
  //
  // LO QUE ESTO CUESTA, DICHO SIN ADORNOS: en la APK, cualquier otra
  // aplicación con permiso de grabación de pantalla puede ahora capturar
  // Technoverse, y las capturas de pantalla del sistema salen normales.
  //
  // LO QUE SIGUE PUESTO: el escudo del NAVEGADOR (hoja @media print que
  // imprime en blanco y borrado del portapapeles tras PrintScreen), que
  // es independiente de la bandera nativa y se sigue gobernando con la
  // lista blanca de siempre — ver `aplicarEscudo`/`quitarEscudo` arriba.
  void fijarFlagSecure(false);
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

function aplicarEscudo(): void {
  if (puesto) return;
  puesto = true;
  hojaDeImpresion();
  window.addEventListener('keydown', alTeclear, true);
  window.addEventListener('keyup', alSoltarTecla, true);
}

function quitarEscudo(): void {
  if (!puesto) return;
  puesto = false;
  window.removeEventListener('keydown', alTeclear, true);
  window.removeEventListener('keyup', alSoltarTecla, true);
  document.getElementById(ID_ESTILO)?.remove();
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
