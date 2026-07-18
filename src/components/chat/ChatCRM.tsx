import React, { useState, useEffect, useCallback } from 'react';
import { MessageSquare } from 'lucide-react';
import { ChatConversation, User } from '../../types';
import { getDB, saveDB, addAuditLog } from '../../utils/storage';
import { supabase } from '../../supabaseClient';
import ChatInbox from './ChatInbox';
import ChatThread from './ChatThread';

interface ChatCRMProps {
  currentUser: User | null;
  onDataChanged?: () => void;
}

export type ChatStatusFilter = 'nuevo' | 'pendiente' | 'todos';

export default function ChatCRM({ currentUser, onDataChanged }: ChatCRMProps) {
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ChatStatusFilter>('nuevo');
  const [staffEmails, setStaffEmails] = useState<string[]>([]);

  const loadConversations = useCallback(() => {
    const db = getDB();
    setConversations(db.chat_conversations || []);
  }, []);

  useEffect(() => {
    loadConversations();
    const handleUpdate = () => loadConversations();
    window.addEventListener('technoverse_db_updated', handleUpdate);
    return () => window.removeEventListener('technoverse_db_updated', handleUpdate);
  }, [loadConversations]);

  useEffect(() => {
    let active = true;
    supabase.from('profiles').select('email').in('role', ['Dueño', 'Empleado']).then(({ data }) => {
      if (active && data) setStaffEmails(data.map((p: any) => p.email).filter(Boolean));
    });
    return () => { active = false; };
  }, []);

  const selectedConv = conversations.find(c => c.id === selectedConvId) || null;
  const filteredConversations = conversations.filter(c => statusFilter === 'todos' || c.status === statusFilter);

  const persist = async (mutate: (db: ReturnType<typeof getDB>) => void) => {
    const db = getDB();
    mutate(db);
    await saveDB(db);
    loadConversations();
    onDataChanged?.();
  };

  const handleSendMessage = async (convId: string, payload: { text: string; imageUrl?: string; isInternalNote?: boolean }) => {
    await persist(db => {
      const idx = db.chat_conversations.findIndex(c => c.id === convId);
      if (idx === -1) return;
      db.chat_conversations[idx].messages.push({
        id: `MSG-${Date.now()}`,
        sender: 'support',
        text: payload.text,
        timestamp: new Date().toISOString(),
        imageUrl: payload.imageUrl,
        isInternalNote: payload.isInternalNote
      });
      db.chat_conversations[idx].unreadCount = 0;
    });
    addAuditLog(currentUser?.email || 'admin', 'Soporte', payload.isInternalNote ? 'Nota Interna' : 'Respuesta Chat', `Conversación ${convId}`);
  };

  const handleAssign = async (convId: string, email: string) => {
    await persist(db => {
      const idx = db.chat_conversations.findIndex(c => c.id === convId);
      if (idx !== -1) db.chat_conversations[idx].assignedAdminEmail = email;
    });
    addAuditLog(currentUser?.email || 'admin', 'Soporte', 'Asignar Responsable', `Conversación ${convId} asignada a ${email}`);
  };

  const handleChangeStatus = async (convId: string, status: 'nuevo' | 'pendiente') => {
    await persist(db => {
      const idx = db.chat_conversations.findIndex(c => c.id === convId);
      if (idx !== -1) db.chat_conversations[idx].status = status;
    });
  };

  const handleResolve = async (convId: string) => {
    if (!window.confirm('¿Marcar como Resuelto? Esto ejecutará un Hard Delete permanente de la conversación y todos sus mensajes en Supabase. Esta acción no se puede deshacer.')) return;
    const db = getDB();
    const conv = db.chat_conversations.find(c => c.id === convId);
    db.chat_conversations = db.chat_conversations.filter(c => c.id !== convId);
    try {
      await saveDB(db);
    } catch (err: any) {
      alert('No se pudo eliminar la conversación. Detalle: ' + (err?.message || err));
      return;
    }
    addAuditLog(currentUser?.email || 'admin', 'Soporte', 'Chat Resuelto (Hard Delete)', `Conversación de ${conv?.customerName || convId} eliminada permanentemente junto con sus mensajes.`);
    if (selectedConvId === convId) setSelectedConvId(null);
    loadConversations();
    onDataChanged?.();
  };

  return (
    <div className="flex flex-col md:flex-row h-[calc(100vh-220px)] md:h-[75vh] min-h-[500px] gap-4" id="chat-crm-root">
      <div className={`${selectedConvId ? 'hidden md:flex' : 'flex'} md:w-[30%] md:min-w-[300px] md:max-w-sm flex-col glass-panel rounded-2xl overflow-hidden`}>
        <ChatInbox
          conversations={filteredConversations}
          selectedConvId={selectedConvId}
          statusFilter={statusFilter}
          onFilterChange={setStatusFilter}
          onSelect={setSelectedConvId}
        />
      </div>
      <div className={`${selectedConvId ? 'flex' : 'hidden md:flex'} flex-1 flex-col glass-panel rounded-2xl overflow-hidden`}>
        {selectedConv ? (
          <ChatThread
            conversation={selectedConv}
            staffEmails={staffEmails}
            onBack={() => setSelectedConvId(null)}
            onSendMessage={handleSendMessage}
            onAssign={handleAssign}
            onChangeStatus={handleChangeStatus}
            onResolve={handleResolve}
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
