// =====================================================================
// ENVIAR UNA RESPUESTA DE LA TIENDA SIN ABRIR EL CHAT
// =====================================================================
// Lo usa Jarvis («respondele a Laura que ya está lista»). Es el mismo
// camino que `handleSendMessage` de useChatAdmin —mensaje en vuelo, guardar
// con `saveDB`, bitácora—, sin la parte de pantalla: la pestaña Chat y la
// burbuja lo ven aparecer por el aviso normal de `technoverse_db_updated`.
// =====================================================================

import { getDB, saveDB, addAuditLog, marcarMensajeEnVuelo, confirmarMensajeEnVuelo, recargarChatDelServidor } from '../../utils/storage';

export async function enviarRespuestaDeSoporte(convId: string, texto: string, quien: string): Promise<{ ok: boolean; msgId?: string; mensaje: string }> {
  const msg = {
    id: `MSG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sender: 'support' as const,
    text: texto,
    timestamp: new Date().toISOString(),
  };
  marcarMensajeEnVuelo(convId, msg);

  let db = getDB();
  if (!db.chat_conversations.some(c => c.id === convId)) {
    await recargarChatDelServidor(true);
    db = getDB();
  }
  const conv = db.chat_conversations.find(c => c.id === convId);
  if (!conv) {
    confirmarMensajeEnVuelo(msg.id);
    return { ok: false, mensaje: 'Esa conversación ya no está disponible.' };
  }
  if (!conv.messages.some(m => m.id === msg.id)) conv.messages.push(msg);
  conv.unreadCount = 0;
  try {
    await saveDB(db);
  } catch (e: any) {
    confirmarMensajeEnVuelo(msg.id);
    return { ok: false, mensaje: 'No se pudo enviar: ' + (e?.message || e) };
  }
  addAuditLog(quien || 'admin', 'Soporte', 'Respuesta Chat', `Conversación ${convId} (por Jarvis)`);
  return { ok: true, msgId: msg.id, mensaje: `Enviado a ${conv.customerName || 'el cliente'}: «${texto.length > 80 ? texto.slice(0, 77) + '…' : texto}»` };
}
