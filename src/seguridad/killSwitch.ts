// =====================================================================
// KILL SWITCH — bloqueo y expulsión instantánea, sin recargar nada
// =====================================================================
// Cuando el Superadmin bloquea a alguien, ese aparato tiene que quedar
// tapado en el acto: sin esperar a que la persona recargue la página ni
// reinicie la APK.
//
// CÓMO SE CONSIGUE LO INSTANTÁNEO
// ---------------------------------------------------------------------
// Todos los clientes —web y APK, con sesión o anónimos— están unidos desde
// el arranque a un canal común, `system_bans`. Al bloquear o liberar, el
// panel manda por ahí un AVISO VACÍO: un simple "revisá tu estado".
//
// El aviso no lleva datos a propósito. Si viajara la lista de bloqueados,
// cualquiera con el canal abierto sabría a quién se bloqueó, y eso es
// justo lo que no debe filtrarse. En vez de eso, cada cliente pregunta por
// SÍ MISMO con `estoy_bloqueado()`, que responde solo su propio veredicto.
// El viaje de ida y vuelta son milisegundos, así que se siente inmediato y
// no se cuenta nada de nadie.
//
// HASTA DÓNDE LLEGA ESTO — con honestidad
// ---------------------------------------------------------------------
// La pantalla de bloqueo es una barrera de INTERFAZ. Detiene a cualquiera
// que use la aplicación normalmente, que es el caso real, pero alguien con
// las herramientas del navegador podría quitar la capa. La barrera de
// verdad sigue siendo la RLS de cada tabla, que ya está puesta: aunque
// alguien tapara la pantalla, el servidor le sigue negando los datos que
// no le tocan.
//
// Y falla ABIERTO: si la consulta falla (sin red, servidor caído), NO se
// bloquea. Un fallo de infraestructura no puede dejar a todo el personal
// afuera; el costo de equivocarse en esa dirección es mucho mayor.
// =====================================================================

import { supabase } from '../supabaseClient';

const ID_PANTALLA = 'tv-kill-switch';
/** Tope de reconsultas: un aviso repetido no puede convertirse en tormenta. */
const MIN_ENTRE_CONSULTAS_MS = 800;
/** Red de seguridad por si un aviso se pierde. */
const REVISION_PERIODICA_MS = 60000;

let canal: any = null;
let reloj: ReturnType<typeof setInterval> | null = null;
let modeloAparato: string | null = null;
let huellaAparato: string | null = null;
let ultimaConsulta = 0;
let pendiente = false;
let bloqueado = false;

function textoDeVigencia(hasta: string | null): string {
  if (!hasta) return 'Este bloqueo no tiene fecha de término.';
  const f = new Date(hasta);
  if (Number.isNaN(f.getTime())) return '';
  return `El acceso se restablece el ${f.toLocaleDateString('es-CR')} a las ` +
         `${f.toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' })}.`;
}

function mostrarPantalla(motivo: string | null, hasta: string | null): void {
  if (document.getElementById(ID_PANTALLA)) return;
  const capa = document.createElement('div');
  capa.id = ID_PANTALLA;
  capa.setAttribute('role', 'alertdialog');
  capa.setAttribute('aria-modal', 'true');
  capa.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:2147483647',
    'background:#07100c', 'display:flex', 'flex-direction:column',
    'align-items:center', 'justify-content:center', 'gap:14px',
    'padding:32px 24px', 'text-align:center',
    'font-family:system-ui,sans-serif', 'color:#e8efec',
    'user-select:none', 'overscroll-behavior:contain',
  ].join(';');

  const escudo = document.createElement('div');
  escudo.style.cssText =
    'width:60px;height:60px;border-radius:18px;display:grid;place-items:center;' +
    'background:rgba(229,72,77,.14);border:1px solid rgba(229,72,77,.35);font-size:28px';
  escudo.textContent = '⛔';

  const titulo = document.createElement('h1');
  titulo.style.cssText = 'margin:0;font-size:19px;font-weight:700;letter-spacing:-.01em';
  titulo.textContent = 'Acceso bloqueado';

  const detalle = document.createElement('p');
  detalle.style.cssText = 'margin:0;max-width:42ch;font-size:13.5px;line-height:1.55;color:#9db0a8';
  detalle.textContent = motivo
    ? `Motivo: ${motivo}`
    : 'Un administrador bloqueó el acceso desde este dispositivo o cuenta.';

  const vigencia = document.createElement('p');
  vigencia.style.cssText = 'margin:0;font-size:12px;color:#6a7c74';
  vigencia.textContent = textoDeVigencia(hasta);

  capa.append(escudo, titulo, detalle, vigencia);
  document.body.appendChild(capa);

  // Nada por debajo debe poder tocarse ni desplazarse.
  document.body.style.overflow = 'hidden';
  // Y el botón "atrás" no puede sacar de aquí: cada intento se reinserta.
  try {
    history.pushState(null, '', location.href);
    window.addEventListener('popstate', atajarAtras);
  } catch { /* nada */ }
}

function atajarAtras(): void {
  if (!bloqueado) return;
  try { history.pushState(null, '', location.href); } catch { /* nada */ }
}

function quitarPantalla(): void {
  document.getElementById(ID_PANTALLA)?.remove();
  document.body.style.overflow = '';
  window.removeEventListener('popstate', atajarAtras);
}

/**
 * Pregunta por uno mismo y actúa. Nunca lanza: si algo falla, se deja
 * pasar (ver la nota de "falla abierto" arriba).
 */
async function revisar(): Promise<void> {
  const ahora = Date.now();
  if (ahora - ultimaConsulta < MIN_ENTRE_CONSULTAS_MS) {
    // Llegaron avisos en ráfaga: se agenda UNA sola reconsulta al final.
    if (pendiente) return;
    pendiente = true;
    setTimeout(() => { pendiente = false; void revisar(); }, MIN_ENTRE_CONSULTAS_MS);
    return;
  }
  ultimaConsulta = ahora;

  try {
    const { data, error } = await supabase.rpc('estoy_bloqueado', {
      p_modelo: modeloAparato,
      p_device: huellaAparato,
    });
    if (error) return;
    const fila = Array.isArray(data) ? data[0] : data;
    if (fila) {
      bloqueado = true;
      mostrarPantalla(fila.motivo ?? null, fila.hasta ?? null);
    } else if (bloqueado) {
      // Liberado: la pantalla se retira sola, sin recargar.
      bloqueado = false;
      quitarPantalla();
    }
  } catch { /* sin red: no se bloquea a nadie */ }
}

/**
 * Arranca la vigilancia. Se llama UNA vez al iniciar la aplicación, para
 * todos por igual: personal y visitantes de la tienda.
 *
 * `modelo` es el aparato (p. ej. "Honor Pad SE"), para que funcione el
 * bloqueo por hardware. Puede llegar más tarde: se actualiza con
 * `fijarModeloAparato`.
 */
export function iniciarKillSwitch(modelo?: string | null): void {
  if (typeof window === 'undefined' || canal) return;
  if (modelo) modeloAparato = modelo;

  void revisar();

  // Canal común y SIN datos: solo transporta el "revisá tu estado".
  canal = supabase
    .channel('system_bans')
    .on('broadcast', { event: 'cambio' }, () => { void revisar(); })
    .subscribe();

  // Red de seguridad: si un aviso se perdiera, igual se revisa sola. Y al
  // volver a poner la app al frente, otra revisión —por si el bloqueo
  // ocurrió mientras estaba en segundo plano y el socket dormía.
  reloj = setInterval(() => void revisar(), REVISION_PERIODICA_MS);
  document.addEventListener('visibilitychange', alVolverAlFrente);
}

function alVolverAlFrente(): void {
  if (document.visibilityState === 'visible') void revisar();
}

/** El modelo del aparato se lee de forma asíncrona; llega por aquí. */
export function fijarModeloAparato(modelo: string | null): void {
  if (!modelo || modelo === modeloAparato) return;
  modeloAparato = modelo;
  void revisar();
}

/** La huella del aparato (para el bloqueo por dispositivo físico). */
export function fijarHuellaAparato(huella: string | null): void {
  if (!huella || huella === huellaAparato) return;
  huellaAparato = huella;
  void revisar();
}

/** Avisa a TODOS los clientes de que revisen su estado. Lo usa el panel. */
export async function avisarCambioDeBloqueos(): Promise<void> {
  try {
    const c = canal || supabase.channel('system_bans');
    await c.send({ type: 'broadcast', event: 'cambio', payload: {} });
  } catch { /* si no sale, la revisión periódica lo alcanza igual */ }
}

/** Corta la vigilancia. Solo para pruebas o al desmontar del todo. */
export function detenerKillSwitch(): void {
  if (reloj) { clearInterval(reloj); reloj = null; }
  if (canal) { try { supabase.removeChannel(canal); } catch { /* nada */ } canal = null; }
  document.removeEventListener('visibilitychange', alVolverAlFrente);
  quitarPantalla();
  bloqueado = false;
}
