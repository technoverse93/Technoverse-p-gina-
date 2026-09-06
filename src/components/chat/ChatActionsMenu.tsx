import React, { useEffect, useRef, useState } from 'react';
import { UserCog, CheckCircle2, AlertTriangle, RotateCcw, Trash2 } from 'lucide-react';
import { ChatConversation } from '../../types';

interface ChatActionsMenuProps {
  conversation: ChatConversation;
  staffEmails: string[];
  onClose: () => void;
  onAssign: (email: string) => void;
  onChangeStatus: (status: 'nuevo' | 'pendiente') => void;
  onResolve: () => void;
  /** Cierra y BORRA esta conversación, para todos y al instante. */
  onCerrarYBorrar: () => void;
}

export default function ChatActionsMenu({ conversation, staffEmails, onClose, onAssign, onChangeStatus, onResolve, onCerrarYBorrar }: ChatActionsMenuProps) {
  const [confirmando, setConfirmando] = useState(false);
  const isResolved = conversation.status === 'resuelto';
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
                  conversation.assignedAdminEmail === email ? 'text-[var(--brand-gold-dark)] font-bold' : 'text-[var(--text-secondary)]'
                }`}
              >
                {email}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="p-2 border-b border-[var(--border-color)]/50">
        <p className="px-2 pb-1 text-[10px] font-bold uppercase text-[var(--text-muted)]">
          {isResolved ? 'Reabrir en estado' : 'Cambiar estado'}
        </p>
        <button
          type="button"
          onClick={() => { onChangeStatus('nuevo'); onClose(); }}
          disabled={conversation.status === 'nuevo'}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-surface)] text-[var(--text-primary)] disabled:opacity-40"
        >
          {isResolved ? <RotateCcw className="w-3 h-3" /> : <span className="w-2 h-2 rounded-full bg-blue-500" />} Nuevo
        </button>
        <button
          type="button"
          onClick={() => { onChangeStatus('pendiente'); onClose(); }}
          disabled={conversation.status === 'pendiente'}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-surface)] text-[var(--text-primary)] disabled:opacity-40"
        >
          {isResolved ? <RotateCcw className="w-3 h-3" /> : <span className="w-2 h-2 rounded-full bg-orange-500" />} Pendiente
        </button>
      </div>
      <div className="p-2">
        {isResolved ? (
          <p className="px-2 py-1 text-[10px] text-[var(--text-muted)] flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
            Esta conversación está resuelta. Aparece en la pestaña "Resueltos" (filtrable por 1 día/1 semana/1 mes). Usa "Nuevo" o "Pendiente" arriba para reabrirla.
          </p>
        ) : (
          <>
            <button
              type="button"
              onClick={() => { onResolve(); onClose(); }}
              className="w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-rose-500/10 text-rose-500 font-bold"
            >
              <CheckCircle2 className="w-4 h-4" /> Marcar como Resuelto
            </button>
            <p className="px-2 pt-1 text-[9px] text-[var(--text-muted)] flex items-start gap-1">
              <AlertTriangle className="w-3 h-3 shrink-0 mt-px" /> No se elimina; el cliente conserva su historial. Quedará en "Resueltos" según su fecha.
            </p>
          </>
        )}
      </div>
      {/* Cerrar y borrar ESTA conversación — la versión fina del botón
          nuclear. Pide un segundo toque a propósito: borra los mensajes de
          verdad y no hay vuelta atrás. */}
      <div className="p-2 border-t border-[var(--border-color)]/50">
        {!confirmando ? (
          <button
            type="button"
            onClick={() => setConfirmando(true)}
            className="w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-[var(--bg-surface)] font-medium"
            style={{ color: '#e5484d' }}
          >
            <Trash2 className="w-4 h-4" /> Cerrar y borrar conversación
          </button>
        ) : (
          <div className="px-2 py-1.5">
            <p className="text-[10.5px] text-[var(--text-secondary)] leading-snug mb-2">
              Se borran todos los mensajes de esta conversación, también en la pantalla del cliente. No se puede deshacer.
            </p>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => { setConfirmando(false); onCerrarYBorrar(); }}
                className="flex-1 px-2 py-1.5 rounded-lg text-[11px] font-bold text-white"
                style={{ background: '#c2262b' }}
              >
                Sí, borrar
              </button>
              <button
                type="button"
                onClick={() => setConfirmando(false)}
                className="flex-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold border border-[var(--border-color)] text-[var(--text-secondary)]"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
