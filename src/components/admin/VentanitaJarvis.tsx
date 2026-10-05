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

import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, X, ExternalLink, Power, LogIn, ShieldAlert, WifiOff, Smartphone, ArrowUp, Maximize2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { OverlayProvider } from '../ui/Overlays';
import { supabase } from '../../supabaseClient';
import { conexionBloqueada, conTope } from '../../utils/adminLogin';
import { esSuperadmin } from '../../utils/roles';
import { widgetNativo, type PedidoVentanita, type ModoVentanita } from '../../mobile/jarvisWidget';
import { preguntarDesdeWidget, conversacionDelWidget, esperarAcciones } from '../../mobile/preguntaWidget';
import { iniciarKillSwitch, fijarHuellaAparato, fijarModeloAparato } from '../../seguridad/killSwitch';
import { obtenerHuellaAparato } from '../../utils/fingerprint';
import { sincronizarPaseSinTocarCandado } from '../../utils/biometriaNativa';
import { lector, modoLectura } from '../../utils/lectorVoz';
import type { User } from '../../types';

const AsistenteIA = lazy(() => import('./AsistenteIA'));
const TarjetaAccion = lazy(() => import('./JarvisPiezas').then(m => ({ default: m.TarjetaAccion })));

// Cada toque al widget llega como «pedido» (también el que abrió la
// ventanita). Se escucha desde que carga el código, fuera de React, para no
// perder el primero mientras la pantalla todavía arma.
let ultimoPedido: PedidoVentanita | null = null;
const alPedir = new Set<(p: PedidoVentanita) => void>();
if (widgetNativo.enApp()) {
  void widgetNativo.alPedir(p => { ultimoPedido = p; alPedir.forEach(f => f(p)); }).catch(() => { /* sin pedidos: se abre sin micrófono */ });
}

type Fase = 'cargando' | 'listo' | 'fuera' | 'sin_puente' | 'apagado' | 'sin_sesion' | 'no_super' | 'bloqueado' | 'sin_red';
type Boton = 'app' | 'panel' | 'reintentar';

const AVISOS: Record<Exclude<Fase, 'cargando' | 'listo'>, { icono: LucideIcon; titulo: string; texto: string; boton?: Boton }> = {
  fuera: { icono: Smartphone, titulo: 'Esta es la ventanita del widget', texto: 'Se abre desde el widget de Jarvis en el teléfono. Jarvis completo está en el panel.', boton: 'panel' },
  sin_puente: { icono: Smartphone, titulo: 'No se pudo abrir Jarvis aquí', texto: 'Abrí Jarvis en la app; si vuelve a pasar, reinstalá la APK más nueva.', boton: 'app' },
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

/** Si el puente no cerró la ventanita, se sale igual (nunca queda tapando). */
function salirSiSigue(): void {
  setTimeout(() => { void import('@capacitor/app').then(({ App }) => App.exitApp()).catch(() => { /* nada más que hacer */ }); }, 900);
}

/**
 * Esta página solo vale dentro de la ventanita del widget. Si se abriera en
 * la app, se vuelve al panel (una sola vez: nunca en bucle).
 */
function volverAlPanel(): void {
  try {
    const k = 'tv_ventanita_salida', antes = Number(sessionStorage.getItem(k) || 0);
    if (Date.now() - antes < 15_000) return;
    sessionStorage.setItem(k, String(Date.now()));
  } catch { /* sin almacenamiento: se intenta igual */ }
  location.replace('/admin');
}

/** Espera a que termine de leer en voz alta (o un tope). */
function finDeLectura(topeMs = 120_000): Promise<void> {
  return new Promise(ok => {
    const fin = setTimeout(listo, topeMs);
    let quitar = () => {};
    function listo() { clearTimeout(fin); quitar(); ok(); }
    quitar = lector.suscribir(() => { if (lector.obtener().estado === 'callado') listo(); });
    setTimeout(() => { if (lector.obtener().estado === 'callado') listo(); }, 400);
  });
}

/** La barrita para escribir: Android no deja escribir dentro de un widget. */
function BarraEscribir({ onEnviar, onHoja, onCerrar }: { onEnviar: (t: string) => void; onHoja: () => void; onCerrar: () => void }) {
  const [texto, setTexto] = useState('');
  const caja = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const t = setTimeout(() => caja.current?.focus(), 60); return () => clearTimeout(t); }, []);
  const enviar = () => { const t = texto.trim(); if (t) onEnviar(t); };
  return (
    <form className="vj-barra" onSubmit={e => { e.preventDefault(); enviar(); }}>
      <span className="vj-barra-marca" aria-hidden><Sparkles className="w-4 h-4" /></span>
      <textarea ref={caja} rows={1} value={texto} placeholder="Escribile a Jarvis…" aria-label="Pregunta para Jarvis" maxLength={2000}
        onChange={e => { setTexto(e.target.value); const t = e.target; t.style.height = 'auto'; t.style.height = `${Math.min(120, t.scrollHeight)}px`; }} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }} />
      <button type="button" className="vj-barra-btn" onClick={onHoja} aria-label="Abrir la conversación completa" title="Abrir la conversación completa"><Maximize2 className="w-4 h-4" /></button>
      <button type="button" className="vj-barra-btn" onClick={onCerrar} aria-label="Cerrar" title="Cerrar"><X className="w-4 h-4" /></button>
      <button type="submit" className="vj-barra-env" disabled={!texto.trim()} aria-label="Enviar"><ArrowUp className="w-4 h-4" /></button>
    </form>
  );
}

export default function VentanitaJarvis() {
  const [fase, setFase] = useState<Fase>('cargando');
  const [usuario, setUsuario] = useState<User | null>(null);
  const [pedirVoz, setPedirVoz] = useState(0);
  const [intento, setIntento] = useState(0);
  // Cómo se abrió: hoja completa, pregunta dictada o barrita para escribir.
  const [modo, setModo] = useState<ModoVentanita | null>(null);
  const [conversacion, setConversacion] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  // Las acciones que trajo la respuesta del widget: se montan ocultas para
  // que las cotidianas se ejecuten solas, con el mismo código de la app.
  const [accionesOcultas, setAccionesOcultas] = useState<string[]>([]);
  const [pendiente, setPendiente] = useState<string | null>(null);

  useEffect(() => {
    const atender = (p: PedidoVentanita) => {
      const m: ModoVentanita = p.modo || (p.voz ? 'voz' : 'hoja');
      setModo(m);
      if (m === 'voz' && p.texto) setPendiente(p.texto);
      if (m === 'hoja' && p.voz) setPedirVoz(p.n);
    };
    if (ultimoPedido) atender(ultimoPedido);
    alPedir.add(atender);
    return () => { alPedir.delete(atender); };
  }, []);

  // Lo mismo que la app al arrancar, en este orden: ¿estoy en la ventanita
  // y está activada?, ¿bloqueado?, ¿hay sesión?, ¿es el superadmin?
  useEffect(() => {
    let vivo = true;
    (async () => {
      // En la web esta página no hace nada (se abre desde el widget del teléfono).
      if (!widgetNativo.enApp()) { setFase('fuera'); return; }
      // En el teléfono SIEMPRE es la ventanita: el puente puede tardar un
      // instante en contestar al arrancar, así que se reintenta.
      let e = await widgetNativo.estado();
      for (let i = 0; i < 4 && !e.version; i++) {
        await new Promise(ok => setTimeout(ok, 350));
        if (!vivo) return;
        e = await widgetNativo.estado();
      }
      if (!vivo) return;
      setModo(m => m || e.modo);
      setConversacion(e.conversacion || conversacionDelWidget());
      if (!e.version) { setFase('sin_puente'); return; }
      // Esta página solo vale dentro de la ventanita del widget. Si por lo
      // que sea se abrió en la app (pasó en un teléfono: se veía «El
      // mini-widget está apagado» en vez del panel, sin poder cerrarlo), se
      // cambia en el acto por la app de siempre.
      if (!e.enVentanita) { volverAlPanel(); return; }
      // El widget es opcional: apagado, la ventanita no muestra nada y se
      // cierra en el acto (no se interpone con la app).
      if (!e.activo) { void widgetNativo.cerrar(); salirSiSigue(); return; }
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

  const cerrar = useCallback(() => {
    lector.callar();
    void widgetNativo.cerrar();
    salirSiSigue();
  }, []);

  // Pregunta EN EL WIDGET: la ventanita deja de tapar, el widget dice
  // «Pensando…», la respuesta queda en el recuadro (y se lee si va por voz)
  // y la ventanita se cierra sola.
  const responderEnWidget = useCallback(async (texto: string, porVoz: boolean) => {
    setTrabajando(true);
    void widgetNativo.soltar();
    void widgetNativo.avisar('Pensando…');
    const r = await preguntarDesdeWidget(texto, porVoz);
    if (r.ok === true && 'texto' in r) {
      setConversacion(r.conversacion);
      let final = r.texto, pendientes = 0;
      if (r.acciones.length) {
        void widgetNativo.avisar('Haciendo lo que pediste…');
        void import('../../utils/storage');
        setAccionesOcultas(r.acciones);
        const a = await esperarAcciones(r.acciones);
        pendientes = a.pendientes;
        if (a.hechas.length) final = `${final}\n${a.hechas.join('\n')}`;
      }
      await widgetNativo.ultimaRespuesta(texto, final, { conversacion: r.conversacion, accion: pendientes > 0 });
      const lectura = modoLectura();
      if (r.texto && (lectura === 'siempre' || (lectura === 'voz' && porVoz))) {
        void lector.hablar(r.texto, `w-${Date.now()}`);
        await finDeLectura();
      }
    } else {
      await widgetNativo.ultimaRespuesta(texto, `⚠ ${"error" in r ? r.error : "No se pudo responder."}`);
    }
    void widgetNativo.cerrar();
  }, []);

  // Lo dictado espera a que la sesión esté lista.
  useEffect(() => {
    if (fase === 'listo' && modo === 'voz' && pendiente && !trabajando) {
      setPendiente(null);
      void responderEnWidget(pendiente, true);
    }
  }, [fase, modo, pendiente, trabajando, responderEnWidget]);
  const abrirApp = useCallback((modulo?: string) => { lector.callar(); void widgetNativo.abrirApp(modulo); }, []);
  const alResponder = useCallback((pregunta: string, respuesta: string) => { void widgetNativo.ultimaRespuesta(pregunta, respuesta); }, []);

  const aviso = fase !== 'cargando' && fase !== 'listo' ? AVISOS[fase] : null;
  // En el teléfono siempre hay cómo cerrar (X, tocar afuera o atrás).
  const nativa = widgetNativo.enApp();
  // En el recuadro: nada a la vista (salvo un aviso que pida algo), o solo
  // la barrita para escribir.
  const enRecuadro = modo === 'voz' || (modo === 'escribir' && !aviso);
  const verHoja = () => { void widgetNativo.avisar(''); setModo('hoja'); };
  // Por voz no hay ventana: si algo impide contestar (sin sesión, apagado,
  // bloqueo…), se dice en el propio widget.
  useEffect(() => {
    if (modo !== 'voz' || !aviso) return;
    void widgetNativo.ultimaRespuesta('', `${aviso.titulo}. ${aviso.texto}`).then(() => widgetNativo.cerrar());
  }, [modo, aviso]);

  if (enRecuadro) {
    return (
      <OverlayProvider>
        <div id="admin-panel-root" className="vj-raiz" data-recuadro>
          {accionesOcultas.length > 0 && (
            <div hidden aria-hidden>
              <Suspense fallback={null}>{accionesOcultas.map(id => <TarjetaAccion key={id} id={id} />)}</Suspense>
            </div>
          )}
          {modo === 'escribir' && !trabajando && (
            <>
              <button type="button" className="vj-velo" aria-label="Cerrar" tabIndex={-1} onClick={cerrar} />
              {fase === 'listo'
                ? <BarraEscribir onEnviar={t => void responderEnWidget(t, false)} onHoja={verHoja} onCerrar={cerrar} />
                : <div className="vj-barra" aria-busy><span className="vj-barra-marca"><Sparkles className="w-4 h-4" /></span><span className="vj-barra-espera">Abriendo Jarvis…</span></div>}
            </>
          )}
        </div>
      </OverlayProvider>
    );
  }

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
            {fase === 'listo' && usuario && modo ? (
              <ErrorDeCarga>
                <Suspense fallback={<Esqueleto />}>
                  <AsistenteIA currentUser={usuario} onAbrirModulo={abrirApp} pedirVoz={pedirVoz} onRespuesta={alResponder} conversacionInicial={conversacion} />
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
