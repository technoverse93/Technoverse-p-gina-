import { Keyboard } from '@capacitor/keyboard';
import { isNative } from './platform';

let initialized = false;

export function initKeyboard() {
  if (!isNative() || initialized) return;
  initialized = true;

  Keyboard.setResizeMode({ mode: 'native' as any }).catch(() => {});

  Keyboard.addListener('keyboardWillShow', () => {
    const active = document.activeElement as HTMLElement | null;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
      setTimeout(() => {
        active.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 50);
    }
  });
}
