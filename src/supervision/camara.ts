// =====================================================================
// CÁMARA DE SUPERVISIÓN — lado del operador (Zero Trust · Hub)
// =====================================================================
// Junto al espejo de pantalla, el Superadmin puede ver la CARA del
// operador en un recuadro (PiP). Este módulo es el que captura y transmite
// esa cara, y lo hace bajo tres reglas firmes:
//
//   1. CON CONSENTIMIENTO. Usa getUserMedia, que SIEMPRE pide permiso al
//      navegador y SIEMPRE enciende el indicador de cámara del sistema. No
//      hay captura en silencio —ni la busca—: la persona sabe que su
//      cámara está encendida, y encima le ponemos un aviso propio.
//
//   2. SOLO MIENTRAS LA MIRAN. Arranca cuando el Superadmin activa el
//      espejo de esa persona (watch = true) y se apaga en cuanto lo suelta.
//      Así el indicador de cámara se prende JUSTO cuando alguien observa, y
//      no queda la cámara abierta de gusto gastando batería.
//
//   3. SOLO PERSONAL. Nunca un Cliente. La llamada vive detrás del mismo
//      gateo `esStaff` del resto de la supervisión (ver grabador.ts) y se
//      excluye al propio Superadmin, que es quien mira.
//
// CÓMO VIAJA: por el MISMO canal privado del espejo (`espejo:<user_id>`),
// como cuadros JPEG pequeños a pocos fps. Reusa la RLS que ya protege ese
// canal —solo el superadmin, o el dueño, se unen— así que la cara viaja por
// el mismo túnel seguro que la pantalla, sin infraestructura nueva.
// =====================================================================

import { supabase } from '../supabaseClient';

// Cuadros por segundo y tamaño. Bajos a propósito: para supervisar una
// cara no hace falta vídeo fluido, y así cada cuadro es un JPEG de pocos
// KB que entra de sobra en un mensaje del canal.
const FPS = 5;
const ANCHO = 240;
const CALIDAD = 0.5;
const ID_AVISO = 'tv-cam-aviso';

let stream: MediaStream | null = null;
let canal: any = null;
let video: HTMLVideoElement | null = null;
let lienzo: HTMLCanvasElement | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let activo = false;

function mostrarAviso(): void {
  if (document.getElementById(ID_AVISO)) return;
  const el = document.createElement('div');
  el.id = ID_AVISO;
  el.setAttribute('role', 'status');
  el.style.cssText = [
    'position:fixed', 'left:12px', 'bottom:12px', 'z-index:2147483000',
    'display:flex', 'align-items:center', 'gap:8px',
    'padding:7px 12px', 'border-radius:999px',
    'background:rgba(180,30,30,.95)', 'color:#fff',
    'font:600 12px system-ui,sans-serif', 'box-shadow:0 6px 20px -8px #000',
    'pointer-events:none', 'user-select:none',
  ].join(';');
  el.innerHTML =
    '<span style="width:8px;height:8px;border-radius:50%;background:#fff;box-shadow:0 0 0 3px rgba(255,255,255,.35)"></span>' +
    'Cámara de supervisión activa';
  document.body.appendChild(el);
}
function quitarAviso(): void {
  document.getElementById(ID_AVISO)?.remove();
}

function transmitirCuadro(): void {
  if (!video || !lienzo || !canal) return;
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return;
  const alto = Math.round((ANCHO * vh) / vw);
  lienzo.width = ANCHO;
  lienzo.height = alto;
  const ctx = lienzo.getContext('2d');
  if (!ctx) return;
  ctx.drawImage(video, 0, 0, ANCHO, alto);
  let datos: string;
  try { datos = lienzo.toDataURL('image/jpeg', CALIDAD); } catch { return; }
  try {
    void canal.send({ type: 'broadcast', event: 'cam', payload: { d: datos, t: Date.now() } });
  } catch { /* un cuadro perdido no importa: viene otro enseguida */ }
}

// ---------------------------------------------------------------------
// EL PERMISO SE PIDE UNA VEZ, AL ENTRAR — no en medio del trabajo
// ---------------------------------------------------------------------
// Sin esto, el cuadro de permiso saltaría la primera vez que el Superadmin
// abre el espejo, o sea justo mientras la persona está cobrando o
// atendiendo: el peor momento, y encima con un susto.
//
// Así que se pide UNA sola vez, al iniciar sesión, y se suelta la cámara
// en el acto. A partir de ahí el sistema recuerda la respuesta:
//   · APK      → Android guarda el permiso para SIEMPRE en esa instalación
//                (solo vuelve a preguntar si se reinstala o si la persona
//                lo revoca a mano en Ajustes).
//   · Web      → el navegador lo recuerda para el dominio.
// Y con la marca local no se vuelve a intentar ni siquiera esa vez.
const CLAVE_PERMISO = 'technoverse_cam_permiso';

/**
 * Registra el permiso de cámara una única vez por instalación. Enciende la
 * cámara un instante y la apaga: no transmite nada, solo deja la respuesta
 * guardada para que después no haya cuadros de permiso a destiempo.
 */
export async function registrarPermisoCamara(): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;
  try { if (localStorage.getItem(CLAVE_PERMISO)) return; } catch { /* sin almacenamiento: se sigue */ }

  // Si el sistema ya lo tiene concedido, ni se enciende la cámara.
  try {
    const estado = await (navigator as any).permissions?.query?.({ name: 'camera' });
    if (estado?.state === 'granted') {
      try { localStorage.setItem(CLAVE_PERMISO, '1'); } catch { /* nada */ }
      return;
    }
  } catch { /* la API de permisos no está en todos lados: se sigue */ }

  try {
    const prueba = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    prueba.getTracks().forEach(t => t.stop());
    try { localStorage.setItem(CLAVE_PERMISO, '1'); } catch { /* nada */ }
  } catch {
    // Negado o sin cámara. No se marca, pero tampoco se insiste: el
    // navegador y Android recuerdan el "no" y dejan de preguntar solos.
  }
}

/**
 * Enciende la cámara y empieza a transmitir. `topic` es el mismo canal del
 * espejo. Si la persona NIEGA el permiso, el espejo de pantalla sigue
 * funcionando igual: la cara simplemente no viaja.
 */
export async function iniciarCamara(topic: string): Promise<void> {
  if (activo || typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;
  activo = true;
  try {
    // Esto ABRE el prompt de permiso del navegador y enciende el indicador
    // de cámara. Es el comportamiento que se quiere: consentido y visible.
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 320 } },
      audio: false,
    });
  } catch {
    // Permiso negado o sin cámara: se cancela en silencio, sin romper nada.
    activo = false;
    return;
  }
  if (!activo) { // por si pararon mientras se pedía el permiso
    stream.getTracks().forEach(t => t.stop());
    stream = null;
    return;
  }

  video = document.createElement('video');
  video.playsInline = true;
  video.muted = true;
  video.srcObject = stream;
  try { await video.play(); } catch { /* algunos navegadores no necesitan play explícito */ }

  lienzo = document.createElement('canvas');

  canal = supabase.channel(topic, { config: { private: true, broadcast: { self: false } } });
  canal.subscribe();

  mostrarAviso();
  timer = setInterval(transmitirCuadro, Math.round(1000 / FPS));
}

/** Apaga la cámara, quita el aviso y cierra el canal. Idempotente. */
export function pararCamara(): void {
  activo = false;
  if (timer) { clearInterval(timer); timer = null; }
  if (stream) { try { stream.getTracks().forEach(t => t.stop()); } catch { /* nada */ } stream = null; }
  if (video) { try { video.srcObject = null; } catch { /* nada */ } video = null; }
  lienzo = null;
  if (canal) { try { supabase.removeChannel(canal); } catch { /* nada */ } canal = null; }
  quitarAviso();
}
