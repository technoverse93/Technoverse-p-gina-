// =====================================================================
// CÁMARA DEL CLIENTE — compartir la cámara frontal, SOLO si la persona lo pide
// =====================================================================
// Esto NO es acceso remoto ni se enciende solo. Existe un único camino para
// que la cámara se abra: la persona toca "Compartir mi cámara" en el pie de
// página, lee para qué es, y el navegador (o Android/iOS) le muestra SU
// propio permiso de cámara. Sin ese permiso del sistema —que no lo podemos
// saltar— aquí no se abre nada.
//
// Además, mientras comparte:
//   · Ve SU PROPIA cámara en pantalla todo el tiempo (autovista), así sabe
//     que está encendida y qué se está enviando.
//   · Puede tocar "Dejar de compartir" en cualquier momento y se apaga en
//     el acto (se sueltan las pistas de la cámara del sistema).
//
// Y una capa más de recato: los fotogramas SOLO se envían mientras un
// miembro del personal está de verdad mirando esta visita en la consola de
// supervisión (`estanMirando`). Si nadie está atendiendo, la cámara puede
// estar encendida para la persona, pero no se manda nada por la red.
//
// Va por el MISMO canal privado del espejo (broadcast), como fotogramas
// JPEG chicos. No se guarda en ninguna tabla: es en vivo, no un archivo.
// =====================================================================

export type EstadoCamara = 'idle' | 'pidiendo' | 'activa' | 'negada' | 'error';

export interface EstadoCamaraCliente {
  estado: EstadoCamara;
  /** La transmisión local, para que el pie de página muestre la autovista. */
  stream: MediaStream | null;
  mensaje: string | null;
}

/** Cómo salen los fotogramas y cómo se sabe si alguien está mirando. */
export interface EnlaceCamara {
  enviar: (evento: string, payload: any) => void;
  estanMirando: () => boolean;
}

// Fotograma chico y liviano: 320 px de ancho, 3 por segundo, calidad media.
// Es una autovista de soporte, no una videollamada en HD; así pesa unos
// pocos KB por cuadro y no castiga los datos ni la batería del cliente.
const ANCHO_ENVIO = 320;
const FOTOGRAMAS_POR_SEG = 3;
const CALIDAD_JPEG = 0.5;

let stream: MediaStream | null = null;
let video: HTMLVideoElement | null = null;
let lienzo: HTMLCanvasElement | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let enlace: EnlaceCamara | null = null;

let estadoActual: EstadoCamaraCliente = { estado: 'idle', stream: null, mensaje: null };
const suscriptores = new Set<(e: EstadoCamaraCliente) => void>();

function emitir(cambio: Partial<EstadoCamaraCliente>): void {
  estadoActual = { ...estadoActual, ...cambio };
  for (const fn of suscriptores) { try { fn(estadoActual); } catch { /* nada */ } }
}

/** El pie de página se suscribe para pintar el estado y la autovista. */
export function suscribirCamara(fn: (e: EstadoCamaraCliente) => void): () => void {
  suscriptores.add(fn);
  fn(estadoActual);
  return () => { suscriptores.delete(fn); };
}

export function camaraActiva(): boolean { return !!stream; }
export function hayCamara(): boolean {
  try { return !!navigator.mediaDevices?.getUserMedia; } catch { return false; }
}

/**
 * Abre la cámara frontal. Se llama SOLO desde el clic de la persona. El
 * `enlace` dice cómo mandar los fotogramas y cómo saber si alguien mira.
 */
export async function iniciarCamaraCliente(nuevoEnlace: EnlaceCamara): Promise<void> {
  if (stream) return;
  enlace = nuevoEnlace;
  if (!hayCamara()) {
    emitir({ estado: 'error', stream: null, mensaje: 'Este aparato no permite compartir la cámara.' });
    return;
  }
  emitir({ estado: 'pidiendo', mensaje: null });
  try {
    // `facingMode: 'user'` = cámara frontal. El navegador/APK muestra AQUÍ
    // su propio permiso: si la persona dice que no, cae en el catch.
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
  } catch (e: any) {
    stream = null;
    const negada = e?.name === 'NotAllowedError' || e?.name === 'SecurityError';
    emitir({
      estado: negada ? 'negada' : 'error',
      stream: null,
      mensaje: negada
        ? 'No se compartió: se rechazó el permiso de la cámara.'
        : 'No se pudo abrir la cámara de este aparato.',
    });
    return;
  }

  video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', 'true');
  video.srcObject = stream;
  try { await video.play(); } catch { /* algunos navegadores necesitan el gesto: ya lo hubo */ }

  lienzo = document.createElement('canvas');
  emitir({ estado: 'activa', stream, mensaje: null });
  timer = setInterval(capturar, Math.round(1000 / FOTOGRAMAS_POR_SEG));
}

function capturar(): void {
  if (!stream || !video || !lienzo || !enlace) return;
  // Recato: si nadie del personal está mirando esta visita, la cámara sigue
  // encendida para la persona (su autovista), pero no se manda nada.
  if (!enlace.estanMirando()) return;
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return;
  const w = ANCHO_ENVIO;
  const h = Math.max(1, Math.round((vh / vw) * ANCHO_ENVIO));
  lienzo.width = w; lienzo.height = h;
  const ctx = lienzo.getContext('2d');
  if (!ctx) return;
  ctx.drawImage(video, 0, 0, w, h);
  let jpg = '';
  try { jpg = lienzo.toDataURL('image/jpeg', CALIDAD_JPEG); } catch { return; }
  try { enlace.enviar('camara', { jpg, w, h, ts: Date.now() }); } catch { /* un cuadro perdido no importa */ }
}

/** Apaga la cámara en el acto: suelta las pistas del sistema y avisa a la consola. */
export function detenerCamaraCliente(): void {
  if (timer) { clearInterval(timer); timer = null; }
  if (stream) { for (const t of stream.getTracks()) { try { t.stop(); } catch { /* nada */ } } }
  // Avisar que se cortó, para que la consola quite la imagen enseguida.
  try { enlace?.enviar('camara-fin', {}); } catch { /* nada */ }
  stream = null; video = null; lienzo = null;
  emitir({ estado: 'idle', stream: null, mensaje: null });
}
