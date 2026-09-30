// =====================================================================
// BURBUJA DE CHAT FLOTANTE (sin perder el contexto de fondo)
// =====================================================================
// Cuando el personal sale de la pestaña Chat hacia cualquier otro módulo
// (Supervisión, Ciberseguridad, Contabilidad…), el chat no desaparece: se
// queda como una burbuja flotante con la cantidad de conversaciones sin
// leer. Al tocarla se abre un panel liviano SOBRE lo que se esté haciendo,
// para leer y responder sin cambiar de pestaña.
//
// CERO pérdida de estado: el panel es una capa fija encima; no desmonta ni
// recarga nada. Lo que corre detrás (el espejo de supervisión en vivo, una
// factura a medio llenar) sigue intacto. Y comparte los datos con la
// pestaña Chat a través de `getDB()` (ver useChatAdmin), así que responder
// aquí se ve allá y al revés, sin una segunda conexión.
// =====================================================================

import { useState } from 'react';
import { MessageSquare, X } from 'lucide-react';
import { User } from '../../types';
import { Z } from '../ui/Overlays';
import ChatInbox from './ChatInbox';
import ChatThread from './ChatThread';
import { useChatAdmin } from './useChatAdmin';

interface Props {
  currentUser: User | null;
  onDataChanged?: () => void;
  /** La burbuja se esconde cuando ya se está en la pestaña Chat. */
  oculto?: boolean;
}

export default function BurbujaChat({ currentUser, onDataChanged, oculto }: Props) {
  const [abierto, setAbierto] = useState(false);
  // `avisar = false`: las notificaciones al personal las dispara la pestaña
  // Chat (siempre montada de fondo); si también avisara la burbuja, cada
  // mensaje nuevo sonaría dos veces.
  const chat = useChatAdmin(currentUser, onDataChanged, false);

  if (oculto) return null;

  return (
    <>
      {/* La burbuja. Siempre visible fuera de la pestaña Chat. */}
      <button
        type="button"
        onClick={() => setAbierto(v => !v)}
        aria-label={abierto ? 'Cerrar el chat' : `Abrir el chat${chat.noLeidas ? `, ${chat.noLeidas} sin leer` : ''}`}
        className="fixed bottom-5 right-5 w-14 h-14 rounded-full bg-[var(--accent)] text-[var(--accent-ink)] shadow-lg flex items-center justify-center transition active:scale-95 hover:brightness-110"
        style={{ zIndex: Z.floating, marginBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {abierto ? <X className="w-6 h-6" /> : <MessageSquare className="w-6 h-6" />}
        {!abierto && chat.noLeidas > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[22px] h-[22px] px-1 rounded-full bg-[#e5484d] text-white text-[11px] font-bold flex items-center justify-center tabular-nums ring-2 ring-[var(--bg-base)]">
            {chat.noLeidas > 99 ? '99+' : chat.noLeidas}
          </span>
        )}
      </button>

      {/* El panel. Capa fija encima del módulo actual; no toca lo de fondo.
          En teléfono ocupa casi toda la pantalla; en escritorio es una
          ventana anclada abajo a la derecha. */}
      {abierto && (
        <div
          className="fixed flex flex-col glass-panel-strong rounded-2xl overflow-hidden shadow-2xl border border-[var(--border-color)]
                     inset-x-2 top-16 bottom-24 sm:inset-x-auto sm:top-auto sm:right-5 sm:bottom-24 sm:w-[390px] sm:h-[72vh] sm:max-h-[640px]"
          style={{ zIndex: Z.floating }}
          role="dialog"
          aria-label="Chat"
        >
          <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-[var(--border-color)] bg-[var(--bg-elevated)] shrink-0">
            <span className="font-display font-bold text-[14px] text-[var(--text-primary)] flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-[var(--accent)]" />
              {chat.selectedConv ? (chat.selectedConv.customerName || 'Conversación') : 'Chat'}
            </span>
            <button
              type="button"
              onClick={() => setAbierto(false)}
              aria-label="Cerrar"
              className="p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 min-h-0 flex flex-col">
            {chat.selectedConv ? (
              <ChatThread
                conversation={chat.selectedConv}
                staffEmails={chat.staffEmails}
                onBack={() => chat.setSelectedConvId(null)}
                onSendMessage={chat.handleSendMessage}
                onAssign={chat.handleAssign}
                onChangeStatus={chat.handleChangeStatus}
                onResolve={chat.handleResolve}
              />
            ) : (
              <ChatInbox
                conversations={chat.filteredConversations}
                selectedConvId={chat.selectedConvId}
                statusFilter={chat.statusFilter}
                onFilterChange={chat.setStatusFilter}
                resolvedRange={chat.resolvedRange}
                onResolvedRangeChange={chat.setResolvedRange}
                onSelect={chat.setSelectedConvId}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}
