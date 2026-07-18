import React, { useState, useRef, useEffect } from 'react';
import { ArrowLeft, MoreVertical, Send, StickyNote, ImagePlus, RefreshCw, Shield, Bot, User } from 'lucide-react';
import { ChatConversation } from '../../types';
import { compressImage } from '../../utils/storage';
import { supabase } from '../../supabaseClient';
import ChatActionsMenu from './ChatActionsMenu';

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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
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
      if (isMountedRef.current) alert('No se pudo subir la imagen. Detalle: ' + (err?.message || err));
    } finally {
      if (isMountedRef.current) setUploading(false);
    }
  };

  return (
    <>
      <div className="p-3 border-b border-[var(--border-color)]/60 flex items-center justify-between gap-2 relative" id="chat-thread-header">
        <div className="flex items-center gap-2 min-w-0">
          <button type="button" onClick={onBack} className="md:hidden p-1 -ml-1 text-[var(--text-secondary)]">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0">
            <h4 className="font-bold text-sm text-[var(--text-primary)] truncate">{conversation.customerName || 'Cliente'}</h4>
            <p className="text-[10px] text-[var(--text-secondary)] truncate">{conversation.customerEmail}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {conversation.assignedAdminEmail && (
            <span className="text-[9px] font-bold px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 hidden sm:inline truncate max-w-[140px]">
              {conversation.assignedAdminEmail}
            </span>
          )}
          <button type="button" onClick={() => setShowMenu(v => !v)} className="p-1.5 rounded-lg hover:bg-[var(--bg-surface)] text-[var(--text-secondary)]">
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

      <div className="flex-1 overflow-y-auto p-4 space-y-3" id="chat-thread-messages">
        {conversation.messages.map(msg => {
          if (msg.isInternalNote) {
            return (
              <div key={msg.id} className="flex justify-center">
                <div className="max-w-[85%] rounded-xl px-3 py-2 text-[11px] bg-amber-400/15 border border-amber-500/40 text-amber-700 dark:text-amber-300 flex items-start gap-1.5">
                  <StickyNote className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <div>
                    {msg.text && <p className="whitespace-pre-wrap">{msg.text}</p>}
                    <span className="block mt-1 text-[9px] opacity-70">Nota interna • {new Date(msg.timestamp).toLocaleString()}</span>
                  </div>
                </div>
              </div>
            );
          }
          const isSupport = msg.sender === 'support';
          return (
            <div key={msg.id} className={`flex ${isSupport ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[75%] rounded-xl p-3 text-xs ${
                isSupport ? 'bg-[var(--brand-gold-mid)] text-slate-950' :
                msg.sender === 'bot' ? 'bg-[var(--brand-gold-mid)]/10 border border-[var(--brand-gold-dark)]/30 text-[var(--text-primary)]' :
                'bg-[var(--bg-surface)] border border-[var(--border-color)]/60 text-[var(--text-primary)]'
              }`}>
                <div className="flex items-center gap-1 mb-1 text-[9px] opacity-70">
                  {isSupport && <Shield className="w-3 h-3" />}
                  {msg.sender === 'bot' && <Bot className="w-3 h-3" />}
                  {msg.sender === 'customer' && <User className="w-3 h-3" />}
                  <span>{isSupport ? 'Soporte' : msg.sender === 'bot' ? 'Asistente' : conversation.customerName}</span>
                  <span>•</span>
                  <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                {msg.imageUrl && (
                  <img src={msg.imageUrl} alt="Imagen adjunta" className="rounded-lg max-w-full mb-1.5 max-h-64 object-cover" loading="lazy" />
                )}
                {msg.text && <p className="whitespace-pre-wrap">{msg.text}</p>}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSendText} className={`p-3 border-t border-[var(--border-color)]/60 flex items-center gap-2 ${noteMode ? 'bg-amber-400/10' : ''}`} id="chat-thread-input">
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImagePick} />
        <button
          type="button"
          onClick={() => setNoteMode(v => !v)}
          title="Nota interna"
          className={`p-2 rounded-xl transition shrink-0 ${noteMode ? 'bg-amber-500 text-white' : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-amber-500'}`}
        >
          <StickyNote className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          title="Adjuntar imagen"
          className="p-2 rounded-xl bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--brand-gold-dark)] transition shrink-0 disabled:opacity-40"
        >
          {uploading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
        </button>
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={noteMode ? 'Nota interna (solo visible para el equipo)...' : 'Escribe tu respuesta...'}
          className="flex-1 bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--brand-gold-mid)]"
        />
        <button type="submit" className="p-2 rounded-xl bg-[var(--brand-gold-mid)] hover:bg-[var(--brand-gold-dark)] text-slate-950 transition shrink-0">
          <Send className="w-4 h-4" />
        </button>
      </form>
    </>
  );
}
