// =====================================================================
// ALERTAS DE SESIÓN — notificaciones locales + estado de conexión
// =====================================================================
// Alcance real, sin inflar la promesa: esto es la API `Notification` del
// navegador, encendida SOLO si la persona prendió el interruptor
// "Alertas de Sesión" del aviso de consentimiento (ver
// seguridad/consentimiento.ts). No hay backend de push detrás — sin
// service worker, sin VAPID, sin tabla de suscripciones — así que si la
// pestaña o la app está cerrada del todo, no llega nada; solo avisa
// mientras la pestaña sigue abierta pero en segundo plano.
//
// Dentro de la APK de Android, además, esta misma llamada puede no
// salir como notificación real del sistema: la WebView no siempre
// respeta `Notification` sin el plugin nativo
// `@capacitor/local-notifications`, que hoy NO está instalado. Queda
// como límite conocido, no como algo a resolver aquí.
//
// QUÉ AVISA HOY
// ---------------------------------------------------------------------
//   · Un mensaje nuevo de chat que no es propio, mientras la pestaña
//     está oculta (ver notificarMensajeChat, llamado desde storage.ts).
//   · Cuando se pierde o se recupera la conexión a internet.
// =====================================================================

let inicializado = false;

function notificar(titulo: string, cuerpo: string): void {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    new Notification(titulo, { body: cuerpo });
  } catch { /* una notificación fallida no debe romper nada */ }
}

/** Se llama una vez, solo si `permisoConcedido('alertas')` es true. */
export function inicializarAlertas(): void {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return;
  if (inicializado) return;
  inicializado = true;

  try {
    if (Notification.permission === 'default') void Notification.requestPermission();
  } catch { /* algunos navegadores lo niegan de entrada; no pasa nada */ }

  try {
    window.addEventListener('offline', () =>
      notificar('Sin conexión', 'Se perdió la conexión a internet. Seguís viendo lo último guardado.'));
    window.addEventListener('online', () =>
      notificar('Conexión recuperada', 'Ya volviste a estar en línea.'));
  } catch { /* nada */ }
}

/** Mensaje de chat nuevo (no propio), mientras la pestaña está oculta. */
export function notificarMensajeChat(texto: string): void {
  try {
    if (typeof document === 'undefined' || !document.hidden) return;
    notificar('Nuevo mensaje', (texto || '').trim().slice(0, 120) || 'Tenés un mensaje nuevo.');
  } catch { /* nada */ }
}
