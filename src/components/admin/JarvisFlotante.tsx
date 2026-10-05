// =====================================================================
// ASISTENTE FLOTANTE — el único acceso a la IA del panel
// =====================================================================
// Un botón abajo a la izquierda en cualquier módulo (la burbuja del chat
// vive a la derecha). Abre la IA encima de lo que se esté haciendo, sin
// cambiar de pestaña. Ya no existe un módulo «Asistente IA»: es esto.
//
//   · Superadmin  → «Jarvis» (acciones, voz, memoria, cerebro).
//   · Resto del personal → «Asistencia de IA» (consultas y ayuda, sin la
//     identidad ni las acciones de Jarvis).
//
// Usa la MISMA sesión del panel (con la huella de la APK): no hay un acceso
// aparte ni sin autenticar. Al minimizar, la conversación queda montada y
// sigue donde iba.
//
// FALLO CORREGIDO («se queda pegado al cargar»): la ventana abría en
// blanco hasta que llegaba el código del asistente, y si se había
// publicado una versión nueva con la app abierta, ese código viejo ya no
// existía y la carga no terminaba nunca. Ahora hay un esqueleto mientras
// carga, se reintenta y, si la versión cambió, se recarga la app una vez.
// =====================================================================

import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { Orbe } from './JarvisVisual';
import { useUnaSolaCapa } from './capaFlotante';
import { Sparkles, Minus, Maximize2, Minimize2, MessageCircleQuestion } from 'lucide-react';
import { Z } from '../ui/Overlays';
import { esSuperadmin } from '../../utils/roles';
import type { User } from '../../types';

const CLAVE_RECARGA = 'tv_asistente_recargado';
function importarAsistente() {
  return import('./AsistenteIA').catch(async () => {
    await new Promise(r => setTimeout(r, 1200));
    return import('./AsistenteIA').catch((e) => {
      // Dos fallos seguidos: casi siempre es una versión nueva publicada con
      // la app abierta. Se recarga UNA vez para traer la versión vigente.
      try {
        if (!sessionStorage.getItem(CLAVE_RECARGA)) { sessionStorage.setItem(CLAVE_RECARGA, '1'); location.reload(); }
      } catch { /* sin almacenamiento: se muestra el error */ }
      throw e;
    });
  });
}
const AsistenteIA = lazy(importarAsistente);

/** Lo que se ve mientras llega el código: la misma forma, sin saltos. */
function Esqueleto() {
  return (
    <div className="jv-esqueleto" aria-label="Cargando el asistente">
      <i /><i /><i />
    </div>
  );
}

class ErrorDeCarga extends React.Component<{ children: React.ReactNode }, { error: boolean }> {
  declare props: { children: React.ReactNode };
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="jv-esqueleto" role="alert">
        <p>No se pudo cargar el asistente. Revisá la conexión.</p>
        <button type="button" className="ai-chip" onClick={() => location.reload()}>Reintentar</button>
      </div>
    );
  }
}

export default function JarvisFlotante({ currentUser, onAbrirModulo, sinBoton, pedido, pestana }: {
  currentUser: User | null; onAbrirModulo: (m: string) => void; sinBoton?: boolean;
  pedido?: { n: number; voz: boolean } | null; pestana?: string;
}) {
  const jarvis = esSuperadmin(currentUser?.role);
  const nombre = jarvis ? 'Jarvis' : 'Asistencia de IA';
  const [abierto, setAbierto] = useState(false);
  const [grande, setGrande] = useState(false);
  // Se monta la primera vez que se abre y después solo se esconde: así la
  // conversación sobrevive a minimizar.
  const [montado, setMontado] = useState(false);
  // Se baja el código cuando el teléfono está libre, para que abra al instante.
  useEffect(() => {
    try { sessionStorage.removeItem(CLAVE_RECARGA); } catch { /* nada */ }
    const precargar = () => { void importarAsistente().catch(() => { /* se reintenta al abrir */ }); };
    const w = window as any;
    const id = w.requestIdleCallback ? w.requestIdleCallback(precargar, { timeout: 8000 }) : setTimeout(precargar, 4000);
    return () => { if (w.cancelIdleCallback) w.cancelIdleCallback(id); else clearTimeout(id); };
  }, []);
  // Una sola ventana flotante a la vez, y se minimiza al cambiar de pestaña.
  const minimizar = useCallback(() => setAbierto(false), []);
  useUnaSolaCapa('jarvis', abierto, minimizar, pestana);
  // Pedido del widget: se abre la ventana (y, si fue «Hablar», el micrófono).
  useEffect(() => { if (pedido?.n) { setMontado(true); setAbierto(true); } }, [pedido?.n]);
  const abrir = () => { setMontado(true); setAbierto(true); };
  const Icono = jarvis ? Sparkles : MessageCircleQuestion;
  return (
    <>
      {!abierto && !sinBoton && (
        <button type="button" className="jv-fab" data-jarvis={jarvis || undefined} style={{ zIndex: Z.fab }} onClick={abrir} aria-label={`Abrir ${nombre}`} title={nombre}>
          {jarvis ? <Orbe tam={26} /> : <Icono className="w-5 h-5" />}
        </button>
      )}
      {montado && (
        <div className="jv-hoja glass-panel-strong" data-grande={grande || undefined} data-jarvis={jarvis || undefined} role="dialog" aria-label={nombre} hidden={!abierto} style={{ zIndex: Z.floating }}>
          <div className="jv-hoja-cab">
            <span>{jarvis ? <Orbe tam={18} /> : <Icono className="w-3.5 h-3.5" />}{nombre}</span>
            <button type="button" className="jv-hoja-btn jv-solo-pc" aria-label={grande ? 'Achicar' : 'Agrandar'} title={grande ? 'Achicar' : 'Agrandar'}
              onClick={() => setGrande(v => !v)}>{grande ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}</button>
            <button type="button" className="jv-hoja-btn" aria-label="Minimizar" title="Minimizar" onClick={() => setAbierto(false)}><Minus className="w-4 h-4" /></button>
          </div>
          <div className="jv-hoja-cuerpo">
            <ErrorDeCarga>
              <Suspense fallback={<Esqueleto />}>
                <AsistenteIA currentUser={currentUser} onAbrirModulo={(m: string) => { setAbierto(false); onAbrirModulo(m); }} pedirVoz={pedido?.voz ? pedido.n : 0} />
              </Suspense>
            </ErrorDeCarga>
          </div>
        </div>
      )}
    </>
  );
}
