import React, { useEffect, useMemo, useState } from 'react';
import { Clock, Search } from 'lucide-react';
import { ChatConversation } from '../../types';
import { selloDeLista, estaEnLinea, inicialDe, colorDe } from './formatoChat';
import type { ChatStatusFilter, ResolvedRange } from './ChatCRM';

interface ChatInboxProps {
  conversations: ChatConversation[];
  selectedConvId: string | null;
  statusFilter: ChatStatusFilter;
  onFilterChange: (filter: ChatStatusFilter) => void;
  resolvedRange: ResolvedRange;
  onResolvedRangeChange: (range: ResolvedRange) => void;
  onSelect: (id: string) => void;
}

const FILTERS: { id: ChatStatusFilter; label: string; dot: string }[] = [
  { id: 'nuevo', label: 'Nuevos', dot: 'bg-[var(--accent)]' },
  { id: 'pendiente', label: 'Pendientes', dot: 'bg-[var(--warn)]' },
  { id: 'todos', label: 'Todos', dot: 'bg-[var(--text-muted)]' },
  { id: 'resueltos', label: 'Resueltos', dot: 'bg-[var(--ok)]' }
];

// Componente propietario (sin <select> nativo del OS/navegador): pills en
// línea, coherentes con FILTERS de arriba, que caben igual en el ancho
// angosto del A12 que en el panel de la Redmi Pad SE 12" (el ancho del
// sidebar no cambia entre ambos: es md:max-w-sm), sin overlays flotantes que
// puedan colisionar con otros elementos/z-index.
const RESOLVED_RANGES: { id: ResolvedRange; label: string }[] = [
  { id: '1d', label: '1 Día' },
  { id: '7d', label: '1 Semana' },
  { id: '30d', label: '1 Mes' }
];

function ultimoVisible(conv: ChatConversation) {
  const visible = conv.messages.filter(m => !m.isInternalNote);
  return visible[visible.length - 1];
}

function lastPreview(conv: ChatConversation): string {
  const last = ultimoVisible(conv);
  if (!last) return 'Sin mensajes todavía';
  if (last.imageUrl) return '📷 Imagen';
  return last.text;
}

export default function ChatInbox({
  conversations,
  selectedConvId,
  statusFilter,
  onFilterChange,
  resolvedRange,
  onResolvedRangeChange,
  onSelect
}: ChatInboxProps) {
  // Reloj para que el punto verde se apague solo cuando el visitante deja
  // de avisar (sin eventos nuevos no habría nada que repinte la lista).
  const [ahora, setAhora] = useState(() => Date.now());
  const [buscar, setBuscar] = useState('');
  useEffect(() => { const t = setInterval(() => setAhora(Date.now()), 15000); return () => clearInterval(t); }, []);
  const lista = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(c =>
      (c.customerName || '').toLowerCase().includes(q) ||
      c.messages.some(m => !m.isInternalNote && (m.text || '').toLowerCase().includes(q)));
  }, [conversations, buscar]);
  return (
    <>
      <div id="chat-inbox-filters">
        <label className="tv-chat-busca">
          <Search className="w-4 h-4 shrink-0" aria-hidden="true" />
          <input
            type="search"
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
            placeholder="Buscar cliente o mensaje"
            aria-label="Buscar cliente o mensaje"
          />
        </label>
        <div className="tv-chat-filtros">
          {FILTERS.map(f => (
            <button
              key={f.id}
              type="button"
              onClick={() => onFilterChange(f.id)}
              data-on={statusFilter === f.id ? '' : undefined}
              className="tv-chat-filtro"
            >
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${f.dot}`} />
              {f.label}
            </button>
          ))}
        </div>
        {statusFilter === 'resueltos' && (
          <div className="tv-chat-rango" id="chat-resolved-range">
            <Clock className="w-3.5 h-3.5 shrink-0" />
            {RESOLVED_RANGES.map(r => (
              <button
                key={r.id}
                type="button"
                onClick={() => onResolvedRangeChange(r.id)}
                data-on={resolvedRange === r.id ? '' : undefined}
              >
                {r.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto py-1" id="chat-inbox-list">
        {lista.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)] italic text-center py-10 px-4">
            {buscar.trim() ? 'Nada coincide con tu búsqueda.' : 'No hay conversaciones en esta categoría.'}
          </p>
        ) : (
          lista.map(conv => (
            <button
              key={conv.id}
              type="button"
              onClick={() => onSelect(conv.id)}
              data-activa={selectedConvId === conv.id ? '' : undefined}
              className="tv-chat-conv"
            >
              <div className="relative shrink-0">
                <div className="tv-chat-ava" style={{ background: colorDe(conv.id) }}>
                  {inicialDe(conv.customerName)}
                </div>
                {estaEnLinea(conv.customerLastSeenAt, ahora) && (
                  <span title="En línea" aria-label="En línea" className="tv-chat-punto" />
                )}
              </div>
              <div className="min-w-0">
                <span className="block font-semibold text-[13.5px] text-[var(--text-primary)] truncate">{conv.customerName || 'Cliente'}</span>
                <span className="block text-[12.5px] text-[var(--text-secondary)] truncate">{lastPreview(conv)}</span>
                {conv.assignedAdminEmail && (
                  <span className="block text-[10.5px] text-[var(--text-muted)] truncate" title={`Asignado a ${conv.assignedAdminEmail}`}>
                    Atiende: {conv.assignedAdminEmail.split('@')[0]}
                  </span>
                )}
              </div>
              <div className="grid justify-items-end gap-1 text-[11.5px] text-[var(--text-muted)]">
                {ultimoVisible(conv) && <span className="tabular-nums">{selloDeLista(ultimoVisible(conv).timestamp)}</span>}
                {conv.unreadCount > 0
                  ? <span className="tv-chat-cuenta">{conv.unreadCount > 99 ? '99+' : conv.unreadCount}</span>
                  : <span className={`w-2 h-2 rounded-full ${conv.status === 'nuevo' ? 'bg-[var(--accent)]' : conv.status === 'pendiente' ? 'bg-[var(--warn)]' : 'bg-[var(--text-muted)]'}`} />}
              </div>
            </button>
          ))
        )}
      </div>
    </>
  );
}
