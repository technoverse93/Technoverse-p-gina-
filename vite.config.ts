import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {createHash} from 'node:crypto';
import {defineConfig, type Plugin} from 'vite';

/**
 * El script del tema va EN LÍNEA en index.html (`#tv-tema`): tiene que correr
 * antes del primer dibujo y sin pedir un archivo aparte. La política de
 * seguridad de la página solo deja correr scripts propios o con huella
 * conocida, así que aquí se calcula la huella (sha256) de ese script y se pone
 * en la política en lugar de `'sha256-TEMA'`. Así editar el script no obliga a
 * recalcular nada a mano; y si algo fallara, el navegador solo lo bloquea
 * (vuelve el destello de tema), no se rompe nada más.
 */
function huellaDelScriptDelTema(): Plugin {
  return {
    name: 'huella-del-script-del-tema',
    transformIndexHtml(html) {
      const m = html.match(/<script id="tv-tema">([\s\S]*?)<\/script>/);
      if (!m) return html;
      const huella = createHash('sha256').update(m[1], 'utf8').digest('base64');
      return html.replaceAll("'sha256-TEMA'", `'sha256-${huella}'`);
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), huellaDelScriptDelTema()],
    // La voz propia de Jarvis corre en un hilo aparte (worker) que divide su código.
    worker: { format: 'es' as const },
    // Identifica la compilación que corre en cada aparato (ver el
    // diagnóstico de la consola de supervisión).
    // __COMMIT__: el commit con que se compiló (en GitHub Actions). La APK
    // lo usa para saber que ya trae la versión publicada por OTA y no
    // bajarla de nuevo (eso provocaba una recarga extra al abrir).
    define: {
      __BUILD_ID__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')),
      __COMMIT__: JSON.stringify((process.env.GITHUB_SHA || '').slice(0, 7)),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    // Dos páginas: la app (index.html) y la ventanita del mini-widget de
    // Jarvis en el teléfono (jarvis-rapido.html, ver src/rapido.tsx), que
    // carga solo lo de Jarvis para abrir rápido.
    build: {
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          rapido: path.resolve(__dirname, 'jarvis-rapido.html'),
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
