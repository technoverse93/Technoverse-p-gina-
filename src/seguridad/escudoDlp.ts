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
import { esStaff, esSuperadmin } from '../utils/roles';
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
  el.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:2147483647',
    'background:#0b0f0d', 'display:none',
    'align-items:center', 'justify-content:center',
    'padding:24px', 'text-align:center',
    'color:#8aa79b', 'font:600 13px system-ui,sans-serif',
    'letter-spacing:.01em', 'user-select:none',
  ].join(';');
  el.textContent = 'Contenido protegido. Volvé a la ventana para continuar.';
  document.body.appendChild(el);
  return el;
}

function taparPantalla(tapar: boolean): void {
  if (!puesto) return;
  velo().style.display = tapar ? 'flex' : 'none';
}

const alPerderFoco = () => taparPantalla(true);
const alRecuperarFoco = () => taparPantalla(false);
const alCambiarVisibilidad = () => taparPantalla(document.visibilityState === 'hidden');

function alTeclear(e: KeyboardEvent): void {
  // Imprimir / Guardar como PDF: se corta antes de abrir el diálogo.
  if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
    e.preventDefault();
    e.stopPropagation();
  }
}

function alSoltarTecla(e: KeyboardEvent): void {
  if (e.key !== 'PrintScreen') return;
  // La tecla ya disparó la captura del sistema: no se puede cancelar. Lo
  // que sí se puede es PISAR el portapapeles para que lo capturado no
  // sirva de nada al pegarlo.
  try { void navigator.clipboard?.writeText('')?.catch?.(() => {}); } catch { /* sin permiso */ }
}

// ---------------------------------------------------------------------
// Poner / quitar
// ---------------------------------------------------------------------

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
  if (permitido) quitarEscudo();
  else aplicarEscudo();
  // El bloqueo nativo sigue la misma decisión (no-op fuera de la APK).
  void fijarFlagSecure(!permitido);
}

// ---------------------------------------------------------------------
// API
// ---------------------------------------------------------------------

/**
 * Arranca el escudo para una sesión de PERSONAL. Idempotente.
 *
 * El Superadmin queda fuera a propósito: es quien administra la lista, y
 * restringirlo solo lograría que no pudiera documentar el propio sistema.
 * Un Cliente nunca entra aquí — la tienda pública jamás se escuda, que
 * sería hostil con quien viene a comprar.
 */
export function iniciarEscudoDlp(user: User): void {
  if (typeof window === 'undefined' || !user || !esStaff(user.role)) return;
  detenerEscudoDlp();
  if (esSuperadmin(user.role)) return;

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
  quitarEscudo();
  void fijarFlagSecure(false);
  usuario = null;
}
