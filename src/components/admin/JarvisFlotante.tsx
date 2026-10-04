// =====================================================================
// JARVIS FLOTANTE — el intercomunicador del superadmin
// =====================================================================
// Un botón abajo a la izquierda en cualquier módulo del panel (la burbuja
// del chat vive a la derecha). Abre a Jarvis en una ventana encima de lo que
// se esté haciendo, sin cambiar de pestaña: preguntar «¿hay alguien en la
// tienda?» o dictar una orden por voz desde Inventario, Taller o donde sea.
//
// Usa la MISMA sesión del panel (con la huella de la APK): no hay un acceso
// aparte ni sin autenticar. Al minimizar, la conversación queda montada y
// sigue donde iba.
// =====================================================================

import React, { Suspense, lazy, useState } from 'react';
import { Sparkles, Minus, Maximize2 } from 'lucide-react';
import { Z } from '../ui/Overlays';
import type { User } from '../../types';

const AsistenteIA = lazy(() => import('./AsistenteIA'));

export default function JarvisFlotante({ currentUser, onAbrirModulo, oculto }: { currentUser: User | null; onAbrirModulo: (m: string) => void; oculto?: boolean }) {
  const [abierto, setAbierto] = useState(false);
  // Se monta la primera vez que se abre y después solo se esconde: así la
  // conversación sobrevive a minimizar.
  const [montado, setMontado] = useState(false);
  if (oculto) return null;
  const abrir = () => { setMontado(true); setAbierto(true); };
  return (
    <>
      {!abierto && (
        <button type="button" className="jv-fab" style={{ zIndex: Z.fab }} onClick={abrir} aria-label="Hablar con Jarvis" title="Jarvis">
          <Sparkles className="w-5 h-5" />
        </button>
      )}
      {montado && (
        <div className="jv-hoja glass-panel-strong" role="dialog" aria-label="Jarvis" hidden={!abierto} style={{ zIndex: Z.floating }}>
          <div className="jv-hoja-cab">
            <span>Jarvis · encima de lo que estás haciendo</span>
            <button type="button" className="jv-hoja-btn" aria-label="Abrir en su pestaña" title="Abrir en su pestaña"
              onClick={() => { setAbierto(false); onAbrirModulo('asistente'); }}><Maximize2 className="w-4 h-4" /></button>
            <button type="button" className="jv-hoja-btn" aria-label="Minimizar" title="Minimizar" onClick={() => setAbierto(false)}><Minus className="w-4 h-4" /></button>
          </div>
          <div className="jv-hoja-cuerpo">
            <Suspense fallback={null}>
              <AsistenteIA currentUser={currentUser} onAbrirModulo={(m: string) => { setAbierto(false); onAbrirModulo(m); }} />
            </Suspense>
          </div>
        </div>
      )}
    </>
  );
}
