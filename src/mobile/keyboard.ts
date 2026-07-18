import { Keyboard, KeyboardResize } from '@capacitor/keyboard';
import { isNative } from './platform';

let initialized = false;

export function initKeyboard() {
  if (!isNative() || initialized) return;
  initialized = true;

  // 'None' = el teclado se superpone sin redimensionar el WebView, evitando
  // que el layout (headers/footers fijos, min-h-screen) se aplaste o se rompa
  // al abrir el teclado en Android. Antes estaba en 'native', la causa del bug.
  Keyboard.setResizeMode({ mode: KeyboardResize.None }).catch(() => {});
  // Barra de accesorios nativa fuera: menos ruido visual y un poco menos de RAM.
  Keyboard.setAccessoryBarVisible({ isVisible: false }).catch(() => {});

  // Como el WebView no se encoge, subimos el input enfocado a la zona visible
  // por encima del teclado. requestAnimationFrame evita el salto brusco.
  Keyboard.addListener('keyboardWillShow', () => {
    const active = document.activeElement as HTMLElement | null;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
      requestAnimationFrame(() => {
        active.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
    }
  });
}
