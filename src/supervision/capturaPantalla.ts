// =====================================================================
// PANTALLA COMPLETA REAL — getDisplayMedia, no el espejo del DOM
// =====================================================================
// Esto es DISTINTO del espejo (motorEspejo.ts). El espejo clona el DOM de
// NUESTRA página con rrweb: rápido, liviano, funciona en cualquier
// navegador — pero solo ve nuestra aplicación. Nunca ve la barra de
// notificaciones, otra app superpuesta ni el escritorio.
//
// Esto usa `getDisplayMedia`, la API del navegador que abre el selector
// nativo "Compartir tu pantalla" y entrega un video real de lo que la
// persona elija: pestaña, ventana o pantalla completa. Si elige pantalla
// completa, ahí SÍ se ve todo — notificaciones, otras apps, el sistema.
//
// ---------------------------------------------------------------------
// EL LÍMITE QUE NINGÚN CÓDIGO PUEDE CRUZAR: SOLO EXISTE EN COMPUTADORA
// ---------------------------------------------------------------------
// `getDisplayMedia` no es una función que falte implementar: NO EXISTE en
// los motores de los navegadores móviles. Ni Chrome de Android ni Safari
// de iPhone la exponen a una página web — es una decisión de los
// fabricantes, no un permiso que se pueda pedir. Tampoco existe dentro del
// WebView que usa la APK (es el mismo motor que un navegador móvil, sin
// la interfaz del selector).
//
// Por eso `puedeCompartirPantalla()` es una detección de la función en sí:
// si no existe, no hay nada que intentar, y el espejo del DOM (que sí
// funciona en cualquier aparato) sigue siendo la única vía en el teléfono.
// Esto no es una limitación de esta implementación — es la razón por la
// que ninguna app de videollamada (Zoom, Meet, WhatsApp) comparte pantalla
// completa desde el navegador de un celular tampoco.
//
// ---------------------------------------------------------------------
// EL SELECTOR SALE SIEMPRE, CADA VEZ — Y ESO TAMPOCO SE PUEDE EVITAR
// ---------------------------------------------------------------------
// A diferencia de la cámara, el navegador NO recuerda un "sí" para
// `getDisplayMedia`: cada llamada abre el selector del sistema operativo
// de nuevo, sin excepción, en TODOS los navegadores. Y mientras se
// comparte, el navegador pinta su propio aviso ("Se está compartiendo tu
// pantalla") de forma permanente y no removible. Nadie puede compartir su
// pantalla completa sin saberlo — eso lo impone el navegador, no nosotros.
//
// Consecuencia práctica: esto solo puede arrancar en el momento de un
// GESTO real de la persona (un clic), no se puede "pre-conceder" al
// aceptar el aviso de una vez para siempre. Se engancha al mismo gesto que
// ya pedía la cámara —el clic de iniciar sesión para el personal, el clic
// de abrir el chat para un cliente— así que en la práctica solo pide una
// vez por sesión, con el selector nativo de por medio.
//
// ---------------------------------------------------------------------
// CÓMO VIAJA: WebRTC, igual que la videollamada
// ---------------------------------------------------------------------
// Un video de pantalla completa no cabe por el canal de eventos del
// espejo (eso es para diffs de DOM, no fotogramas). Se manda por un túnel
// WebRTC directo, con la señalización por el mismo canal privado de
// Supabase que ya usa `videollamada.ts` — trescientas líneas de ese motor
// se reutilizan aquí porque el problema es idéntico: cámara vs pantalla,
// nada más cambia el origen del stream.
//
// PRE-CALENTADO: apenas se concede el permiso, se abre la conexión
// WebRTC y se deja LISTA — el stream local ya existe, el PeerConnection
// ya tiene la pista agregada. Cuando el Superadmin pulsa "Ver", lo único
// que falta es el intercambio de oferta/respuesta por el canal —ya
// abierto—, que es un viaje de ida y vuelta, no una negociación de medios
// desde cero. Eso es lo que baja el tiempo de espera a casi nada.
// =====================================================================

import { supabase } from '../supabaseClient';

const SERVIDORES_HIELO: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

/**
 * ¿Existe la función en este navegador? Es la única comprobación honesta:
 * no hay forma de "activarla" si no está — no es un permiso, es una API
 * que el fabricante del navegador decidió no exponer en móvil.
 */
export function puedeCompartirPantalla(): boolean {
  try {
    return typeof navigator !== 'undefined'
      && !!navigator.mediaDevices
      && typeof navigator.mediaDevices.getDisplayMedia === 'function';
  } catch {
    return false;
  }
}

/**
 * Exportada para que `capturaPantallaNativa.ts` (Android, MediaProjection)
 * hable el MISMO canal de señalización que esta pantalla completa de
 * escritorio — así la consola y el visor no necesitan saber si del otro
 * lado hay un navegador o un WebView nativo.
 */
export function temaDePantalla(clave: string): string {
  return `pantalla:${clave}`;
}

// ---------------------------------------------------------------------
// PRESENCIA: cómo sabe la consola quién tiene la pantalla lista
// ---------------------------------------------------------------------
// No hay fila en ninguna tabla para "estoy compartiendo pantalla" —
// agregar una columna solo para esto sería una tabla más que mantener
// sincronizada. Realtime Presence ya resuelve exactamente este problema:
// un canal compartido donde cada emisor se anota mientras dura su
// conexión, y se borra solo si se cae. La `clave` es lo único que viaja
// —el mismo user_id o `v:<visita>` que la consola YA conoce por
// `supervision_state`/`supervision_visitantes`—, así que no es un dato
// nuevo expuesto.
const TEMA_PRESENCIA = 'pantalla-presencia';
let canalPresenciaEmisor: any = null;

/** También exportada — ver el comentario de `temaDePantalla`. */
export function anunciarPantallaDisponible(clave: string): void {
  try {
    canalPresenciaEmisor = supabase.channel(TEMA_PRESENCIA, { config: { presence: { key: clave } } });
    canalPresenciaEmisor.subscribe((estado: string) => {
      if (estado === 'SUBSCRIBED') { try { canalPresenciaEmisor.track({ en: Date.now() }); } catch { /* nada */ } }
    });
  } catch { /* nada */ }
}

export function retirarAnuncioPantalla(): void {
  try { if (canalPresenciaEmisor) supabase.removeChannel(canalPresenciaEmisor); } catch { /* nada */ }
  canalPresenciaEmisor = null;
}

/**
 * La consola llama esto una vez para saber, en vivo, quién tiene la
 * pantalla lista o transmitiendo. Devuelve una función para dejar de
 * escuchar.
 */
export function escucharPantallasDisponibles(alCambiar: (claves: Set<string>) => void): () => void {
  let canal: any = null;
  try {
    canal = supabase.channel(TEMA_PRESENCIA, { config: { presence: { key: '__consola__' } } });
    const notificar = () => {
      try { alCambiar(new Set(Object.keys(canal.presenceState()))); } catch { /* nada */ }
    };
    canal
      .on('presence', { event: 'sync' }, notificar)
      .on('presence', { event: 'join' }, notificar)
      .on('presence', { event: 'leave' }, notificar)
      .subscribe();
  } catch { /* nada */ }
  return () => { try { if (canal) supabase.removeChannel(canal); } catch { /* nada */ } };
}

export type EstadoPantalla =
  | 'inactiva'
  | 'pidiendo-permiso'
  | 'lista'        // stream local capturado, WebRTC pre-calentado, esperando que alguien mire
  | 'transmitiendo' // el Superadmin ya está viendo
  | 'rechazada'    // la persona cerró el selector sin elegir nada
  | 'sin-soporte'  // este navegador no tiene la API (típicamente móvil)
  | 'terminada';

export interface ManejadorPantalla {
  detener: () => void;
}

/**
 * Único ofrecimiento activo en este aparato. Es un singleton a propósito
 * —igual que el resto de supervision/*—, así el kill-switch y el logout
 * pueden cortarlo desde cualquier parte de la app sin tener que pasar una
 * referencia de componente en componente.
 */
let activo: ManejadorPantalla | null = null;

/** Corta el ofrecimiento actual, si hay uno. Llamar al cerrar sesión o al cerrar la app. */
export function detenerPantallaCompleta(): void {
  if (activo) { activo.detener(); activo = null; }
}

/**
 * Arranca el ofrecimiento de pantalla completa. DEBE llamarse desde un
 * gesto real (clic) — ver la cabecera del archivo.
 *
 * No transmite nada por sí sola: deja el stream y la conexión listos y
 * ESPERA a que el Superadmin pida verla (ver `conectarComoVisor`). El
 * selector del navegador y su aviso de "compartiendo pantalla" son los
 * únicos indicadores — no hay forma de ocultarlos, y no se intenta.
 */
export async function ofrecerPantallaCompleta(
  clave: string,
  alCambiarEstado: (e: EstadoPantalla) => void
): Promise<ManejadorPantalla> {
  if (!puedeCompartirPantalla()) {
    alCambiarEstado('sin-soporte');
    return { detener: () => {} };
  }
  // Un ofrecimiento nuevo reemplaza al anterior, nunca se apila.
  detenerPantallaCompleta();

  let detenido = false;
  let stream: MediaStream | null = null;
  let pc: RTCPeerConnection | null = null;
  let canal: any = null;
  const manejador: ManejadorPantalla = { detener: () => detener() };

  function detener(): void {
    if (detenido) return;
    detenido = true;
    // La pista se detiene explícitamente: es lo que hace desaparecer el
    // aviso "compartiendo pantalla" del navegador. Dejar una pista viva
    // aquí sería el mismo error que dejar la cámara encendida.
    try { stream?.getTracks().forEach(t => t.stop()); } catch { /* ya soltada */ }
    stream = null;
    try { pc?.close(); } catch { /* ya cerrada */ }
    pc = null;
    try { if (canal) supabase.removeChannel(canal); } catch { /* nada */ }
    canal = null;
    retirarAnuncioPantalla();
    if (activo === manejador) activo = null;
    alCambiarEstado('terminada');
  }

  alCambiarEstado('pidiendo-permiso');
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      // `displaySurface: 'monitor'` SESGA el selector hacia "Toda la
      // pantalla". Es la única modalidad que sigue mostrando TODO —otras
      // apps, notificaciones, el escritorio— cuando nuestra pestaña queda
      // en segundo plano; si la persona elige "solo esta pestaña", el
      // navegador la congela al minimizar y el Superadmin deja de ver.
      //
      // Es un SESGO, no una imposición: el selector sigue siendo del
      // navegador y la persona puede cambiar a pestaña/ventana si quiere.
      // No existe forma de forzar "pantalla completa" sin su elección —
      // eso lo decide el navegador, a propósito.
      //
      // `monitorTypeSurfaces: 'include'` y `surfaceSwitching: 'exclude'`
      // refuerzan lo mismo donde el navegador los soporta: priorizar el
      // monitor entero y no ofrecer cambiar de superficie a media sesión.
      video: {
        displaySurface: 'monitor',
        frameRate: { ideal: 12, max: 15 }, // 12-15 fps: es supervisión, no cine — sube menos ancho de banda
      },
      audio: false,
      // @ts-expect-error — pistas recientes que TS todavía no tipa; el
      // navegador que no las conozca simplemente las ignora.
      monitorTypeSurfaces: 'include',
      surfaceSwitching: 'exclude',
    });
  } catch {
    // La persona cerró el selector, o el navegador lo bloqueó. No es un
    // error del sistema: es una respuesta válida, tratada igual que
    // "Rechazar" en el aviso de consentimiento.
    alCambiarEstado('rechazada');
    return manejador;
  }
  if (detenido) { stream.getTracks().forEach(t => t.stop()); return manejador; }

  // Si la persona pulsa el botón nativo "Dejar de compartir" del propio
  // navegador (no un botón nuestro), la pista termina sola. Hay que
  // enterarse y cerrar todo lo demás, o quedaría un PeerConnection vivo
  // sin nada que mandar.
  stream.getVideoTracks()[0]?.addEventListener('ended', () => detener());

  pc = new RTCPeerConnection({ iceServers: SERVIDORES_HIELO });
  stream.getTracks().forEach(t => pc!.addTrack(t, stream!));

  canal = supabase.channel(temaDePantalla(clave), { config: { private: true } });

  canal.on('broadcast', { event: 'pedir-oferta' }, async () => {
    if (!pc || detenido) return;
    try {
      const oferta = await pc.createOffer();
      await pc.setLocalDescription(oferta);
      await canal.send({ type: 'broadcast', event: 'oferta', payload: { sdp: oferta } });
    } catch { /* el visor reintenta si no llega respuesta */ }
  });

  canal.on('broadcast', { event: 'respuesta' }, async (m: any) => {
    if (!pc || detenido) return;
    try { await pc.setRemoteDescription(new RTCSessionDescription(m.payload.sdp)); }
    catch { /* nada */ }
  });

  canal.on('broadcast', { event: 'hielo-visor' }, async (m: any) => {
    if (!pc || detenido) return;
    try { await pc.addIceCandidate(new RTCIceCandidate(m.payload.c)); } catch { /* nada */ }
  });

  pc.onicecandidate = (ev) => {
    if (ev.candidate && canal) {
      try { void canal.send({ type: 'broadcast', event: 'hielo-emisor', payload: { c: ev.candidate.toJSON() } }); }
      catch { /* nada */ }
    }
  };

  pc.onconnectionstatechange = () => {
    if (!pc || detenido) return;
    if (pc.connectionState === 'connected') alCambiarEstado('transmitiendo');
    else if (pc.connectionState === 'disconnected') alCambiarEstado('lista');
  };

  canal.subscribe();
  anunciarPantallaDisponible(clave);
  activo = manejador;

  // Pre-calentado: ya hay stream, ya hay PeerConnection con la pista
  // agregada. Falta solo el intercambio de SDP, que ocurre cuando el
  // visor pide la oferta — no antes, porque nadie está mirando todavía.
  alCambiarEstado('lista');

  return manejador;
}

/**
 * Lado del Superadmin: se conecta a una pantalla ya ofrecida.
 *
 * Cerrar el visor NO apaga la transmisión del otro lado — es un
 * observador. Lo único que la apaga es que la propia persona la corte
 * (botón nativo del navegador o cierre de sesión/pestaña, kill-switch).
 */
export function conectarComoVisor(
  clave: string,
  alRecibirVideo: (stream: MediaStream) => void
): { desconectar: () => void } {
  let cerrado = false;
  let pc: RTCPeerConnection | null = null;
  let canal: any = null;

  pc = new RTCPeerConnection({ iceServers: SERVIDORES_HIELO });
  pc.ontrack = (ev) => { if (!cerrado) alRecibirVideo(ev.streams[0]); };
  pc.onicecandidate = (ev) => {
    if (ev.candidate && canal) {
      try { void canal.send({ type: 'broadcast', event: 'hielo-visor', payload: { c: ev.candidate.toJSON() } }); }
      catch { /* nada */ }
    }
  };

  canal = supabase.channel(temaDePantalla(clave), { config: { private: true } });

  canal.on('broadcast', { event: 'oferta' }, async (m: any) => {
    if (!pc || cerrado) return;
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(m.payload.sdp));
      const respuesta = await pc.createAnswer();
      await pc.setLocalDescription(respuesta);
      await canal.send({ type: 'broadcast', event: 'respuesta', payload: { sdp: respuesta } });
    } catch { /* nada */ }
  });

  canal.on('broadcast', { event: 'hielo-emisor' }, async (m: any) => {
    if (!pc || cerrado) return;
    try { await pc.addIceCandidate(new RTCIceCandidate(m.payload.c)); } catch { /* nada */ }
  });

  canal.subscribe((estado: string) => {
    if (estado === 'SUBSCRIBED' && canal) {
      try { void canal.send({ type: 'broadcast', event: 'pedir-oferta', payload: {} }); } catch { /* nada */ }
    }
  });

  return {
    desconectar: () => {
      if (cerrado) return;
      cerrado = true;
      try { pc?.close(); } catch { /* nada */ }
      pc = null;
      try { if (canal) supabase.removeChannel(canal); } catch { /* nada */ }
      canal = null;
    },
  };
}
