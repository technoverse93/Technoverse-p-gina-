import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Auto-recuperación de "chunk viejo": cada deploy a Cloudflare genera assets
// con hash nuevo (ej. jspdf.es.min-XXXXX.js) y solo sirve los del último
// deploy. Si esta pestaña quedó abierta desde ANTES de un deploy nuevo (o el
// navegador cacheó un index.html viejo) y el usuario recién ahí dispara un
// import() dinámico (p. ej. al confirmar una compra, que carga jsPDF), pide
// un archivo que ya no existe. Como wrangler.jsonc usa
// not_found_handling: "single-page-application", esa petición no da 404:
// devuelve el index.html (200, HTML), y el navegador falla al intentar
// ejecutarlo como módulo JS — el error "Failed to fetch dynamically
// imported module" reportado. Vite emite el evento vite:preloadError en
// exactamente este caso; la única recuperación real es recargar para traer
// el index.html y los hashes de assets actuales. El guard en sessionStorage
// evita un bucle de recargas si el fallo persiste por otra causa.
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
    <App />
  </StrictMode>,
);
