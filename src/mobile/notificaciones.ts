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
      LocalNotifications.addListener('localNotificationActionPerformed', () => {
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

/**
 * Dispara la notificación de un mensaje nuevo, SOLO si la persona no está
 * en primer plano (regla anti-duplicado). El clic/toque abre el chat.
 */
export async function notificarMensajeChat(titulo: string, cuerpo: string): Promise<void> {
  if (estaEnPrimerPlano()) return;

  try {
    if (Capacitor.isNativePlatform()) {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const permiso = await LocalNotifications.checkPermissions();
      if (permiso.display !== 'granted') return;
      await LocalNotifications.schedule({
        notifications: [{
          id: Date.now() % 2147483000,
          title: titulo,
          body: cuerpo,
        }],
      });
    } else {
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      const n = new Notification(titulo, { body: cuerpo, tag: 'technoverse-chat' });
      n.onclick = () => {
        try { window.focus(); } catch { /* nada */ }
        try { window.dispatchEvent(new CustomEvent(EVENTO_ABRIR_CHAT)); } catch { /* nada */ }
        n.close();
      };
    }
  } catch { /* nunca debe romper el flujo del chat */ }
}
