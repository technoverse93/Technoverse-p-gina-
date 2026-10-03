// =====================================================================
// LÓGICA COMPARTIDA DEL CHAT DEL PERSONAL
// =====================================================================
// La misma lógica del Chat CRM, extraída a un hook para que la usen DOS
// vistas a la vez sin duplicar nada ni perder el hilo:
//
//   · ChatCRM       → la pestaña completa.
//   · BurbujaChat   → la burbuja flotante que aparece al salir de la pestaña.
//
// El estado real de las conversaciones NO vive aquí: vive en `getDB()`
// (utils/storage.ts), que ya se mantiene al día por Realtime y avisa con el
// evento `technoverse_db_updated`. Este hook solo lee de ahí y guarda con
// `saveDB`. Por eso las dos vistas ven exactamente lo mismo en todo momento:
// responder desde la burbuja se refleja en la pestaña y al revés, sin una
// segunda suscripción ni un estado paralelo que se pueda desincronizar.
// =====================================================================

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ChatConversation, User } from '../../types';
import { getDB, saveDB, addAuditLog, marcarMensajeEnVuelo, confirmarMensajeEnVuelo, recargarChatDelServidor, marcarChatExclusivo } from '../../utils/storage';
import { esSuperadmin } from '../../utils/roles';
import { supabase } from '../../supabaseClient';
import { useToast, useConfirm } from '../ui/Overlays';
import { pedirPermisoNotificaciones, notificarMensajeChat } from '../../mobile/notificaciones';

export type ChatStatusFilter = 'nuevo' | 'pendiente' | 'todos' | 'resueltos';
export type ResolvedRange = '1d' | '7d' | '30d';

export const RESOLVED_RANGE_MS: Record<ResolvedRange, number> = {
  '1d': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

/**
 * `avisar`: si este uso del hook es el que dispara la notificación al
 * personal por un mensaje nuevo del cliente. Solo debe hacerlo UNO —si no,
 * la pestaña y la burbuja avisarían por duplicado—, así que lo hace la
 * pestaña Chat (siempre montada de fondo) y la burbuja no.
 */
export function useChatAdmin(currentUser: User | null, onDataChanged?: () => void, avisar = true) {
  const toast = useToast();
  const confirm = useConfirm();
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ChatStatusFilter>('nuevo');
  const [resolvedRange, setResolvedRange] = useState<ResolvedRange>('7d');
  const [staffEmails, setStaffEmails] = useState<string[]>([]);

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const vistosRef = useRef<Set<string>>(new Set());
  const sembradoRef = useRef(false);

  const detectarMensajesDeClientes = useCallback((convs: ChatConversation[]) => {
    if (!avisar) return;
    const entrantes = convs.flatMap(c => c.messages.filter(m => m && m.sender === 'customer'));
    if (!sembradoRef.current) {
      entrantes.forEach(m => vistosRef.current.add(m.id));
      sembradoRef.current = true;
      return;
    }
    const nuevos = entrantes.filter(m => !vistosRef.current.has(m.id));
    nuevos.forEach(m => vistosRef.current.add(m.id));
    if (nuevos.length === 0) return;
    const ultimo = nuevos[nuevos.length - 1];
    const deQuien = convs.find(c => c.messages.some(m => m.id === ultimo.id))?.customerName || 'un cliente';
    const cuerpo = (ultimo.text || '').trim()
      || (ultimo.imageUrl ? '📷 Imagen' : ultimo.audioUrl ? '🎤 Nota de voz' : ultimo.videoUrl ? '🎬 Video' : 'Mensaje nuevo');
    void notificarMensajeChat(`${deQuien} — Technoverse`, cuerpo);
  }, [avisar]);

  const soySuper = esSuperadmin(currentUser?.role);
  const loadConversations = useCallback(() => {
    const db = getDB();
    // La base ya no le entrega los chats exclusivos a quien no es
    // superadmin; este filtro es solo para el instante entre que alguien
    // marca uno y llega la relectura.
    const lista = (db.chat_conversations || []).filter(c => soySuper || !c.exclusivoSuperadmin);
    setConversations(lista);
    detectarMensajesDeClientes(lista);
  }, [detectarMensajesDeClientes, soySuper]);

  useEffect(() => {
    loadConversations();
    const handleUpdate = () => loadConversations();
    window.addEventListener('technoverse_db_updated', handleUpdate);
    return () => window.removeEventListener('technoverse_db_updated', handleUpdate);
  }, [loadConversations]);

  useEffect(() => { if (avisar) void pedirPermisoNotificaciones(); }, [avisar]);

  useEffect(() => {
    let active = true;
    supabase.from('profiles').select('email').in('role', ['superadmin', 'admin', 'empleado']).then(({ data }) => {
      if (active && data) setStaffEmails(data.map((p: any) => p.email).filter(Boolean));
    });
    return () => { active = false; };
  }, []);

  const selectedConv = conversations.find(c => c.id === selectedConvId) || null;

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

  // Cuántas conversaciones activas tienen mensajes sin leer: alimenta la
  // insignia de la burbuja flotante.
  const noLeidas = useMemo(
    () => conversations.filter(c => c.status !== 'resuelto' && (c.unreadCount || 0) > 0).length,
    [conversations],
  );

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

  const handleSendMessage = async (convId: string, payload: { text: string; imageUrl?: string; videoUrl?: string; audioUrl?: string; isInternalNote?: boolean }) => {
    const newMsg = {
      id: `MSG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sender: 'support' as const,
      text: payload.text,
      timestamp: new Date().toISOString(),
      imageUrl: payload.imageUrl,
      videoUrl: payload.videoUrl,
      audioUrl: payload.audioUrl,
      isInternalNote: payload.isInternalNote,
    };

    marcarMensajeEnVuelo(convId, newMsg);
    if (isMountedRef.current) {
      setConversations(prev => prev.map(c => c.id === convId
        ? { ...c, messages: [...c.messages, newMsg], unreadCount: 0 }
        : c));
    }

    let db = getDB();
    let idx = db.chat_conversations.findIndex(c => c.id === convId);
    if (idx === -1) {
      await recargarChatDelServidor(true);
      db = getDB();
      idx = db.chat_conversations.findIndex(c => c.id === convId);
    }
    if (idx === -1) {
      confirmarMensajeEnVuelo(newMsg.id);
      if (isMountedRef.current) {
        toast.error('No se pudo enviar: esa conversación ya no está disponible.');
        loadConversations();
      }
      return;
    }

    const ok = await persist(db => {
      const idx = db.chat_conversations.findIndex(c => c.id === convId);
      if (idx === -1) return;
      const mensajes = db.chat_conversations[idx].messages;
      if (!mensajes.some(m => m.id === newMsg.id)) mensajes.push(newMsg);
      db.chat_conversations[idx].unreadCount = 0;
    });
    if (ok) {
      addAuditLog(currentUser?.email || 'admin', 'Soporte', payload.isInternalNote ? 'Nota Interna' : 'Respuesta Chat', `Conversación ${convId}`);
    } else {
      confirmarMensajeEnVuelo(newMsg.id);
    }
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
      confirmText: 'Marcar como Resuelto',
    });
    if (!confirmed) return;
    const conv = getDB().chat_conversations.find(c => c.id === convId);
    const ok = await persist(db => {
      const idx = db.chat_conversations.findIndex(c => c.id === convId);
      if (idx !== -1) db.chat_conversations[idx].status = 'resuelto';
    });
    if (ok) {
      addAuditLog(currentUser?.email || 'admin', 'Soporte', 'Chat Resuelto', `Conversación de ${conv?.customerName || convId} marcada como resuelta. Historial conservado.`);
      if (isMountedRef.current && selectedConvId === convId) setSelectedConvId(null);
    }
  };

  const handleExclusivo = async (convId: string, exclusivo: boolean) => {
    if (!soySuper) return;
    if (exclusivo) {
      const ok = await confirm({
        title: 'Chat exclusivo de superadmin',
        message: 'El resto del personal deja de ver esta conversación al instante: no aparece en su bandeja ni le llegan los mensajes nuevos. El cliente sigue escribiendo igual. Puedes quitarlo cuando quieras.',
        confirmText: 'Hacer exclusivo',
      });
      if (!ok) return;
    }
    try {
      await marcarChatExclusivo(convId, exclusivo);
      toast.success(exclusivo ? 'Chat exclusivo: solo tú lo ves.' : 'El chat vuelve a estar a la vista del personal.');
      addAuditLog(currentUser?.email || 'superadmin', 'Soporte', exclusivo ? 'Chat exclusivo' : 'Chat no exclusivo', `Conversación ${convId}.`);
    } catch (err: any) {
      toast.error('No se pudo cambiar la exclusividad. ' + (err?.message || err));
    }
  };

  return {
    soySuper, handleExclusivo,
    conversations, filteredConversations, selectedConv, selectedConvId, setSelectedConvId,
    statusFilter, setStatusFilter, resolvedRange, setResolvedRange, staffEmails, noLeidas,
    handleSendMessage, handleAssign, handleChangeStatus, handleResolve,
  };
}
