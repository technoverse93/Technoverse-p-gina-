import React, { useState, useRef, useEffect } from 'react';
import { ArrowLeft, MoreVertical, Send, StickyNote, ImagePlus, RefreshCw, Shield, Bot, User } from 'lucide-react';
import { ChatConversation } from '../../types';
import { compressImage } from '../../utils/storage';
import { supabase } from '../../supabaseClient';
import ChatActionsMenu from './ChatActionsMenu';
import { useToast } from '../ui/Overlays';

interface ChatThreadProps {
  conversation: ChatConversation;
  staffEmails: string[];
  onBack: () => void;
  onSendMessage: (convId: string, payload: { text: string; imageUrl?: string; isInternalNote?: boolean }) => Promise<void>;
  onAssign: (convId: string, email: string) => Promise<void>;
  onChangeStatus: (convId: string, status: 'nuevo' | 'pendiente') => Promise<void>;
  onResolve: (convId: string) => Promise<void>;
}

export default function ChatThread({ conversation, staffEmails, onBack, onSendMessage, onAssign, onChangeStatus, onResolve }: ChatThreadProps) {
  const toast = useToast();
  const [inputText, setInputText] = useState('');
  const [noteMode, setNoteMode] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // La subida de imagen es asíncrona (lectura + compresión + Storage); si el
  // admin cambia de conversación o sale del módulo antes de que termine, no
  // se debe tocar el estado de un componente ya desmontado.
  const isMountedRef = useRef(true);

  // Cuántos mensajes (contando desde el más reciente) se dibujan de una vez.
  // Un hilo con meses de historial no necesita renderizar TODO para mostrar
  // los últimos: eso es DOM y trabajo de layout que crece sin límite con la
  // antigüedad del chat, no con lo que la persona realmente está viendo.
  const TANDA_MENSAJES = 60;
  const [cantidadVisible, setCantidadVisible] = useState(TANDA_MENSAJES);
  useEffect(() => { setCantidadVisible(TANDA_MENSAJES); }, [conversation.id]);
  const indiceInicio = Math.max(0, conversation.messages.length - cantidadVisible);
  const mensajesVisibles = conversation.messages.slice(indiceInicio);
  const hayMensajesAnteriores = indiceInicio > 0;

  // Instantáneo (`auto`), no animado: con mensajes seguidos, un scroll
  // "smooth" que no llega a terminar antes del siguiente mensaje se ve
  // como si el chat se hubiera "trabado" a medio camino.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [conversation.messages.length]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const handleSendText = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    const text = inputText.trim();
    const wasNote = noteMode;
    setInputText('');
    setNoteMode(false);
    await onSendMessage(conversation.id, { text, isInternalNote: wasNote });
  };

  const handleImagePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const reader = new FileReader();
      const dataUrl: string = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const compressed = await compressImage(dataUrl, 1000, 1000, 0.7);
      const blob = await (await fetch(compressed)).blob();
      const path = `${conversation.id}/${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage.from('chat-images').upload(path, blob, { contentType: 'image/jpeg' });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from('chat-images').getPublicUrl(path);
      await onSendMessage(conversation.id, { text: '', imageUrl: data.publicUrl });
    } catch (err: any) {
      if (isMountedRef.current) toast.error('No se pudo subir la imagen. Detalle: ' + (err?.message || err));
    } finally {
      if (isMountedRef.current) setUploading(false);
    }
  };

  return (
    <>
      <div className="p-3 border-b border-[var(--border-color)] flex items-center justify-between gap-2 relative bg-[var(--bg-elevated)]" id="chat-thread-header">
        <div className="flex items-center gap-2.5 min-w-0">
          <button type="button" onClick={onBack} className="md:hidden p-1 -ml-1 text-[var(--text-secondary)]">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="w-9 h-9 rounded-full bg-[var(--accent)]/15 text-[var(--brand-gold-dark)] flex items-center justify-center font-display font-bold text-sm shrink-0">
            {conversation.customerName?.charAt(0).toUpperCase() || '?'}
          </div>
          <div className="min-w-0">
            <h4 className="font-display font-bold text-[13.5px] text-[var(--text-primary)] truncate leading-tight">{conversation.customerName || 'Cliente'}</h4>
            <p className="text-[10.5px] font-mono text-[var(--text-secondary)] truncate">{conversation.customerEmail}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {conversation.status === 'resuelto' && (
            <span className="text-[9.5px] font-bold px-2.5 py-1 rounded-full bg-[var(--ok-soft)] text-[var(--ok)] hidden sm:inline">
              Resuelto
            </span>
          )}
          {conversation.assignedAdminEmail && (
            <span className="text-[9.5px] font-bold px-2.5 py-1 rounded-full bg-[var(--ok-soft)] text-[var(--ok)] hidden sm:inline truncate max-w-[140px]">
              {conversation.assignedAdminEmail}
            </span>
          )}
          <button type="button" onClick={() => setShowMenu(v => !v)} className="p-1.5 rounded-lg hover:bg-[var(--bg-surface)] text-[var(--text-secondary)]" aria-label="Más opciones">
            <MoreVertical className="w-4 h-4" />
          </button>
          {showMenu && (
            <ChatActionsMenu
              conversation={conversation}
              staffEmails={staffEmails}
              onClose={() => setShowMenu(false)}
              onAssign={(email) => onAssign(conversation.id, email)}
              onChangeStatus={(status) => onChangeStatus(conversation.id, status)}
              onResolve={() => onResolve(conversation.id)}
            />
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[var(--bg-base)]" id="chat-thread-messages">
        {hayMensajesAnteriores && (
          <div className="flex justify-center pb-1">
            <button
              type="button"
              onClick={() => setCantidadVisible(v => v + TANDA_MENSAJES)}
              className="text-[10.5px] font-bold px-3 py-1.5 rounded-full bg-[var(--bg-surface)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition"
            >
              Ver mensajes anteriores
            </button>
          </div>
        )}
        {mensajesVisibles.map(msg => {
          if (msg.isInternalNote) {
            return (
              <div key={msg.id} className="flex justify-center">
                <div className="max-w-[88%] rounded-xl px-3 py-2 text-[11px] bg-amber-400/12 border border-amber-500/35 text-amber-700 flex items-start gap-1.5">
                  <StickyNote className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <div>
                    {msg.text && <p className="tv-break whitespace-pre-wrap">{msg.text}</p>}
                    <span className="block mt-1 text-[9px] opacity-70 font-mono">Nota interna &middot; {new Date(msg.timestamp).toLocaleString()}</span>
                  </div>
                </div>
              </div>
            );
          }
          const isSupport = msg.sender === 'support';
          const isBot = msg.sender === 'bot';
          return (
            <div key={msg.id} className={`flex gap-1.5 max-w-[78%] ${isSupport ? 'ml-auto flex-row-reverse' : ''}`}>
              {!isSupport && (
                <div className="w-[22px] h-[22px] rounded-full bg-[var(--bg-sunken)] text-[var(--text-muted)] flex items-center justify-center shrink-0 mt-0.5">
                  {isBot ? <Bot className="w-3 h-3" /> : <User className="w-3 h-3" />}
                </div>
              )}
              <div className="min-w-0">
                <div className={`rounded-2xl p-3 text-xs shadow-sm ${
                  isSupport
                    ? 'rounded-br-[5px] bg-[var(--bubble-out)] text-[var(--bubble-out-ink)]'
                    : isBot
                    ? 'rounded-bl-[5px] bg-transparent border border-[var(--border-color)] text-[var(--text-primary)]'
                    : 'rounded-bl-[5px] bg-[var(--bubble-in)] text-[var(--bubble-in-ink)]'
                }`}>
                  {msg.imageUrl && (
                    <img src={msg.imageUrl} alt="Imagen adjunta" className="rounded-lg max-w-full mb-1.5 max-h-64 object-cover" loading="lazy" decoding="async" />
                  )}
                  {msg.text && <p className="tv-break whitespace-pre-wrap leading-relaxed">{msg.text}</p>}
                </div>
                <div className={`flex items-center gap-1 mt-1 text-[9.5px] font-mono text-[var(--text-muted)] ${isSupport ? 'justify-end' : ''}`}>
                  {isSupport && <Shield className="w-2.5 h-2.5" />}
                  <span>{isSupport ? 'Vos' : isBot ? 'Asistente' : conversation.customerName}</span>
                  <span>&middot;</span>
                  <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSendText} className={`p-3 border-t border-[var(--border-color)] flex items-center gap-2 transition-colors ${noteMode ? 'bg-amber-400/10' : 'bg-[var(--bg-elevated)]'}`} id="chat-thread-input">
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImagePick} />
        <button
          type="button"
          onClick={() => setNoteMode(v => !v)}
          title="Nota interna"
          className={`w-9 h-9 rounded-full flex items-center justify-center transition shrink-0 border ${noteMode ? 'bg-amber-500 border-amber-500 text-white' : 'bg-[var(--bg-sunken)] border-[var(--border-color)] text-[var(--text-secondary)] hover:text-amber-500 hover:border-amber-500'}`}
        >
          <StickyNote className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          title="Adjuntar imagen"
          className="w-9 h-9 rounded-full flex items-center justify-center border border-[var(--border-color)] bg-[var(--bg-sunken)] text-[var(--text-secondary)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition shrink-0 disabled:opacity-40"
        >
          {uploading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
        </button>
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={noteMode ? 'Nota interna (solo visible para el equipo)...' : 'Escribe tu respuesta...'}
          className="flex-1 bg-[var(--bg-sunken)] border border-[var(--border-color)] rounded-full px-4 py-2.5 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/15 transition"
        />
        <button type="submit" className="w-9 h-9 rounded-full flex items-center justify-center bg-[var(--accent)] hover:bg-[var(--accent-hover)] hover:scale-105 active:scale-95 text-[var(--accent-ink)] transition shrink-0 shadow-[0_4px_10px_-4px_rgba(var(--accent-rgb),0.6)]" aria-label="Enviar">
          <Send className="w-3.5 h-3.5" />
        </button>
      </form>
    </>
  );
}
