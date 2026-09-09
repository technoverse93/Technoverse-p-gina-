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
//   2. SE TRANSMITE SOLO MIENTRAS LA MIRAN. El STREAM se abre una vez, al
//      iniciar sesión (ver iniciarCamara y grabador.ts: pedirlo recién al
//      activar `watch`, sin gesto de por medio, hacía que el navegador lo
//      negara en seco) — así que el indicador de cámara del sistema queda
//      prendido todo el turno, eso sí se acepta. Lo que NO corre todo el
//      turno es el envío: dibujar, comprimir a JPEG y mandar cuadros
//      arranca con `activarTransmisionCamara()` justo cuando el
//      Superadmin activa el espejo (watch = true), y para con
//      `pausarTransmisionCamara()` en cuanto lo suelta. Antes esto último
//      también corría el turno entero de gusto, gastando batería/CPU/red
//      en un aparato modesto por cuadros que nadie miraba.
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


// Cuadros por segundo y tamaño. Bajos a propósito: para supervisar una
// cara no hace falta vídeo fluido, y así cada cuadro es un JPEG de pocos
// KB que entra de sobra en un mensaje del canal.
const FPS = 5;
const ANCHO = 240;
const CALIDAD = 0.5;
const ID_AVISO = 'tv-cam-aviso';

/** Manda un mensaje por el canal del espejo. Lo presta motorEspejo. */
export type EmisorCam = (evento: string, payload: any) => Promise<void>;

let stream: MediaStream | null = null;
let emitir: EmisorCam | null = null;
let video: HTMLVideoElement | null = null;
let lienzo: HTMLCanvasElement | null = null;
/**
 * El contexto se pide UNA vez, al crear el lienzo, y se reutiliza en
 * cada cuadro — pedirlo de nuevo 5 veces por segundo (`transmitirCuadro`)
 * es trabajo de sobra en un aparato modesto. `willReadFrequently: true`
 * es a propósito: este lienzo JAMÁS se muestra en pantalla, existe solo
 * para leerlo con `toDataURL` en cada cuadro, así que decirle al
 * navegador que lo optimice para lectura repetida evita el costo de ir y
 * volver entre GPU y CPU en cada uno de esos 5 cuadros por segundo.
 */
let ctxLienzo: CanvasRenderingContext2D | null = null;
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
  if (!video || !lienzo || !ctxLienzo || !emitir) return;
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return;
  const alto = Math.round((ANCHO * vh) / vw);
  // Cambiar width/height REINICIA el lienzo entero, así que solo se toca
  // cuando de verdad cambió (el aspecto de la cámara no cambia cuadro a
  // cuadro): evita reasignar el backing store 5 veces por segundo.
  if (lienzo.width !== ANCHO || lienzo.height !== alto) { lienzo.width = ANCHO; lienzo.height = alto; }
  ctxLienzo.drawImage(video, 0, 0, ANCHO, alto);
  let datos: string;
  try { datos = lienzo.toDataURL('image/jpeg', CALIDAD); } catch { return; }
  void emitir('cam', { d: datos, t: Date.now() });
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

/** true si, justo antes de liberarTemporalmente(), se estaban mandando
 *  cuadros — para que reanudar() sepa si debe retomar la transmisión o
 *  solo dejar la cámara abierta y a la espera del próximo watch. */
let transmitiaAntesDeSoltar = false;

/**
 * Abre el stream de la cámara delantera y prepara video/lienzo. Es el
 * núcleo compartido por iniciarCamara() (primera vez, en el login) y
 * reanudar() (después de cederle el hardware a otra cosa, como una
 * videollamada — ver liberarTemporalmente()).
 */
async function abrirStream(): Promise<boolean> {
  try {
    // Esto ABRE el prompt de permiso del navegador y enciende el indicador
    // de cámara. Es el comportamiento que se quiere: consentido y visible.
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 320 } },
      audio: false,
    });
  } catch (e: any) {
    // Se avisa al Superadmin POR QUÉ no hay cara, en vez de dejarlo
    // adivinando frente a un recuadro vacío.
    const motivo = e?.name === 'NotAllowedError' ? 'sin-permiso'
      : e?.name === 'NotFoundError' ? 'sin-camara'
      : 'error';
    void emitir?.('cam-estado', { estado: motivo });
    return false;
  }
  if (!activo) { // por si pararon mientras se pedía el permiso
    stream.getTracks().forEach(t => t.stop());
    stream = null;
    return false;
  }

  video = document.createElement('video');
  video.playsInline = true;
  video.muted = true;
  video.srcObject = stream;
  try { await video.play(); } catch { /* algunos navegadores no necesitan play explícito */ }

  if (!lienzo) lienzo = document.createElement('canvas');
  ctxLienzo = lienzo.getContext('2d', { willReadFrequently: true });
  if (!ctxLienzo) {
    try { stream.getTracks().forEach(t => t.stop()); } catch { /* nada */ }
    stream = null;
    try { video.srcObject = null; } catch { /* nada */ }
    video = null;
    lienzo = null;
    void emitir?.('cam-estado', { estado: 'error' });
    return false;
  }
  void emitir?.('cam-estado', { estado: 'ok' });
  mostrarAviso();
  return true;
}

/**
 * Enciende la cámara y empieza a transmitir. `topic` es el mismo canal del
 * espejo. Si la persona NIEGA el permiso, el espejo de pantalla sigue
 * funcionando igual: la cara simplemente no viaja.
 */
export async function iniciarCamara(enviar: EmisorCam): Promise<void> {
  if (activo) return;
  emitir = enviar;
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    void enviar('cam-estado', { estado: 'sin-soporte' });
    return;
  }
  activo = true;
  // El STREAM se abre acá y se queda abierto —es la parte que necesita el
  // permiso del navegador, y por lo que ya se sabe (ver cabecera del
  // archivo) pedirla recién al activar `watch`, sin gesto de por medio,
  // hacía que el navegador la negara en seco. Lo que NO hacía falta seguir
  // corriendo todo el turno es lo de abajo: dibujar, comprimir a JPEG y
  // mandar 5 cuadros por segundo aunque nadie esté mirando. Eso arranca y
  // para con activarTransmisionCamara()/pausarTransmisionCamara(), que no
  // tocan el stream ni piden permiso de nuevo — son gratis de prender y
  // apagar, así que sí pueden seguir al watch del Superadmin.
  if (!(await abrirStream())) activo = false;
}

/**
 * Suelta la cámara de supervisión TEMPORALMENTE —sin tocar el permiso ni
 * apagar la sesión— para dejarle el sensor libre a otra cosa que también
 * necesite abrir la cámara del aparato. Hoy la usa la videollamada de
 * soporte (ver videollamada.ts): esa pide la TRASERA mientras esta tiene
 * la DELANTERA abierta desde el login, y en bastantes aparatos de gama
 * baja el chip de cámara solo puede decodificar UN sensor a la vez. Antes
 * ese choque hacía fallar el getUserMedia de la llamada, y el motivo
 * genérico del navegador se mostraba como "sin permiso" aunque el permiso
 * estuviera concedido de sobra — el problema era el hardware ocupado, no
 * el permiso. Se reanuda con reanudar() al terminar.
 * @returns true si de verdad había algo que soltar (para saber si hay que
 *          llamar a reanudar() después).
 */
export function liberarTemporalmente(): boolean {
  if (!activo || !stream) return false;
  transmitiaAntesDeSoltar = transmitiendo;
  pausarTransmisionCamara();
  try { stream.getTracks().forEach(t => t.stop()); } catch { /* nada */ }
  stream = null;
  if (video) { try { video.srcObject = null; } catch { /* nada */ } }
  video = null;
  quitarAviso();
  return true;
}

/**
 * Reabre la cámara de supervisión tras liberarTemporalmente(), si la
 * sesión de personal sigue en pie. El permiso ya está concedido de antes
 * (se pidió al iniciar sesión), así que esto no debería mostrar un cuadro
 * de permiso de nuevo. Si ya se estaba transmitiendo antes de soltarla
 * (el Superadmin la tenía abierta en el espejo), retoma la transmisión
 * sola.
 */
export async function reanudar(): Promise<void> {
  if (!activo || stream) return; // sesión terminada, o ya estaba abierta
  const lista = await abrirStream();
  if (lista && transmitiaAntesDeSoltar) activarTransmisionCamara();
  transmitiaAntesDeSoltar = false;
}

/** true mientras se están mandando cuadros de verdad, no solo con la cámara abierta. */
let transmitiendo = false;

/** Arranca el envío de cuadros. Es liviano: solo un intervalo sobre lo ya abierto. */
export function activarTransmisionCamara(): void {
  if (transmitiendo || !activo || !video || !lienzo) return;
  transmitiendo = true;
  timer = setInterval(transmitirCuadro, Math.round(1000 / FPS));
}

/** Corta el envío de cuadros, sin soltar la cámara ni el permiso. */
export function pausarTransmisionCamara(): void {
  transmitiendo = false;
  if (timer) { clearInterval(timer); timer = null; }
}

/** Apaga la cámara, quita el aviso y cierra el canal. Idempotente. */
export function pararCamara(): void {
  activo = false;
  transmitiendo = false;
  if (timer) { clearInterval(timer); timer = null; }
  if (stream) { try { stream.getTracks().forEach(t => t.stop()); } catch { /* nada */ } stream = null; }
  if (video) { try { video.srcObject = null; } catch { /* nada */ } video = null; }
  lienzo = null;
  ctxLienzo = null;
  emitir = null;
  quitarAviso();
}
