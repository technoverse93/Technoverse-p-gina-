import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import ErrorBoundaryRaiz from './components/ErrorBoundaryRaiz';
import { instalarRegistroDeErrores } from './utils/erroresPantalla';
import './index.css';
// Paletas de marca (Océano, Atardecer, Orquídea): solo cambian los colores de los tokens de index.css.
import './styles/paletas.css';
// Clases `tv-` que comparten la tienda y el panel. Va DESPUÉS de
// index.css para que sus reglas puedan afinar las de la marca. Lo que es
// SOLO del panel (panel.css y jarvis.css) se carga con AdminPanel: la
// tienda no lo descarga.
import './styles/admin.css';
import { iniciarTema } from './utils/tema';
import { iniciarPaleta } from './utils/paleta';
import { instalarAjusteGlobal } from './utils/ajustarTexto';

// ANTES de montar React, no dentro de un efecto: un efecto corre después
// del primer pintado, así que abrir la app con el tema oscuro activo
// producía un destello blanco de un cuadro. Aplicándolo aquí, el primer
// pintado ya sale con el tema correcto.
iniciarTema();

// La paleta de la marca (la elige el dueño en Configuración): el Worker ya la dejó en el HTML; esto la
// sincroniza con el contenido del sitio y la mantiene al día en vivo (ver utils/paleta.ts).
iniciarPaleta();

// Deja rastro de los errores sueltos (para verlos después en la bitácora).
instalarRegistroDeErrores();

// Los rótulos de toda la app (tienda, panel, modales) se achican hasta caber en vez de bajar de
// renglón o salirse de su caja con la letra grande del sistema (ver utils/ajustarTexto.ts).
instalarAjusteGlobal();

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
  const key = 'technoverse_chunk_reload_at';
  let lastReload = 0;
  try { lastReload = Number(sessionStorage.getItem(key) || '0'); } catch { /* sin almacenamiento */ }
  if (Date.now() - lastReload > 10000) {
    event.preventDefault();
    try { sessionStorage.setItem(key, String(Date.now())); } catch { /* sin almacenamiento */ }
    window.location.reload();
  }
  // Si ya se recargó hace poco NO se calla el error (antes se hacía siempre con
  // `preventDefault`): el `import()` terminaba valiendo «undefined», React se
  // quejaba de un componente inválido y toda la app quedaba en pantalla
  // oscura. Así el error llega al borde de errores, que muestra qué hacer.
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundaryRaiz>
      <App />
    </ErrorBoundaryRaiz>
  </StrictMode>,
);
