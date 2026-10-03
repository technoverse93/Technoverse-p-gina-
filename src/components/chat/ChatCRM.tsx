import React from 'react';
import { MessageSquare } from 'lucide-react';
import { User } from '../../types';
import ChatInbox from './ChatInbox';
import ChatThread from './ChatThread';
import { useChatAdmin } from './useChatAdmin';

interface ChatCRMProps {
  currentUser: User | null;
  onDataChanged?: () => void;
}

// Los tipos y la constante se re-exportan desde su nuevo hogar (useChatAdmin)
// para no romper a quien los importaba desde aquí.
export { RESOLVED_RANGE_MS } from './useChatAdmin';
export type { ChatStatusFilter, ResolvedRange } from './useChatAdmin';

// La lógica vive en `useChatAdmin` (compartida con la burbuja flotante). Este
// componente es solo la VISTA de pantalla completa de la pestaña Chat.
function ChatCRM({ currentUser, onDataChanged }: ChatCRMProps) {
  const chat = useChatAdmin(currentUser, onDataChanged);

  return (
    // `h-full`, no un alto calculado a mano: el contenedor de la pestaña ya
    // recibe el alto disponible (ver `[data-pantalla='completa']` en
    // admin.css). El mínimo es un piso para ventanas muy bajas — por debajo
    // de eso el panel se recorre en vez de aplastar la conversación.
    <div className="flex flex-col md:flex-row h-full min-h-[420px] gap-3" id="chat-crm-root">
      <div className={`${chat.selectedConvId ? 'hidden md:flex' : 'flex flex-1 md:flex-none'} md:w-[30%] md:min-w-[280px] md:max-w-[320px] flex-col glass-panel rounded-[22px] overflow-hidden`}>
        <ChatInbox
          conversations={chat.filteredConversations}
          selectedConvId={chat.selectedConvId}
          statusFilter={chat.statusFilter}
          onFilterChange={chat.setStatusFilter}
          resolvedRange={chat.resolvedRange}
          onResolvedRangeChange={chat.setResolvedRange}
          onSelect={chat.setSelectedConvId}
        />
      </div>
      <div className={`${chat.selectedConvId ? 'flex' : 'hidden md:flex'} flex-1 min-w-0 flex-col glass-panel rounded-[22px] overflow-hidden`}>
        {chat.selectedConv ? (
          <ChatThread
            conversation={chat.selectedConv}
            staffEmails={chat.staffEmails}
            onBack={() => chat.setSelectedConvId(null)}
            onSendMessage={chat.handleSendMessage}
            onAssign={chat.handleAssign}
            onChangeStatus={chat.handleChangeStatus}
            onResolve={chat.handleResolve}
            onExclusivo={chat.soySuper ? chat.handleExclusivo : undefined}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-[var(--text-muted)] p-8">
            <MessageSquare className="w-12 h-12 mb-3 opacity-40" />
            <p className="text-sm text-center">Selecciona una conversación para atender al cliente.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// Mismo motivo que en los otros módulos pesados.
export default React.memo(ChatCRM);
