// =====================================================================
// ENTRADA DE LA VENTANITA DEL MINI-WIDGET (jarvis-rapido.html)
// =====================================================================
// La abre native-android/jarvis/JarvisRapido.java encima de la pantalla de
// inicio. Carga solo lo de Jarvis, no la app entera: así abre rápido en un
// teléfono de gama de entrada. Ver src/components/admin/VentanitaJarvis.tsx.
// =====================================================================

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './styles/admin.css';
import './styles/ventanita.css';
import { iniciarTema } from './utils/tema';
import { avisarArranqueOta } from './mobile/otaUpdater';
import VentanitaJarvis from './components/admin/VentanitaJarvis';

// Lo primero: esta versión arrancó bien (si la ventanita es lo primero que
// se abre tras una actualización, sin este aviso se volvería a la anterior).
void avisarArranqueOta();
iniciarTema();

// Igual que en la app (src/main.tsx): un pedazo de código que ya no existe
// tras publicar una versión nueva se resuelve recargando UNA vez.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  const key = 'technoverse_chunk_reload_at';
  const lastReload = Number(sessionStorage.getItem(key) || '0');
  if (Date.now() - lastReload > 10000) {
    sessionStorage.setItem(key, String(Date.now()));
    window.location.reload();
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <VentanitaJarvis />
  </StrictMode>,
);
