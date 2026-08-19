import React, { useState, useEffect, useRef } from 'react';
import { MessageSquare, Send, X, Bot, User, Menu, Plus, Check, CheckCheck } from 'lucide-react';
import { ChatConversation, ChatMessage } from '../types';
import { getDB, saveDB, ensureCustomerChatToken } from '../utils/storage';

export const FAQ_DATA = [
  {
    q: "¿Cuáles son las formas de pago?",
    a: "Aceptamos transferencias SINPE Móvil al teléfono oficial +506 6421 4795 y tarjetas de crédito/débito a través de nuestra pasarela segura PayU Latam."
  },
  {
    q: "¿Cuánto dura la garantía de reparación?",
    a: "Según la Ley 7472 de Costa Rica, ofrecemos una garantía real incondicional de un mínimo de 3 meses en todas las reparaciones de hardware. Esta garantía se respalda con un ticket firmado y un hash trazable."
  },
  {
    q: "¿Cumplen con la facturación electrónica?",
    a: "Sí, cada compra u orden de reparación genera un XML firmado conforme a la resolución DGT-R-48-2016 del Ministerio de Hacienda de Costa Rica, con IVA del 13% desglosado."
  }
];

const EMAIL_KEY = 'technoverse_chat_email';
const NAME_KEY = 'technoverse_chat_name';

// IDs con sufijo aleatorio: dos envíos rápidos (doble tap) pueden caer en el
// mismo milisegundo con Date.now() puro y colisionar en el upsert por id.
function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readLS(key: string): string {
  try { return window.localStorage.getItem(key) || ''; } catch { return ''; }
}
function writeLS(key: string, val: string) {
  try { window.localStorage.setItem(key, val); } catch { /* almacenamiento no disponible */ }
}

function welcomeMessage(name: string): ChatMessage {
  return {
    id: newId('MSG'),
    sender: 'bot',
    text: `¡Hola ${name}! Bienvenido al soporte de Technoverse Costa Rica. Soy tu asistente virtual. ¿En qué te puedo ayudar hoy? Puedes hacer clic en una pregunta frecuente abajo o escribir tu consulta.`,
    timestamp: new Date().toISOString()
  };
}

/**
 * ¿Ya escribió el cliente algo en esta conversación?
 *
 * ---------------------------------------------------------------------
 * BUG QUE ESTO CORRIGE
 * ---------------------------------------------------------------------
 * Antes, el bloque de "Preguntas Frecuentes" se ocultaba con
 * `messages.length < 5` — un CONTEO, no una pregunta sobre lo que pasó.
 * Resultado: elegir una FAQ agrega 2 mensajes (pregunta + respuesta) y
 * con 1 mensaje de bienvenida ya puesto, hacían falta DOS clics para
 * llegar a 5 y recién ahí desaparecían — la primera elección se veía
 * "no hacer nada". Y si el cliente escribía su propio mensaje (que solo
 * agrega 1), los botones seguían ahí un buen rato más.
 *
 * Preguntando directamente "¿hay algún mensaje del cliente?" el bloque
 * desaparece exactamente en el mensaje número uno, sin importar si vino
 * de un clic o de texto escrito a mano — y una vez que desaparece, no
 * vuelve: un mensaje del cliente no se puede "deshacer".
 */
function yaEscribioElCliente(conv: ChatConversation | undefined): boolean {
  return !!conv?.messages.some(m => m.sender === 'customer');
}

export default function LiveChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [isRegistered, setIsRegistered] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Mensajes que ya se ven en pantalla (optimistic UI) pero todavía no
  // confirma Supabase. Es solo para el "check" tenue del recibo — la
  // conversación en sí ya se actualizó de una, no espera a esto.
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // Al montar: recupera identidad guardada (token + datos) para restaurar el
  // historial del cliente sin que tenga que volver a registrarse.
  useEffect(() => {
    ensureCustomerChatToken();
    const savedEmail = readLS(EMAIL_KEY);
    const savedName = readLS(NAME_KEY);
    if (savedEmail) {
      setClientEmail(savedEmail);
      setClientName(savedName);
      setIsRegistered(true);
    }
    loadConversations(savedEmail);

    const handleUpdate = () => loadConversations(readLS(EMAIL_KEY));
    window.addEventListener('technoverse_db_updated', handleUpdate);
    return () => window.removeEventListener('technoverse_db_updated', handleUpdate);
  }, []);

  const loadConversations = (email?: string) => {
    const db = getDB();
    const mail = (email ?? readLS(EMAIL_KEY)).toLowerCase();
    // Defensa extra: aunque el backend (RPC + token) ya devuelve solo las
    // conversaciones del cliente, se filtra también por su correo.
    const mine = (db.chat_conversations || []).filter(
      c => !mail || (c.customerEmail || '').toLowerCase() === mail
    );
    setConversations(mine);
    // Si no hay conversación activa seleccionada, abre la más reciente.
    setActiveConvId(prev => {
      if (prev && mine.some(c => c.id === prev)) return prev;
      return mine.length > 0 ? mine[0].id : null;
    });
  };

  useEffect(() => {
    // Autoscroll al último mensaje limitado ESTRICTAMENTE al contenedor de
    // mensajes. Antes usábamos messagesEndRef.scrollIntoView(), que desplaza
    // TODOS los ancestros con scroll — incluida la página detrás del chat
    // flotante — provocando que "todo el chat" saltara/subiera al abrirlo o
    // enfocar el input. Manipular scrollTop del propio contenedor no toca la
    // página ni el layout fijo.
    const container = messagesContainerRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  }, [conversations, activeConvId, isOpen]);

  const persistNewConversation = async (name: string, email: string): Promise<boolean> => {
    const token = ensureCustomerChatToken();
    const db = getDB();
    const conv: ChatConversation = {
      id: newId('CONV'),
      customerName: name,
      customerEmail: email,
      customerToken: token,
      messages: [welcomeMessage(name)],
      status: 'nuevo',
      unreadCount: 0
    };
    db.chat_conversations.push(conv);
    try {
      await saveDB(db);
    } catch {
      setChatError('No se pudo iniciar el chat. Verifica tu conexión e intenta de nuevo.');
      loadConversations(email);
      return false;
    }
    setActiveConvId(conv.id);
    loadConversations(email);
    return true;
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName.trim() || !clientEmail.trim() || isSubmitting) return;
    setChatError(null);
    setIsSubmitting(true);

    const name = clientName.trim();
    const email = clientEmail.trim();
    writeLS(NAME_KEY, name);
    writeLS(EMAIL_KEY, email);

    // ¿Ya existe una conversación abierta para este correo? Reusarla.
    const db = getDB();
    const existing = db.chat_conversations.find(
      c => (c.customerEmail || '').toLowerCase() === email.toLowerCase() && (c.status === 'nuevo' || c.status === 'pendiente')
    );

    if (existing) {
      setActiveConvId(existing.id);
      setIsRegistered(true);
      loadConversations(email);
      setIsSubmitting(false);
      return;
    }

    const ok = await persistNewConversation(name, email);
    if (ok) setIsRegistered(true);
    setIsSubmitting(false);
  };

  const handleNewConsulta = async () => {
    if (isSubmitting) return;
    setChatError(null);
    setDrawerOpen(false);
    const name = readLS(NAME_KEY) || clientName || 'Cliente';
    const email = readLS(EMAIL_KEY) || clientEmail;
    if (!email) return;
    setIsSubmitting(true);
    await persistNewConversation(name, email);
    setIsSubmitting(false);
  };

  const handleSelectConversation = (id: string) => {
    setActiveConvId(id);
    setDrawerOpen(false);
  };

  /**
   * Agrega mensajes a la conversación activa YA, en pantalla, antes de
   * tocar la base de datos (optimistic UI) — es lo que hace que enviar
   * se sienta instantáneo en vez de esperar el viaje de ida y vuelta a
   * Supabase. `loadConversations()` (disparado por saveDB) después
   * reconcilia con la copia real; como los IDs coinciden, React no
   * duplica nada.
   */
  const appendOptimistic = (convId: string, msgs: ChatMessage[], unreadDelta: number) => {
    setPendingIds(prev => {
      const next = new Set(prev);
      msgs.forEach(m => next.add(m.id));
      return next;
    });
    setConversations(prev => prev.map(c => c.id === convId
      ? { ...c, messages: [...c.messages, ...msgs], unreadCount: c.unreadCount + unreadDelta }
      : c));
  };

  const clearPending = (ids: string[]) => {
    setPendingIds(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.delete(id));
      return next;
    });
  };

  const rollbackOptimistic = (convId: string, ids: string[]) => {
    setConversations(prev => prev.map(c => c.id === convId
      ? { ...c, messages: c.messages.filter(m => !ids.includes(m.id)) }
      : c));
    clearPending(ids);
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !activeConvId || isSubmitting) return;
    setChatError(null);

    const messageText = inputText.trim();
    const convId = activeConvId;
    const newMsg: ChatMessage = { id: newId('MSG'), sender: 'customer', text: messageText, timestamp: new Date().toISOString() };

    setInputText('');
    appendOptimistic(convId, [newMsg], 1);
    setIsSubmitting(true);

    const db = getDB();
    const convIndex = db.chat_conversations.findIndex(c => c.id === convId);
    if (convIndex === -1) {
      rollbackOptimistic(convId, [newMsg.id]);
      setIsSubmitting(false);
      return;
    }
    db.chat_conversations[convIndex].messages.push(newMsg);
    db.chat_conversations[convIndex].unreadCount += 1;

    try {
      await saveDB(db);
      clearPending([newMsg.id]);
    } catch {
      setChatError('No se pudo enviar tu mensaje. Verifica tu conexión e intenta de nuevo.');
      setInputText(messageText);
      rollbackOptimistic(convId, [newMsg.id]);
      loadConversations();
      setIsSubmitting(false);
      return;
    }

    // Texto libre va directo a soporte humano: el bot no responde texto libre.
    loadConversations();
    setIsSubmitting(false);
  };

  const handleFAQClick = async (faq: typeof FAQ_DATA[0]) => {
    if (!activeConvId || isSubmitting) return;
    setChatError(null);

    const convId = activeConvId;
    const qMsg: ChatMessage = { id: newId('MSG'), sender: 'customer', text: faq.q, timestamp: new Date().toISOString() };
    const aMsg: ChatMessage = { id: newId('MSG'), sender: 'bot', text: faq.a, timestamp: new Date(Date.now() + 1).toISOString() };

    appendOptimistic(convId, [qMsg, aMsg], 0);
    setIsSubmitting(true);

    const db = getDB();
    const convIndex = db.chat_conversations.findIndex(c => c.id === convId);
    if (convIndex === -1) {
      rollbackOptimistic(convId, [qMsg.id, aMsg.id]);
      setIsSubmitting(false);
      return;
    }
    db.chat_conversations[convIndex].messages.push(qMsg, aMsg);

    try {
      await saveDB(db);
      clearPending([qMsg.id, aMsg.id]);
    } catch {
      setChatError('No se pudo enviar tu consulta. Verifica tu conexión e intenta de nuevo.');
      rollbackOptimistic(convId, [qMsg.id, aMsg.id]);
    }
    loadConversations();
    setIsSubmitting(false);
  };

  const activeConv = conversations.find(c => c.id === activeConvId);
  const activeChats = conversations.filter(c => c.status === 'nuevo' || c.status === 'pendiente');
  const closedChats = conversations.filter(c => c.status === 'resuelto');
  const mostrarRespuestasRapidas = !yaEscribioElCliente(activeConv);

  const convPreview = (c: ChatConversation): string => {
    const visible = (c.messages || []).filter(m => !m.isInternalNote);
    const last = visible[visible.length - 1];
    if (!last) return 'Sin mensajes';
    if (last.imageUrl && !last.text) return '📷 Imagen';
    return last.text.length > 38 ? last.text.slice(0, 38) + '…' : last.text;
  };

  return (
    <>
      {/* Floating Button — se oculta mientras el chat está abierto para que la
          ventana pueda usar todo el alto disponible sin encimarse con el FAB. */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-24 right-6 z-[45] w-12 h-12 max-w-12 max-h-12 rounded-full flex items-center justify-center transition hover:scale-105 active:scale-95 shadow-[var(--float-shadow-lg)] text-[var(--accent-ink)] bg-gradient-to-br from-[var(--brand-gold-dark)] to-[var(--brand-gold-mid)] border-2 border-[var(--bg-surface)]"
          id="btn-floating-chat"
        >
          <MessageSquare className="w-5 h-5" />
          {conversations.some(c => c.unreadCount > 0) && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-rose-500 rounded-full flex items-center justify-center text-[10px] font-bold text-white border-2 border-[var(--bg-surface)]">!</span>
          )}
        </button>
      )}

      {/* Chat popup window
          Posicionamiento robusto para todos los formatos (móvil vertical,
          tablet horizontal, APK):
          - Offset inferior pequeño (bottom-6) → aprovecha el alto disponible en
            pantallas bajas/horizontales, evitando que se vea "comprimida".
          - Alto flexible: crece hasta 600px pero nunca más de (100dvh − 7rem),
            de modo que el borde SUPERIOR siempre queda por debajo de la barra
            de navegación fija (top-0, h-16 = 4rem) con margen, sin taparla.
          - 100dvh (viewport dinámico) para respetar la barra del navegador
            móvil y el teclado en APK. */}
      {isOpen && (
        <div className="fixed bottom-6 right-4 sm:right-6 z-[45] w-[calc(100vw-2rem)] sm:w-96 h-[600px] max-h-[calc(100dvh-7rem)] bg-[var(--bg-base)] border border-[var(--border-color)] rounded-2xl shadow-[var(--float-shadow-lg)] flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300" id="floating-chat-window">
          {/* Header */}
          <div className="p-3.5 bg-gradient-to-r from-[var(--brand-gold-dark)] to-[var(--brand-gold-mid)] text-[var(--accent-ink)] flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              {isRegistered && (
                <button
                  onClick={() => setDrawerOpen(true)}
                  className="hover:opacity-75 transition p-1 -ml-1 shrink-0"
                  title="Mis consultas"
                  aria-label="Abrir historial de consultas"
                  id="btn-chat-drawer"
                >
                  <Menu className="w-5 h-5" />
                </button>
              )}
              <div className="w-9 h-9 rounded-full bg-white/25 border border-white/50 flex items-center justify-center shrink-0">
                <Bot className="w-[18px] h-[18px]" />
              </div>
              <div className="min-w-0">
                <h4 className="font-display font-bold text-[13.5px] truncate leading-tight">Soporte Technoverse CR</h4>
                <p className="text-[10.5px] flex items-center gap-1.5 truncate opacity-90 mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" style={{ boxShadow: '0 0 0 2px rgba(255,255,255,.35)' }} />
                  En línea &middot; responde al instante
                </p>
              </div>
            </div>
            <button onClick={() => setIsOpen(false)} className="hover:opacity-75 transition p-1 shrink-0" aria-label="Cerrar chat">
              <X className="w-5 h-5" />
            </button>
          </div>

          {chatError && (
            <div className="px-4 py-2 bg-rose-500/10 border-b border-rose-500/30 text-rose-500 text-[11px] flex items-center justify-between gap-2 shrink-0">
              <span>{chatError}</span>
              <button type="button" onClick={() => setChatError(null)} className="shrink-0 hover:opacity-70">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Main area (relative para contener el drawer superpuesto) */}
          <div className="relative flex-1 min-h-0 flex flex-col">
            {!isRegistered ? (
              /* Registration Screen */
              <form onSubmit={handleRegister} className="flex-1 p-6 flex flex-col justify-between overflow-y-auto">
                <div className="space-y-4">
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                    Para brindarte asistencia fiscal, de garantías y consultas en tiempo real conforme a la Ley costarricense, indícanos tus datos:
                  </p>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wide text-[var(--brand-gold-dark)] dark:text-[var(--brand-gold-light)] mb-1">Nombre Completo</label>
                    <input
                      type="text"
                      required
                      value={clientName}
                      onChange={(e) => setClientName(e.target.value)}
                      placeholder="Ej. Juan Pérez Madrigal"
                      className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl px-4 py-2.5 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/15 transition"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wide text-[var(--brand-gold-dark)] dark:text-[var(--brand-gold-light)] mb-1">Correo Electrónico</label>
                    <input
                      type="email"
                      required
                      value={clientEmail}
                      onChange={(e) => setClientEmail(e.target.value)}
                      placeholder="juan@gmail.com"
                      className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl px-4 py-2.5 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/15 transition"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] transition text-[var(--accent-ink)] text-xs font-bold py-3 rounded-xl shadow-sm mt-4 uppercase tracking-wider disabled:opacity-50"
                >
                  {isSubmitting ? 'Conectando...' : 'Iniciar Chat Seguro'}
                </button>
              </form>
            ) : activeConv ? (
              /* Chatting Screen */
              <>
                <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-[var(--bg-base)]">
                  {activeConv.messages.filter(msg => !msg.isInternalNote).map(msg => {
                    const isCustomer = msg.sender === 'customer';
                    const isBot = msg.sender === 'bot';
                    const pending = pendingIds.has(msg.id);
                    return (
                      <div key={msg.id} className={`flex gap-1.5 max-w-[82%] animate-in fade-in slide-in-from-bottom-1 duration-200 ${isCustomer ? 'ml-auto flex-row-reverse' : ''}`}>
                        {!isCustomer && (
                          <div className="w-[22px] h-[22px] rounded-full bg-[var(--bg-sunken)] text-[var(--text-muted)] flex items-center justify-center shrink-0 mt-0.5">
                            {isBot ? <Bot className="w-3 h-3" /> : <User className="w-3 h-3" />}
                          </div>
                        )}
                        <div className="min-w-0">
                          <div
                            className={`rounded-2xl px-3 py-2 text-xs shadow-sm ${
                              isCustomer
                                ? 'rounded-br-[5px] bg-[var(--bubble-out)] text-[var(--bubble-out-ink)]'
                                : isBot
                                ? 'rounded-bl-[5px] bg-transparent border border-[var(--border-color)] text-[var(--text-primary)]'
                                : 'rounded-bl-[5px] bg-[var(--bubble-in)] text-[var(--bubble-in-ink)]'
                            }`}
                          >
                            {msg.imageUrl && (
                              <img src={msg.imageUrl} alt="Imagen adjunta" className="rounded-lg max-w-full mb-1.5 max-h-56 object-cover" loading="lazy" />
                            )}
                            {msg.text && <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>}
                          </div>
                          <div className={`flex items-center gap-1 mt-1 text-[9.5px] font-mono text-[var(--text-muted)] ${isCustomer ? 'justify-end' : ''}`}>
                            <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            {isCustomer && (
                              pending
                                ? <Check className="w-3 h-3 opacity-50" />
                                : <CheckCheck className="w-3 h-3 text-[var(--accent)]" />
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {activeConv.status === 'resuelto' ? (
                  /* Consulta cerrada: solo lectura. Para seguir, nueva consulta. */
                  <div className="p-3 bg-[var(--bg-surface)] border-t border-[var(--border-color)] shrink-0 flex flex-col items-center gap-2 text-center">
                    <p className="text-[11px] text-[var(--text-secondary)]">Esta consulta fue cerrada por el equipo de soporte. Puedes revisarla, pero para seguir escribe una nueva.</p>
                    <button
                      onClick={handleNewConsulta}
                      disabled={isSubmitting}
                      className="flex items-center gap-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] transition text-[var(--accent-ink)] text-[11px] font-bold py-2 px-3 rounded-xl uppercase tracking-wider disabled:opacity-50"
                    >
                      <Plus className="w-3.5 h-3.5" /> Nueva Consulta
                    </button>
                  </div>
                ) : (
                  <>
                    {mostrarRespuestasRapidas && (
                      <div className="border-t border-[var(--border-color)] bg-[var(--bg-surface)] shrink-0 overflow-hidden transition-[max-height,opacity,padding] duration-300 ease-out max-h-40 opacity-100 p-3">
                        <span className="text-[9.5px] font-mono uppercase tracking-wide text-[var(--text-muted)] block mb-1.5">Preguntas frecuentes</span>
                        <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto">
                          {FAQ_DATA.map((faq, i) => (
                            <button
                              key={i}
                              onClick={() => handleFAQClick(faq)}
                              disabled={isSubmitting}
                              className="text-[10.5px] font-semibold bg-[var(--bg-sunken)] border border-[var(--border-color)] hover:border-[var(--accent)] hover:text-[var(--accent)] rounded-full px-2.5 py-1.5 text-[var(--text-secondary)] transition duration-150 disabled:opacity-50"
                            >
                              {faq.q}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <form onSubmit={handleSendMessage} className="p-3 bg-[var(--bg-surface)] border-t border-[var(--border-color)] flex gap-2 shrink-0">
                      <input
                        type="text"
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        placeholder="Escribe tu mensaje aquí..."
                        className="flex-1 bg-[var(--bg-sunken)] border border-[var(--border-color)] rounded-full px-4 py-2.5 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/15 transition"
                      />
                      <button
                        type="submit"
                        disabled={isSubmitting}
                        className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 bg-[var(--accent)] hover:bg-[var(--accent-hover)] hover:scale-105 active:scale-95 transition text-[var(--accent-ink)] disabled:opacity-50 shadow-[0_4px_10px_-4px_rgba(var(--accent-rgb),0.6)]"
                        aria-label="Enviar"
                      >
                        <Send className="w-3.5 h-3.5" />
                      </button>
                    </form>
                  </>
                )}
              </>
            ) : (
              /* Registrado pero sin consulta activa */
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6 gap-3 bg-[var(--bg-base)]">
                <MessageSquare className="w-10 h-10 text-[var(--text-muted)] opacity-40" />
                <p className="text-xs text-[var(--text-secondary)]">No tienes consultas activas.</p>
                <button
                  onClick={handleNewConsulta}
                  disabled={isSubmitting}
                  className="flex items-center gap-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] transition text-[var(--accent-ink)] text-xs font-bold py-2.5 px-4 rounded-xl uppercase tracking-wider disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" /> Nueva Consulta
                </button>
              </div>
            )}

            {/* Drawer / historial lateral — transform puro (60 FPS), sin librerías */}
            {isRegistered && (
              <>
                <div
                  onClick={() => setDrawerOpen(false)}
                  className={`absolute inset-0 z-20 bg-black/50 transition-opacity duration-300 ${drawerOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                />
                <div
                  className={`absolute inset-y-0 left-0 z-30 w-[78%] max-w-[280px] bg-[var(--bg-elevated)] border-r border-[var(--border-color)] flex flex-col transition-transform duration-300 ease-out will-change-transform ${drawerOpen ? 'translate-x-0' : '-translate-x-full'}`}
                  id="chat-history-drawer"
                >
                  <div className="p-4 border-b border-[var(--border-color)] flex items-center justify-between shrink-0">
                    <span className="text-sm font-display font-bold text-[var(--text-primary)]">Mis Consultas</span>
                    <button onClick={() => setDrawerOpen(false)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition p-1">
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="p-3 shrink-0">
                    <button
                      onClick={handleNewConsulta}
                      disabled={isSubmitting}
                      className="w-full flex items-center justify-center gap-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-ink)] text-xs font-bold py-2.5 rounded-xl transition disabled:opacity-50"
                    >
                      <Plus className="w-4 h-4" /> Crear Nueva Consulta
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-3">
                    <div>
                      <span className="text-[10px] font-bold uppercase text-[var(--brand-gold-dark)] dark:text-[var(--brand-gold-light)] tracking-wider">Chats Activos</span>
                      <div className="mt-1.5 space-y-1.5">
                        {activeChats.length === 0 && (
                          <p className="text-[11px] text-[var(--text-muted)] px-1">Sin consultas activas.</p>
                        )}
                        {activeChats.map(c => (
                          <button
                            key={c.id}
                            onClick={() => handleSelectConversation(c.id)}
                            className={`w-full text-left rounded-xl px-3 py-2 border transition ${
                              c.id === activeConvId
                                ? 'bg-[var(--accent)]/10 border-[var(--accent)]/50'
                                : 'bg-[var(--bg-surface)] border-[var(--border-color)] hover:border-[var(--text-muted)]'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] font-bold text-[var(--text-primary)] truncate">
                                {c.status === 'pendiente' ? 'En atención' : 'Consulta nueva'}
                              </span>
                              {c.assignedAdminEmail && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />}
                            </div>
                            <p className="text-[10px] text-[var(--text-secondary)] truncate mt-0.5">{convPreview(c)}</p>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <span className="text-[10px] font-bold uppercase text-[var(--text-muted)] tracking-wider">Historial Cerrado</span>
                      <div className="mt-1.5 space-y-1.5">
                        {closedChats.length === 0 && (
                          <p className="text-[11px] text-[var(--text-muted)] px-1">Sin chats cerrados.</p>
                        )}
                        {closedChats.map(c => (
                          <button
                            key={c.id}
                            onClick={() => handleSelectConversation(c.id)}
                            className="w-full text-left rounded-xl px-3 py-2 border bg-[var(--bg-surface)] border-[var(--border-color)] hover:border-[var(--text-muted)] transition opacity-80"
                          >
                            <span className="text-[11px] font-bold text-[var(--text-secondary)] truncate block">Consulta resuelta</span>
                            <p className="text-[10px] text-[var(--text-muted)] truncate mt-0.5">{convPreview(c)}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
