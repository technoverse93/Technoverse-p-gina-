// =====================================================================
// VIDEOLLAMADA LIGERA DE SOPORTE — solo video, sin audio
// =====================================================================
// Para que el cliente enseñe el aparato averiado y el técnico lo vea en
// movimiento, que es lo que un chat de texto y una foto no resuelven.
//
// ---------------------------------------------------------------------
// POR QUÉ WebRTC Y NO EL CANAL QUE YA EXISTE
// ---------------------------------------------------------------------
// El hub de cámara (`camara.ts`) ya manda imagen por el WebSocket: fotos
// JPEG de 240 px a 5 por segundo. Sirve para vigilar, no para una llamada
// —se ve a tirones y cada cuadro pasa por el servidor de Supabase—.
//
// WebRTC abre un túnel DIRECTO entre los dos aparatos: video fluido, sin
// pasar el video por ningún servidor nuestro y sin gastar cuota de
// Realtime. Lo único que viaja por Supabase es el apretón de manos —tres
// o cuatro mensajitos de texto— y para eso el canal que ya existe sobra.
//
// ---------------------------------------------------------------------
// SIN AUDIO, Y ES ESTRUCTURAL
// ---------------------------------------------------------------------
// `audio: false` en la captura: NUNCA se crea una pista de audio, así que
// no hay nada que silenciar ni nada que se pueda encender por error. El
// navegador tampoco pide permiso de micrófono, que es la mitad del susto
// cuando a alguien le sale un aviso de permisos. Menos ancho de banda y
// menos permiso que justificar.
//
// ---------------------------------------------------------------------
// EL PERMISO SE PIDE CON UN GESTO, SIEMPRE
// ---------------------------------------------------------------------
// `getUserMedia` solo se llama desde el manejador del botón. Un navegador
// deniega en seco una petición de cámara que no venga de un gesto de la
// persona, y —más importante— nadie debe encontrarse la cámara encendida
// sin haber dicho que sí. Quien recibe la llamada ve un aviso y decide.
//
// ---------------------------------------------------------------------
// LÍMITE CONOCIDO: NO HAY TURN
// ---------------------------------------------------------------------
// Se usan servidores STUN públicos y gratuitos, que bastan para la
// mayoría de las redes domésticas y móviles. Detrás de un NAT simétrico
// —algunas redes corporativas, ciertos operadores móviles— el túnel
// directo no se puede abrir y la llamada no conecta. La solución sería un
// servidor TURN, que retransmite el video y CUESTA dinero por gigabyte.
// No se contrata nada por cuenta propia: si esto llegara a fallar seguido
// en la calle, es una decisión de gasto del dueño.
//
// Cuando no conecta, se avisa. No se deja la pantalla girando para
// siempre.
// =====================================================================

import { supabase } from '../supabaseClient';
import { liberarTemporalmente as liberarCamaraDeSupervision, reanudar as reanudarCamaraDeSupervision } from './camara';

/** STUN públicos de Google. Solo sirven para descubrir la IP pública. */
const SERVIDORES_HIELO: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

/** Si en este tiempo no hay imagen, se da por fallida (ver TURN arriba). */
const TIEMPO_MAX_CONEXION_MS = 20000;

export type EstadoLlamada =
  | 'inactiva'
  | 'pidiendo-permiso'
  | 'llamando'
  | 'conectando'
  | 'en-curso'
  | 'rechazada'
  | 'sin-camara'
  | 'sin-conexion'
  | 'terminada';

export interface ManejadorLlamada {
  /** Corta la llamada y suelta la cámara. Idempotente. */
  colgar: () => void;
}

interface OpcionesLlamada {
  /** Identifica la conversación: los dos lados deben usar el mismo. */
  sala: string;
  /** Quien llama crea la oferta; quien contesta espera. */
  rol: 'llama' | 'contesta';
  /** Video propio, para la vista previa. Puede no llegar si se deniega. */
  alTenerVideoLocal?: (stream: MediaStream) => void;
  /** Video del otro lado. Es el que importa. */
  alTenerVideoRemoto: (stream: MediaStream) => void;
  alCambiarEstado: (estado: EstadoLlamada) => void;
}

function temaDeSala(sala: string): string {
  return `videollamada-${sala}`;
}

/**
 * Abre una videollamada. DEBE llamarse desde un gesto de la persona
 * (el `onClick` del botón), o el navegador denegará la cámara.
 */
export async function abrirVideollamada(op: OpcionesLlamada): Promise<ManejadorLlamada> {
  let cerrado = false;
  let pc: RTCPeerConnection | null = null;
  let local: MediaStream | null = null;
  let canal: any = null;
  let relojConexion: ReturnType<typeof setTimeout> | null = null;
  /** true si esta sesión le quitó el sensor a la cámara de supervisión
   *  (ver camara.ts) para poder pedir la propia — y por lo tanto hay que
   *  devolvérselo al colgar. */
  let habiaCamaraDeSupervision = false;

  const avisar = (e: EstadoLlamada) => { if (!cerrado) op.alCambiarEstado(e); };

  function colgar(): void {
    if (cerrado) return;
    cerrado = true;
    if (relojConexion) { clearTimeout(relojConexion); relojConexion = null; }
    // La cámara se suelta SIEMPRE y explícitamente: si quedara una pista
    // viva, el aparato se queda con la luz de la cámara encendida y eso,
    // con razón, se lee como que la aplicación está espiando.
    try { local?.getTracks().forEach(t => t.stop()); } catch { /* ya soltada */ }
    local = null;
    try { pc?.close(); } catch { /* ya cerrada */ }
    pc = null;
    try { if (canal) supabase.removeChannel(canal); } catch { /* nada */ }
    canal = null;
    // Si esta sesión es de personal, le devuelve el sensor a la cámara de
    // supervisión (ver el porqué más abajo, donde se lo quitamos).
    if (habiaCamaraDeSupervision) void reanudarCamaraDeSupervision();
    op.alCambiarEstado('terminada');
  }

  async function senalar(evento: string, payload: any): Promise<void> {
    if (!canal || cerrado) return;
    try { await canal.send({ type: 'broadcast', event: evento, payload }); }
    catch { /* un mensaje de señalización perdido lo reintenta el otro lado */ }
  }

  // --- 1. Cámara, con permiso explícito -------------------------------
  // Si quien llama/contesta es personal, camara.ts puede tener la cámara
  // DELANTERA abierta desde el login para la supervisión (PiP del
  // Superadmin). Esta llamada pide la TRASERA —para enseñar el aparato
  // averiado, no la cara—, y en bastantes teléfonos de gama baja el chip
  // de cámara solo decodifica UN sensor a la vez: pedir un segundo
  // getUserMedia con el primero todavía abierto fallaba ahí, con un
  // motivo genérico que en pantalla se leía como "sin permiso" aunque el
  // permiso estuviera concedido de sobra. Se libera antes de pedir la
  // propia; se le devuelve el sensor al colgar (ver arriba).
  habiaCamaraDeSupervision = liberarCamaraDeSupervision();
  avisar('pidiendo-permiso');
  try {
    // `audio: false` a propósito: ver la cabecera. Resolución modesta —una
    // llamada de soporte no necesita 1080p y el móvil lo agradece.
    local = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'environment' },
      audio: false,
    });
  } catch {
    // Puede ser permiso denegado o un aparato sin cámara. Para quien mira
    // la pantalla es lo mismo: no hay video que enviar.
    avisar('sin-camara');
    return { colgar };
  }
  if (cerrado) { local.getTracks().forEach(t => t.stop()); return { colgar }; }
  op.alTenerVideoLocal?.(local);

  // --- 2. Conexión entre pares ----------------------------------------
  pc = new RTCPeerConnection({ iceServers: SERVIDORES_HIELO });
  local.getTracks().forEach(t => pc!.addTrack(t, local!));

  pc.ontrack = (ev) => {
    if (cerrado) return;
    if (relojConexion) { clearTimeout(relojConexion); relojConexion = null; }
    op.alTenerVideoRemoto(ev.streams[0]);
    avisar('en-curso');
  };

  pc.onicecandidate = (ev) => {
    if (ev.candidate) void senalar('hielo', { c: ev.candidate.toJSON(), de: op.rol });
  };

  pc.onconnectionstatechange = () => {
    if (!pc || cerrado) return;
    if (pc.connectionState === 'failed') {
      // Casi siempre es el NAT simétrico del que habla la cabecera.
      avisar('sin-conexion');
    } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
      colgar();
    }
  };

  // --- 3. Señalización por el canal que ya existe ----------------------
  canal = supabase.channel(temaDeSala(op.sala), { config: { private: true } });

  canal.on('broadcast', { event: 'oferta' }, async (m: any) => {
    if (op.rol !== 'contesta' || !pc || cerrado) return;
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(m.payload.sdp));
      const respuesta = await pc.createAnswer();
      await pc.setLocalDescription(respuesta);
      await senalar('respuesta', { sdp: respuesta });
      avisar('conectando');
    } catch { avisar('sin-conexion'); }
  });

  canal.on('broadcast', { event: 'respuesta' }, async (m: any) => {
    if (op.rol !== 'llama' || !pc || cerrado) return;
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(m.payload.sdp));
      avisar('conectando');
    } catch { avisar('sin-conexion'); }
  });

  canal.on('broadcast', { event: 'hielo' }, async (m: any) => {
    // El propio candidato vuelve por el canal: se ignora el de uno mismo.
    if (!pc || cerrado || m.payload?.de === op.rol) return;
    try { await pc.addIceCandidate(new RTCIceCandidate(m.payload.c)); }
    catch { /* candidato tardío o repetido: no rompe la llamada */ }
  });

  canal.on('broadcast', { event: 'colgar' }, () => colgar());
  canal.on('broadcast', { event: 'rechazo' }, () => { avisar('rechazada'); colgar(); });

  canal.subscribe(async (estado: string) => {
    if (estado !== 'SUBSCRIBED' || cerrado) return;
    if (op.rol === 'llama') {
      avisar('llamando');
      try {
        const oferta = await pc!.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: false });
        await pc!.setLocalDescription(oferta);
        await senalar('oferta', { sdp: oferta });
      } catch { avisar('sin-conexion'); }
    } else {
      avisar('conectando');
    }
  });

  // Sin imagen en 20 segundos se declara fallida, en vez de dejar a la
  // persona mirando una rueda que no va a parar nunca.
  relojConexion = setTimeout(() => {
    if (!cerrado) avisar('sin-conexion');
  }, TIEMPO_MAX_CONEXION_MS);

  return {
    colgar: () => { void senalar('colgar', {}); colgar(); },
  };
}

/** Avisa al otro lado de que no se acepta la llamada. */
export async function rechazarVideollamada(sala: string): Promise<void> {
  try {
    const c = supabase.channel(temaDeSala(sala), { config: { private: true } });
    await new Promise<void>((listo) => {
      c.subscribe((e: string) => { if (e === 'SUBSCRIBED') listo(); });
      setTimeout(listo, 3000);
    });
    await c.send({ type: 'broadcast', event: 'rechazo', payload: {} });
    supabase.removeChannel(c);
  } catch { /* si no sale, al que llama le vence el tiempo de espera */ }
}

// ---------------------------------------------------------------------
// TIMBRE
// ---------------------------------------------------------------------
// El canal de la llamada solo existe mientras alguien tiene el panel
// abierto, así que por sí solo no sirve para AVISAR: quien contesta
// todavía no está escuchando ahí. Este canal aparte es el timbre, y el
// cliente lo tiene puesto mientras el chat está abierto. Va vacío de
// contenido a propósito —solo dice "te llaman"—, para no filtrar nada por
// un canal que escucha quien tenga el identificador de la conversación.

function temaDeTimbre(sala: string): string {
  return `videollamada-timbre-${sala}`;
}

/** Hace sonar el timbre del otro lado. La usa quien llama. */
export async function timbrar(sala: string): Promise<void> {
  try {
    const c = supabase.channel(temaDeTimbre(sala), { config: { private: true } });
    await new Promise<void>((listo) => {
      c.subscribe((e: string) => { if (e === 'SUBSCRIBED') listo(); });
      setTimeout(listo, 3000);
    });
    await c.send({ type: 'broadcast', event: 'timbre', payload: {} });
    supabase.removeChannel(c);
  } catch { /* sin timbre, quien llama verá que nadie contesta */ }
}

/**
 * Queda a la escucha de llamadas entrantes.
 * @returns función para dejar de escuchar. Llamarla al desmontar.
 */
export function escucharTimbre(sala: string, alSonar: () => void): () => void {
  let canal: any = null;
  try {
    canal = supabase.channel(temaDeTimbre(sala), { config: { private: true } });
    canal.on('broadcast', { event: 'timbre' }, () => alSonar());
    canal.subscribe();
  } catch { /* sin timbre: el cliente no vera la llamada entrante */ }
  return () => { try { if (canal) supabase.removeChannel(canal); } catch { /* nada */ } };
}
