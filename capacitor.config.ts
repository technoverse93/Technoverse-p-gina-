import type { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize, KeyboardStyle } from '@capacitor/keyboard';

const config: CapacitorConfig = {
  appId: 'com.technoverse.admin',
  appName: 'Technoverse Admin',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    Keyboard: {
      // 'None': el teclado se SUPERPONE sobre el WebView sin redimensionarlo.
      // Antes se usaba 'native', que encogía el viewport y — combinado con las
      // vistas con min-h-screen (100vh) — aplastaba/rompía el layout al abrir
      // el teclado. Con 'None' el UI nunca cambia de tamaño; el input enfocado
      // se trae a la vista con scrollIntoView (ver src/mobile/keyboard.ts).
      resize: KeyboardResize.None,
      style: KeyboardStyle.Default,
      resizeOnFullScreen: true
    }
  }
};

export default config;
