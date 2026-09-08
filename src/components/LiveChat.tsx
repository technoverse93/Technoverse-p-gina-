import React, { useState, useEffect, useRef } from 'react';
import { MessageSquare, Send, X, Bot, Plus, Check, CheckCheck, ImagePlus, Loader2, Video, Mic } from 'lucide-react';
import { ChatConversation, ChatMessage } from '../types';
import { getDB, saveDB, ensureCustomerChatToken, marcarMensajeEnVuelo, confirmarMensajeEnVuelo, recargarChatDelServidor } from '../utils/storage';
import { etiquetaDeDia, abreDiaNuevo, soloHora } from './chat/formatoChat';
import VideoMensaje from './chat/VideoMensaje';
import PanelVideollamada from './soporte/PanelVideollamada';
import { escucharTimbre, rechazarVideollamada } from '../supervision/videollamada';
import { subirAdjuntoChat, subirNotaDeVoz, ACEPTA_ADJUNTOS, type Adjunto } from '../utils/adjuntosChat';
import { grabarNotaDeVoz, puedeGrabarVoz, type GrabacionEnCurso } from '../utils/grabadorVoz';
import AudioMensaje from './chat/AudioMensaje';
import { escudoDeChat } from '../seguridad/escudoDlp';
import { ofrecerPantallaCompleta, puedeCompartirPantalla } from '../supervision/capturaPantalla';
import { permisoConcedido } from '../seguridad/consentimiento';
import { obtenerDeviceId } from '../utils/dispositivo';

// ---------------------------------------------------------------------
// DECISIÓN TOMADA: el chat funciona COMPLETO en los dos lados
// ---------------------------------------------------------------------
// Se probó esconder el historial fuera de la APK —era la única forma de
// que una captura en el navegador no se llevara la conversación, porque
// taparla en el momento es imposible: el sistema captura antes de que la
// página se entere, y con los botones físicos ni siquiera llega un evento.
//
// Se descartó: obligaba al cliente a instalar la app para leer una
// respuesta, y eso es peor que el riesgo que evitaba. Escribir y leer
// funcionan igual en el navegador y en la APK, para anónimos y para
// clientes con sesión.
//
// Lo que queda protegido de verdad es la APK, donde FLAG_SECURE bloquea la
// captura a nivel de sistema. En el navegador el escudo DISUADE —recorte
// de Windows, cambio de aplicación, portapapeles vacío, impresión en
// blanco— pero no impide una captura con botones ni con PrintScreen.
// Eso está asumido a conciencia, no es un descuido.
// ---------------------------------------------------------------------

export const FAQ_DATA = [
  {
    q: "¿Cuáles son las formas de pago?",
    a: "Aceptamos transferencias SINPE Móvil al teléfono oficial +506 6421 4795 y tarjetas de crédito/débito a través de nuestra pasarela segura PayU Latam."
  },
  {
    q: "¿Cuánto dura la garantía de reparación?",
    a: "Según la Ley 7472 de Costa Rica, ofrecemos una garantía real incondicional de un mínimo de 3 meses en todas las reparaciones de hardware. Esta garantía se respalda con un ticket firmado y un hash trazable."
  },
  {
    q: "¿Cumplen con la facturación electrónica?",
    a: "Sí, cada compra u orden de reparación genera un XML firmado conforme a la resolución DGT-R-48-2016 del Ministerio de Hacienda de Costa Rica, con IVA del 13% desglosado."
  }
];

const EMAIL_KEY = 'technoverse_chat_email';
const NAME_KEY = 'technoverse_chat_name';

// IDs con sufijo aleatorio: dos envíos rápidos (doble tap) pueden caer en el
// mismo milisegundo con Date.now() puro y colisionar en el upsert por id.
function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readLS(key: string): string {
  try { return window.localStorage.getItem(key) || ''; } catch { return ''; }
}
function writeLS(key: string, val: string) {
  try { window.localStorage.setItem(key, val); } catch { /* almacenamiento no disponible */ }
}

function welcomeMessage(name: string): ChatMessage {
  return {
    id: newId('MSG'),
    sender: 'bot',
    text: `¡Hola ${name}! Bienvenido al soporte de Technoverse Costa Rica. Soy tu asistente virtual. ¿En qué te puedo ayudar hoy? Puedes hacer clic en una pregunta frecuente abajo o escribir tu consulta.`,
    timestamp: new Date().toISOString()
  };
}

/**
 * ¿Ya escribió el cliente algo en esta conversación?
 *
 * ---------------------------------------------------------------------
 * BUG QUE ESTO CORRIGE
 * ---------------------------------------------------------------------
 * Antes, el bloque de "Preguntas Frecuentes" se ocultaba con
 * `messages.length < 5` — un CONTEO, no una pregunta sobre lo que pasó.
 * Resultado: elegir una FAQ agrega 2 mensajes (pregunta + respuesta) y
 * con 1 mensaje de bienvenida ya puesto, hacían falta DOS clics para
 * llegar a 5 y recién ahí desaparecían — la primera elección se veía
 * "no hacer nada". Y si el cliente escribía su propio mensaje (que solo
 * agrega 1), los botones seguían ahí un buen rato más.
 *
 * Preguntando directamente "¿hay algún mensaje del cliente?" el bloque
 * desaparece exactamente en el mensaje número uno, sin importar si vino
 * de un clic o de texto escrito a mano — y una vez que desaparece, no
 * vuelve: un mensaje del cliente no se puede "deshacer".
 */
function yaEscribioElCliente(conv: ChatConversation | undefined): boolean {
  return !!conv?.messages.some(m => m.sender === 'customer');
}

export default function LiveChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [isRegistered, setIsRegistered] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  /** Grabación de voz en curso, si la hay (ver `alternarGrabacion`). */
  const [grabacion, setGrabacion] = useState<GrabacionEnCurso | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Mensajes que ya se ven en pantalla (optimistic UI) pero todavía no
  // confirma Supabase. Es solo para el "check" tenue del recibo — la
  // conversación en sí ya se actualizó de una, no espera a esto.
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  /** Llamada entrante pendiente de aceptar, y llamada ya aceptada. */
  const [timbreSonando, setTimbreSonando] = useState(false);
  const [enLlamada, setEnLlamada] = useState(false);

  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // Al montar: recupera identidad guardada (token + datos) para restaurar el
  // historial del cliente sin que tenga que volver a registrarse.
  useEffect(() => {
    ensureCustomerChatToken();
    const savedEmail = readLS(EMAIL_KEY);
    const savedName = readLS(NAME_KEY);
    if (savedEmail) {
      setClientEmail(savedEmail);
      setClientName(savedName);
      setIsRegistered(true);
    }
    loadConversations(savedEmail);

    const handleUpdate = () => loadConversations(readLS(EMAIL_KEY));
    window.addEventListener('technoverse_db_updated', handleUpdate);
    return () => window.removeEventListener('technoverse_db_updated', handleUpdate);
  }, []);

  const loadConversations = (email?: string) => {
    const db = getDB();
    const mail = (email ?? readLS(EMAIL_KEY)).toLowerCase();
    // Defensa extra: aunque el backend (RPC + token) ya devuelve solo las
    // conversaciones del cliente, se filtra también por su correo.
    const mine = (db.chat_conversations || []).filter(
      c => !mail || (c.customerEmail || '').toLowerCase() === mail
    );
    setConversations(mine);
    // Si no hay conversación activa seleccionada, abre la más reciente.
    setActiveConvId(prev => {
      if (prev && mine.some(c => c.id === prev)) return prev;
      return mine.length > 0 ? mine[0].id : null;
    });
  };

  useEffect(() => {
    // Autoscroll al último mensaje limitado ESTRICTAMENTE al contenedor de
    // mensajes. Antes usábamos messagesEndRef.scrollIntoView(), que desplaza
    // TODOS los ancestros con scroll — incluida la página detrás del chat
    // flotante — provocando que "todo el chat" saltara/subiera al abrirlo o
    // enfocar el input. Manipular scrollTop del propio contenedor no toca la
    // página ni el layout fijo.
    const container = messagesContainerRef.current;
    if (!container) return;
    // Instantáneo (`auto`), no animado: con mensajes seguidos, un scroll
    // "smooth" que no llega a terminar antes del siguiente mensaje se ve
    // como si el chat se hubiera "trabado" a medio camino.
    container.scrollTo({ top: container.scrollHeight, behavior: 'auto' });
  }, [conversations, activeConvId, isOpen]);

  // RELECTURA DESDE EL SERVIDOR: el historial borrado tiene que irse.
  //
  // El cliente no recibe los eventos de borrado de `chat_conversations`
  // —lee su chat por RPC con su token, así que la RLS no le entrega esos
  // eventos— y el aviso por broadcast es de usar y tirar: si salió mientras
  // este aparato estaba desconectado, se perdió. Por eso el chat viejo se
  // le quedaba en pantalla aunque el administrador ya lo hubiera borrado.
  //
  // Aquí no se espera ningún aviso: se PREGUNTA al servidor al abrir el
  // chat, al volver a la aplicación y cada tanto mientras está abierto.
  // Como la recarga reemplaza la copia local por lo que hay en el
  // servidor, lo borrado desaparece sin que nadie recargue la página.
  useEffect(() => {
    if (!isOpen) return;
    void recargarChatDelServidor(true);

    const alVolver = () => {
      if (document.visibilityState === 'visible') void recargarChatDelServidor();
    };
    document.addEventListener('visibilitychange', alVolver);
    window.addEventListener('focus', alVolver);
    // Red de seguridad para el caso peor: sin eventos, sin foco y sin
    // broadcast, el historial borrado no puede sobrevivir más de medio
    // minuto en la pantalla de nadie.
    const reloj = setInterval(() => void recargarChatDelServidor(), 30000);

    return () => {
      document.removeEventListener('visibilitychange', alVolver);
      window.removeEventListener('focus', alVolver);
      clearInterval(reloj);
    };
  }, [isOpen]);

  // TIMBRE DE VIDEOLLAMADA.
  //
  // Se escucha solo con el chat abierto y una conversación en curso. No es
  // una limitación técnica sino una decisión: nadie debería poder hacer
  // sonar la cámara de un cliente que ni siquiera tiene el chat a la vista.
  // Y sonar no es encender: aquí solo aparece el aviso. La cámara no se
  // toca hasta que la persona pulsa "Aceptar" (ver PanelVideollamada).
  useEffect(() => {
    if (!isOpen || !activeConvId || enLlamada) return;
    return escucharTimbre(activeConvId, () => setTimbreSonando(true));
  }, [isOpen, activeConvId, enLlamada]);

  // Escudo anti-captura MIENTRAS el chat está abierto.
  //
  // El escudo general ya cubre toda la aplicación, pero este motivo se
  // mantiene aparte a propósito: protege la conversación —lo que el
  // administrador puede borrar— y seguiría en pie aunque algún día se
  // decidiera quitarle el escudo a la tienda.
  useEffect(() => {
    escudoDeChat(isOpen);
    return () => escudoDeChat(false);
  }, [isOpen]);

  const persistNewConversation = async (name: string, email: string): Promise<boolean> => {
    const token = ensureCustomerChatToken();
    const db = getDB();
    const conv: ChatConversation = {
      id: newId('CONV'),
      customerName: name,
      customerEmail: email,
      customerToken: token,
      messages: [welcomeMessage(name)],
      status: 'nuevo',
      unreadCount: 0
    };
    db.chat_conversations.push(conv);
    try {
      await saveDB(db);
    } catch {
      setChatError('No se pudo iniciar el chat. Verifica tu conexión e intenta de nuevo.');
      loadConversations(email);
      return false;
    }
    setActiveConvId(conv.id);
    loadConversations(email);
    return true;
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName.trim() || !clientEmail.trim() || isSubmitting) return;
    setChatError(null);
    setIsSubmitting(true);

    const name = clientName.trim();
    const email = clientEmail.trim();
    writeLS(NAME_KEY, name);
    writeLS(EMAIL_KEY, email);

    // ¿Ya existe una conversación abierta para este correo? Reusarla.
    const db = getDB();
    const existing = db.chat_conversations.find(
      c => (c.customerEmail || '').toLowerCase() === email.toLowerCase() && (c.status === 'nuevo' || c.status === 'pendiente')
    );

    if (existing) {
      setActiveConvId(existing.id);
      setIsRegistered(true);
      loadConversations(email);
      setIsSubmitting(false);
      return;
    }

    const ok = await persistNewConversation(name, email);
    if (ok) setIsRegistered(true);
    setIsSubmitting(false);
  };

  const handleNewConsulta = async () => {
    if (isSubmitting) return;
    setChatError(null);
    const name = readLS(NAME_KEY) || clientName || 'Cliente';
    const email = readLS(EMAIL_KEY) || clientEmail;
    if (!email) return;
    setIsSubmitting(true);
    await persistNewConversation(name, email);
    setIsSubmitting(false);
  };

  /**
   * Agrega mensajes a la conversación activa YA, en pantalla, antes de
   * tocar la base de datos (optimistic UI) — es lo que hace que enviar
   * se sienta instantáneo en vez de esperar el viaje de ida y vuelta a
   * Supabase. `loadConversations()` (disparado por saveDB) después
   * reconcilia con la copia real; como los IDs coinciden, React no
   * duplica nada.
   */
  const appendOptimistic = (convId: string, msgs: ChatMessage[], unreadDelta: number) => {
    setPendingIds(prev => {
      const next = new Set(prev);
      msgs.forEach(m => next.add(m.id));
      return next;
    });
    // `pendingIds` es local a este componente y solo sirve para pintar el
    // mensaje como "enviando". Esto otro es global: protege el mensaje de
    // que una recarga completa del chat —llegada justo entre este pintado
    // y el guardado— lo borre de la caché y con ella de la pantalla. Ver
    // `mensajesEnVuelo` en storage.ts.
    msgs.forEach(m => marcarMensajeEnVuelo(convId, m));
    setConversations(prev => prev.map(c => c.id === convId
      ? { ...c, messages: [...c.messages, ...msgs], unreadCount: c.unreadCount + unreadDelta }
      : c));
  };

  const clearPending = (ids: string[]) => {
    setPendingIds(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.delete(id));
      return next;
    });
    ids.forEach(confirmarMensajeEnVuelo);
  };

  const rollbackOptimistic = (convId: string, ids: string[]) => {
    setConversations(prev => prev.map(c => c.id === convId
      ? { ...c, messages: c.messages.filter(m => !ids.includes(m.id)) }
      : c));
    clearPending(ids);
  };

  /**
   * El CLIENTE adjunta una foto o un video.
   *
   * Antes esto no existía —y la política del bucket exigía `is_staff()`,
   * así que ni forzándolo habría funcionado—. Ahora sube por el mismo
   * camino que el panel y el mensaje aparece de una en su pantalla
   * (optimista), igual que un mensaje de texto.
   */
  /**
   * Manda un adjunto ya subido como mensaje del cliente.
   *
   * Lo comparten la foto/video y la nota de voz: el camino optimista es
   * idéntico —aparece de una en pantalla y se confirma contra el
   * servidor—, y lo único que cambia es de dónde salió la URL.
   */
  const enviarAdjuntoComoMensaje = async (convId: string, adjunto: Adjunto, queFalla: string) => {
    const newMsg: ChatMessage = {
      id: newId('MSG'), sender: 'customer', text: '',
      timestamp: new Date().toISOString(), ...adjunto,
    };
    appendOptimistic(convId, [newMsg], 1);

    const db = getDB();
    const idx = db.chat_conversations.findIndex(c => c.id === convId);
    if (idx === -1) { rollbackOptimistic(convId, [newMsg.id]); return; }
    db.chat_conversations[idx].messages.push(newMsg);
    db.chat_conversations[idx].unreadCount += 1;

    try {
      await saveDB(db);
      clearPending([newMsg.id]);
    } catch {
      setChatError(`No se pudo enviar ${queFalla}. Verifica tu conexión e intenta de nuevo.`);
      rollbackOptimistic(convId, [newMsg.id]);
      loadConversations();
    }
  };

  /**
   * NOTA DE VOZ: se toca una vez para empezar y otra para mandar.
   *
   * No es "mantener presionado" a propósito. En un teléfono, mantener el
   * dedo compite con el gesto de desplazar la conversación y con el menú
   * contextual del navegador; en escritorio no existe equivalente. Dos
   * toques funcionan igual en los dos lados y no se cancelan solos si la
   * persona mueve el dedo sin querer.
   */
  const alternarGrabacion = async () => {
    if (!activeConvId || subiendo) return;
    setChatError(null);

    // Segundo toque: cerrar, subir y mandar.
    if (grabacion) {
      const convId = activeConvId;
      const enCurso = grabacion;
      setGrabacion(null);
      setSubiendo(true);
      try {
        const blob = await enCurso.detener();
        const adjunto = await subirNotaDeVoz(convId, blob);
        await enviarAdjuntoComoMensaje(convId, adjunto, 'la nota de voz');
      } catch (err: any) {
        setChatError(err?.message || 'No se pudo enviar la nota de voz.');
      } finally {
        setSubiendo(false);
      }
      return;
    }

    // Primer toque: acá es donde el navegador pide el micrófono.
    try {
      setGrabacion(await grabarNotaDeVoz());
    } catch (err: any) {
      setChatError(err?.message || 'No se pudo usar el micrófono.');
    }
  };

  const handleAdjuntar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !activeConvId || subiendo) return;
    setChatError(null);
    setSubiendo(true);

    const convId = activeConvId;
    try {
      const adjunto = await subirAdjuntoChat(convId, file);
      await enviarAdjuntoComoMensaje(convId, adjunto, 'el archivo');
    } catch (err: any) {
      setChatError(err?.message || 'No se pudo enviar el archivo.');
    } finally {
      setSubiendo(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !activeConvId || isSubmitting) return;
    setChatError(null);

    const messageText = inputText.trim();
    const convId = activeConvId;
    const newMsg: ChatMessage = { id: newId('MSG'), sender: 'customer', text: messageText, timestamp: new Date().toISOString() };

    setInputText('');
    appendOptimistic(convId, [newMsg], 1);
    setIsSubmitting(true);

    const db = getDB();
    const convIndex = db.chat_conversations.findIndex(c => c.id === convId);
    if (convIndex === -1) {
      rollbackOptimistic(convId, [newMsg.id]);
      setIsSubmitting(false);
      return;
    }
    db.chat_conversations[convIndex].messages.push(newMsg);
    db.chat_conversations[convIndex].unreadCount += 1;

    try {
      await saveDB(db);
      clearPending([newMsg.id]);
    } catch {
      setChatError('No se pudo enviar tu mensaje. Verifica tu conexión e intenta de nuevo.');
      setInputText(messageText);
      rollbackOptimistic(convId, [newMsg.id]);
      loadConversations();
      setIsSubmitting(false);
      return;
    }

    // Texto libre va directo a soporte humano: el bot no responde texto libre.
    loadConversations();
    setIsSubmitting(false);
  };

  const handleFAQClick = async (faq: typeof FAQ_DATA[0]) => {
    if (!activeConvId || isSubmitting) return;
    setChatError(null);

    const convId = activeConvId;
    const qMsg: ChatMessage = { id: newId('MSG'), sender: 'customer', text: faq.q, timestamp: new Date().toISOString() };
    const aMsg: ChatMessage = { id: newId('MSG'), sender: 'bot', text: faq.a, timestamp: new Date(Date.now() + 1).toISOString() };

    appendOptimistic(convId, [qMsg, aMsg], 0);
    setIsSubmitting(true);

    const db = getDB();
    const convIndex = db.chat_conversations.findIndex(c => c.id === convId);
    if (convIndex === -1) {
      rollbackOptimistic(convId, [qMsg.id, aMsg.id]);
      setIsSubmitting(false);
      return;
    }
    db.chat_conversations[convIndex].messages.push(qMsg, aMsg);

    try {
      await saveDB(db);
      clearPending([qMsg.id, aMsg.id]);
    } catch {
      setChatError('No se pudo enviar tu consulta. Verifica tu conexión e intenta de nuevo.');
      rollbackOptimistic(convId, [qMsg.id, aMsg.id]);
    }
    loadConversations();
    setIsSubmitting(false);
  };

  const activeConv = conversations.find(c => c.id === activeConvId);
  const mostrarRespuestasRapidas = !yaEscribioElCliente(activeConv);

  // Igual que del lado admin (ChatThread): dibuja solo los últimos N para
  // que un historial largo no crezca el DOM del widget flotante sin límite.
  const TANDA_MENSAJES_CLIENTE = 60;
  const [cantidadVisibleCliente, setCantidadVisibleCliente] = useState(TANDA_MENSAJES_CLIENTE);
  useEffect(() => { setCantidadVisibleCliente(TANDA_MENSAJES_CLIENTE); }, [activeConvId]);
  const mensajesClienteFiltrados = (activeConv?.messages || []).filter(msg => !msg.isInternalNote);
  const indiceInicioCliente = Math.max(0, mensajesClienteFiltrados.length - cantidadVisibleCliente);
  const mensajesClienteVisibles = mensajesClienteFiltrados.slice(indiceInicioCliente);
  const hayMensajesAnterioresCliente = indiceInicioCliente > 0;

  return (
    <>
      {enLlamada && activeConvId && (
        <PanelVideollamada
          sala={activeConvId}
          rol="contesta"
          onCerrar={() => setEnLlamada(false)}
        />
      )}

      {/* Aviso de llamada entrante. Va por encima del chat porque exige una
          respuesta: aceptar enciende la cámara, rechazar avisa al otro lado
          en vez de dejarlo esperando a que venza el tiempo. */}
      {timbreSonando && !enLlamada && (
        <div className="fixed inset-x-4 bottom-24 sm:left-auto sm:right-6 sm:w-80 z-[55] rounded-2xl border border-[var(--border-color)] bg-[var(--bg-elevated)] shadow-[var(--float-shadow-lg)] p-4">
          <div className="flex items-center gap-2.5 mb-1">
            <span className="w-9 h-9 rounded-full bg-[rgba(var(--accent-rgb),0.14)] text-[var(--accent)] flex items-center justify-center shrink-0">
              <Video className="w-4.5 h-4.5" />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-display font-bold text-[var(--text-primary)] leading-tight">
                Videollamada de soporte
              </p>
              <p className="text-[11px] text-[var(--text-secondary)]">Solo video, sin audio</p>
            </div>
          </div>
          <p className="text-[11.5px] leading-relaxed text-[var(--text-secondary)] mb-3">
            Technoverse quiere ver el equipo por la cámara. Tu micrófono no se usa.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setTimbreSonando(false); void rechazarVideollamada(activeConvId || ''); }}
              className="flex-1 rounded-xl border border-[var(--border-color)] px-3 py-2 text-[12px] font-semibold text-[var(--text-secondary)]"
            >
              Ahora no
            </button>
            <button
              type="button"
              onClick={() => { setTimbreSonando(false); setEnLlamada(true); }}
              className="flex-1 rounded-xl bg-[var(--accent)] text-[var(--accent-ink)] px-3 py-2 text-[12px] font-bold"
            >
              Aceptar
            </button>
          </div>
        </div>
      )}

      {/* Floating Button — se oculta mientras el chat está abierto para que la
          ventana pueda usar todo el alto disponible sin encimarse con el FAB. */}
      {!isOpen && (
        <button
          onClick={() => {
            setIsOpen(true);
            // Pantalla completa REAL: se ofrece EN ESTE CLIC, el único
            // gesto que un visitante da por sesión antes de escribir. Solo
            // en computadora (puedeCompartirPantalla) y solo si ya
            // consintió — en el teléfono esto no hace nada, la función ni
            // existe ahí (ver capturaPantalla.ts).
            const idAparato = obtenerDeviceId();
            if (idAparato && puedeCompartirPantalla() && permisoConcedido('pantallaCompleta')) {
              void ofrecerPantallaCompleta(`v:${idAparato}`, () => {});
            }
          }}
          className="fixed bottom-24 right-6 z-[45] w-12 h-12 max-w-12 max-h-12 rounded-full flex items-center justify-center transition hover:scale-105 active:scale-95 shadow-[var(--float-shadow-lg)] text-[var(--accent-ink)] bg-gradient-to-br from-[var(--brand-gold-dark)] to-[var(--brand-gold-mid)] border-2 border-[var(--bg-surface)]"
          id="btn-floating-chat"
        >
          <MessageSquare className="w-5 h-5" />
          {conversations.some(c => c.unreadCount > 0) && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-rose-500 rounded-full flex items-center justify-center text-[10px] font-bold text-white border-2 border-[var(--bg-surface)]">!</span>
          )}
        </button>
      )}

      {/* Chat popup window
          Posicionamiento robusto para todos los formatos (móvil vertical,
          tablet horizontal, APK):
          - Offset inferior pequeño (bottom-6) → aprovecha el alto disponible en
            pantallas bajas/horizontales, evitando que se vea "comprimida".
          - Alto flexible: crece hasta 600px pero nunca más de (100dvh − 7rem),
            de modo que el borde SUPERIOR siempre queda por debajo de la barra
            de navegación fija (top-0, h-16 = 4rem) con margen, sin taparla.
          - 100dvh (viewport dinámico) para respetar la barra del navegador
            móvil y el teclado en APK. */}
      {isOpen && (
        <div className="fixed bottom-6 right-4 sm:right-6 z-[45] w-[calc(100vw-2rem)] sm:w-96 h-[600px] max-h-[calc(100dvh-7rem)] bg-[var(--bg-base)] border border-[var(--border-color)] rounded-2xl shadow-[var(--float-shadow-lg)] flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300" id="floating-chat-window">
          {/* Header */}
          <div className="p-3.5 bg-gradient-to-r from-[var(--brand-gold-dark)] to-[var(--brand-gold-mid)] text-[var(--accent-ink)] flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              {/* Aquí vivía "Mis Consultas". El archivo de conversaciones
                  pasadas es ahora una herramienta del panel, no del
                  cliente: ver el comentario del ARCHIVO más abajo. */}
              <div className="w-9 h-9 rounded-full bg-white/25 border border-white/50 flex items-center justify-center shrink-0">
                <Bot className="w-[18px] h-[18px]" />
              </div>
              <div className="min-w-0">
                <h4 className="font-display font-bold text-[13.5px] truncate leading-tight">Soporte Technoverse CR</h4>
                <p className="text-[10.5px] flex items-center gap-1.5 truncate opacity-90 mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" style={{ boxShadow: '0 0 0 2px rgba(255,255,255,.35)' }} />
                  En línea &middot; responde al instante
                </p>
              </div>
            </div>
            <button onClick={() => setIsOpen(false)} className="hover:opacity-75 transition p-1 shrink-0" aria-label="Cerrar chat">
              <X className="w-5 h-5" />
            </button>
          </div>

          {chatError && (
            <div className="px-4 py-2 bg-rose-500/10 border-b border-rose-500/30 text-rose-500 text-[11px] flex items-center justify-between gap-2 shrink-0">
              <span>{chatError}</span>
              <button type="button" onClick={() => setChatError(null)} className="shrink-0 hover:opacity-70">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Main area (relative para contener el drawer superpuesto) */}
          <div className="relative flex-1 min-h-0 flex flex-col">
            {!isRegistered ? (
              /* Registration Screen */
              <form onSubmit={handleRegister} className="flex-1 p-6 flex flex-col justify-between overflow-y-auto">
                <div className="space-y-4">
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                    Para brindarte asistencia fiscal, de garantías y consultas en tiempo real conforme a la Ley costarricense, indícanos tus datos:
                  </p>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wide text-[var(--brand-gold-dark)] mb-1">Nombre Completo</label>
                    <input
                      type="text"
                      required
                      value={clientName}
                      onChange={(e) => setClientName(e.target.value)}
                      placeholder="Ej. Juan Pérez Madrigal"
                      className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl px-4 py-2.5 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/15 transition"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wide text-[var(--brand-gold-dark)] mb-1">Correo Electrónico</label>
                    <input
                      type="email"
                      required
                      value={clientEmail}
                      onChange={(e) => setClientEmail(e.target.value)}
                      placeholder="juan@gmail.com"
                      className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl px-4 py-2.5 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/15 transition"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] transition text-[var(--accent-ink)] text-xs font-bold py-3 rounded-xl shadow-sm mt-4 uppercase tracking-wider disabled:opacity-50"
                >
                  {isSubmitting ? 'Conectando...' : 'Iniciar Chat Seguro'}
                </button>
              </form>
            ) : activeConv ? (
              /* Chatting Screen */
              <>
                <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-[var(--bg-base)]">
                  {hayMensajesAnterioresCliente && (
                    <div className="flex justify-center pb-1">
                      <button
                        type="button"
                        onClick={() => setCantidadVisibleCliente(v => v + TANDA_MENSAJES_CLIENTE)}
                        className="text-[10.5px] font-bold px-3 py-1.5 rounded-full bg-[var(--bg-surface)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition"
                      >
                        Ver mensajes anteriores
                      </button>
                    </div>
                  )}
                  {mensajesClienteVisibles.map((msg, i) => {
                    const isCustomer = msg.sender === 'customer';
                    const isBot = msg.sender === 'bot';
                    const pending = pendingIds.has(msg.id);
                    const separador = abreDiaNuevo(msg.timestamp, mensajesClienteVisibles[i - 1]?.timestamp);
                    return (
                      <React.Fragment key={msg.id}>
                        {separador && (
                          <div className="flex justify-center py-1">
                            <span className="text-[10px] font-bold uppercase tracking-[0.08em] px-3 py-1 rounded-full bg-[var(--bg-sunken)] text-[var(--text-muted)]">
                              {etiquetaDeDia(msg.timestamp)}
                            </span>
                          </div>
                        )}
                        <div className={`flex gap-2 max-w-[82%] animate-in fade-in slide-in-from-bottom-1 duration-200 ${isCustomer ? 'ml-auto flex-row-reverse' : ''}`}>
                          {!isCustomer && (
                            <div className="w-6 h-6 rounded-full bg-[rgba(var(--accent-rgb),0.14)] text-[var(--accent)] flex items-center justify-center shrink-0 self-end font-display font-bold text-[10px]">
                              {isBot ? <Bot className="w-3 h-3" /> : 'T'}
                            </div>
                          )}
                          <div className="min-w-0">
                            {/* Hora y acuse DENTRO de la burbuja, alineados a
                                la derecha. Antes iban en una fila aparte
                                debajo, que en un hilo largo suma una línea de
                                ruido por cada mensaje. */}
                            {/* Mismos tokens de burbuja que el hilo del panel:
                                es la MISMA conversación vista desde el otro
                                lado, así que el verde y el gris tienen que ser
                                exactamente los mismos en las dos pantallas. */}
                            <div
                              className={`px-3.5 py-2 text-[13px] rounded-2xl ${
                                isCustomer
                                  ? 'rounded-br-[4px] bg-[var(--bubble-out)] text-[var(--bubble-out-ink)] shadow-[0_2px_10px_-4px_rgba(var(--accent-rgb),0.5)]'
                                  : isBot
                                  ? 'rounded-bl-[4px] bg-[var(--bubble-in)] text-[var(--bubble-in-ink)] border border-[var(--border-color)]'
                                  : 'rounded-bl-[4px] bg-[var(--bubble-in)] text-[var(--bubble-in-ink)] shadow-[0_1px_2px_rgba(15,21,18,0.06),0_6px_16px_-12px_rgba(15,21,18,0.3)]'
                              }`}
                            >
                              {msg.imageUrl && (
                                <img src={msg.imageUrl} alt="Imagen adjunta" className="rounded-xl max-w-full mb-1.5 max-h-56 object-cover" loading="lazy" />
                              )}
                              {msg.videoUrl && (
                                <VideoMensaje src={msg.videoUrl} alto="max-h-56" />
                              )}
                              {msg.audioUrl && (
                                <AudioMensaje src={msg.audioUrl} />
                              )}
                              {/* `flow-root` contiene el flotante de la hora;
                                  sin eso la burbuja no lo cuenta al medir su
                                  alto y la hora se sale por abajo. */}
                              <div className="flow-root tv-break whitespace-pre-wrap leading-[1.5]">
                                {msg.text}
                                {/* La hora FLOTA al final del texto: si cabe,
                                    se acomoda en el mismo renglón; si no, baja
                                    sola. Antes ocupaba siempre una línea
                                    entera, y en un mensaje corto como
                                    "Gracias" eso estiraba la burbuja al ancho
                                    de la hora y la dejaba descuadrada. */}
                                <span className={`float-right inline-flex items-center gap-1 ml-2.5 mt-[7px] text-[10px] tabular-nums whitespace-nowrap select-none ${isCustomer ? 'opacity-85' : 'opacity-55'}`}>
                                  {soloHora(msg.timestamp)}
                                  {/* Un solo tic mientras el guardado va en
                                      camino, doble cuando el servidor ya lo
                                      confirmó. Es el estado REAL del envío, no
                                      un adorno fijo. */}
                                  {isCustomer && (
                                    pending
                                      ? <Check className="w-3 h-3 opacity-70" />
                                      : <CheckCheck className="w-3 h-3" />
                                  )}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </React.Fragment>
                    );
                  })}
                </div>

                {activeConv.status === 'resuelto' ? (
                  /* Consulta cerrada: solo lectura. Para seguir, nueva consulta. */
                  <div className="p-3 bg-[var(--bg-surface)] border-t border-[var(--border-color)] shrink-0 flex flex-col items-center gap-2 text-center">
                    <p className="text-[11px] text-[var(--text-secondary)]">Esta consulta fue cerrada por el equipo de soporte. Puedes revisarla, pero para seguir escribe una nueva.</p>
                    <button
                      onClick={handleNewConsulta}
                      disabled={isSubmitting}
                      className="flex items-center gap-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] transition text-[var(--accent-ink)] text-[11px] font-bold py-2 px-3 rounded-xl uppercase tracking-wider disabled:opacity-50"
                    >
                      <Plus className="w-3.5 h-3.5" /> Nueva Consulta
                    </button>
                  </div>
                ) : (
                  <>
                    {mostrarRespuestasRapidas && (
                      <div className="border-t border-[var(--border-color)] bg-[var(--bg-surface)] shrink-0 overflow-hidden transition-[max-height,opacity,padding] duration-300 ease-out max-h-40 opacity-100 p-3">
                        <span className="text-[9.5px] font-mono uppercase tracking-wide text-[var(--text-muted)] block mb-1.5">Preguntas frecuentes</span>
                        <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto">
                          {FAQ_DATA.map((faq, i) => (
                            <button
                              key={i}
                              onClick={() => handleFAQClick(faq)}
                              disabled={isSubmitting}
                              className="text-[10.5px] font-semibold bg-[var(--bg-sunken)] border border-[var(--border-color)] hover:border-[var(--accent)] hover:text-[var(--accent)] rounded-full px-2.5 py-1.5 text-[var(--text-secondary)] transition duration-150 disabled:opacity-50"
                            >
                              {faq.q}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <form onSubmit={handleSendMessage} className="p-3 bg-[var(--bg-surface)] border-t border-[var(--border-color)] flex gap-2 shrink-0">
                      <input ref={fileRef} type="file" accept={ACEPTA_ADJUNTOS} className="hidden" onChange={handleAdjuntar} />
                      <button
                        type="button"
                        onClick={() => fileRef.current?.click()}
                        disabled={subiendo}
                        aria-label="Adjuntar foto o video"
                        title="Adjuntar foto o video"
                        className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 bg-[var(--bg-sunken)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition disabled:opacity-50"
                      >
                        {subiendo ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
                      </button>
                      {puedeGrabarVoz() && (
                        <button
                          type="button"
                          onClick={() => void alternarGrabacion()}
                          disabled={subiendo}
                          aria-label={grabacion ? 'Enviar nota de voz' : 'Grabar nota de voz'}
                          title={grabacion ? 'Tocá para enviar la nota de voz' : 'Grabar una nota de voz'}
                          className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 border transition disabled:opacity-50 ${
                            grabacion
                              ? 'bg-red-500 border-red-500 text-white animate-pulse'
                              : 'bg-[var(--bg-sunken)] border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--accent)] hover:border-[var(--accent)]'
                          }`}
                        >
                          <Mic className="w-4 h-4" />
                        </button>
                      )}
                      <input
                        type="text"
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        placeholder="Escribe tu mensaje aquí..."
                        className="flex-1 bg-[var(--bg-sunken)] border border-[var(--border-color)] rounded-full px-4 py-2.5 text-[13px] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/15 transition"
                      />
                      <button
                        type="submit"
                        disabled={isSubmitting}
                        className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 bg-[var(--accent)] hover:bg-[var(--accent-hover)] hover:scale-105 active:scale-95 transition text-[var(--accent-ink)] disabled:opacity-50 shadow-[0_4px_10px_-4px_rgba(var(--accent-rgb),0.6)]"
                        aria-label="Enviar"
                      >
                        <Send className="w-3.5 h-3.5" />
                      </button>
                    </form>
                  </>
                )}
              </>
            ) : (
              /* Registrado pero sin consulta activa */
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6 gap-3 bg-[var(--bg-base)]">
                <MessageSquare className="w-10 h-10 text-[var(--text-muted)] opacity-40" />
                <p className="text-xs text-[var(--text-secondary)]">No tienes consultas activas.</p>
                <button
                  onClick={handleNewConsulta}
                  disabled={isSubmitting}
                  className="flex items-center gap-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] transition text-[var(--accent-ink)] text-xs font-bold py-2.5 px-4 rounded-xl uppercase tracking-wider disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" /> Nueva Consulta
                </button>
              </div>
            )}

            {/* EL ARCHIVO DE CONVERSACIONES ES DEL PANEL, NO DEL CLIENTE.
                ------------------------------------------------------------
                Aquí había un cajón "Mis Consultas" que le listaba al cliente
                todas sus conversaciones pasadas, incluidas las cerradas. Se
                quitó por dos razones que apuntan al mismo lado:

                1. Contradecía el borrado. El administrador cierra o borra una
                   conversación para que deje de existir; tener al cliente
                   paseándose por su propio archivo es la puerta de atrás por
                   la que eso vuelve.
                2. El archivo es una herramienta de gestión —seguimiento de
                   un caso, historial de un cliente— y esa es la vista del
                   panel, donde el personal ya lo tiene completo.

                El cliente ve SU conversación en curso, entera y en tiempo
                real. El servidor tampoco le manda las demás: `get_customer_chat`
                devuelve únicamente la más reciente de su token, así que las
                viejas ni siquiera llegan al aparato. */}
          </div>
        </div>
      )}
    </>
  );
}
