// =====================================================================
// MANOS LIBRES — el orbe de Jarvis que escucha, piensa y habla
// =====================================================================
// Pantalla de conversación continua: el orbe respira con el volumen de tu
// voz mientras hablás y con el de Jarvis mientras contesta. Tocarlo
// corta lo que Jarvis dice (y lo pone a escucharte) o, si lo estás
// escuchando, manda lo que llevás dicho. El volumen llega por `nivelVoz`
// y se dibuja con una variable CSS (sin volver a pintar React).
// =====================================================================

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { Orbe } from './JarvisVisual';
import { nivelVoz } from '../../utils/nivelVoz';

export type FaseManos = 'saludando' | 'escuchando' | 'pensando' | 'hablando' | 'espera';

const ETIQUETA: Record<FaseManos, string> = {
  saludando: 'Jarvis',
  escuchando: 'Te escucho…',
  pensando: 'Pensando…',
  hablando: 'Jarvis',
  espera: 'Un momento…',
};
const AYUDA: Record<FaseManos, string> = {
  saludando: 'Tocá el orbe para pasar directo a hablar.',
  escuchando: 'Cuando hagas una pausa, lo mando. O tocá el orbe para mandarlo ya.',
  pensando: 'Tocá el orbe para cancelar.',
  hablando: 'Tocá el orbe para interrumpir y hablar vos.',
  espera: '',
};

export default function HudVoz({ fase, vos, jarvis, onToque, onTerminar }: {
  fase: FaseManos; vos: string; jarvis: string; onToque: () => void; onTerminar: () => void;
}) {
  const orbe = useRef<HTMLButtonElement>(null);
  const faseRef = useRef(fase);
  faseRef.current = fase;

  // El volumen suavizado a una variable CSS. Si Jarvis habla con la voz del
  // teléfono (que no se puede medir), el orbe late solo, como al hablar.
  useEffect(() => {
    let id = 0, suave = 0;
    const reducir = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const cuadro = (t: number) => {
      const f = faseRef.current;
      let n = 0;
      if (f === 'escuchando') n = nivelVoz.hayReal('mic') ? nivelVoz.leer() : 0.08;
      else if (f === 'hablando' || f === 'saludando') {
        n = nivelVoz.hayReal('voz') ? nivelVoz.leer() : 0.3 + 0.22 * Math.sin(t / 95) * Math.sin(t / 310 + 1);
      }
      suave += (n - suave) * (n > suave ? 0.5 : 0.16); // sube rápido, baja despacio
      orbe.current?.style.setProperty('--nivel', (reducir ? Math.min(suave, 0.25) : suave).toFixed(3));
      id = requestAnimationFrame(cuadro);
    };
    id = requestAnimationFrame(cuadro);
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div className="jv-hud" data-fase={fase} role="dialog" aria-label="Conversación con Jarvis, manos libres">
      <button type="button" className="jv-hud-x ai-chip" onClick={onTerminar} aria-label="Terminar la conversación"><X className="w-4 h-4" />Terminar</button>
      <button type="button" ref={orbe} className="jv-hud-orbe" onClick={onToque} aria-label={AYUDA[fase] || ETIQUETA[fase]}>
        <span className="jv-hud-aro" aria-hidden="true" />
        <span className="jv-hud-aro dos" aria-hidden="true" />
        <Orbe tam={132} />
      </button>
      <div className="jv-hud-tx" aria-live="polite">
        <b className="jv-hud-estado">{ETIQUETA[fase]}</b>
        <span className="jv-hud-ayuda">{AYUDA[fase]}</span>
        {vos && <p className="jv-hud-vos"><small>Vos</small>{vos}</p>}
        {jarvis && fase !== 'escuchando' && <p className="jv-hud-jarvis"><small>Jarvis</small>{jarvis}</p>}
      </div>
    </div>
  );
}
