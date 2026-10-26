// =====================================================================
// SERVICE WORKER DE AVISOS — muestra el aviso de un chat con el navegador cerrado
// =====================================================================
// Solo hace esto: recibir el aviso cifrado que manda el servidor
// (supabase/functions/asistente-ia/avisosWeb.ts), mostrarlo y, al tocarlo,
// abrir esa conversación del panel. No guarda nada en caché ni intercepta
// pedidos: la página carga exactamente igual que sin él.
// =====================================================================

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

const recortar = (t, n) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { texto: e.data ? e.data.text() : '' }; }
  const chat = d.tipo === 'chat';
  const titulo = chat ? `${recortar(d.cliente || 'Un cliente', 60)} — Technoverse` : recortar(d.titulo || 'Technoverse', 80);
  const url = chat ? `/admin/chat${d.conv ? `?conv=${encodeURIComponent(d.conv)}` : ''}` : d.destino ? `/admin/${encodeURIComponent(d.destino)}` : '/admin';
  e.waitUntil((async () => {
    // Con el panel a la vista no hace falta: la propia app ya lo muestra. (La prueba de Ajustes sí sale.)
    const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (d.conv !== 'PRUEBA' && ventanas.some(v => v.visibilityState === 'visible' && v.focused)) return;
    await self.registration.showNotification(titulo, {
      body: recortar(d.texto || 'Mensaje nuevo', 300),
      // La MISMA etiqueta que el aviso que muestra la app abierta en segundo plano: uno reemplaza al otro.
      tag: chat && d.conv ? `tv-chat-${d.conv}` : `tv-aviso-${d.subtipo || 'general'}`,
      icon: '/logo.png',
      badge: '/logo.png',
      timestamp: Number(d.ts) || Date.now(),
      data: { url, conv: chat ? d.conv || null : null },
    });
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const { url = '/admin/chat', conv = null } = e.notification.data || {};
  e.waitUntil((async () => {
    const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const propia = ventanas.find(v => new URL(v.url).origin === self.location.origin);
    if (propia) {
      // La app ya está abierta: se le pide la conversación y se trae al frente.
      propia.postMessage({ tipo: 'abrir-conv', conv });
      return propia.focus();
    }
    return self.clients.openWindow(url);
  })());
});
