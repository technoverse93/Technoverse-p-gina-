// =====================================================================
// VIGÍA DEL CHAT — «te escribieron», estés en la pantalla que estés
// =====================================================================
// FALLO QUE ESTO CORRIGE (2026-10-26, «las notificaciones de que escribieron
// al chat no llegan»): el aviso lo disparaba la pestaña Chat del panel
// (useChatAdmin), que solo está montada MIENTRAS esa pestaña está abierta.
// En la tienda, en otro módulo, con la sesión cerrada con llave o con la
// APK abriendo en la tienda, nadie miraba los mensajes nuevos y no salía
// nada. Ahora hay UN vigía para toda la app, que corre mientras en este
// aparato hay una sesión del personal:
//
//   · con la app en segundo plano → notificación del sistema (tocarla abre
//     esa conversación en el panel);
//   · con la app a la vista en la tienda → un aviso en pantalla (en el panel
//     ya lo muestran la burbuja del chat y la pestaña Chat);
//   · al volver a abrir la app → cuenta lo que llegó mientras no estaba
//     (se recuerda hasta qué mensaje se avisó).
//
// Con la app CERRADA del todo el teléfono no corre nada de esto: ahí avisa
// el servidor (push de la APK con Firebase, o los avisos web de Chrome:
// mobile/pushNativo.ts y utils/avisosWeb.ts). Cuando alguno de esos está
// activo, `notificarMensajeChat` no repite la notificación.
// =====================================================================

import type { ChatConversation, ChatMessage } from '../types';
import { esperarDatosListos, lecturaDelChat } from '../utils/storage';
import { estaEnPrimerPlano, notificarMensajeChat } from './notificaciones';

/** Hasta qué mensaje de cliente ya se avisó en este aparato (marca de tiempo en ms). */
const CLAVE_VISTO = 'tv_chat_visto_hasta';
/** Al abrir, solo se cuenta lo que llegó en este lapso (lo más viejo ya no es «nuevo»). */
const VENTANA_AL_ABRIR_MS = 24 * 3_600_000;

export interface AvisoEnPantalla { conv: string; cliente: string; texto: string; cuantos: number }

let activo = false;
let vistos = new Set<string>();
let enPantalla: ((a: AvisoEnPantalla) => void) | null = null;
let pendiente: ReturnType<typeof setTimeout> | null = null;

const leerVisto = (): number => { try { return Number(localStorage.getItem(CLAVE_VISTO)) || 0; } catch { return 0; } };
const guardarVisto = (ms: number) => { try { if (ms > leerVisto()) localStorage.setItem(CLAVE_VISTO, String(ms)); } catch { /* sin almacenamiento */ } };
const momento = (m: ChatMessage) => { const t = Date.parse(m.timestamp); return Number.isFinite(t) ? t : 0; };

export const resumenDelMensaje = (m: Pick<ChatMessage, 'text' | 'imageUrl' | 'audioUrl' | 'videoUrl'>) =>
  (m.text || '').trim() || (m.imageUrl ? '📷 Imagen' : m.audioUrl ? '🎤 Nota de voz' : m.videoUrl ? '🎬 Video' : 'Mensaje nuevo');

/** Los mensajes de clientes (sin notas internas), con su conversación. */
function mensajesDeClientes(convs: readonly ChatConversation[]): { m: ChatMessage; c: ChatConversation }[] {
  const salida: { m: ChatMessage; c: ChatConversation }[] = [];
  for (const c of convs) for (const m of c.messages || []) if (m?.id && m.sender === 'customer' && !m.isInternalNote) salida.push({ m, c });
  return salida;
}

/** ¿El panel está a la vista? Entonces ya lo muestran la burbuja del chat y la pestaña Chat. */
const panelALaVista = () => estaEnPrimerPlano() && window.location.pathname.startsWith('/admin');

function avisar(nuevos: { m: ChatMessage; c: ChatConversation }[]): void {
  if (!nuevos.length) return;
  nuevos.sort((a, b) => momento(a.m) - momento(b.m));
  const { m, c } = nuevos[nuevos.length - 1];
  const cliente = (c.customerName || '').trim() || 'Un cliente';
  const deEsa = nuevos.filter(x => x.c.id === c.id).length;
  const otras = new Set(nuevos.map(x => x.c.id)).size - 1;
  const texto = resumenDelMensaje(m);
  if (panelALaVista()) return;
  if (estaEnPrimerPlano()) {
    enPantalla?.({ conv: c.id, cliente, texto, cuantos: nuevos.length });
    return;
  }
  const titulo = otras > 0 ? `${cliente} y ${otras === 1 ? 'otra conversación' : `${otras} conversaciones más`}` : cliente;
  const cuerpo = deEsa > 1 ? `${texto} (+${deEsa - 1})` : texto;
  void notificarMensajeChat(`${titulo} — Technoverse`, cuerpo, c.id);
}

function revisar(): void {
  pendiente = null;
  if (!activo) return;
  const nuevos = mensajesDeClientes(lecturaDelChat()).filter(x => !vistos.has(x.m.id));
  if (!nuevos.length) return;
  nuevos.forEach(x => vistos.add(x.m.id));
  guardarVisto(Math.max(...nuevos.map(x => momento(x.m))));
  avisar(nuevos);
}

// La base avisa de CADA tabla que cambia: se revisa una vez por ráfaga.
const alCambiar = () => { if (activo && !pendiente) pendiente = setTimeout(revisar, 150); };

/**
 * Empieza a vigilar (seguro de llamar varias veces). `alVerlo` recibe lo que llega con la app a la vista,
 * para mostrarlo en pantalla.
 */
export function iniciarVigiaChat(alVerlo?: (a: AvisoEnPantalla) => void): void {
  if (alVerlo) enPantalla = alVerlo;
  if (activo || typeof window === 'undefined') return;
  activo = true;
  vistos = new Set();
  void (async () => {
    // La primera lectura es la base: lo que ya estaba no es «nuevo»… salvo lo que llegó mientras la app
    // estaba cerrada (después de la última marca y dentro de la ventana), que se cuenta una vez.
    await esperarDatosListos(['chat'], 20_000);
    if (!activo) return;
    const marca = leerVisto();
    const todos = mensajesDeClientes(lecturaDelChat());
    const desde = Math.max(marca, Date.now() - VENTANA_AL_ABRIR_MS);
    const mientrasTanto = marca ? todos.filter(x => momento(x.m) > desde) : [];
    todos.forEach(x => vistos.add(x.m.id));
    if (todos.length) guardarVisto(Math.max(...todos.map(x => momento(x.m))));
    avisar(mientrasTanto);
    window.addEventListener('technoverse_db_updated', alCambiar);
  })();
}

/** Deja de vigilar (cerrar sesión o una cuenta que no es del personal). */
export function detenerVigiaChat(): void {
  activo = false;
  if (pendiente) { clearTimeout(pendiente); pendiente = null; }
  window.removeEventListener('technoverse_db_updated', alCambiar);
}
