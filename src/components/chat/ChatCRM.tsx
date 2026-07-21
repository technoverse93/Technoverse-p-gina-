import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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

// 'resueltos' reemplaza al antiguo 'archivados': ya no es una bandera booleana
// mutable, sino una vista filtrada por rango temporal (ver ResolvedRange).
export type ChatStatusFilter = 'nuevo' | 'pendiente' | 'todos' | 'resueltos';
export type ResolvedRange = '1d' | '7d' | '30d';

export const RESOLVED_RANGE_MS: Record<ResolvedRange, number> = {
  '1d': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000
};

export default function ChatCRM({ currentUser, onDataChanged }: ChatCRMProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ChatStatusFilter>('nuevo');
  const [resolvedRange, setResolvedRange] = useState<ResolvedRange>('7d');
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

  // Filtro puro sobre (status, updatedAt): no depende de ninguna bandera
  // paralela que un actor distinto pudiera desincronizar. Cada evento de
  // Realtime dispara un refetch completo (loadConversations), y este cálculo
  // se re-evalúa desde cero en cada render con los datos frescos — así un
  // chat resuelto fuera del rango elegido NUNCA puede "colarse" de vuelta,
  // sin importar en qué orden lleguen los eventos del WebSocket.
  const filteredConversations = useMemo(() => {
    if (statusFilter === 'resueltos') {
      const cutoff = Date.now() - RESOLVED_RANGE_MS[resolvedRange];
      return conversations.filter(c => {
        if (c.status !== 'resuelto') return false;
        const ts = c.updatedAt ? new Date(c.updatedAt).getTime() : 0;
        return ts >= cutoff;
      });
    }
    return conversations.filter(c => {
      if (c.status === 'resuelto') return false;
      return statusFilter === 'todos' || c.status === statusFilter;
    });
  }, [conversations, statusFilter, resolvedRange]);

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
      message: 'La conversación saldrá de "Nuevos", "Pendientes" y "Todos", pero NO se elimina: el cliente conserva su historial completo. Quedará disponible en la pestaña "Resueltos", filtrable por 1 día, 1 semana o 1 mes. Para reabrirla, cambia su estado a Nuevo o Pendiente.',
      confirmText: 'Marcar como Resuelto'
    });
    if (!confirmed) return;
    const conv = getDB().chat_conversations.find(c => c.id === convId);
    // Cierre suave (soft-close): en vez de borrar la conversación, se marca
    // 'resuelto'. La marca de tiempo (updated_at) la fija automáticamente un
    // trigger en la BD al hacer el UPDATE — es la base del filtro por rango
    // temporal, y ningún cliente puede falsearla.
    const ok = await persist(db => {
      const idx = db.chat_conversations.findIndex(c => c.id === convId);
      if (idx !== -1) db.chat_conversations[idx].status = 'resuelto';
    });
    if (ok) {
      addAuditLog(currentUser?.email || 'admin', 'Soporte', 'Chat Resuelto', `Conversación de ${conv?.customerName || convId} marcada como resuelta. Historial conservado.`);
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
          resolvedRange={resolvedRange}
          onResolvedRangeChange={setResolvedRange}
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
