import React, { useState, useEffect, useRef } from 'react';
import { MessageSquare, Send, X, Bot, User } from 'lucide-react';
import { ChatConversation, ChatMessage } from '../types';
import { getDB, saveDB } from '../utils/storage';

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

export default function LiveChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [isRegistered, setIsRegistered] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadConversations();
    const handleUpdate = () => loadConversations();
    window.addEventListener('technoverse_db_updated', handleUpdate);
    return () => window.removeEventListener('technoverse_db_updated', handleUpdate);
  }, []);

  const loadConversations = () => {
    const db = getDB();
    setConversations(db.chat_conversations || []);
  };

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [conversations, activeConvId, isOpen]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName.trim() || !clientEmail.trim()) return;
    setChatError(null);

    const db = getDB();
    // Check if there is an ongoing (not yet resolved) conversation for this email
    let conv = db.chat_conversations.find(c => c.customerEmail === clientEmail && (c.status === 'nuevo' || c.status === 'pendiente'));

    if (!conv) {
      const newMsg: ChatMessage = {
        id: `MSG-${Date.now()}-1`,
        sender: 'bot',
        text: `¡Hola ${clientName}! Bienvenido al soporte de Technoverse Costa Rica. Soy tu asistente virtual. ¿En qué te puedo ayudar hoy? Puedes hacer clic en una pregunta frecuente abajo o escribir tu consulta.`,
        timestamp: new Date().toISOString()
      };
      conv = {
        id: `CONV-${Date.now()}`,
        customerName: clientName,
        customerEmail: clientEmail,
        messages: [newMsg],
        status: 'nuevo',
        unreadCount: 0
      };
      db.chat_conversations.push(conv);
      try {
        await saveDB(db);
      } catch {
        // Un fallo aquí (ej. app desactualizada, sin conexión) no debe dejar
        // al cliente en una pantalla rota: se avisa y se puede reintentar.
        setChatError('No se pudo iniciar el chat. Verifica tu conexión e intenta de nuevo.');
        loadConversations();
        return;
      }
    }

    setActiveConvId(conv.id);
    setIsRegistered(true);
    loadConversations();
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !activeConvId) return;
    setChatError(null);

    const db = getDB();
    const convIndex = db.chat_conversations.findIndex(c => c.id === activeConvId);
    if (convIndex === -1) return;

    const messageText = inputText.trim();
    const userMsg: ChatMessage = {
      id: `MSG-${Date.now()}`,
      sender: 'customer',
      text: messageText,
      timestamp: new Date().toISOString()
    };

    db.chat_conversations[convIndex].messages.push(userMsg);
    db.chat_conversations[convIndex].unreadCount += 1;

    // El bot solo debe responder mientras nadie humano ha tomado el chat.
    // En cuanto un admin se asigna o cambia el estado (pendiente/resuelto),
    // el bot se desactiva de inmediato para no competir con soporte humano.
    const conv = db.chat_conversations[convIndex];
    const botActive = !conv.assignedAdminEmail && conv.status === 'nuevo';

    setInputText('');

    try {
      await saveDB(db);
    } catch {
      // Fallo real de guardado: se avisa al cliente y se le devuelve su texto
      // para que pueda reintentar, en vez de que el mensaje desaparezca sin
      // explicación (y sin disparar el bot sobre un mensaje que nunca llegó).
      setChatError('No se pudo enviar tu mensaje. Verifica tu conexión e intenta de nuevo.');
      setInputText(messageText);
      loadConversations();
      return;
    }

    loadConversations();

    if (botActive) {
      const lowerText = messageText.toLowerCase();
      let matchedFAQ = FAQ_DATA.find(faq =>
        lowerText.includes(faq.q.toLowerCase()) ||
        lowerText.includes(faq.q.split(' ')[1]) || // simple keyword match
        (lowerText.includes('garant') && faq.q.includes('garantía')) ||
        (lowerText.includes('pago') && faq.q.includes('pago')) ||
        (lowerText.includes('factur') && faq.q.includes('facturación'))
      );

      if (matchedFAQ) {
        setTimeout(() => {
          const updatedDb = getDB();
          const freshIdx = updatedDb.chat_conversations.findIndex(c => c.id === activeConvId);
          const freshConv = updatedDb.chat_conversations[freshIdx];
          if (freshIdx !== -1 && !freshConv.assignedAdminEmail && freshConv.status === 'nuevo') {
            freshConv.messages.push({
              id: `MSG-${Date.now()}-bot`,
              sender: 'bot',
              text: matchedFAQ.a,
              timestamp: new Date().toISOString()
            });
            saveDB(updatedDb);
            loadConversations();
          }
        }, 1000);
      } else {
        // Standard placeholder reply if no match
        setTimeout(() => {
          const updatedDb = getDB();
          const freshIdx = updatedDb.chat_conversations.findIndex(c => c.id === activeConvId);
          const freshConv = updatedDb.chat_conversations[freshIdx];
          if (freshIdx !== -1 && !freshConv.assignedAdminEmail && freshConv.status === 'nuevo') {
            freshConv.messages.push({
              id: `MSG-${Date.now()}-bot`,
              sender: 'bot',
              text: "Entiendo tu consulta. He asignado tu ticket a nuestro personal de soporte humano. Te atenderemos en el orden de la cola.",
              timestamp: new Date().toISOString()
            });
            saveDB(updatedDb);
            loadConversations();
          }
        }, 1500);
      }
    }
  };

  const handleFAQClick = async (faq: typeof FAQ_DATA[0]) => {
    if (!activeConvId) return;
    setChatError(null);
    const db = getDB();
    const convIndex = db.chat_conversations.findIndex(c => c.id === activeConvId);
    if (convIndex === -1) return;

    db.chat_conversations[convIndex].messages.push({
      id: `MSG-${Date.now()}-q`,
      sender: 'customer',
      text: faq.q,
      timestamp: new Date().toISOString()
    });

    db.chat_conversations[convIndex].messages.push({
      id: `MSG-${Date.now()}-a`,
      sender: 'bot',
      text: faq.a,
      timestamp: new Date().toISOString()
    });

    try {
      await saveDB(db);
    } catch {
      setChatError('No se pudo enviar tu consulta. Verifica tu conexión e intenta de nuevo.');
    }
    loadConversations();
  };

  const activeConv = conversations.find(c => c.id === activeConvId);

  // Public Floating Widget view
  return (
    <>
      {/* Floating Button */}
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-24 right-6 z-[45] w-11 h-11 max-w-11 max-h-11 bg-[var(--brand-gold-mid)] hover:bg-[#c49f2c] shadow-lg text-[#1a1408] dark:text-[#14100a] rounded-full flex items-center justify-center transition hover:scale-105 active:scale-95 border-2 border-white"
        id="btn-floating-chat"
      >
        <MessageSquare className="w-5 h-5" />
        {conversations.some(c => c.customerEmail === clientEmail && c.unreadCount > 0) && (
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-rose-500 rounded-full flex items-center justify-center text-[10px] font-bold">!</span>
        )}
      </button>

      {/* Chat popup window */}
      {isOpen && (
        <div className="fixed bottom-40 right-6 z-[45] w-[calc(100vw-3rem)] sm:w-96 h-[500px] max-h-[70vh] bg-slate-950 border border-white/10 rounded-2xl shadow-sm flex flex-col text-white overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300" id="floating-chat-window">
          {/* Header */}
          <div className="p-4 bg-gradient-to-r from-emerald-500 to-teal-600 dark:bg-[var(--brand-gold-mid)] dark:bg-none flex items-center justify-between shadow-sm">
            <div className="flex items-center gap-2">
              <Bot className="w-6 h-6 text-white" />
              <div>
                <h4 className="font-semibold text-sm">Soporte Technoverse CR</h4>
                <p className="text-[10px] text-emerald-100 dark:text-[var(--brand-gold-light)] flex items-center gap-1">● Conectado con soporte humano legal</p>
              </div>
            </div>
            <button 
              onClick={() => setIsOpen(false)}
              className="text-white hover:text-rose-200 transition p-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {chatError && (
            <div className="px-4 py-2 bg-rose-950/80 border-b border-rose-500/40 text-rose-200 text-[11px] flex items-center justify-between gap-2">
              <span>{chatError}</span>
              <button type="button" onClick={() => setChatError(null)} className="shrink-0 text-rose-300 hover:text-white">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {!isRegistered ? (
            /* Registration Screen */
            <form onSubmit={handleRegister} className="flex-1 p-6 flex flex-col justify-between">
              <div className="space-y-4">
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                  Para brindarte asistencia fiscal, de garantías y consultas en tiempo real conforme a la Ley costarricense, indícanos tus datos:
                </p>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-emerald-400 dark:text-[var(--brand-gold-light)] mb-1">Nombre Completo</label>
                  <input
                    type="text"
                    required
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    placeholder="Ej. Juan Pérez Madrigal"
                    className="w-full bg-[var(--bg-surface)] border border-white/10 rounded-xl px-4 py-2.5 text-xs text-[var(--text-primary)] focus:outline-none focus:border-emerald-500 dark:focus:border-[var(--brand-gold-mid)]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-emerald-400 dark:text-[var(--brand-gold-light)] mb-1">Correo Electrónico</label>
                  <input
                    type="email"
                    required
                    value={clientEmail}
                    onChange={(e) => setClientEmail(e.target.value)}
                    placeholder="juan@gmail.com"
                    className="w-full bg-[var(--bg-surface)] border border-white/10 rounded-xl px-4 py-2.5 text-xs text-[var(--text-primary)] focus:outline-none focus:border-emerald-500 dark:focus:border-[var(--brand-gold-mid)]"
                  />
                </div>
              </div>
              <button
                type="submit"
                className="w-full bg-emerald-500 hover:bg-emerald-600 dark:bg-[var(--brand-gold-mid)] dark:hover:bg-[var(--brand-gold-dark)] transition text-white text-xs font-bold py-3 rounded-xl shadow-sm mt-4 uppercase tracking-wider dark:text-slate-950"
              >
                Iniciar Chat Seguro
              </button>
            </form>
          ) : (
            /* Chatting Screen */
            <>
              {/* Messages Container */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {activeConv?.messages.filter(msg => !msg.isInternalNote).map(msg => (
                  <div key={msg.id} className={`flex ${
                    msg.sender === 'customer' ? 'justify-end' : 'justify-start'
                  }`}>
                    <div className={`max-w-[80%] rounded-xl p-3 text-xs ${
                      msg.sender === 'customer' 
                        ? 'bg-emerald-600 dark:bg-[var(--brand-gold-mid)] text-white dark:text-slate-950'
                        : msg.sender === 'bot'
                        ? 'bg-slate-900 border border-white/5 text-slate-200'
                        : 'bg-teal-900/60 border border-teal-500/30 dark:border-[var(--brand-gold-dark)] text-teal-100 dark:text-[var(--brand-gold-light)]'
                    }`}>
                      <div className="flex items-center gap-1 mb-1 text-[9px] opacity-75">
                        {msg.sender === 'bot' ? <Bot className="w-2.5 h-2.5" /> : <User className="w-2.5 h-2.5" />}
                        <span className="capitalize">{msg.sender === 'customer' ? 'Tú' : msg.sender === 'bot' ? 'Asistente' : 'Soporte Humano'}</span>
                      </div>
                      {msg.imageUrl && (
                        <img src={msg.imageUrl} alt="Imagen adjunta" className="rounded-lg max-w-full mb-1.5 max-h-56 object-cover" loading="lazy" />
                      )}
                      {msg.text && <p className="whitespace-pre-wrap">{msg.text}</p>}
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              {/* FAQs shortcuts list inside chat window */}
              {activeConv && activeConv.messages.length < 5 && (
                <div className="p-3 bg-[var(--bg-surface)] border-t border-white/10 space-y-1.5">
                  <span className="text-[10px] text-[var(--text-secondary)] font-bold block mb-1">Preguntas Frecuentes de la DGT / Ley Consumo:</span>
                  <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto">
                    {FAQ_DATA.map((faq, i) => (
                      <button
                        key={i}
                        onClick={() => handleFAQClick(faq)}
                        className="text-[9px] bg-slate-900 border border-white/10 hover:border-emerald-500 dark:hover:border-[var(--brand-gold-dark)] dark:border-[var(--brand-gold-mid)]/50 rounded-full px-2.5 py-1 text-[var(--text-secondary)] hover:text-emerald-300 dark:hover:text-[var(--brand-gold-light)] dark:text-[var(--brand-gold-light)] transition duration-150"
                      >
                        {faq.q}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Input Form */}
              <form onSubmit={handleSendMessage} className="p-3 bg-slate-950 border-t border-white/10 flex gap-2">
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="Escribe tu mensaje aquí..."
                  className="flex-1 bg-[var(--bg-surface)] border border-white/10 rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-emerald-500 dark:focus:border-[var(--brand-gold-mid)]"
                />
                <button
                  type="submit"
                  className="bg-emerald-500 hover:bg-emerald-600 dark:bg-[var(--brand-gold-mid)] dark:hover:bg-[var(--brand-gold-dark)] transition p-2 rounded-xl text-white dark:text-slate-950"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </form>
            </>
          )}
        </div>
      )}
    </>
  );
}
