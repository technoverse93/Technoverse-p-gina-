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
    },
    // Actualización OTA (src/mobile/otaUpdater.ts). `autoUpdate: false`
    // porque el modo automático del plugin espera la nube de Capgo (un
    // servicio de terceros); este proyecto se auto-hospeda contra Supabase
    // Storage y hace la comprobación/descarga a mano. `appReadyTimeout` es
    // cuánto espera la capa nativa la llamada a `notifyAppReady()` antes de
    // revertir sola al bundle anterior por si el nuevo viniera roto.
    CapacitorUpdater: {
      autoUpdate: false,
      appReadyTimeout: 10000
    },
    // FLAG_SECURE nativo — anti-captura para TODOS, sin excepción.
    // `enable: true`: protegido desde el primer fotograma, antes incluso
    // de que corra el JavaScript de la app. `src/seguridad/flagSecure.ts`
    // vuelve a llamar a enable() al arrancar como segunda capa, por si
    // este arranque estático no se aplicara en algún flujo — no hay
    // ninguna llamada a disable() en todo el proyecto.
    PrivacyScreen: {
      enable: true,
      preventScreenshots: true
    }
  }
};

export default config;
