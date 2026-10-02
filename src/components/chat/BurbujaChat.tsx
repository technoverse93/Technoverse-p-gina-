// =====================================================================
// CHAT FLOTANTE · "CABEZAS DE CHAT" (sin perder el contexto de fondo)
// =====================================================================
// Fuera de la pestaña Chat, cada conversación activa aparece como una
// burbuja con la inicial del cliente, apiladas abajo a la derecha:
//
//   · punto verde  → el cliente está en línea ahora (avisa cada 20 s);
//   · número rojo  → mensajes sin leer;
//   · al llegar un mensaje nuevo, asoma unos segundos al lado de su burbuja.
//
// Tocar una burbuja abre ESA conversación en una ventana al costado, para
// leer y responder sin cambiar de pestaña. La burbuja de abajo (el globo)
// abre la lista completa. El panel es una capa fija encima: lo que corre
// detrás (el espejo de supervisión, una factura a medio llenar) no se toca.
//
// Comparte datos con la pestaña Chat a través de `useChatAdmin` (mismo
// `getDB()`): responder aquí se ve allá y al revés.
//
// La VISTA (`BurbujaChatVista`) está separada del hook a propósito: la
// maqueta de revisión renderiza este mismo componente con datos de ejemplo,
// así lo que se aprueba es exactamente lo que se instala.
// =====================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare, Minus } from 'lucide-react';
import { ChatConversation, User } from '../../types';
import { Z } from '../ui/Overlays';
import ChatInbox from './ChatInbox';
import ChatThread from './ChatThread';
import { useChatAdmin } from './useChatAdmin';
import { estaEnLinea, inicialDe, nombreLegible } from './formatoChat';

type ChatAdmin = ReturnType<typeof useChatAdmin>;

/** Cuántas cabezas se muestran; el resto se ve desde el globo de la lista. */
const MAX_CABEZAS = 4;

/** Forma de las burbujas (Cristal Ligero): cuadrado de esquinas de 18 px, no
 *  círculo. El panel redondea todos los botones con una regla de id; el radio
 *  en línea le gana y fija la forma de la maqueta. */
const REDONDA = { borderRadius: 18 } as const;

function ultimoDelCliente(c: ChatConversation) {
  for (let i = c.messages.length - 1; i >= 0; i--) {
    const m = c.messages[i];
    if (m && m.sender === 'customer') return m;
  }
  return null;
}

function textoCorto(m: { text?: string; imageUrl?: string; audioUrl?: string; videoUrl?: string } | null): string {
  if (!m) return '';
  const t = (m.text || '').trim();
  if (t) return t.length > 60 ? `${t.slice(0, 57)}…` : t;
  return m.imageUrl ? '📷 Foto' : m.audioUrl ? '🎤 Nota de voz' : m.videoUrl ? '🎬 Video' : '';
}

function ultimaActividad(c: ChatConversation): number {
  const m = c.messages[c.messages.length - 1];
  return m ? new Date(m.timestamp).getTime() : (c.updatedAt ? new Date(c.updatedAt).getTime() : 0);
}

export function BurbujaChatVista({ chat, oculto, ahoraInicial }: { chat: ChatAdmin; oculto?: boolean; ahoraInicial?: number }) {
  // null = todo minimizado · 'lista' = lista completa · id = esa conversación
  const [abierta, setAbierta] = useState<string | null>(null);
  const [asomando, setAsomando] = useState<string | null>(null);
  const [ahora, setAhora] = useState(() => ahoraInicial ?? Date.now());
  useEffect(() => {
    if (ahoraInicial) return;
    const t = setInterval(() => setAhora(Date.now()), 15000);
    return () => clearInterval(t);
  }, [ahoraInicial]);

  const activas = useMemo(
    () => chat.conversations
      .filter(c => c.status !== 'resuelto')
      .sort((a, b) => ultimaActividad(b) - ultimaActividad(a)),
    [chat.conversations],
  );
  const cabezas = activas.slice(0, MAX_CABEZAS);
  const sobrantes = activas.length - cabezas.length;
  const totalSinLeer = activas.reduce((n, c) => n + (c.unreadCount || 0), 0);

  // Aviso al llegar un mensaje nuevo del cliente: asoma 6 s junto a su burbuja.
  const ultimosRef = useRef<Map<string, string>>(new Map());
  const sembradoRef = useRef(false);
  useEffect(() => {
    let nuevo: string | null = null;
    for (const c of activas) {
      const m = ultimoDelCliente(c);
      const previo = ultimosRef.current.get(c.id);
      if (m) ultimosRef.current.set(c.id, m.id);
      if (sembradoRef.current && m && previo !== m.id && abierta !== c.id) nuevo = c.id;
    }
    sembradoRef.current = true;
    if (!nuevo) return;
    setAsomando(nuevo);
    const t = setTimeout(() => setAsomando(a => (a === nuevo ? null : a)), 6000);
    return () => clearTimeout(t);
  }, [activas, abierta]);

  // Escape minimiza.
  useEffect(() => {
    if (!abierta) return;
    const alTeclear = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierta(null); };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [abierta]);

  // Al entrar a la pestaña Chat se minimiza todo (allí ya está el chat entero).
  useEffect(() => { if (oculto) setAbierta(null); }, [oculto]);

  if (oculto) return null;

  const abrirConversacion = (id: string) => {
    if (abierta === id) { setAbierta(null); return; }
    chat.setSelectedConvId(id);
    setAbierta(id);
    setAsomando(null);
  };
  const conversacionAbierta = abierta && abierta !== 'lista'
    ? chat.conversations.find(c => c.id === abierta) || null
    : null;

  return (
    <>
      {/* La pila de burbujas: la más reciente arriba del globo de la lista. */}
      <div
        className="fixed right-3 sm:right-5 bottom-4 sm:bottom-5 flex flex-col-reverse items-end gap-2.5"
        style={{ zIndex: Z.floating, marginBottom: 'env(safe-area-inset-bottom, 0px)' }}
        aria-label="Chats"
      >
        <button
          type="button"
          onClick={() => setAbierta(a => (a === 'lista' ? null : 'lista'))}
          aria-label={`Todas las conversaciones${totalSinLeer ? `, ${totalSinLeer} mensajes sin leer` : ''}`}
          aria-expanded={abierta === 'lista'}
          style={REDONDA}
          className="relative w-12 h-12 sm:w-[52px] sm:h-[52px] bg-[var(--accent)] text-[var(--accent-ink)] shadow-lg flex items-center justify-center transition active:scale-95 hover:brightness-110"
        >
          <MessageSquare className="w-5 h-5" />
          {sobrantes > 0 && (
            <span className="absolute -top-1 -left-1 min-w-[20px] h-5 px-1 rounded-full bg-[var(--bg-surface)] text-[var(--text-primary)] text-[10.5px] font-bold flex items-center justify-center ring-1 ring-[var(--border-color)]">
              +{sobrantes}
            </span>
          )}
        </button>

        {cabezas.map(c => {
          const enLinea = estaEnLinea(c.customerLastSeenAt, ahora);
          const nombre = nombreLegible(c.customerName) || 'Cliente';
          const activa = abierta === c.id;
          return (
            <div key={c.id} className="relative flex items-center">
              {/* Vista previa: asoma al llegar un mensaje nuevo (y al pasar
                  el ratón en escritorio). Nunca tapa la ventana abierta. */}
              {(asomando === c.id) && !activa && (
                <button
                  type="button"
                  onClick={() => abrirConversacion(c.id)}
                  className="absolute right-full mr-2.5 max-w-[220px] rounded-[18px] border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-2 text-left shadow-lg motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-right-2"
                >
                  <span className="block text-[11px] font-bold text-[var(--text-primary)] truncate">{nombre}</span>
                  <span className="block text-[12px] text-[var(--text-secondary)] truncate">{textoCorto(ultimoDelCliente(c))}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => abrirConversacion(c.id)}
                onMouseEnter={() => !activa && setAsomando(c.id)}
                onMouseLeave={() => setAsomando(a => (a === c.id ? null : a))}
                aria-label={`Chat con ${nombre}${c.unreadCount ? `, ${c.unreadCount} sin leer` : ''}${enLinea ? ', en línea' : ''}`}
                aria-expanded={activa}
                className={`cristal-vidrio relative w-12 h-12 sm:w-[52px] sm:h-[52px] text-[var(--gota-ink)] font-display font-bold text-[17px] flex items-center justify-center transition active:scale-95 ${activa ? 'ring-[3px] ring-[var(--accent)]' : ''}`}
                style={REDONDA}
              >
                {inicialDe(c.customerName)}
                {enLinea && (
                  <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-[var(--ok)] ring-2 ring-[var(--bg-surface)]" aria-hidden="true" />
                )}
                {(c.unreadCount || 0) > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-[#e5484d] text-white text-[10.5px] font-bold flex items-center justify-center tabular-nums ring-2 ring-[var(--bg-surface)]">
                    {c.unreadCount > 99 ? '99+' : c.unreadCount}
                  </span>
                )}
              </button>
            </div>
          );
        })}
      </div>

      {/* La ventana: al costado de las burbujas en tablet/PC; en teléfono
          ocupa el ancho que dejan libre las burbujas. */}
      {abierta && (
        <div
          className="fixed flex flex-col glass-panel-strong rounded-[22px] overflow-hidden shadow-2xl border border-[var(--border-color)]
                     left-2 right-[68px] top-16 bottom-4
                     sm:left-auto sm:top-auto sm:right-[88px] sm:bottom-5 sm:w-[380px] sm:h-[min(72vh,620px)]"
          style={{ zIndex: Z.floating }}
          role="dialog"
          aria-label={conversacionAbierta ? `Chat con ${nombreLegible(conversacionAbierta.customerName)}` : 'Conversaciones'}
        >
          <div className="flex items-center justify-between gap-2 pl-3 pr-1.5 h-9 border-b border-[var(--border-color)] bg-[var(--bg-sunken)] shrink-0">
            <span className="text-[11.5px] font-semibold text-[var(--text-secondary)] truncate">
              {conversacionAbierta ? 'Chat' : `Conversaciones · ${activas.length}`}
            </span>
            <button
              type="button"
              onClick={() => setAbierta(null)}
              aria-label="Minimizar"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]"
            >
              <Minus className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 min-h-0 flex flex-col">
            {conversacionAbierta ? (
              <ChatThread
                conversation={conversacionAbierta}
                staffEmails={chat.staffEmails}
                onBack={() => setAbierta('lista')}
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
                onSelect={id => { chat.setSelectedConvId(id); setAbierta(id); }}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}

interface Props {
  currentUser: User | null;
  onDataChanged?: () => void;
  /** La burbuja se esconde cuando ya se está en la pestaña Chat. */
  oculto?: boolean;
}

export default function BurbujaChat({ currentUser, onDataChanged, oculto }: Props) {
  // `avisar = false`: las notificaciones las dispara la pestaña Chat; si
  // también avisara la burbuja, cada mensaje sonaría dos veces.
  const chat = useChatAdmin(currentUser, onDataChanged, false);
  return <BurbujaChatVista chat={chat} oculto={oculto} />;
}
