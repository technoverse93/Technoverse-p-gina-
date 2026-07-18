import React, { useEffect, useRef, useState } from 'react';
import { UserCog, CheckCircle2, AlertTriangle } from 'lucide-react';
import { ChatConversation } from '../../types';

interface ChatActionsMenuProps {
  conversation: ChatConversation;
  staffEmails: string[];
  onClose: () => void;
  onAssign: (email: string) => void;
  onChangeStatus: (status: 'nuevo' | 'pendiente') => void;
  onResolve: () => void;
}

export default function ChatActionsMenu({ conversation, staffEmails, onClose, onAssign, onChangeStatus, onResolve }: ChatActionsMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [showAssignList, setShowAssignList] = useState(false);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  return (
    <div ref={rootRef} className="absolute right-0 top-full mt-1.5 w-64 z-[70] glass-panel rounded-xl shadow-sm overflow-hidden text-xs" id="chat-actions-menu">
      <div className="p-2 border-b border-[var(--border-color)]/50">
        <button
          type="button"
          onClick={() => setShowAssignList(v => !v)}
          className="w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-[var(--bg-surface)] text-[var(--text-primary)] font-medium"
        >
          <UserCog className="w-4 h-4" /> Asignar responsable
        </button>
        {showAssignList && (
          <div className="mt-1 space-y-0.5 pl-2">
            {staffEmails.length === 0 && <p className="text-[10px] text-[var(--text-muted)] px-2 py-1">Sin administradores disponibles.</p>}
            {staffEmails.map(email => (
              <button
                key={email}
                type="button"
                onClick={() => { onAssign(email); onClose(); }}
                className={`w-full text-left px-2 py-1.5 rounded-lg text-[11px] truncate hover:bg-[var(--bg-surface)] ${
                  conversation.assignedAdminEmail === email ? 'text-[var(--brand-gold-dark)] dark:text-[var(--brand-gold-light)] font-bold' : 'text-[var(--text-secondary)]'
                }`}
              >
                {email}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="p-2 border-b border-[var(--border-color)]/50">
        <p className="px-2 pb-1 text-[10px] font-bold uppercase text-[var(--text-muted)]">Cambiar estado</p>
        <button
          type="button"
          onClick={() => { onChangeStatus('nuevo'); onClose(); }}
          disabled={conversation.status === 'nuevo'}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-surface)] text-[var(--text-primary)] disabled:opacity-40"
        >
          <span className="w-2 h-2 rounded-full bg-blue-500" /> Nuevo
        </button>
        <button
          type="button"
          onClick={() => { onChangeStatus('pendiente'); onClose(); }}
          disabled={conversation.status === 'pendiente'}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-surface)] text-[var(--text-primary)] disabled:opacity-40"
        >
          <span className="w-2 h-2 rounded-full bg-orange-500" /> Pendiente
        </button>
      </div>
      <div className="p-2">
        <button
          type="button"
          onClick={() => { onResolve(); onClose(); }}
          className="w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-rose-500/10 text-rose-500 font-bold"
        >
          <CheckCircle2 className="w-4 h-4" /> Marcar como Resuelto
        </button>
        <p className="px-2 pt-1 text-[9px] text-[var(--text-muted)] flex items-start gap-1">
          <AlertTriangle className="w-3 h-3 shrink-0 mt-px" /> Elimina la conversación y sus mensajes permanentemente (Hard Delete).
        </p>
      </div>
    </div>
  );
        }
