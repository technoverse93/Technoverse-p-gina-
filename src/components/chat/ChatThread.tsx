import React, { useState, useRef, useEffect } from 'react';
import { ArrowLeft, MoreVertical, Send, StickyNote, RefreshCw, Bot, Trash2, Mic, Paperclip, Check, CheckCheck } from 'lucide-react';
import { subirAdjuntoChat, subirNotaDeVoz, ACEPTA_ADJUNTOS } from '../../utils/adjuntosChat';
import { tomarFotoNativa, hayCamaraNativa } from '../../utils/camara';
import { grabarNotaDeVoz, puedeGrabarVoz, type GrabacionEnCurso } from '../../utils/grabadorVoz';
import { borrarMensajeParaTodos, cerrarConversacion } from '../../utils/storage';
import { ChatConversation } from '../../types';
import { compressImage } from '../../utils/storage';
import { supabase } from '../../supabaseClient';
import ChatActionsMenu from './ChatActionsMenu';
import AdjuntarMenu from './AdjuntarMenu';
import { useToast } from '../ui/Overlays';
import { etiquetaDeDia, abreDiaNuevo, soloHora, estaEnLinea, haceCuanto, inicialDe, colorDe } from './formatoChat';
import VideoMensaje from './VideoMensaje';
import AudioMensaje from './AudioMensaje';
import ImagenMensaje from './ImagenMensaje';

interface ChatThreadProps {
  conversation: ChatConversation;
  staffEmails: string[];
  onBack: () => void;
  onSendMessage: (convId: string, payload: { text: string; imageUrl?: string; videoUrl?: string; audioUrl?: string; isInternalNote?: boolean }) => Promise<void>;
  onAssign: (convId: string, email: string) => Promise<void>;
  onChangeStatus: (convId: string, status: 'nuevo' | 'pendiente') => Promise<void>;
  onResolve: (convId: string) => Promise<void>;
}

export default function ChatThread({ conversation, staffEmails, onBack, onSendMessage, onAssign, onChangeStatus, onResolve }: ChatThreadProps) {
  const toast = useToast();
  // Hasta qué momento leyó el visitante: un mensaje del personal anterior o
  // igual a esta marca ya fue visto por él. Alimenta el doble check.
  const leidoHasta = conversation.customerLastReadAt ? new Date(conversation.customerLastReadAt).getTime() : 0;
  // Reloj propio: sin él, "En línea" se quedaría fijo cuando el visitante
  // se va (al dejar de avisar no llega ningún evento que repinte).
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setAhora(Date.now()), 15000); return () => clearInterval(t); }, []);
  const enLinea = estaEnLinea(conversation.customerLastSeenAt, ahora);
  const ultimaConexion = haceCuanto(conversation.customerLastSeenAt, ahora);
  const [inputText, setInputText] = useState('');
  const [noteMode, setNoteMode] = useState(false);
  const [uploading, setUploading] = useState(false);
  /** Grabación de voz en curso, si la hay (ver `alternarGrabacion`). */
  const [grabacion, setGrabacion] = useState<GrabacionEnCurso | null>(null);
  /** ¿Está abierto el menú "Adjuntar" (cámara / galería)? Ver AdjuntarMenu.tsx. */
  const [menuAdjuntoAbierto, setMenuAdjuntoAbierto] = useState(false);
  // El botón "Adjuntar" se oculta con el resto de las herramientas apenas
  // hay texto escrito. Si el menú quedó abierto justo antes de eso, se
  // cierra solo en vez de quedar flotando sin el botón que lo ancla.
  useEffect(() => {
    if (inputText.trim()) setMenuAdjuntoAbierto(false);
  }, [inputText]);
  const [borrandoId, setBorrandoId] = useState<string | null>(null);
  /** Mensaje cuyo menú de acciones está abierto (se abre al tocarlo). */
  const [menuMsgId, setMenuMsgId] = useState<string | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Input aparte SOLO para la cámara en el navegador: `capture="environment"`
  // abre la cámara trasera directo (ver `handleCamara`).
  const camaraRef = useRef<HTMLInputElement>(null);
  // La subida de imagen es asíncrona (lectura + compresión + Storage); si el
  // admin cambia de conversación o sale del módulo antes de que termine, no
  // se debe tocar el estado de un componente ya desmontado.
  const isMountedRef = useRef(true);

  // Cuántos mensajes (contando desde el más reciente) se dibujan de una vez.
  // Un hilo con meses de historial no necesita renderizar TODO para mostrar
  // los últimos: eso es DOM y trabajo de layout que crece sin límite con la
  // antigüedad del chat, no con lo que la persona realmente está viendo.
  const TANDA_MENSAJES = 60;
  const [cantidadVisible, setCantidadVisible] = useState(TANDA_MENSAJES);
  useEffect(() => { setCantidadVisible(TANDA_MENSAJES); }, [conversation.id]);
  const indiceInicio = Math.max(0, conversation.messages.length - cantidadVisible);
  const mensajesVisibles = conversation.messages.slice(indiceInicio);
  const hayMensajesAnteriores = indiceInicio > 0;

  // Instantáneo (`auto`), no animado: con mensajes seguidos, un scroll
  // "smooth" que no llega a terminar antes del siguiente mensaje se ve
  // como si el chat se hubiera "trabado" a medio camino.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [conversation.messages.length]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const handleSendText = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    const text = inputText.trim();
    const wasNote = noteMode;
    setInputText('');
    setNoteMode(false);
    await onSendMessage(conversation.id, { text, isInternalNote: wasNote });
  };

  const handleImagePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      // Mismo camino que usa el cliente: fotos comprimidas, videos tal cual
      // y con tope de tamaño comprobado antes de salir (ver adjuntosChat.ts).
      const adjunto = await subirAdjuntoChat(conversation.id, file);
      await onSendMessage(conversation.id, { text: '', ...adjunto });
    } catch (err: any) {
      if (isMountedRef.current) toast.error('No se pudo enviar el adjunto. ' + (err?.message || err));
    } finally {
      if (isMountedRef.current) setUploading(false);
    }
  };

  /**
   * Botón de CÁMARA del personal: tomar una foto y mandarla al toque.
   *
   * En la APK abre la cámara del sistema (`tomarFotoNativa`); en el
   * navegador dispara el `<input capture="environment">`, que cae en el
   * mismo `handleImagePick`. Igual que del lado del cliente.
   */
  const handleCamara = async () => {
    if (uploading) return;

    if (!hayCamaraNativa()) {
      camaraRef.current?.click();
      return;
    }

    setUploading(true);
    try {
      const file = await tomarFotoNativa();
      if (!file) return; // se cerró la cámara sin tomar nada
      const adjunto = await subirAdjuntoChat(conversation.id, file);
      await onSendMessage(conversation.id, { text: '', ...adjunto });
    } catch (err: any) {
      if (isMountedRef.current) toast.error('No se pudo tomar la foto. ' + (err?.message || err));
    } finally {
      if (isMountedRef.current) setUploading(false);
    }
  };

  /**
   * NOTA DE VOZ del personal: un toque empieza, otro manda.
   *
   * Mismo criterio que del lado del cliente (ver `LiveChat.tsx`): dos
   * toques en vez de mantener presionado, porque "mantener" pelea con el
   * desplazamiento en el teléfono y no tiene equivalente en escritorio.
   * El micrófono se pide en el primer toque, que ya es un gesto real.
   */
  const alternarGrabacion = async () => {
    if (uploading) return;

    if (grabacion) {
      const enCurso = grabacion;
      setGrabacion(null);
      setUploading(true);
      try {
        const blob = await enCurso.detener();
        const adjunto = await subirNotaDeVoz(conversation.id, blob);
        await onSendMessage(conversation.id, { text: '', ...adjunto });
      } catch (err: any) {
        if (isMountedRef.current) toast.error('No se pudo enviar la nota de voz. ' + (err?.message || err));
      } finally {
        if (isMountedRef.current) setUploading(false);
      }
      return;
    }

    try {
      setGrabacion(await grabarNotaDeVoz());
    } catch (err: any) {
      toast.error(err?.message || 'No se pudo usar el micrófono.');
    }
  };

  /** Cierra y borra ESTA conversación, para todos y al instante. */
  const cerrarYBorrar = async () => {
    setShowMenu(false);
    try {
      const r = await cerrarConversacion(conversation.id);
      toast.success(`Conversación cerrada: ${r.mensajes} mensajes y ${r.archivos} archivos borrados.`);
      onBack();
    } catch (err: any) {
      toast.error('No se pudo cerrar. ' + (err?.message || err));
    }
  };

  /**
   * Borra un mensaje PARA TODOS — sea del cliente o propio.
   *
   * El borrado lo hace una función del servidor que vuelve a comprobar que
   * quien llama es personal, y el aviso viaja por WebSocket: el mensaje
   * desaparece de la pantalla del cliente sin que recargue nada.
   */
  const borrarMensaje = async (msgId: string) => {
    if (borrandoId) return;
    setBorrandoId(msgId);
    try {
      await borrarMensajeParaTodos(msgId);
    } catch (err: any) {
      if (isMountedRef.current) toast.error('No se pudo borrar. ' + (err?.message || err));
    } finally {
      if (isMountedRef.current) setBorrandoId(null);
    }
  };

  return (
    <>
      <div className="tv-chat-cab" id="chat-thread-header">
        <div className="flex items-center gap-2.5 min-w-0">
          <button type="button" onClick={onBack} className="tv-chat-ib md:hidden" aria-label="Volver a la bandeja">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="tv-chat-ava tv-chat-ava--cab" style={{ background: colorDe(conversation.id) }}>
            {inicialDe(conversation.customerName)}
          </div>
          <div className="min-w-0">
            <h4 className="font-display font-bold text-[15px] text-[var(--text-primary)] truncate leading-tight">{conversation.customerName || 'Cliente'}</h4>
            <p className="text-[12px] text-[var(--text-secondary)] truncate">
              {enLinea ? (
                <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--ok)]">
                  <span className="w-2 h-2 rounded-full bg-[var(--ok)]" aria-hidden="true" /> En línea
                </span>
              ) : ultimaConexion
                ? <>Última vez conectado: {ultimaConexion}</>
                : conversation.customerEmail}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {conversation.status === 'resuelto' && (
            <span className="tv-chat-etq hidden sm:inline">
              Resuelto
            </span>
          )}
          {conversation.assignedAdminEmail && (
            <span className="tv-chat-etq hidden sm:inline truncate max-w-[160px]">
              {conversation.assignedAdminEmail}
            </span>
          )}
          <button type="button" onClick={() => setShowMenu(v => !v)} className="tv-chat-ib" aria-label="Más opciones">
            <MoreVertical className="w-4 h-4" />
          </button>
          {showMenu && (
            <ChatActionsMenu
              conversation={conversation}
              staffEmails={staffEmails}
              onClose={() => setShowMenu(false)}
              onAssign={(email) => onAssign(conversation.id, email)}
              onChangeStatus={(status) => onChangeStatus(conversation.id, status)}
              onResolve={() => onResolve(conversation.id)}
              onCerrarYBorrar={() => void cerrarYBorrar()}
            />
          )}
        </div>
      </div>

      <div className="tv-chat-msgs" id="chat-thread-messages">
        {hayMensajesAnteriores && (
          <div className="flex justify-center pb-1">
            <button
              type="button"
              onClick={() => setCantidadVisible(v => v + TANDA_MENSAJES)}
              className="tv-chat-mas"
            >
              Ver mensajes anteriores
            </button>
          </div>
        )}
        {mensajesVisibles.map((msg, i) => {
          // Separador de día. Va fuera del `if` de nota interna a propósito:
          // una nota también puede ser lo primero de un día.
          const separador = abreDiaNuevo(msg.timestamp, mensajesVisibles[i - 1]?.timestamp) ? (
            <div key={`dia-${msg.id}`} className="flex justify-center py-1">
              <span className="tv-chat-dia">
                {etiquetaDeDia(msg.timestamp)}
              </span>
            </div>
          ) : null;

          if (msg.isInternalNote) {
            return (
              <React.Fragment key={msg.id}>
                {separador}
                <div className="flex justify-center">
                  <div className="tv-chat-nota max-w-[min(88%,32rem)] px-3.5 py-2.5 text-[12.5px] flex items-start gap-1.5">
                    <StickyNote className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <div>
                      {msg.text && <p className="tv-break whitespace-pre-wrap leading-[1.5]">{msg.text}</p>}
                      <span className="block mt-1 text-[10.5px] font-semibold opacity-70">Nota interna &middot; {soloHora(msg.timestamp)}</span>
                    </div>
                  </div>
                </div>
              </React.Fragment>
            );
          }
          const isSupport = msg.sender === 'support';
          const isBot = msg.sender === 'bot';
          // Inicial del cliente en el avatar, no un icono genérico: en un
          // hilo largo la letra ancla la mirada mucho antes que una silueta
          // igual para todos.
          const inicial = inicialDe(conversation.customerName);

          return (
            <React.Fragment key={msg.id}>
              {separador}
              {/* El tope es el MENOR entre el 78% y una medida legible.
                  Solo con el porcentaje, en el panel ancho de escritorio una
                  respuesta larga se estira de lado a lado y se vuelve un
                  párrafo de página, no un mensaje: el ojo pierde el renglón
                  al volver. En móvil manda el 78% y nada cambia. */}
              <div className={`relative flex gap-2 max-w-[min(78%,32rem)] ${isSupport ? 'ml-auto flex-row-reverse' : ''}`}>
                {!isSupport && (
                  <div className="tv-chat-ava tv-chat-ava--mini shrink-0 self-end" style={{ background: colorDe(conversation.id) }}>
                    {isBot ? <Bot className="w-3 h-3" /> : inicial}
                  </div>
                )}
                <div className="min-w-0">
                  {/* La hora vive DENTRO de la burbuja, alineada a la derecha.
                      Antes iba en una fila aparte debajo, con el nombre
                      repetido en cada mensaje: en un intercambio de veinte
                      líneas eso son veinte veces el mismo nombre ocupando
                      espacio y ruido. Quién habla ya lo dice el lado y el
                      color de la burbuja. */}
                  {/* Los colores salen de --bubble-in/--bubble-out, que
                      existen para esto y ya están afinados en los dos temas:
                      en oscuro la burbuja entrante (#1D2421) se despega del
                      fondo por tono, que es como se marca elevación ahí,
                      porque una sombra negra sobre fondo negro no se ve. */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setMenuMsgId(id => id === msg.id ? null : msg.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setMenuMsgId(id => id === msg.id ? null : msg.id); } }}
                    className={`tv-chat-burbuja cursor-pointer px-3.5 py-2 text-[13px] ${isSupport ? 'tv-chat-burbuja--out' : 'tv-chat-burbuja--in'}`}>
                    {msg.imageUrl && (
                      <ImagenMensaje src={msg.imageUrl} alto="max-h-64" />
                    )}
                    {msg.audioUrl && (
                      <AudioMensaje src={msg.audioUrl} />
                    )}
                    {msg.videoUrl && (
                      <VideoMensaje src={msg.videoUrl} />
                    )}
                    {/* `flow-root` contiene el flotante de la hora; sin eso la
                        burbuja no lo cuenta al medir su alto y la hora se
                        sale por abajo. */}
                    <div className="flow-root tv-break whitespace-pre-wrap leading-[1.5]">
                      {msg.text}
                      {/* La hora FLOTA al final del texto: si cabe, se acomoda
                          en el mismo renglón; si no, baja sola. Antes ocupaba
                          siempre una línea entera, y en un mensaje corto como
                          "Gracias" eso estiraba la burbuja al ancho de la
                          hora y la dejaba descuadrada. */}
                      <span className={`float-right ml-2.5 mt-[7px] text-[10px] tabular-nums whitespace-nowrap select-none inline-flex items-center gap-1 ${isSupport ? 'opacity-75' : 'opacity-55'}`}>
                        {soloHora(msg.timestamp)}
                        {/* Acuse de lectura, solo en los mensajes que el
                            personal ENVIÓ al cliente (las notas internas no
                            se muestran al cliente, así que no llevan check).
                            Doble check lleno = el visitante ya lo leyó; un
                            solo check = entregado, aún sin leer. */}
                        {isSupport && !msg.isInternalNote && (
                          leidoHasta && new Date(msg.timestamp).getTime() <= leidoHasta
                            ? <CheckCheck className="w-3.5 h-3.5 tv-tick-visto" aria-label="Visto por el cliente" />
                            : <Check className="w-3.5 h-3.5 opacity-80" aria-label="Enviado" />
                        )}
                      </span>
                    </div>
                  </div>
                </div>

                {/* MENÚ AL TOCAR EL MENSAJE.
                    Antes esto era un ícono que solo aparecía al pasar el
                    cursor por encima. En un teléfono NO hay cursor, así que
                    el botón quedaba invisible para siempre y no había forma
                    de borrar nada desde el móvil — que es justo desde donde
                    se atiende. Ahora se toca el mensaje y sale la opción,
                    igual que en WhatsApp: funciona con dedo y con ratón.

                    Vale para CUALQUIER mensaje, propio o del cliente: es
                    moderación, no un "deshacer lo mío". */}
                {menuMsgId === msg.id && (
                  <div
                    className={`tv-chat-pop absolute z-30 top-full mt-1 ${isSupport ? 'right-0' : 'left-0'} w-52`}
                  >
                    <button
                      type="button"
                      onClick={() => { setMenuMsgId(null); void borrarMensaje(msg.id); }}
                      disabled={borrandoId === msg.id}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-[12.5px] font-semibold hover:bg-[var(--bg-sunken)] disabled:opacity-50"
                      style={{ color: '#e5484d' }}
                    >
                      {borrandoId === msg.id
                        ? <RefreshCw className="w-4 h-4 animate-spin" />
                        : <Trash2 className="w-4 h-4" />}
                      Borrar para todos
                    </button>
                    <button
                      type="button"
                      onClick={() => setMenuMsgId(null)}
                      className="w-full px-3 py-2 text-[12px] text-[var(--text-secondary)] border-t border-[var(--border-color)] hover:bg-[var(--bg-sunken)]"
                    >
                      Cancelar
                    </button>
                  </div>
                )}
              </div>
            </React.Fragment>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSendText} className="tv-chat-red" data-nota={noteMode ? '' : undefined} id="chat-thread-input">
        <input ref={fileInputRef} type="file" accept={ACEPTA_ADJUNTOS} className="hidden" onChange={handleImagePick} />
        {/* Input exclusivo de la cámara en el navegador (`capture="environment"`
            abre la cámara trasera directo). En la APK manda el plugin nativo. */}
        <input ref={camaraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleImagePick} />

        {/* HERRAMIENTAS: nota interna, adjuntar (cámara+galería en un solo
            botón con menú) y nota de voz. Desaparecen apenas hay texto
            escrito, dejando solo el botón de enviar — el campo de texto es
            lo que importa leer, no la fila de íconos. El tinte ámbar de
            "modo nota" (arriba, en el `form`) sigue visible aunque el
            toggle se oculte, así que no se pierde esa señal al escribir.

            FALLO CORREGIDO — el botón "Adjuntar" no hacía nada visible: el
            `relative` que ancla su menú (`AdjuntarMenu.tsx`) tiene que
            quedar AFUERA del `overflow-hidden` que recorta el ancho para
            la animación, o el menú se recorta a la nada aunque el botón sí
            reaccione. Por eso el `relative` de abajo envuelve TODA la fila
            de herramientas —nota, adjuntar, voz— y el menú se dibuja como
            hermano de la caja recortada, no adentro. Como acá el botón de
            adjuntar es el SEGUNDO (después de "nota interna", 36px + 8px
            de separación), el menú necesita ese mismo desplazamiento para
            seguir quedando debajo del botón correcto: `anchorOffsetClass`
            en vez del `left-0` por defecto (ver AdjuntarMenu.tsx). */}
        <div className="tv-chat-pildora">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={noteMode ? 'Nota interna (solo el equipo la ve)' : 'Responder…'}
          className="tv-chat-campo"
        />
        <div className="relative" id="div-menu-admin">
          <div
            className={`grid transition-[grid-template-columns] duration-200 ease-out ${
              inputText.trim() ? 'grid-cols-[0fr]' : 'grid-cols-[auto]'
            }`}
          >
            <div className="overflow-hidden flex items-center gap-2">
              <button
                type="button"
                onClick={() => setNoteMode(v => !v)}
                title="Nota interna"
                data-on={noteMode ? '' : undefined}
                className="tv-chat-herr shrink-0"
              >
                <StickyNote className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setMenuAdjuntoAbierto(v => !v)}
                disabled={uploading}
                title="Adjuntar"
                aria-label="Adjuntar"
                className="tv-chat-herr shrink-0 disabled:opacity-40"
              >
                {uploading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
              </button>
              {puedeGrabarVoz() && (
                <button
                  type="button"
                  onClick={() => void alternarGrabacion()}
                  disabled={uploading}
                  title={grabacion ? 'Toca para enviar la nota de voz' : 'Grabar una nota de voz'}
                  aria-label={grabacion ? 'Enviar nota de voz' : 'Grabar nota de voz'}
                  data-grabando={grabacion ? '' : undefined}
                  className="tv-chat-herr shrink-0 disabled:opacity-40"
                >
                  <Mic className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
          {menuAdjuntoAbierto && (
            <AdjuntarMenu
              onClose={() => setMenuAdjuntoAbierto(false)}
              onCamara={() => void handleCamara()}
              onGaleria={() => fileInputRef.current?.click()}
              anchorOffsetClass="right-0"
            />
          )}
        </div>

        </div>
        <button type="submit" className="tv-chat-env" aria-label="Enviar">
          <Send className="w-3.5 h-3.5" />
        </button>
      </form>
    </>
  );
}
