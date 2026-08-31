import React, { useState, useRef, useEffect } from 'react';
import { ArrowLeft, MoreVertical, Send, StickyNote, ImagePlus, RefreshCw, Bot } from 'lucide-react';
import { ChatConversation } from '../../types';
import { compressImage } from '../../utils/storage';
import { supabase } from '../../supabaseClient';
import ChatActionsMenu from './ChatActionsMenu';
import { useToast } from '../ui/Overlays';
import { etiquetaDeDia, abreDiaNuevo, soloHora } from './formatoChat';

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
            <p className="text-[11px] text-[var(--text-secondary)] truncate">{conversation.customerEmail}</p>
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
        {mensajesVisibles.map((msg, i) => {
          // Separador de día. Va fuera del `if` de nota interna a propósito:
          // una nota también puede ser lo primero de un día.
          const separador = abreDiaNuevo(msg.timestamp, mensajesVisibles[i - 1]?.timestamp) ? (
            <div key={`dia-${msg.id}`} className="flex justify-center py-1">
              <span className="text-[10px] font-bold uppercase tracking-[0.08em] px-3 py-1 rounded-full bg-[var(--bg-sunken)] text-[var(--text-muted)]">
                {etiquetaDeDia(msg.timestamp)}
              </span>
            </div>
          ) : null;

          if (msg.isInternalNote) {
            return (
              <React.Fragment key={msg.id}>
                {separador}
                <div className="flex justify-center">
                  <div className="max-w-[min(88%,32rem)] rounded-2xl px-3.5 py-2.5 text-[12.5px] bg-amber-400/12 border border-amber-500/35 text-amber-700 flex items-start gap-1.5">
                    <StickyNote className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <div>
                      {msg.text && <p className="tv-break whitespace-pre-wrap leading-[1.5]">{msg.text}</p>}
                      <span className="block mt-1 text-[10.5px] font-semibold opacity-70">Nota interna &middot; {soloHora(msg.timestamp)}</span>
                    </div>
                  </div>
                </div>
              </React.Fragment>
            );
          }
          const isSupport = msg.sender === 'support';
          const isBot = msg.sender === 'bot';
          // Inicial del cliente en el avatar, no un icono genérico: en un
          // hilo largo la letra ancla la mirada mucho antes que una silueta
          // igual para todos.
          const inicial = conversation.customerName?.trim().charAt(0).toUpperCase() || '?';

          return (
            <React.Fragment key={msg.id}>
              {separador}
              {/* El tope es el MENOR entre el 78% y una medida legible.
                  Solo con el porcentaje, en el panel ancho de escritorio una
                  respuesta larga se estira de lado a lado y se vuelve un
                  párrafo de página, no un mensaje: el ojo pierde el renglón
                  al volver. En móvil manda el 78% y nada cambia. */}
              <div className={`flex gap-2 max-w-[min(78%,32rem)] ${isSupport ? 'ml-auto flex-row-reverse' : ''}`}>
                {!isSupport && (
                  <div className="w-6 h-6 rounded-full bg-[rgba(var(--accent-rgb),0.14)] text-[var(--accent)] flex items-center justify-center shrink-0 self-end font-display font-bold text-[10px]">
                    {isBot ? <Bot className="w-3 h-3" /> : inicial}
                  </div>
                )}
                <div className="min-w-0">
                  {/* La hora vive DENTRO de la burbuja, alineada a la derecha.
                      Antes iba en una fila aparte debajo, con el nombre
                      repetido en cada mensaje: en un intercambio de veinte
                      líneas eso son veinte veces el mismo nombre ocupando
                      espacio y ruido. Quién habla ya lo dice el lado y el
                      color de la burbuja. */}
                  {/* Los colores salen de --bubble-in/--bubble-out, que
                      existen para esto y ya están afinados en los dos temas:
                      en oscuro la burbuja entrante (#1D2421) se despega del
                      fondo por tono, que es como se marca elevación ahí,
                      porque una sombra negra sobre fondo negro no se ve. */}
                  <div className={`px-3.5 py-2 text-[13px] rounded-2xl ${
                    isSupport
                      ? 'rounded-br-[4px] bg-[var(--bubble-out)] text-[var(--bubble-out-ink)] shadow-[0_2px_10px_-4px_rgba(var(--accent-rgb),0.5)]'
                      : isBot
                      ? 'rounded-bl-[4px] bg-transparent border border-[var(--border-color)] text-[var(--text-primary)]'
                      : 'rounded-bl-[4px] bg-[var(--bubble-in)] text-[var(--bubble-in-ink)] shadow-[0_1px_2px_rgba(15,21,18,0.06),0_6px_16px_-12px_rgba(15,21,18,0.3)]'
                  }`}>
                    {msg.imageUrl && (
                      <img src={msg.imageUrl} alt="Imagen adjunta" className="rounded-xl max-w-full mb-1.5 max-h-64 object-cover" loading="lazy" decoding="async" />
                    )}
                    {/* `flow-root` contiene el flotante de la hora; sin eso la
                        burbuja no lo cuenta al medir su alto y la hora se
                        sale por abajo. */}
                    <div className="flow-root tv-break whitespace-pre-wrap leading-[1.5]">
                      {msg.text}
                      {/* La hora FLOTA al final del texto: si cabe, se acomoda
                          en el mismo renglón; si no, baja sola. Antes ocupaba
                          siempre una línea entera, y en un mensaje corto como
                          "Gracias" eso estiraba la burbuja al ancho de la
                          hora y la dejaba descuadrada. */}
                      <span className={`float-right ml-2.5 mt-[7px] text-[10px] tabular-nums whitespace-nowrap select-none ${isSupport ? 'opacity-75' : 'opacity-55'}`}>
                        {soloHora(msg.timestamp)}{isSupport ? ' ✓✓' : ''}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </React.Fragment>
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
          className="flex-1 bg-[var(--bg-sunken)] border border-[var(--border-color)] rounded-full px-4 py-2.5 text-[13px] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/15 transition"
        />
        <button type="submit" className="w-9 h-9 rounded-full flex items-center justify-center bg-[var(--accent)] hover:bg-[var(--accent-hover)] hover:scale-105 active:scale-95 text-[var(--accent-ink)] transition shrink-0 shadow-[0_4px_10px_-4px_rgba(var(--accent-rgb),0.6)]" aria-label="Enviar">
          <Send className="w-3.5 h-3.5" />
        </button>
      </form>
    </>
  );
}
