// =====================================================================
// NOTIFICACIONES DE CHAT — cuando llega un mensaje y no estás mirando
// =====================================================================
// Avisa al cliente de un mensaje nuevo cuando la app (APK) está en segundo
// plano o la pestaña (web) está oculta. Si está mirando el chat en primer
// plano, NO dispara nada del sistema —de eso se encarga la propia UI del
// chat— para no duplicar el aviso.
//
//   · Web  → HTML5 Notification API, con permiso del navegador.
//   · APK  → @capacitor/local-notifications (nativa). Necesita una
//            recompilación de la APK para tomar efecto; en la web ese
//            código ni se carga (import diferido tras isNativePlatform).
//
// El permiso se pide de forma amigable al ABRIR el chat, no al entrar a la
// tienda: así se pregunta en el momento en que tiene sentido.
// =====================================================================

import { Capacitor } from '@capacitor/core';
import { pushActivo } from './pushNativo';

/** Evento local: "abrí el chat" (lo escucha LiveChat al tocar la notificación). */
export const EVENTO_ABRIR_CHAT = 'technoverse_abrir_chat';

/** Estado de primer plano en la APK, que se mantiene por `appStateChange`. */
let appActiva = true;
let iniciado = false;

/**
 * Arranca los listeners nativos (una sola vez): el estado de la app y el
 * toque sobre la notificación. En web no hace nada nativo.
 */
export function iniciarNotificaciones(): void {
  if (iniciado) return;
  iniciado = true;
  if (!Capacitor.isNativePlatform()) return;

  void (async () => {
    try {
      const { App } = await import('@capacitor/app');
      App.addListener('appStateChange', ({ isActive }) => { appActiva = isActive; });
    } catch { /* sin plugin: se asume activa */ }
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      // Al tocar la notificación nativa, se pide abrir el chat.
      LocalNotifications.addListener('localNotificationActionPerformed', (a) => {
        // Un recordatorio de la agenda de Javier abre Javier, no el chat.
        if (a?.notification?.extra?.jarvis) { void import('./jarvisAtajo').then(m => m.manejar('technoverse://jarvis')); return; }
        // Un mensaje de un cliente (aviso del personal): «Responder» manda lo escrito sin pasar por el panel;
        // tocar la notificación abre esa conversación.
        const conv = a?.notification?.extra?.conv;
        if (typeof conv === 'string' && conv) {
          const texto = (a.inputValue || '').trim();
          if (a.actionId === 'responder' && texto) { void import('./vigiaChat').then(m => m.responderDesdeAviso(conv, texto, a.notification.id)); return; }
          abrirConversacion(conv);
          return;
        }
        try { window.dispatchEvent(new CustomEvent(EVENTO_ABRIR_CHAT)); } catch { /* nada */ }
      });
    } catch { /* sin plugin todavía: se activa al recompilar la APK */ }
  })();
}

/** ¿La persona está mirando la app/pestaña ahora mismo? */
export function estaEnPrimerPlano(): boolean {
  if (Capacitor.isNativePlatform()) return appActiva;
  return typeof document !== 'undefined' && document.visibilityState === 'visible';
}

/**
 * Pide el permiso de notificaciones de forma amigable. Se llama al abrir el
 * chat. No molesta si ya se respondió antes (el sistema lo recuerda).
 */
export async function pedirPermisoNotificaciones(): Promise<void> {
  try {
    if (Capacitor.isNativePlatform()) {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      await LocalNotifications.requestPermissions();
    } else if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
  } catch { /* si el permiso falla, la app sigue igual */ }
}

/** Lleva al panel, a esa conversación (la misma vía que el toque de un aviso push). */
export function abrirConversacion(conv: string): void {
  void import('./jarvisAtajo').then(m => m.manejar(`technoverse://jarvis?modulo=chat&conv=${encodeURIComponent(conv)}`));
}

// ---------------------------------------------------------------------
// CANAL «MENSAJES DEL CHAT» (APK): como WhatsApp
// ---------------------------------------------------------------------
// El canal por defecto de Android tiene importancia normal: el aviso entra
// callado a la barra, sin asomarse arriba de la pantalla. Este canal es de
// importancia ALTA (se asoma arriba, con sonido y vibración) y la
// notificación trae «Responder» para contestar sin abrir el chat. El canal no
// se puede subir de importancia una vez creado: por eso es uno nuevo.
// En la pantalla bloqueada se ve que hay un mensaje, sin mostrar lo que dice.
// ---------------------------------------------------------------------
const CANAL_CHAT = 'chat_mensajes';
const ACCION_CHAT = 'CHAT_RESPONDER';
let canalListo: Promise<boolean> | null = null;
function prepararCanalChat(): Promise<boolean> {
  if (!canalListo) {
    canalListo = (async () => {
      try {
        const { LocalNotifications } = await import('@capacitor/local-notifications');
        await LocalNotifications.createChannel({
          id: CANAL_CHAT, name: 'Mensajes del chat', description: 'Cuando un cliente te escribe en la tienda',
          importance: 4, visibility: 0, vibration: true, lights: true,
        });
        await LocalNotifications.registerActionTypes({ types: [{
          id: ACCION_CHAT,
          actions: [{ id: 'responder', title: 'Responder', input: true, inputButtonTitle: 'Enviar', inputPlaceholder: 'Escribí tu respuesta' }],
        }] });
        return true;
      } catch { canalListo = null; return false; }
    })();
  }
  return canalListo;
}

/** Un número estable por conversación: sus mensajes se juntan en UNA notificación (como WhatsApp). */
const idDeConversacion = (conv: string) => { let h = 7; for (const ch of conv) h = (h * 31 + ch.charCodeAt(0)) % 2_000_000_000; return h + 1000; };

/**
 * Dispara la notificación de un mensaje nuevo, SOLO si la persona no está
 * en primer plano (regla anti-duplicado). El clic/toque abre el chat; con
 * `conv` (avisos del personal), esa conversación en el panel.
 */
export async function notificarMensajeChat(titulo: string, cuerpo: string, conv?: string): Promise<void> {
  if (estaEnPrimerPlano()) return;
  // Con los avisos push del servidor ya funcionando, el teléfono avisa solo:
  // este aviso local sería un duplicado. (En el navegador no hace falta: el
  // aviso web de la misma conversación lleva la MISMA etiqueta y la
  // reemplaza en silencio en vez de sumar otra.)
  if (pushActivo()) return;

  try {
    if (Capacitor.isNativePlatform()) {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const permiso = await LocalNotifications.checkPermissions();
      if (permiso.display !== 'granted') return;
      const conCanal = conv ? await prepararCanalChat() : false;
      await LocalNotifications.schedule({
        notifications: [{
          id: conv ? idDeConversacion(conv) : Date.now() % 2147483000,
          title: titulo,
          body: cuerpo,
          ...(conv ? { extra: { conv }, largeBody: cuerpo, autoCancel: true } : {}),
          ...(conCanal ? { channelId: CANAL_CHAT, actionTypeId: ACCION_CHAT } : {}),
        }],
      });
    } else {
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      const n = new Notification(titulo, { body: cuerpo, tag: conv ? `tv-chat-${conv}` : 'technoverse-chat' });
      n.onclick = () => {
        try { window.focus(); } catch { /* nada */ }
        if (conv) abrirConversacion(conv);
        else try { window.dispatchEvent(new CustomEvent(EVENTO_ABRIR_CHAT)); } catch { /* nada */ }
        n.close();
      };
    }
  } catch { /* nunca debe romper el flujo del chat */ }
}
