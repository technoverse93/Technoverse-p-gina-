import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MessageSquare } from 'lucide-react';
import { ChatConversation, User } from '../../types';
import { getDB, saveDB, addAuditLog } from '../../utils/storage';
import { supabase } from '../../supabaseClient';
import ChatInbox from './ChatInbox';
import ChatThread from './ChatThread';
import { useToast, useConfirm } from '../ui/Overlays';

interface ChatCRMProps {
  currentUser: User | null;
  onDataChanged?: () => void;
}

export type ChatStatusFilter = 'nuevo' | 'pendiente' | 'todos';

export default function ChatCRM({ currentUser, onDataChanged }: ChatCRMProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ChatStatusFilter>('nuevo');
  const [staffEmails, setStaffEmails] = useState<string[]>([]);
  // Si el admin sale de la pestaña Chat CRM mientras una escritura (asignar,
  // cambiar estado, enviar mensaje, resolver) sigue en curso, no se debe
  // tocar el estado de este componente ya desmontado.
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

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
    // Estrictamente cuentas Dueño reales (el rol Empleado quedó sin uso tras
    // la eliminación del módulo de Nómina/RRHH y no debe listarse como staff).
    supabase.from('profiles').select('email').eq('role', 'Dueño').then(({ data }) => {
      if (active && data) setStaffEmails(data.map((p: any) => p.email).filter(Boolean));
    });
    return () => { active = false; };
  }, []);

  const selectedConv = conversations.find(c => c.id === selectedConvId) || null;
  const filteredConversations = conversations.filter(c => statusFilter === 'todos' || c.status === statusFilter);

  const persist = async (mutate: (db: ReturnType<typeof getDB>) => void): Promise<boolean> => {
    const db = getDB();
    mutate(db);
    try {
      await saveDB(db);
    } catch (err: any) {
      if (isMountedRef.current) {
        toast.error('No se pudo guardar el cambio en la base de datos. Detalle: ' + (err?.message || err));
        loadConversations();
      }
      return false;
    }
    if (isMountedRef.current) {
      loadConversations();
      onDataChanged?.();
    }
    return true;
  };

  const handleSendMessage = async (convId: string, payload: { text: string; imageUrl?: string; isInternalNote?: boolean }) => {
    const ok = await persist(db => {
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
    if (ok) addAuditLog(currentUser?.email || 'admin', 'Soporte', payload.isInternalNote ? 'Nota Interna' : 'Respuesta Chat', `Conversación ${convId}`);
  };

  const handleAssign = async (convId: string, email: string) => {
    const ok = await persist(db => {
      const idx = db.chat_conversations.findIndex(c => c.id === convId);
      if (idx !== -1) db.chat_conversations[idx].assignedAdminEmail = email;
    });
    if (ok) addAuditLog(currentUser?.email || 'admin', 'Soporte', 'Asignar Responsable', `Conversación ${convId} asignada a ${email}`);
  };

  const handleChangeStatus = async (convId: string, status: 'nuevo' | 'pendiente') => {
    await persist(db => {
      const idx = db.chat_conversations.findIndex(c => c.id === convId);
      if (idx !== -1) db.chat_conversations[idx].status = status;
    });
  };

  const handleResolve = async (convId: string) => {
    const confirmed = await confirm({
      title: 'Marcar como Resuelto',
      message: 'La conversación se cerrará y saldrá de tu bandeja activa, pero NO se elimina: el cliente conserva su historial y podrás revisarla en el filtro "Todos".',
      confirmText: 'Marcar como Resuelto'
    });
    if (!confirmed) return;
    const conv = getDB().chat_conversations.find(c => c.id === convId);
    // Cierre suave (soft-close): en vez de borrar la conversación (lo que hacía
    // que el cliente perdiera su historial), se marca como 'resuelto'. Así
    // desaparece de la bandeja activa del admin pero se conserva para el cliente
    // (aparece en su "Historial Cerrado") y para auditoría.
    const ok = await persist(db => {
      const idx = db.chat_conversations.findIndex(c => c.id === convId);
      if (idx !== -1) db.chat_conversations[idx].status = 'resuelto';
    });
    if (ok) {
      addAuditLog(currentUser?.email || 'admin', 'Soporte', 'Chat Resuelto (Cerrado)', `Conversación de ${conv?.customerName || convId} marcada como resuelta. Historial conservado.`);
      if (isMountedRef.current && selectedConvId === convId) setSelectedConvId(null);
    }
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
