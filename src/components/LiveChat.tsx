import React, { useState, useEffect, useRef } from 'react';
import { MessageSquare, Send, X, Shield, Bot, User, Award } from 'lucide-react';
import { ChatConversation, ChatMessage } from '../types';
import { getDB, saveDB, addAuditLog } from '../utils/storage';

interface LiveChatProps {
  isAdmin?: boolean;
  activeUserEmail?: string;
}

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
    q: "¿Cómo funcionan las membresías?",
    a: "Ofrecemos membresías Plata, Oro y Platino. Brindan descuentos automáticos del 5%, 10% y 15% en compras y reparaciones, envío gratuito (según la provincia) y soporte prioritario en la cola de atención."
  },
  {
    q: "¿Cumplen con la facturación electrónica?",
    a: "Sí, cada compra u orden de reparación genera un XML firmado conforme a la resolución DGT-R-48-2016 del Ministerio de Hacienda de Costa Rica, con IVA del 13% desglosado."
  }
];

export default function LiveChat({ isAdmin = false, activeUserEmail = "anonimo@technoverse.com" }: LiveChatProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientMembership, setClientMembership] = useState<'Normal' | 'Plata' | 'Oro' | 'Platino'>('Normal');
  const [isRegistered, setIsRegistered] = useState(false);
  
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

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName.trim() || !clientEmail.trim()) return;

    const db = getDB();
    // Check if there is an active conversation for this email
    let conv = db.chat_conversations.find(c => c.customerEmail === clientEmail && c.status === 'active');
    
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
        membershipLevel: clientMembership,
        messages: [newMsg],
        status: 'active',
        unreadCount: 0
      };
      db.chat_conversations.push(conv);
      saveDB(db);
    }
    
    setActiveConvId(conv.id);
    setIsRegistered(true);
    loadConversations();
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !activeConvId) return;

    const db = getDB();
    const convIndex = db.chat_conversations.findIndex(c => c.id === activeConvId);
    if (convIndex === -1) return;

    const userMsg: ChatMessage = {
      id: `MSG-${Date.now()}`,
      sender: isAdmin ? 'support' : 'customer',
      text: inputText.trim(),
      timestamp: new Date().toISOString()
    };

    db.chat_conversations[convIndex].messages.push(userMsg);
    
    if (isAdmin) {
      db.chat_conversations[convIndex].unreadCount = 0;
      addAuditLog(activeUserEmail, 'Soporte', 'Respuesta Chat', `Respuesta enviada a ${db.chat_conversations[convIndex].customerName}`);
    } else {
      db.chat_conversations[convIndex].unreadCount += 1;
      // Auto bot responder if not escalated or if matches FAQ
      const lowerText = inputText.toLowerCase();
      let matchedFAQ = FAQ_DATA.find(faq => 
        lowerText.includes(faq.q.toLowerCase()) || 
        lowerText.includes(faq.q.split(' ')[1]) || // simple keyword match
        (lowerText.includes('garant') && faq.q.includes('garantía')) ||
        (lowerText.includes('pago') && faq.q.includes('pago')) ||
        (lowerText.includes('membres') && faq.q.includes('membresías')) ||
        (lowerText.includes('factur') && faq.q.includes('facturación'))
      );

      if (matchedFAQ) {
        setTimeout(() => {
          const updatedDb = getDB();
          const freshIdx = updatedDb.chat_conversations.findIndex(c => c.id === activeConvId);
          if (freshIdx !== -1) {
            updatedDb.chat_conversations[freshIdx].messages.push({
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
          if (freshIdx !== -1) {
            updatedDb.chat_conversations[freshIdx].messages.push({
              id: `MSG-${Date.now()}-bot`,
              sender: 'bot',
              text: "Entiendo tu consulta. He asignado tu ticket a nuestro personal de soporte humano. Debido a tu nivel de membresía (" + updatedDb.chat_conversations[freshIdx].membershipLevel + "), tendrás prioridad en la cola de atención.",
              timestamp: new Date().toISOString()
            });
            saveDB(updatedDb);
            loadConversations();
          }
        }, 1500);
      }
    }

    saveDB(db);
    setInputText('');
    loadConversations();
  };

  const handleFAQClick = (faq: typeof FAQ_DATA[0]) => {
    if (!activeConvId) return;
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

    saveDB(db);
    loadConversations();
  };

  const activeConv = conversations.find(c => c.id === activeConvId);

  // Sorting chat conversations: Platino first, then Oro, then Plata, then Normal
  const sortedConversations = [...conversations].sort((a, b) => {
    const priority = { 'Platino': 4, 'Oro': 3, 'Plata': 2, 'Normal': 1 };
    const priorityA = priority[a.membershipLevel] || 1;
    const priorityB = priority[b.membershipLevel] || 1;
    return priorityB - priorityA;
  });

  if (isAdmin) {
    // Admin Support Dashboard view
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-[600px] bg-slate-900 border border-white/10 rounded-2xl p-4 text-white overflow-hidden" id="chat-admin-panel">
        {/* Conversations List */}
        <div className="border-r border-white/10 pr-4 flex flex-col h-full">
          <h3 className="font-semibold text-lg mb-4 text-sky-400 dark:text-[var(--brand-gold-light)] flex items-center gap-2">
            <MessageSquare className="w-5 h-5" /> Cola de Mensajes (Prioridad de Membresía)
          </h3>
          <div className="flex-1 overflow-y-auto space-y-2">
            {sortedConversations.length === 0 ? (
              <p className="text-sm text-[var(--text-secondary)] italic text-center py-8">No hay chats activos en este momento.</p>
            ) : (
              sortedConversations.map(conv => (
                <button
                  key={conv.id}
                  onClick={() => {
                    setActiveConvId(conv.id);
                    // Clear unread count on select
                    const db = getDB();
                    const idx = db.chat_conversations.findIndex(c => c.id === conv.id);
                    if (idx !== -1) {
                      db.chat_conversations[idx].unreadCount = 0;
                      saveDB(db);
                      loadConversations();
                    }
                  }}
                  className={`w-full text-left p-3 rounded-xl transition duration-150 flex items-center justify-between border ${
                    activeConvId === conv.id 
                      ? 'bg-sky-500 dark:bg-[var(--brand-gold-mid)]/20 border-sky-500 dark:border-[var(--brand-gold-dark)] dark:border-[var(--brand-gold-mid)]/50' 
                      : 'bg-[var(--bg-surface)] hover:bg-[var(--bg-surface)] border-white/5'
                  }`}
                >
                  <div className="truncate pr-2">
                    <div className="font-medium text-sm flex items-center gap-1.5">
                      {conv.customerName}
                      {conv.unreadCount > 0 && (
                        <span className="w-2.5 h-2.5 bg-rose-500 rounded-full animate-pulse" />
                      )}
                    </div>
                    <div className="text-xs text-[var(--text-secondary)] truncate">{conv.customerEmail}</div>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                    conv.membershipLevel === 'Platino' ? 'bg-indigo-600 dark:bg-[var(--brand-gold-mid)] text-white' :
                    conv.membershipLevel === 'Oro' ? 'bg-amber-500 text-slate-950' :
                    conv.membershipLevel === 'Plata' ? 'bg-slate-300 text-slate-950' :
                    'bg-slate-700 text-[var(--text-secondary)]'
                  }`}>
                    {conv.membershipLevel}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Chat window */}
        <div className="col-span-2 flex flex-col h-full bg-slate-950 rounded-xl overflow-hidden border border-white/5">
          {activeConv ? (
            <>
              {/* Header */}
              <div className="p-4 bg-[var(--bg-surface)] border-b border-white/10 flex items-center justify-between">
                <div>
                  <h4 className="font-medium text-sky-400 dark:text-[var(--brand-gold-light)]">{activeConv.customerName}</h4>
                  <p className="text-xs text-[var(--text-secondary)]">{activeConv.customerEmail}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2.5 py-1 rounded-full font-bold uppercase ${
                    activeConv.membershipLevel === 'Platino' ? 'bg-indigo-600 dark:bg-[var(--brand-gold-mid)] text-white animate-pulse' :
                    activeConv.membershipLevel === 'Oro' ? 'bg-amber-500 text-slate-950' :
                    activeConv.membershipLevel === 'Plata' ? 'bg-slate-300 text-slate-950' :
                    'bg-slate-700 text-[var(--text-secondary)]'
                  }`}>
                    Membresía {activeConv.membershipLevel} (Soporte prioritario)
                  </span>
                </div>
              </div>

              {/* Message List */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {activeConv.messages.map(msg => (
                  <div key={msg.id} className={`flex ${
                    msg.sender === 'support' ? 'justify-end' : 'justify-start'
                  }`}>
                    <div className={`max-w-[75%] rounded-xl p-3 text-sm ${
                      msg.sender === 'support' 
                        ? 'bg-sky-500 dark:bg-[var(--brand-gold-mid)] text-white' 
                        : msg.sender === 'bot'
                        ? 'bg-indigo-950/80 dark:bg-[var(--brand-gold-mid)]/10 border border-indigo-500/30 dark:border-[var(--brand-gold-dark)] text-indigo-200 dark:text-[var(--brand-gold-light)]'
                        : 'bg-[var(--bg-surface)] text-slate-100'
                    }`}>
                      <div className="flex items-center gap-1 mb-1 text-[10px] opacity-70">
                        {msg.sender === 'support' && <Shield className="w-3 h-3" />}
                        {msg.sender === 'bot' && <Bot className="w-3 h-3" />}
                        {msg.sender === 'customer' && <User className="w-3 h-3" />}
                        <span className="capitalize">{msg.sender === 'support' ? 'Soporte' : msg.sender === 'bot' ? 'Asistente' : 'Cliente'}</span>
                        <span>•</span>
                        <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <p className="whitespace-pre-wrap">{msg.text}</p>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              {/* Chat Input */}
              <form onSubmit={handleSendMessage} className="p-4 bg-[var(--bg-surface)] border-t border-white/10 flex gap-2">
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="Escribe tu respuesta como agente soporte..."
                  className="flex-1 bg-[var(--bg-surface)] border border-white/10 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-sky-500 dark:focus:border-[var(--brand-gold-mid)]"
                />
                <button
                  type="submit"
                  className="bg-sky-500 hover:bg-sky-600 dark:bg-[var(--brand-gold-mid)] dark:hover:bg-[var(--brand-gold-dark)] transition p-2 rounded-xl text-white font-medium flex items-center justify-center dark:text-slate-950"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-[var(--text-secondary)] p-8">
              <MessageSquare className="w-12 h-12 text-[var(--text-secondary)] mb-3" />
              <p className="text-center">Selecciona una conversación de la lista para atender al cliente en tiempo real.</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Public Floating Widget view
  return (
    <>
      {/* Floating Button */}
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-24 right-6 z-[999] w-11 h-11 bg-[var(--brand-gold-mid)] hover:bg-[#c49f2c] shadow-lg text-white rounded-full flex items-center justify-center transition hover:scale-105 active:scale-95 border-2 border-white"
        id="btn-floating-chat"
      >
        <MessageSquare className="w-5 h-5" />
        {conversations.some(c => c.customerEmail === clientEmail && c.unreadCount > 0) && (
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-rose-500 rounded-full flex items-center justify-center text-[10px] font-bold">!</span>
        )}
      </button>

      {/* Chat popup window */}
      {isOpen && (
        <div className="fixed bottom-40 right-6 z-50 w-[calc(100vw-3rem)] sm:w-96 h-[500px] max-h-[70vh] bg-slate-950 border border-white/10 rounded-2xl shadow-sm flex flex-col text-white overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300" id="floating-chat-window">
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
                    className="w-full bg-[var(--bg-surface)] border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500 dark:focus:border-[var(--brand-gold-mid)]"
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
                    className="w-full bg-[var(--bg-surface)] border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500 dark:focus:border-[var(--brand-gold-mid)]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-emerald-400 dark:text-[var(--brand-gold-light)] mb-1">Membresía Asociada</label>
                  <select
                    value={clientMembership}
                    onChange={(e: any) => setClientMembership(e.target.value)}
                    className="w-full bg-slate-900 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500 dark:focus:border-[var(--brand-gold-mid)]"
                  >
                    <option value="Normal">Sin membresía (Estándar)</option>
                    <option value="Plata">Membresía Plata</option>
                    <option value="Oro">Membresía Oro (Envío gratis SJ)</option>
                    <option value="Platino">Membresía Platino (VIP)</option>
                  </select>
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
                {activeConv?.messages.map(msg => (
                  <div key={msg.id} className={`flex ${
                    msg.sender === 'customer' ? 'justify-end' : 'justify-start'
                  }`}>
                    <div className={`max-w-[80%] rounded-xl p-3 text-xs ${
                      msg.sender === 'customer' 
                        ? 'bg-emerald-600 dark:bg-[var(--brand-gold-mid)] dark:bg-[var(--brand-gold-dark)] text-white' 
                        : msg.sender === 'bot'
                        ? 'bg-slate-900 border border-white/5 text-slate-200'
                        : 'bg-teal-900/60 dark:bg-[var(--brand-gold-mid)]/10/20 border border-teal-500/30 dark:border-[var(--brand-gold-dark)] text-teal-100 dark:text-[var(--brand-gold-light)] dark:text-[var(--text-primary)]'
                    }`}>
                      <div className="flex items-center gap-1 mb-1 text-[9px] opacity-75">
                        {msg.sender === 'bot' ? <Bot className="w-2.5 h-2.5" /> : <User className="w-2.5 h-2.5" />}
                        <span className="capitalize">{msg.sender === 'customer' ? 'Tú' : msg.sender === 'bot' ? 'Asistente' : 'Soporte Humano'}</span>
                      </div>
                      <p className="whitespace-pre-wrap">{msg.text}</p>
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
                  className="flex-1 bg-[var(--bg-surface)] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 dark:focus:border-[var(--brand-gold-mid)]"
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
