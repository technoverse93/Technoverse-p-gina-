// =====================================================================
// ENTRADA DE LA VENTANITA DEL MINI-WIDGET (jarvis-rapido.html)
// =====================================================================
// La abre native-android/jarvis/JarvisRapido.java encima de la pantalla de
// inicio. Todo se carga con import() a propósito: si esta entrada importara
// módulos de forma estática, el empaquetador podía meter código compartido
// con Jarvis DENTRO de este archivo, y al abrir Jarvis en el panel (app o
// navegador) se ejecutaba también este arranque y tapaba el panel con la
// ventanita (pasó en producción, 2026-10-05). Aquí no hay nada compartible.
// =====================================================================

import './index.css';
import './styles/admin.css';
import './styles/panel.css';
import './styles/jarvis.css';
import './styles/ventanita.css';

// Solo en su propia página (nunca dentro de la app ni del sitio).
if (/\/jarvis-rapido\.html$/.test(location.pathname)) {
  void import('./ventanitaArranque');
}
