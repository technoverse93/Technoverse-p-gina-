// =====================================================================
// VENTANITA DEL MINI-WIDGET — Jarvis completo encima de la pantalla de inicio
// =====================================================================
// Es la página `jarvis-rapido.html` (src/rapido.tsx) que abre el widget del
// teléfono en su propia ventanita nativa (native-android/jarvis/
// JarvisRapido.java). Lo pidió el dueño: «hacer todo como lo haría con mi
// sesión en la APK», sin huella y sin abrir la app; el teléfono es solo suyo.
//
// Por eso no hay nada aparte: es el MISMO AsistenteIA del panel, con la
// MISMA sesión guardada en el teléfono. Cobra, responde chats, mueve el
// taller y ajusta inventario por los mismos caminos que la app, y lo que
// cambia accesos (bloquear, cerrar sesiones) sigue pidiendo confirmación.
//
// Lo que sí se respeta igual que en la app:
//   · Solo abre si el widget se activó en ESTE teléfono (Ajustes →
//     Mini-widget, con la huella de siempre para entrar a la app).
//   · Solo la cuenta superadmin.
//   · Bloqueo de aparato o de conexión: la ventanita se tapa igual.
//   · El candado de la huella de la app NO se abre desde aquí: la app
//     sigue pidiendo su huella como siempre.
// =====================================================================

import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { Sparkles, X, ExternalLink, Power, LogIn, ShieldAlert, WifiOff, Smartphone } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { OverlayProvider } from '../ui/Overlays';
import { supabase } from '../../supabaseClient';
import { conexionBloqueada, conTope } from '../../utils/adminLogin';
import { esSuperadmin } from '../../utils/roles';
import { widgetNativo, type PedidoVentanita } from '../../mobile/jarvisWidget';
import { iniciarKillSwitch, fijarHuellaAparato, fijarModeloAparato } from '../../seguridad/killSwitch';
import { obtenerHuellaAparato } from '../../utils/fingerprint';
import { sincronizarPaseSinTocarCandado } from '../../utils/biometriaNativa';
import { lector } from '../../utils/lectorVoz';
import type { User } from '../../types';

const AsistenteIA = lazy(() => import('./AsistenteIA'));

// Cada toque al widget llega como «pedido» (también el que abrió la
// ventanita). Se escucha desde que carga el código, fuera de React, para no
// perder el primero mientras la pantalla todavía arma.
let ultimoPedido: PedidoVentanita | null = null;
const alPedir = new Set<(p: PedidoVentanita) => void>();
if (widgetNativo.disponible()) {
  void widgetNativo.alPedir(p => { ultimoPedido = p; alPedir.forEach(f => f(p)); }).catch(() => { /* sin pedidos: se abre sin micrófono */ });
}

type Fase = 'cargando' | 'listo' | 'fuera' | 'apagado' | 'sin_sesion' | 'no_super' | 'bloqueado' | 'sin_red';
type Boton = 'app' | 'panel' | 'reintentar';

const AVISOS: Record<Exclude<Fase, 'cargando' | 'listo'>, { icono: LucideIcon; titulo: string; texto: string; boton?: Boton }> = {
  fuera: { icono: Smartphone, titulo: 'Esta es la ventanita del widget', texto: 'Se abre desde el widget de Jarvis en el teléfono. Jarvis completo está en el panel.', boton: 'panel' },
  apagado: { icono: Power, titulo: 'El mini-widget está apagado', texto: 'Activalo en la app: Jarvis → Ajustes → Mini-widget → «Activar en este teléfono».', boton: 'app' },
  sin_sesion: { icono: LogIn, titulo: 'No hay sesión en este teléfono', texto: 'Entrá a la app una vez con tu cuenta y el widget queda listo.', boton: 'app' },
  no_super: { icono: ShieldAlert, titulo: 'Solo para la cuenta del dueño', texto: 'El mini-widget de Jarvis es del superadmin.', boton: 'app' },
  bloqueado: { icono: ShieldAlert, titulo: 'Acceso bloqueado', texto: 'Este aparato o esta conexión están bloqueados.' },
  sin_red: { icono: WifiOff, titulo: 'Sin conexión', texto: 'No se pudo revisar tu sesión. Revisá internet y probá de nuevo.', boton: 'reintentar' },
};

function Esqueleto() {
  return <div className="jv-esqueleto" aria-label="Cargando Jarvis"><i /><i /><i /></div>;
}

class ErrorDeCarga extends React.Component<{ children: React.ReactNode }, { error: boolean }> {
  declare props: { children: React.ReactNode };
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="jv-esqueleto" role="alert">
        <p>No se pudo cargar Jarvis.</p>
        <button type="button" className="ai-chip" onClick={() => location.reload()}>Reintentar</button>
      </div>
    );
  }
}

export default function VentanitaJarvis() {
  const [fase, setFase] = useState<Fase>('cargando');
  const [usuario, setUsuario] = useState<User | null>(null);
  const [pedirVoz, setPedirVoz] = useState(0);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    const atender = (p: PedidoVentanita) => { if (p.voz) setPedirVoz(p.n); };
    if (ultimoPedido) atender(ultimoPedido);
    alPedir.add(atender);
    return () => { alPedir.delete(atender); };
  }, []);

  // Lo mismo que la app al arrancar, en este orden: ¿estoy en la ventanita
  // y está activada?, ¿bloqueado?, ¿hay sesión?, ¿es el superadmin?
  useEffect(() => {
    let vivo = true;
    (async () => {
      const e = await widgetNativo.estado();
      if (!vivo) return;
      if (!e.enVentanita) { setFase('fuera'); return; }
      if (!e.activo) { setFase('apagado'); return; }
      void conexionBloqueada().then(b => { if (b && vivo) setFase('bloqueado'); });
      try {
        const { data } = await conTope(supabase.auth.getSession(), 8000);
        const id = data?.session?.user?.id;
        if (!vivo) return;
        if (!id) { setFase('sin_sesion'); return; }
        const { data: perfil } = await conTope(supabase.from('profiles').select('id, email, name, role').eq('id', id).maybeSingle(), 8000);
        if (!vivo) return;
        if (!perfil) { setFase('sin_sesion'); return; }
        if (!esSuperadmin(perfil.role)) { setFase('no_super'); return; }
        setUsuario({ id: perfil.id, email: perfil.email, role: perfil.role, name: perfil.name || perfil.email });
        setFase(f => (f === 'bloqueado' ? f : 'listo'));
      } catch {
        if (vivo) setFase(f => (f === 'bloqueado' ? f : 'sin_red'));
      }
    })();
    return () => { vivo = false; };
  }, [intento]);

  // Con la ventanita lista: vigilancia de bloqueos, huella del aparato (va
  // con cada pregunta, para que Jarvis nunca proponga bloquear este mismo
  // teléfono), el pase de la huella al día y los datos del negocio bajando.
  useEffect(() => {
    if (fase !== 'listo') return;
    iniciarKillSwitch();
    sincronizarPaseSinTocarCandado();
    void obtenerHuellaAparato()
      .then(h => { fijarHuellaAparato(h.huella); fijarModeloAparato(h.modelo || null); })
      .catch(() => { /* sin huella: siguen valiendo el bloqueo por cuenta e IP */ });
    const t = setTimeout(() => { void import('../../utils/storage'); }, 800);
    const { data: escucha } = supabase.auth.onAuthStateChange(evento => { if (evento === 'SIGNED_OUT') setFase('sin_sesion'); });
    return () => { clearTimeout(t); escucha?.subscription?.unsubscribe(); };
  }, [fase]);

  const cerrar = useCallback(() => { lector.callar(); void widgetNativo.cerrar(); }, []);
  const abrirApp = useCallback((modulo?: string) => { lector.callar(); void widgetNativo.abrirApp(modulo); }, []);
  const alResponder = useCallback((pregunta: string, respuesta: string) => { void widgetNativo.ultimaRespuesta(pregunta, respuesta); }, []);

  const aviso = fase !== 'cargando' && fase !== 'listo' ? AVISOS[fase] : null;
  const nativa = fase !== 'fuera';

  return (
    <OverlayProvider>
      <div id="admin-panel-root" className="vj-raiz">
        {nativa && <button type="button" className="vj-velo" aria-label="Cerrar Jarvis" tabIndex={-1} onClick={cerrar} />}
        <section className="jv-hoja vj-hoja" role="dialog" aria-label="Jarvis" data-compacta={aviso ? '' : undefined}>
          <header className="jv-hoja-cab vj-cab">
            <span><Sparkles className="w-3.5 h-3.5" />Jarvis</span>
            {nativa && !aviso && (
              <button type="button" className="vj-abrir" onClick={() => abrirApp()} title="Abrir Jarvis en la app (con tu huella)">
                <ExternalLink className="w-4 h-4" />Abrir la app
              </button>
            )}
            {nativa && <button type="button" className="jv-hoja-btn" onClick={cerrar} aria-label="Cerrar" title="Cerrar"><X className="w-4 h-4" /></button>}
          </header>
          <div className="jv-hoja-cuerpo">
            {fase === 'listo' && usuario ? (
              <ErrorDeCarga>
                <Suspense fallback={<Esqueleto />}>
                  <AsistenteIA currentUser={usuario} onAbrirModulo={abrirApp} pedirVoz={pedirVoz} onRespuesta={alResponder} />
                </Suspense>
              </ErrorDeCarga>
            ) : aviso ? (
              <div className="vj-aviso" role="status">
                <span className="vj-aviso-ic" data-tipo={fase}><aviso.icono className="w-5 h-5" /></span>
                <b>{aviso.titulo}</b>
                <p>{aviso.texto}</p>
                {aviso.boton === 'app' && <button type="button" className="ai-chip" data-primario onClick={() => abrirApp()}><ExternalLink className="w-4 h-4" />Abrir la app</button>}
                {aviso.boton === 'reintentar' && <button type="button" className="ai-chip" data-primario onClick={() => { setFase('cargando'); setIntento(n => n + 1); }}>Reintentar</button>}
                {aviso.boton === 'panel' && <a className="ai-chip" data-primario href="/admin">Ir al panel</a>}
              </div>
            ) : <Esqueleto />}
          </div>
        </section>
      </div>
    </OverlayProvider>
  );
}
