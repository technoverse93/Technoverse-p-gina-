import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
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
