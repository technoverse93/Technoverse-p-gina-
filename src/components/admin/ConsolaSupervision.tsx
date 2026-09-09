// =====================================================================
// CONSOLA DE SUPERVISIÓN (Zero Trust · Etapa 3)
// =====================================================================
// El "espejo virtual": lista quién está en línea y, al elegir a alguien,
// reproduce su pantalla en vivo con rrweb. Exclusiva del Superadmin (RLS +
// gate en AdminPanel).
//
// Flujo: al elegir a un empleado se pone `watch = true` en su fila. Eso le
// dice a SU cliente que empiece a grabar (ver grabador.ts).
//
// ---------------------------------------------------------------------
// POR DÓNDE LLEGAN LOS FOTOGRAMAS
// ---------------------------------------------------------------------
// Camino rápido: BROADCAST en el canal privado `espejo:<id>`. No toca la
// base, así que el fotograma llega prácticamente en el acto. Vienen
// comprimidos y troceados; aquí se reensamblan y se descomprimen.
//
// Camino de respaldo: los INSERT de `supervision_events`, que es como
// funcionaba antes. Solo se usa si el canal privado no se pudo
// establecer. Se escuchan los dos a la vez: si el rápido funciona, el
// lento nunca llega, porque el grabador no lo usa.
// =====================================================================

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MonitorPlay, Smartphone, Monitor, RefreshCw, Radio, Ban, ScreenShare, BatteryFull, BatteryMedium, BatteryLow, BatteryCharging, Wifi, RotateCw, MousePointer2, Keyboard } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { soloHora } from '../chat/formatoChat';
import { escucharPantallasDisponibles } from '../../supervision/capturaPantalla';
import { abrirEmisorControl, type EmisorControl } from '../../supervision/controlRemoto';
import VisorPantallaCompleta from './VisorPantallaCompleta';

interface Presencia {
  user_id: string;
  email: string | null;
  ruta: string | null;
  entorno: string | null;
  modelo: string | null;
  device: string | null;
  last_seen: string;
  watch: boolean;
}

/**
 * Un cliente navegando la tienda. Sigue sin tener correo, nombre, IP ni
 * user_id — eso no cambió. Lo que sí cambió, por decisión explícita del
 * dueño (ver seguridad/consentimiento.ts y utils/ubicacion.ts): si esta
 * visita aceptó el interruptor "Ubicación" del aviso de consentimiento,
 * `lat`/`lon` traen su posición GPS real, atada al aparato aunque nunca
 * se sepa quién es.
 */
interface Visitante {
  visita: string;
  modelo: string | null;
  tipo: string | null;
  entorno: string | null;
  ruta: string | null;
  last_seen: string;
  watch: boolean;
  lat: number | null;
  lon: number | null;
  precision_m: number | null;
}

const ONLINE_MS = 40000;

/** Lo que se muestra de un cliente. Nunca hay nada más que esto. */
function nombreDeAparato(v: Visitante): string {
  return (v.modelo || '').trim() || (v.tipo || '').trim() || 'Aparato';
}

// ---------------------------------------------------------------------
// CSS DEL ESPEJO — en TEXTO, no por <link>
// ---------------------------------------------------------------------
// La versión anterior copiaba el <link href="/assets/index-*.css"> dentro
// del iframe. Un <link> carga ASÍNCRONO: en cada foto completa el <head>
// del iframe se rehace, se vuelve a copiar el link y hay un instante sin
// estilos —el panel en blanco— hasta que la hoja carga. A veces estaba en
// caché y se veía bien, a veces no: esa era la "carrera" del tema.
//
// La cura es leer el CSS UNA vez, como texto, de las hojas del propio
// dominio (mismo build, mismo origen → `cssRules` es accesible) y luego
// inyectarlo como un <style> en línea. Un <style> con el texto ya dentro
// aplica de inmediato, sin viaje de red, así que no hay parpadeo posible.
let cssCache: string | null = null;

function cssDelDocumento(): string {
  if (cssCache !== null) return cssCache;
  let texto = '';
  for (const hoja of Array.from(document.styleSheets)) {
    try {
      // `cssRules` lanza en hojas de otro origen (p. ej. Google Fonts);
      // esas se ignoran —son tipografías, no el color que se perdía—.
      for (const regla of Array.from(hoja.cssRules)) texto += regla.cssText + '\n';
    } catch { /* hoja de otro origen: se salta */ }
  }
  cssCache = texto;
  return cssCache;
}

export default function ConsolaSupervision() {
  const [gente, setGente] = useState<Presencia[]>([]);
  const [visitantes, setVisitantes] = useState<Visitante[]>([]);
  const [sel, setSel] = useState<string | null>(null);

  // Pantallas completas REALES (getDisplayMedia) que alguien ofreció y
  // están listas para verse. Es presencia en vivo, no una columna de
  // tabla — ver capturaPantalla.ts.
  const [pantallasListas, setPantallasListas] = useState<Set<string>>(new Set());
  const [viendoPantalla, setViendoPantalla] = useState<string | null>(null);
  useEffect(() => escucharPantallasDisponibles(setPantallasListas), []);
  const [estado, setEstado] = useState<'idle' | 'esperando' | 'vivo'>('idle');
  const [refrescando, setRefrescando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  /** Último cuadro de la cámara del supervisado, para el recuadro PiP. */
  const [caraCuadro, setCaraCuadro] = useState<string | null>(null);
  /** Por qué NO hay cara, cuando no la hay. Evita adivinar frente a un hueco. */
  const [camEstado, setCamEstado] = useState<string | null>(null);

  const lienzoRef = useRef<HTMLDivElement>(null);
  const replayerRef = useRef<any>(null);
  const iniciandoRef = useRef(false);
  const colaRef = useRef<any[]>([]);
  const canalEventosRef = useRef<any>(null);
  const canalEspejoRef = useRef<any>(null);
  const trozosRef = useRef<Map<string, { n: number; partes: string[] }>>(new Map());
  /** Último tema conocido del supervisado. Se reaplica tras cada foto. */
  const temaRef = useRef<{ clase: string; estilo: string; data: string } | null>(null);
  /**
   * CSS del SUPERVISADO. Manda sobre el del Superadmin: la app carga el
   * estilo por trozos, y si el Superadmin nunca abrió Chat o Inventario,
   * esas hojas no están en SU documento — por eso esas cajas salían
   * invisibles en el espejo. El empleado sí tiene el CSS de lo que mira.
   */
  const cssRemotoRef = useRef<string | null>(null);
  const selRef = useRef<string | null>(null);
  selRef.current = sel;
  /**
   * Batería y red del supervisado, tal como llegan por el canal del
   * espejo (evento suelto 'telemetria', ver motorEspejo.ts). Es
   * información de a quién se está mirando AHORA MISMO, así que se
   * limpia al cambiar de persona o al soltar — igual que caraCuadro.
   */
  const [telemetria, setTelemetria] = useState<{ bateria: { nivel: number; cargando: boolean } | null; red: { tipo: string; rttMs: number | null; downlinkMbps: number | null } | null } | null>(null);

  // --------------------------- Presencia ---------------------------
  const cargar = useCallback(async () => {
    // Solo lo FRESCO, y filtrado en el servidor. Antes se traía la tabla
    // entera —incluidas fichas viejas que igual se descartaban al pintar—,
    // y con el tiempo eso es lo que hacía lenta la apertura del panel.
    // Un margen sobre la ventana de "en línea" cubre el latido en curso.
    const desde = new Date(Date.now() - ONLINE_MS * 2).toISOString();
    const [personal, clientes] = await Promise.all([
      supabase
        .from('supervision_state')
        .select('user_id, email, ruta, entorno, modelo, device, last_seen, watch')
        .gte('last_seen', desde)
        .order('last_seen', { ascending: false })
        .limit(50),
      supabase
        .from('supervision_visitantes')
        .select('visita, modelo, tipo, entorno, ruta, last_seen, watch, lat, lon, precision_m')
        .gte('last_seen', desde)
        .order('last_seen', { ascending: false })
        .limit(50),
    ]);
    const filas = (personal.data as Presencia[]) || [];
    const visitas = (clientes.data as Visitante[]) || [];
    setGente(filas);
    setVisitantes(visitas);
    return { filas, visitas };
  }, []);

  useEffect(() => {
    cargar();
    const canal = supabase
      .channel('supervision-presencia')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'supervision_state' }, () => cargar())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'supervision_visitantes' }, () => cargar())
      .subscribe();
    const t = setInterval(cargar, 12000);
    return () => { supabase.removeChannel(canal); clearInterval(t); };
  }, [cargar]);

  const frescura = (iso: string) => Date.now() - new Date(iso).getTime() < ONLINE_MS;
  const enLinea = (p: Presencia) => frescura(p.last_seen);
  const visitaEnLinea = (v: Visitante) => frescura(v.last_seen);

  // --------------------------- Escala del espejo ---------------------------
  const ajustarEscala = useCallback((w: number, h: number) => {
    const cont = lienzoRef.current;
    if (!cont || !w || !h) return;
    const escala = Math.min(1, cont.clientWidth / w);
    const wrap = cont.querySelector('.replayer-wrapper') as HTMLElement | null;
    if (wrap) {
      wrap.style.transform = `scale(${escala})`;
      wrap.style.transformOrigin = 'top left';
    }
    cont.style.height = `${Math.round(h * escala)}px`;
  }, []);

  // --------------------------- Fidelidad visual del espejo ---------------------------
  // rrweb reproduce dentro de un IFRAME propio. Eso ya aísla el espejo del
  // tema del Superadmin —son dos documentos distintos—, así que si vos
  // estás en oscuro y el supervisado en claro, se ve el claro de él.
  //
  // Lo que faltaba era el CSS. El grabador ya no empotra las hojas de
  // estilo (perdía los @layer de Tailwind v4 y con ellos TODAS las
  // variables de color). Aquí se inyecta la hoja de estilos REAL: el
  // supervisado y vos corren el mismo build en el mismo dominio, así que
  // es exactamente el mismo CSS, sin reconstruir nada.
  const inyectarEstilos = useCallback(() => {
    try {
      const doc = (replayerRef.current?.iframe as HTMLIFrameElement | undefined)?.contentDocument;
      if (!doc?.head) return;
      // Tras cada foto completa rrweb rehace el <head>, así que la marca
      // desaparece y toca volver a inyectar. Si sigue ahí, no duplicamos.
      if (doc.head.querySelector('[data-tv-css]')) return;
      const estilo = doc.createElement('style');
      estilo.setAttribute('data-tv-css', '');
      // El CSS del supervisado manda; el propio es solo el respaldo para
      // el instante anterior a que llegue el suyo.
      estilo.textContent = cssRemotoRef.current || cssDelDocumento();
      // Primero en el <head>, para que gane sobre cualquier estilo que
      // rrweb hubiera dejado y para que esté aplicado antes del primer
      // pintado del contenido reconstruido.
      doc.head.insertBefore(estilo, doc.head.firstChild);
    } catch { /* iframe aún no accesible: la próxima foto lo reintenta */ }
  }, []);

  /** Pinta el tema del SUPERVISADO sobre el <html> del iframe. */
  const aplicarTema = useCallback(() => {
    try {
      const raiz = (replayerRef.current?.iframe as HTMLIFrameElement | undefined)
        ?.contentDocument?.documentElement;
      const t = temaRef.current;
      if (!raiz || !t) return;
      raiz.className = t.clase;
      if (t.estilo) raiz.setAttribute('style', t.estilo);
      if (t.data) raiz.setAttribute('data-theme', t.data);
      else raiz.removeAttribute('data-theme');
    } catch { /* nada */ }
  }, []);

  /** Lo que hay que rehacer cada vez que rrweb reconstruye el documento. */
  const rehidratar = useCallback(() => {
    inyectarEstilos();
    aplicarTema();
  }, [inyectarEstilos, aplicarTema]);

  // --------------------------- Reproductor ---------------------------
  const destruirReplayer = useCallback(() => {
    try { replayerRef.current?.pause?.(); } catch { /* nada */ }
    replayerRef.current = null;
    colaRef.current = [];
    trozosRef.current.clear();
    // El tema es de QUIEN se estaba mirando: si no se olvida, el siguiente
    // supervisado heredaría el claro/oscuro del anterior hasta su primer
    // cambio de tema.
    temaRef.current = null;
    cssRemotoRef.current = null;
    // La cara es de quien se miraba: no debe quedar colgada al soltar ni
    // reaparecer sobre el espejo de otra persona.
    setCaraCuadro(null);
    setCamEstado(null);
    setTelemetria(null);
    if (lienzoRef.current) lienzoRef.current.innerHTML = '';
  }, []);

  // Arranca el reproductor SOLO cuando ya tenemos una foto completa
  // (evento tipo 2). rrweb no puede pintar el interior sin ella: por eso,
  // si se engancha entre foto y foto, todo el panel se veía en blanco.
  // Como el grabador reenvía una foto cada 12 s, esto se autocura solo.
  const iniciarSiHayFoto = useCallback(async () => {
    if (replayerRef.current || iniciandoRef.current) return;
    const cola = colaRef.current;
    let snap = -1;
    for (let i = cola.length - 1; i >= 0; i--) { if (cola[i]?.type === 2) { snap = i; break; } }
    if (snap === -1) return; // todavía sin foto: seguir esperando
    // rrweb quiere el Meta (tipo 4) justo antes de la foto.
    const desde = (snap > 0 && cola[snap - 1]?.type === 4) ? snap - 1 : snap;
    const eventosIniciales = cola.slice(desde);
    iniciandoRef.current = true;
    try {
      const { Replayer } = await import('rrweb');
      if (!lienzoRef.current) { iniciandoRef.current = false; return; }
      lienzoRef.current.innerHTML = '';
      const r = new Replayer(eventosIniciales, {
        root: lienzoRef.current,
        liveMode: true,
        mouseTail: false,
        speed: 1,
      });
      r.on('resize', (e: any) => ajustarEscala(e?.width, e?.height));
      // Cada foto completa rehace el documento del iframe y se lleva por
      // delante el CSS inyectado y la clase de tema. Se vuelven a poner.
      r.on('fullsnapshot-rebuilded', () => rehidratar());
      r.startLive();
      replayerRef.current = r;
      // La primera foto ya se procesó en el constructor, así que se
      // rehidrata de una: no esperamos al siguiente checkout.
      rehidratar();
      colaRef.current = [];
      setEstado('vivo');
    } catch {
      /* si rrweb no cargó, se queda en "esperando" hasta el próximo checkout */
    } finally {
      iniciandoRef.current = false;
    }
  }, [ajustarEscala]);

  const manejarLote = useCallback((lote: any[]) => {
    if (!Array.isArray(lote) || lote.length === 0) return;

    for (const ev of lote) {
      // Cambio de tema del supervisado. Antes esto DESTRUÍA el reproductor
      // para remontarlo con la foto siguiente, y ahí nacía el parpadeo en
      // blanco: entre tirar el DOM y recibir la foto nueva no había nada
      // que pintar. Ahora solo se anota el tema y se pinta la clase sobre
      // el <html> del iframe — es un atributo, no una reconstrucción, así
      // que el cambio es instantáneo y el contenido no se pierde nunca.
      // El supervisado manda SU hoja de estilos. Se guarda y se reinyecta
      // pisando la del Superadmin: es la única que tiene garantizado el
      // estilo de los módulos que esa persona está mirando.
      if (ev?.type === 5 && ev?.data?.tag === 'css') {
        const texto = ev.data.payload?.texto;
        if (typeof texto === 'string' && texto.length > 0) {
          cssRemotoRef.current = texto;
          try {
            const doc = (replayerRef.current?.iframe as HTMLIFrameElement | undefined)?.contentDocument;
            doc?.head?.querySelector('[data-tv-css]')?.remove();
          } catch { /* nada */ }
          inyectarEstilos();
        }
        continue;
      }

      if (ev?.type === 5 && ev?.data?.tag === 'tema') {
        const p = ev.data.payload || {};
        temaRef.current = { clase: p.clase || '', estilo: p.estilo || '', data: p.data || '' };
        aplicarTema();
        continue;
      }

      // Batería y red del supervisado (ver utils/telemetria.ts). Es
      // informativo, no forma parte del DOM replicado: no va a rrweb.
      if (ev?.type === 5 && ev?.data?.tag === 'telemetria') {
        setTelemetria(ev.data.payload || null);
        continue;
      }

      if (replayerRef.current) {
        try { replayerRef.current.addEvent(ev); } catch { /* evento suelto */ }
        continue;
      }

      // Aún sin reproductor: acumula hasta que llegue una foto completa.
      colaRef.current.push(ev);
      if (colaRef.current.length > 2000) colaRef.current = colaRef.current.slice(-2000);
    }

    if (!replayerRef.current) void iniciarSiHayFoto();
  }, [iniciarSiHayFoto, aplicarTema, inyectarEstilos]);

  /** Reensambla los trozos del canal rápido y descomprime los eventos. */
  const manejarTrozo = useCallback(async (p: any) => {
    if (!p?.id || typeof p.d !== 'string') return;
    const mapa = trozosRef.current;
    const entrada = mapa.get(p.id) || { n: p.n || 1, partes: [] };
    entrada.partes[p.i || 0] = p.d;
    mapa.set(p.id, entrada);

    const completo = entrada.partes.filter(Boolean).length === entrada.n;
    if (!completo) return;
    mapa.delete(p.id);

    try {
      const crudo = JSON.parse(entrada.partes.join(''));
      const { unpack } = await import('rrweb');
      // El grabador comprime cada evento; `unpack` devuelve el objeto.
      const eventos = (crudo as any[]).map(e => { try { return unpack(e); } catch { return e; } });
      manejarLote(eventos);
    } catch { /* lote corrupto: el próximo checkout lo arregla */ }
  }, [manejarLote]);

  // --------------------------- Enganche / desenganche ---------------------------
  const cerrarCanales = useCallback(() => {
    if (canalEventosRef.current) { try { supabase.removeChannel(canalEventosRef.current); } catch { /* nada */ } canalEventosRef.current = null; }
    if (canalEspejoRef.current) { try { supabase.removeChannel(canalEspejoRef.current); } catch { /* nada */ } canalEspejoRef.current = null; }
  }, []);

  // La selección es UNA clave para los dos tipos de supervisado:
  //   · personal  → su user_id
  //   · cliente   → "v:" + el id de su aparato
  // Así todo el motor del espejo (canales, cola, remonte por tema) es el
  // mismo para ambos y no hay dos caminos que mantener en paralelo.
  const esVisita = (clave: string) => clave.startsWith('v:');
  const idDeVisita = (clave: string) => clave.slice(2);

  const pedirGrabacion = useCallback(async (clave: string, encendido: boolean) => {
    try {
      if (esVisita(clave)) {
        await supabase.rpc('visitante_mirar', { p_visita: idDeVisita(clave), p_watch: encendido });
      } else {
        await supabase.from('supervision_state').update({ watch: encendido }).eq('user_id', clave);
      }
    } catch { /* nada */ }
  }, []);

  const soltar = useCallback(async (clave: string | null) => {
    cerrarCanales();
    destruirReplayer();
    if (clave) await pedirGrabacion(clave, false);
  }, [destruirReplayer, cerrarCanales, pedirGrabacion]);

  /** Abre los dos caminos (rápido y respaldo) y pide la grabación. */
  const engancharA = useCallback(async (clave: string) => {
    setEstado('esperando');

    // Camino rápido: canal privado de broadcast. Es el único que tienen
    // los clientes de la tienda (no pueden escribir en la tabla).
    try {
      const topic = esVisita(clave) ? `espejo:v:${idDeVisita(clave)}` : `espejo:${clave}`;
      const espejo = supabase.channel(topic, { config: { private: true } });
      espejo.on('broadcast', { event: 'lote' }, (msg: any) => {
        if (selRef.current === clave) void manejarTrozo(msg?.payload);
      });
      // Cuadros de la cámara del operador, por el MISMO canal privado que
      // la pantalla. Solo llegan si la persona dio permiso; si lo negó, el
      // espejo funciona igual y el recuadro no aparece.
      espejo.on('broadcast', { event: 'cam' }, (msg: any) => {
        if (selRef.current === clave && typeof msg?.payload?.d === 'string') {
          setCaraCuadro(msg.payload.d);
          setCamEstado('ok');
        }
      });
      // El operador avisa POR QUÉ no hay cara (sin permiso, sin cámara…),
      // para no dejar al Superadmin adivinando frente a un hueco.
      espejo.on('broadcast', { event: 'cam-estado' }, (msg: any) => {
        if (selRef.current === clave) setCamEstado(msg?.payload?.estado || null);
      });
      espejo.subscribe();
      canalEspejoRef.current = espejo;
    } catch { /* si el canal no se puede abrir, queda el respaldo */ }

    // Se pide la grabación en cuanto el camino rápido está escuchando. Va
    // ANTES que el canal de respaldo a propósito: es lo único que el
    // empleado necesita para empezar a mandar, y adelantarlo le quita al
    // arranque el tiempo de negociar un segundo WebSocket.
    await pedirGrabacion(clave, true);

    // "Volcá tu DOM ya": fuerza el arranque inmediato del espejo sin
    // esperar al checkout periódico. Se repite unas veces por si la
    // grabación aún estaba levantándose cuando llegó el primer pedido —así
    // el arranque es < 1 s en vez de depender de la foto de los 12 s.
    const canalEspejo = canalEspejoRef.current;
    if (canalEspejo) {
      const pedirFoto = () => { try { void canalEspejo.send({ type: 'broadcast', event: 'pedir-foto', payload: {} }); } catch { /* nada */ } };
      for (const ms of [250, 700, 1500, 3000]) {
        setTimeout(() => { if (selRef.current === clave && !replayerRef.current) pedirFoto(); }, ms);
      }
    }

    // Camino de respaldo por tabla: solo existe para el personal, y se
    // engancha FUERA del camino crítico. Antes se suscribía siempre y de
    // entrada, sumando un apretón de manos completo a la espera aunque el
    // canal rápido fuera a funcionar —que es lo normal—. Ahora se arma un
    // par de segundos después, y solo sigue ahí por si el rápido falla.
    if (!esVisita(clave)) {
      setTimeout(() => {
        if (selRef.current !== clave || canalEventosRef.current) return;
        const canal = supabase
          .channel(`supervision-ev-${clave}`)
          .on('postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'supervision_events', filter: `user_id=eq.${clave}` },
            (payload: any) => { if (selRef.current === clave) void manejarLote(payload?.new?.lote || []); })
          .subscribe();
        canalEventosRef.current = canal;
      }, 2000);
    }
  }, [manejarLote, manejarTrozo, pedirGrabacion]);

  const mirar = useCallback(async (clave: string) => {
    if (sel === clave) { await soltar(clave); setSel(null); setEstado('idle'); return; }
    await soltar(sel);
    setSel(clave);
    await engancharA(clave);
  }, [sel, soltar, engancharA]);

  // --------------------------- Botón "Actualizar" ---------------------------
  // Dos trabajos distintos, según lo que pase de verdad:
  //
  //   a) La ficha quedó colgada porque la persona ya cerró sesión o cerró
  //      la app  → se retira de la lista en el acto.
  //   b) La persona sigue conectada pero el espejo no cargó → se fuerza
  //      una reconexión limpia del canal (se suelta y se vuelve a pedir la
  //      grabación), que es lo que destraba la pantalla.
  const actualizar = useCallback(async () => {
    setRefrescando(true);
    setAviso(null);
    try {
      const { filas, visitas } = await cargar();

      // (a) Barre las fichas que ya no laten, de personal y de clientes.
      // Si alguien solo estaba en segundo plano, vuelve a aparecer con su
      // próximo latido (10 s).
      const caducadas = filas.filter(p => !enLinea(p)).map(p => p.user_id);
      if (caducadas.length > 0) {
        try { await supabase.from('supervision_state').delete().in('user_id', caducadas); } catch { /* nada */ }
        setGente(prev => prev.filter(p => !caducadas.includes(p.user_id)));
      }
      const visitasIdas = visitas.filter(v => !visitaEnLinea(v)).map(v => v.visita);
      if (visitasIdas.length > 0) {
        try { await supabase.from('supervision_visitantes').delete().in('visita', visitasIdas); } catch { /* nada */ }
        setVisitantes(prev => prev.filter(v => !visitasIdas.includes(v.visita)));
      }

      const actual = selRef.current;
      const retiradas = caducadas.length + visitasIdas.length;
      if (!actual) {
        setAviso(retiradas > 0 ? `Se retiraron ${retiradas} sesión(es) cerradas.` : 'Lista al día.');
        return;
      }

      const sigueVivo = esVisita(actual)
        ? visitas.some(v => v.visita === idDeVisita(actual) && visitaEnLinea(v))
        : filas.some(p => p.user_id === actual && enLinea(p));

      if (!sigueVivo) {
        // (a) A quien mirábamos ya no está: se suelta y se quita.
        await soltar(actual);
        setSel(null);
        setEstado('idle');
        setAviso('Esa persona ya cerró sesión. Se quitó de la lista.');
        return;
      }

      // (b) Sigue conectada. Si el espejo YA está vivo —canal abierto y
      // reproductor montado— no se tira nada abajo: se pide una foto
      // COMPLETA nueva sobre el mismo canal (el equivalente a un keyframe)
      // y la imagen se refresca en milisegundos, sin renegociar el
      // WebSocket ni pasar por la pantalla en blanco. La reconexión limpia
      // queda SOLO para cuando de verdad no hay espejo que refrescar.
      const canalVivo = canalEspejoRef.current;
      if (canalVivo && replayerRef.current) {
        try { void canalVivo.send({ type: 'broadcast', event: 'pedir-foto', payload: {} }); } catch { /* si falla, abajo está la reconexión */ }
        setAviso('Imagen actualizada.');
        return;
      }

      // Sin espejo vivo (nunca cargó o el reproductor murió): ahí sí, la
      // reconexión limpia del canal, que es lo que destraba el arranque.
      await soltar(actual);
      destruirReplayer();
      await new Promise(r => setTimeout(r, 400));
      await engancharA(actual);
      setAviso('Canal reconectado. Reintentando el espejo…');
    } finally {
      setRefrescando(false);
    }
  }, [cargar, soltar, engancharA, destruirReplayer]);

  // Al desmontar, suelta a quien se esté mirando (para su grabación).
  useEffect(() => () => { void soltar(selRef.current); }, [soltar]);

  // Título y pie del espejo, sirva para personal o para un cliente. De un
  // cliente solo se puede decir el modelo: no hay más datos que mostrar.
  const visitaSel = sel && esVisita(sel) ? visitantes.find(v => v.visita === idDeVisita(sel)) || null : null;
  const personaSel = sel && !esVisita(sel) ? gente.find(p => p.user_id === sel) || null : null;

  // Bloqueo del aparato físico de quien se está mirando, en un clic. Deja
  // el objetivo en el Kill Switch y avisa a todos: si es su propio equipo,
  // le cae la pantalla de bloqueo en el acto.
  const [bloqueandoAparato, setBloqueandoAparato] = useState(false);
  const bloquearAparato = useCallback(async () => {
    const device = personaSel?.device;
    if (!device) return;
    setBloqueandoAparato(true);
    try {
      await supabase.from('system_bans').insert({
        tipo: 'device', valor: device,
        motivo: `Aparato de ${personaSel?.email || 'personal'} bloqueado desde supervisión`,
      });
      const { avisarCambioDeBloqueos } = await import('../../seguridad/killSwitch');
      await avisarCambioDeBloqueos();
    } catch { /* el panel de Bloqueos muestra el detalle si algo falla */ }
    finally { setBloqueandoAparato(false); }
  }, [personaSel]);
  const seleccionado = personaSel || visitaSel
    ? {
        titulo: personaSel ? (personaSel.email || 'desconocido') : nombreDeAparato(visitaSel!),
        ruta: (personaSel ? personaSel.ruta : visitaSel!.ruta) || '—',
        last_seen: personaSel ? personaSel.last_seen : visitaSel!.last_seen,
      }
    : null;

  // ------------------------- Tomar control -------------------------
  // Operar la sesión que se está mirando: los clics/scroll/texto del
  // Superadmin viajan por `control:<llave>` y el objetivo los aplica. Su
  // pantalla del objetivo ya se ve por el espejo; la del Superadmin nunca
  // sale de acá. Coordenadas RELATIVAS al iframe del espejo, para que el
  // clic caiga en el mismo punto sin importar la escala del panel.
  const [controlando, setControlando] = useState(false);
  const emisorRef = useRef<EmisorControl | null>(null);

  // Cambiar de persona o perder el espejo suelta el control: nunca se
  // manda un comando a alguien que ya no se está mirando.
  useEffect(() => { setControlando(false); }, [sel]);

  useEffect(() => {
    if (!controlando || !sel || estado !== 'vivo') {
      if (emisorRef.current) { emisorRef.current.cerrar(); emisorRef.current = null; }
      return;
    }
    const llave = esVisita(sel) ? `v:${idDeVisita(sel)}` : sel;
    emisorRef.current = abrirEmisorControl(llave);
    return () => { if (emisorRef.current) { emisorRef.current.cerrar(); emisorRef.current = null; } };
  }, [controlando, sel, estado]);

  const rectEspejo = (): DOMRect | null => {
    try {
      const ifr = replayerRef.current?.iframe as HTMLIFrameElement | undefined;
      const r = ifr?.getBoundingClientRect();
      return r && r.width > 0 && r.height > 0 ? r : null;
    } catch { return null; }
  };
  const clicControl = (e: React.MouseEvent) => {
    const r = rectEspejo(); if (!r || !emisorRef.current) return;
    const xr = (e.clientX - r.left) / r.width;
    const yr = (e.clientY - r.top) / r.height;
    if (xr < 0 || xr > 1 || yr < 0 || yr > 1) return;
    emisorRef.current.enviar({ t: 'click', xr, yr });
    (e.currentTarget as HTMLElement).focus();
  };
  const ruedaControl = (e: React.WheelEvent) => {
    const r = rectEspejo(); if (!r || !emisorRef.current) return;
    emisorRef.current.enviar({ t: 'scroll', dyr: e.deltaY / r.height });
  };
  const teclaControl = (e: React.KeyboardEvent) => {
    if (!emisorRef.current) return;
    if (e.key === 'Enter' || e.key === 'Backspace' || e.key === 'Tab') {
      e.preventDefault();
      emisorRef.current.enviar({ t: 'tecla', k: e.key });
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      emisorRef.current.enviar({ t: 'texto', v: e.key });
    }
  };

  // --------------- Controlar desde el celular una sesión de escritorio ---------------
  // El "Tomar control" de arriba ya sirve tal cual en computadora (clic
  // directo). Lo de acá es SOLO para cuando quien mira es un dedo en una
  // pantalla chica y lo que mira es ancho: zoom/paneo táctil, un modo
  // trackpad para apuntar con precisión sin que el dedo tape el punto, y
  // una barra de acciones con botones grandes. Las coordenadas relativas
  // que ya usa `clicControl` no cambian con el zoom —se calculan del
  // rectángulo REAL en pantalla en el momento del toque—, así que hacer
  // zoom con un `transform: scale()` es seguro: no hace falta ningún
  // ajuste extra al mandar el clic.
  const esTactil = typeof window !== 'undefined' && (('ontouchstart' in window) || navigator.maxTouchPoints > 0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [modoTrackpad, setModoTrackpad] = useState(false);
  const [clicDerechoArmado, setClicDerechoArmado] = useState(false);
  const [cursorTrackpad, setCursorTrackpad] = useState({ xr: 0.5, yr: 0.5 });
  const [sugerirHorizontal, setSugerirHorizontal] = useState(false);
  const tocandoRef = useRef<{
    inicio: { x: number; y: number } | null;
    distanciaInicial: number | null;
    zoomInicial: number;
    panInicial: { x: number; y: number };
    movio: boolean;
  }>({ inicio: null, distanciaInicial: null, zoomInicial: 1, panInicial: { x: 0, y: 0 }, movio: false });

  const restablecerZoom = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  // Reinicia todo lo táctil al soltar el control o cambiar de persona:
  // nada de esto debe sobrevivir a la siguiente sesión de control.
  useEffect(() => {
    if (!controlando) {
      restablecerZoom();
      setModoTrackpad(false);
      setClicDerechoArmado(false);
    }
  }, [controlando]);

  // Sugerencia de horizontal: solo tiene sentido en un aparato táctil,
  // controlando de verdad, y en vertical. `matchMedia` reacciona sola si
  // gira el teléfono mientras el aviso está puesto.
  useEffect(() => {
    if (!esTactil || !controlando || estado !== 'vivo' || typeof window === 'undefined') { setSugerirHorizontal(false); return; }
    const mq = window.matchMedia('(orientation: portrait)');
    const actualizar = () => setSugerirHorizontal(mq.matches);
    actualizar();
    mq.addEventListener?.('change', actualizar);
    return () => mq.removeEventListener?.('change', actualizar);
  }, [esTactil, controlando, estado]);

  function distanciaEntre(a: Touch, b: Touch): number {
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }

  // React marca `onTouchStart`/`onTouchMove` como PASIVOS por defecto (para
  // no trabarle el scroll a cualquier página): un `e.preventDefault()`
  // adentro de esos props JSX no frena el pinch-zoom ni el scroll nativos
  // del navegador, aunque el código se vea normal. Por eso los listeners
  // van a mano, con `{ passive: false }` explícito, sobre el nodo real.
  //
  // `vivo` guarda lo último de cada estado que cambia seguido (zoom, pan,
  // modo trackpad...) para que estas funciones —creadas UNA vez— siempre
  // lean el valor actual sin tener que reconectar los listeners en cada
  // repintado, que sería carísimo en un gesto de arrastre.
  const vivoRef = useRef({ zoom, pan, modoTrackpad, clicDerechoArmado, cursorTrackpad });
  vivoRef.current = { zoom, pan, modoTrackpad, clicDerechoArmado, cursorTrackpad };

  const overlayControlRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = overlayControlRef.current;
    if (!el || !esTactil) return;

    const tocarInicio = (e: TouchEvent) => {
      const t = tocandoRef.current;
      t.movio = false;
      if (e.touches.length === 2) {
        t.distanciaInicial = distanciaEntre(e.touches[0], e.touches[1]);
        t.zoomInicial = vivoRef.current.zoom;
        t.panInicial = vivoRef.current.pan;
        t.inicio = null;
      } else if (e.touches.length === 1) {
        t.inicio = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        t.distanciaInicial = null;
      }
    };

    const tocarMover = (e: TouchEvent) => {
      const t = tocandoRef.current;
      const { zoom: z, modoTrackpad: trackpad } = vivoRef.current;
      if (e.touches.length === 2 && t.distanciaInicial) {
        e.preventDefault();
        t.movio = true;
        const dist = distanciaEntre(e.touches[0], e.touches[1]);
        const nuevoZoom = Math.min(4, Math.max(1, t.zoomInicial * (dist / t.distanciaInicial)));
        setZoom(nuevoZoom);
        return;
      }
      if (e.touches.length === 1 && t.inicio) {
        const dx = e.touches[0].clientX - t.inicio.x;
        const dy = e.touches[0].clientY - t.inicio.y;
        if (Math.hypot(dx, dy) > 8) t.movio = true;

        if (trackpad && z <= 1.01) {
          // Trackpad: el dedo mueve un CURSOR virtual por delta, no por
          // posición absoluta —así el dedo nunca tapa el punto exacto—.
          e.preventDefault();
          const r = rectEspejo();
          if (r) {
            setCursorTrackpad(c => ({
              xr: Math.min(1, Math.max(0, c.xr + dx / r.width)),
              yr: Math.min(1, Math.max(0, c.yr + dy / r.height)),
            }));
          }
          t.inicio = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        } else if (z > 1.01) {
          // Con zoom aplicado, un dedo pasea la ventana (paneo), no controla.
          e.preventDefault();
          setPan(p => ({ x: p.x + dx, y: p.y + dy }));
          t.inicio = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }
      }
    };

    const tocarFin = (e: TouchEvent) => {
      const t = tocandoRef.current;
      const { modoTrackpad: trackpad, clicDerechoArmado: armado, cursorTrackpad: cursor } = vivoRef.current;
      // Toque corto sin arrastre: es un TAP, no un gesto de zoom/paneo.
      // `preventDefault` acá evita que el navegador dispare DESPUÉS un
      // `click` sintético por su cuenta y el tap se mande dos veces.
      if (!t.movio && t.inicio && e.touches.length === 0) {
        e.preventDefault();
        if (emisorRef.current) {
          if (trackpad) {
            // En trackpad el tap dispara sobre donde está el cursor
            // virtual, no donde cayó el dedo —pudo levantarse lejos—.
            emisorRef.current.enviar(armado ? { t: 'clic-derecho', ...cursor } : { t: 'click', ...cursor });
          } else {
            const r = rectEspejo();
            if (r) {
              const xr = (t.inicio.x - r.left) / r.width;
              const yr = (t.inicio.y - r.top) / r.height;
              if (xr >= 0 && xr <= 1 && yr >= 0 && yr <= 1) {
                emisorRef.current.enviar(armado ? { t: 'clic-derecho', xr, yr } : { t: 'click', xr, yr });
              }
            }
          }
          if (armado) setClicDerechoArmado(false); // un solo disparo por armado
        }
      }
      t.inicio = null;
      t.distanciaInicial = null;
    };

    el.addEventListener('touchstart', tocarInicio, { passive: false });
    el.addEventListener('touchmove', tocarMover, { passive: false });
    el.addEventListener('touchend', tocarFin, { passive: false });
    return () => {
      el.removeEventListener('touchstart', tocarInicio);
      el.removeEventListener('touchmove', tocarMover);
      el.removeEventListener('touchend', tocarFin);
    };
  }, [controlando, estado, esTactil]);

  // Teclado en pantalla: un input real, oculto, es la única forma
  // confiable de sacar el teclado nativo del teléfono. Se compara el
  // valor anterior contra el nuevo para saber si se agregó o se borró
  // texto —los teclados móviles no mandan una tecla por evento como un
  // teclado físico, mandan el valor ya compuesto (autocompletado,
  // predicción, etc. incluidos)—.
  const [tecladoAbierto, setTecladoAbierto] = useState(false);
  const inputTecladoRef = useRef<HTMLInputElement>(null);
  const valorTecladoRef = useRef('');
  const abrirTecladoEnPantalla = () => {
    setTecladoAbierto(true);
    valorTecladoRef.current = '';
    setTimeout(() => inputTecladoRef.current?.focus(), 50);
  };
  const cambioTeclado = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!emisorRef.current) return;
    const nuevo = e.target.value;
    const anterior = valorTecladoRef.current;
    if (nuevo.length > anterior.length && nuevo.startsWith(anterior)) {
      emisorRef.current.enviar({ t: 'texto', v: nuevo.slice(anterior.length) });
    } else if (nuevo.length < anterior.length) {
      for (let i = 0; i < anterior.length - nuevo.length; i++) emisorRef.current.enviar({ t: 'tecla', k: 'Backspace' });
    } else if (nuevo !== anterior) {
      // Reemplazo grande (pegar, autocorrección): se manda entero de nuevo.
      emisorRef.current.enviar({ t: 'texto', v: nuevo });
    }
    valorTecladoRef.current = nuevo;
  };
  const teclaEspecialTeclado = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!emisorRef.current) return;
    if (e.key === 'Enter') { e.preventDefault(); emisorRef.current.enviar({ t: 'tecla', k: 'Enter' }); }
  };

  return (
    <div className="tv-stack">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-[var(--accent)]/12 text-[var(--accent)] flex items-center justify-center shrink-0">
            <MonitorPlay className="w-[18px] h-[18px]" />
          </div>
          <div>
            <h2 className="font-display font-bold text-[15px] text-[var(--text-primary)] leading-tight">Supervisión</h2>
            <p className="text-[11.5px] text-[var(--text-secondary)]">Espejo en vivo de la sesión del personal.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {aviso && (
            <span className="hidden sm:block text-[11px] text-[var(--text-secondary)] max-w-[280px] truncate">{aviso}</span>
          )}
          <button
            type="button"
            onClick={() => void actualizar()}
            disabled={refrescando}
            className="h-8 px-2.5 rounded-lg flex items-center gap-1.5 border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition disabled:opacity-60"
            aria-label="Actualizar"
          >
            <RefreshCw className={`w-4 h-4 ${refrescando ? 'animate-spin' : ''}`} />
            <span className="text-[11.5px] font-semibold">Actualizar</span>
          </button>
        </div>
      </div>

      {aviso && (
        <p className="sm:hidden text-[11.5px] text-[var(--text-secondary)] -mt-1">{aviso}</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-4">
        {/* Selector de personal conectado */}
        <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-surface)] overflow-hidden">
          <div className="px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-sunken)]">
            <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--text-muted)]">Conectados</span>
          </div>
          {gente.filter(enLinea).length === 0 ? (
            <p className="text-[12px] text-[var(--text-muted)] italic px-3 py-6 text-center">Nadie del personal en línea.</p>
          ) : (
            gente.filter(enLinea).map(p => {
              const esApk = p.entorno === 'apk';
              const activo = p.user_id === sel;
              const pantallaLista = pantallasListas.has(p.user_id);
              return (
                <div
                  key={p.user_id}
                  className={`flex items-center gap-1 border-b border-[var(--border-color)]/50 last:border-b-0 transition ${
                    activo ? 'bg-[var(--accent)]/10' : ''
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => void mirar(p.user_id)}
                    className={`flex-1 min-w-0 text-left px-3 py-2.5 flex items-center gap-2.5 transition ${
                      activo ? '' : 'hover:bg-[var(--bg-sunken)]'
                    }`}
                  >
                    <span className="relative shrink-0">
                      <span className="w-8 h-8 rounded-full bg-[rgba(var(--accent-rgb),0.12)] text-[var(--accent)] flex items-center justify-center font-display font-bold text-[12px]">
                        {(p.email || '?').charAt(0).toUpperCase()}
                      </span>
                      <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[var(--ok)] border-2 border-[var(--bg-surface)]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12.5px] font-semibold text-[var(--text-primary)] truncate">{p.email || 'desconocido'}</span>
                      <span className="flex items-center gap-1 text-[10.5px] text-[var(--text-secondary)] truncate">
                        {esApk ? <Smartphone className="w-3 h-3 shrink-0" /> : <Monitor className="w-3 h-3 shrink-0" />}
                        <span className="truncate">{p.ruta || '—'}</span>
                      </span>
                    </span>
                  </button>
                  {/* Pantalla completa REAL. Solo aparece si esa persona ya
                      la ofreció (consintió + tiene computadora): no pide
                      permiso, no la enciende, solo se conecta a lo que ya
                      está listo (ver capturaPantalla.ts). */}
                  {pantallaLista && (
                    <button
                      type="button"
                      onClick={() => setViendoPantalla(p.user_id)}
                      title="Ver pantalla completa (con notificaciones y otras apps)"
                      className="shrink-0 mr-2 w-7 h-7 rounded-lg flex items-center justify-center text-[var(--accent)] hover:bg-[var(--accent)]/12"
                    >
                      <ScreenShare className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })
          )}

          {/* --------- Clientes en la tienda ---------
              SOLO el modelo del aparato. Nunca correo, nombre ni IP:
              ni siquiera llegan hasta aquí (ver supervision/visitante.ts
              y la tabla supervision_visitantes). */}
          <div className="px-3 py-2 border-y border-[var(--border-color)] bg-[var(--bg-sunken)] flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--text-muted)]">En la tienda</span>
            <span className="text-[10px] font-mono text-[var(--text-muted)]">solo modelo</span>
          </div>
          {visitantes.filter(visitaEnLinea).length === 0 ? (
            <p className="text-[12px] text-[var(--text-muted)] italic px-3 py-5 text-center">Ningún cliente navegando ahora.</p>
          ) : (
            visitantes.filter(visitaEnLinea).map(v => {
              const clave = `v:${v.visita}`;
              const esApk = v.entorno === 'apk';
              const activo = clave === sel;
              const pantallaLista = pantallasListas.has(clave);
              return (
                <div
                  key={v.visita}
                  className={`flex items-center gap-1 border-b border-[var(--border-color)]/50 last:border-b-0 transition ${
                    activo ? 'bg-[var(--accent)]/10' : ''
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => void mirar(clave)}
                    className={`flex-1 min-w-0 text-left px-3 py-2.5 flex items-center gap-2.5 transition ${
                      activo ? '' : 'hover:bg-[var(--bg-sunken)]'
                    }`}
                  >
                    <span className="relative shrink-0">
                      <span className="w-8 h-8 rounded-lg bg-[var(--bg-sunken)] text-[var(--text-secondary)] flex items-center justify-center">
                        {esApk ? <Smartphone className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
                      </span>
                      <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[var(--ok)] border-2 border-[var(--bg-surface)]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12.5px] font-semibold text-[var(--text-primary)] truncate">{nombreDeAparato(v)}</span>
                      <span className="block text-[10.5px] text-[var(--text-secondary)] truncate">{v.ruta || '—'}</span>
                    </span>
                  </button>
                  {pantallaLista && (
                    <button
                      type="button"
                      onClick={() => setViendoPantalla(clave)}
                      title="Ver pantalla completa (con notificaciones y otras apps)"
                      className="shrink-0 mr-2 w-7 h-7 rounded-lg flex items-center justify-center text-[var(--accent)] hover:bg-[var(--accent)]/12"
                    >
                      <ScreenShare className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Espejo */}
        <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-base)] overflow-hidden min-h-[280px] flex flex-col">
          <div className="px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-surface)] flex items-center justify-between">
            <span className="text-[12px] font-semibold text-[var(--text-primary)] truncate">
              {seleccionado ? seleccionado.titulo : 'Elegí a alguien de la izquierda'}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              {estado === 'vivo' && (
                <button
                  type="button"
                  onClick={() => setControlando(v => !v)}
                  className={`flex items-center gap-1.5 text-[10.5px] font-bold px-2.5 py-1 rounded-full transition ${
                    controlando
                      ? 'bg-[#0f766e] text-white'
                      : 'bg-[var(--bg-sunken)] text-[var(--text-secondary)] border border-[var(--border-color)] hover:text-[var(--text-primary)]'
                  }`}
                  title="Operar esta sesión de forma remota: clic = clic, rueda = scroll, teclado = escribir. El objetivo ve un aviso de 'soporte activo'."
                >
                  {controlando ? 'Soltar control' : 'Tomar control'}
                </button>
              )}
              {estado === 'vivo' && (
                <span className="flex items-center gap-1.5 text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-[var(--ok-soft)] text-[var(--ok)]">
                  <Radio className="w-3 h-3 animate-pulse" /> En vivo
                </span>
              )}
              {estado === 'esperando' && (
                <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-[var(--bg-sunken)] text-[var(--text-muted)]">Conectando…</span>
              )}
            </div>
          </div>

          {/* Lienzo del reproductor. Fondo oscuro neutro para que la
              pantalla replicada resalte sea cual sea el tema. */}
          <div className="flex-1 relative bg-[#0b0f0e] overflow-hidden">
            {/* Envoltorio de zoom/paneo táctil: es una capa de transform
                INDEPENDIENTE de la que ya usa `ajustarEscala` sobre
                `.replayer-wrapper` (esa encoge la pantalla entera para que
                quepa; esta es el pellizco del dedo). Se componen sin
                pisarse porque están en dos elementos distintos. */}
            <div
              className="w-full h-full"
              style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0', transition: zoom === 1 && pan.x === 0 && pan.y === 0 ? 'transform 200ms ease-out' : 'none' }}
            >
              <div ref={lienzoRef} className="w-full" />
            </div>

            {/* Capa de captura del control remoto. Los clics sobre el
                iframe del espejo no llegan al contenedor, así que se pone
                una capa transparente encima que atrapa el input del
                Superadmin y lo traduce a coordenadas relativas. Solo
                existe mientras "Tomar control" está activo y hay señal.
                En un aparato táctil, además atrapa pellizco (zoom), un
                dedo (paneo o trackpad) y el tap (clic). */}
            {controlando && estado === 'vivo' && (
              <div
                ref={overlayControlRef}
                className="absolute inset-0 z-20 cursor-crosshair outline-none touch-none"
                tabIndex={0}
                onClick={esTactil ? undefined : clicControl}
                onWheel={ruedaControl}
                onKeyDown={teclaControl}
                title="Operando la sesión. Clic para hacer clic, rueda para desplazar, teclado para escribir."
              >
                {esTactil && modoTrackpad && zoom <= 1.01 && (
                  <span
                    className="absolute w-5 h-5 rounded-full border-2 border-white bg-[var(--accent)]/70 shadow-lg -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                    style={{ left: `${cursorTrackpad.xr * 100}%`, top: `${cursorTrackpad.yr * 100}%` }}
                  />
                )}
              </div>
            )}

            {/* Sugerencia de girar el teléfono: solo estorba mientras hace
                falta, y desaparece sola en cuanto gira o suelta control. */}
            {sugerirHorizontal && (
              <div className="absolute inset-x-3 top-3 z-30 flex items-center gap-2 rounded-xl bg-black/80 px-3 py-2 text-[11px] text-white">
                <RotateCw className="w-4 h-4 shrink-0" />
                Girá el teléfono a horizontal para controlar mejor esta pantalla de escritorio.
              </div>
            )}

            {/* Barra de acciones táctiles: solo en aparato táctil, solo
                controlando de verdad. Botones grandes (44px) a propósito —
                es lo que Apple/Google piden como área mínima de toque. */}
            {esTactil && controlando && estado === 'vivo' && (
              <div className="absolute inset-x-2 bottom-2 z-30 flex items-center justify-center gap-1.5 rounded-2xl bg-black/75 backdrop-blur-sm p-1.5">
                <button
                  type="button"
                  onClick={() => setModoTrackpad(v => !v)}
                  className={`flex flex-col items-center justify-center gap-0.5 w-11 h-11 rounded-xl text-white transition ${modoTrackpad ? 'bg-[var(--accent)]' : 'bg-white/10'}`}
                  title="Modo trackpad: arrastrar mueve un cursor en vez de tocar directo"
                >
                  <MousePointer2 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setClicDerechoArmado(v => !v)}
                  className={`flex flex-col items-center justify-center gap-0.5 w-11 h-11 rounded-xl text-white transition ${clicDerechoArmado ? 'bg-[var(--accent)]' : 'bg-white/10'}`}
                  title="Próximo toque = clic derecho"
                >
                  <span className="text-[9px] font-bold leading-none">CLIC</span>
                  <span className="text-[7px] font-bold leading-none opacity-80">DER.</span>
                </button>
                <button
                  type="button"
                  onClick={abrirTecladoEnPantalla}
                  className="flex items-center justify-center w-11 h-11 rounded-xl bg-white/10 text-white"
                  title="Teclado en pantalla"
                >
                  <Keyboard className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => emisorRef.current?.enviar({ t: 'tecla', k: 'Escape' })}
                  className="flex items-center justify-center w-11 h-11 rounded-xl bg-white/10 text-white text-[10px] font-bold"
                  title="Cancelar (Esc)"
                >
                  Esc
                </button>
                {zoom > 1.01 && (
                  <button
                    type="button"
                    onClick={restablecerZoom}
                    className="flex items-center justify-center w-11 h-11 rounded-xl bg-white/10 text-white"
                    title="Restablecer zoom 100%"
                  >
                    <span className="text-[9px] font-bold">100%</span>
                  </button>
                )}
              </div>
            )}

            {/* Input real, oculto, solo para sacar el teclado nativo del
                teléfono (ver abrirTecladoEnPantalla). No se muestra nunca:
                lo que se ve en pantalla es el espejo, no este campo. */}
            {tecladoAbierto && (
              <input
                ref={inputTecladoRef}
                type="text"
                inputMode="text"
                autoCapitalize="off"
                autoCorrect="off"
                className="absolute opacity-0 pointer-events-none w-px h-px"
                style={{ left: -9999 }}
                onChange={cambioTeclado}
                onKeyDown={teclaEspecialTeclado}
                onBlur={() => setTecladoAbierto(false)}
              />
            )}

            {/* ---------- Cámara del operador (PiP) ----------
                Solo aparece si la persona dio permiso al navegador. Si lo
                negó, no hay recuadro y el espejo de pantalla sigue igual.
                El operador ve en su propia pantalla un aviso de que su
                cámara está encendida (ver supervision/camara.ts). */}
            {caraCuadro && (
              <div className="absolute bottom-3 right-3 w-[110px] sm:w-[150px] rounded-xl overflow-hidden border-2 border-white/25 shadow-2xl bg-black">
                <img
                  src={caraCuadro}
                  alt="Cámara del operador"
                  className="block w-full h-auto"
                />
                <span className="absolute top-1 left-1 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-black/65 text-[8.5px] font-bold uppercase tracking-wide text-white">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                  Cámara
                </span>
              </div>
            )}

            {/* Sin cara: se dice POR QUÉ, en vez de dejar un hueco mudo. */}
            {!caraCuadro && camEstado && camEstado !== 'ok' && estado === 'vivo' && (
              <div className="absolute bottom-3 right-3 max-w-[190px] rounded-lg bg-black/75 px-2.5 py-1.5 text-[10.5px] leading-snug text-white/80">
                {camEstado === 'sin-permiso'
                  ? 'Cámara sin permiso: la persona lo negó. Debe habilitarla en los ajustes de su navegador.'
                  : camEstado === 'sin-camara'
                    ? 'Ese aparato no tiene cámara disponible.'
                    : 'No se pudo abrir la cámara en ese aparato.'}
              </div>
            )}
            {estado !== 'vivo' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6 pointer-events-none">
                <MonitorPlay className="w-9 h-9 text-white/20" />
                <p className="text-[12.5px] text-white/45">
                  {seleccionado ? 'Esperando la señal del dispositivo…' : 'El espejo aparece al elegir a alguien conectado.'}
                </p>
              </div>
            )}
          </div>

          {seleccionado && (
            <div className="px-3 py-2 border-t border-[var(--border-color)] bg-[var(--bg-surface)] flex items-center justify-between gap-2 text-[11px] text-[var(--text-secondary)]">
              <span className="truncate min-w-0 flex items-center gap-2">
                <span className="truncate">
                  {seleccionado.ruta}
                  {personaSel?.modelo ? <span className="text-[var(--text-muted)]"> · {personaSel.modelo}</span> : null}
                </span>
                {telemetria?.bateria && (
                  <span
                    className="flex items-center gap-0.5 shrink-0 font-mono tabular-nums"
                    title={telemetria.bateria.cargando ? 'Cargando' : 'Batería'}
                  >
                    {telemetria.bateria.cargando
                      ? <BatteryCharging className="w-3.5 h-3.5 text-[var(--ok)]" />
                      : telemetria.bateria.nivel > 55
                        ? <BatteryFull className="w-3.5 h-3.5" />
                        : telemetria.bateria.nivel > 20
                          ? <BatteryMedium className="w-3.5 h-3.5" />
                          : <BatteryLow className="w-3.5 h-3.5 text-[#e5484d]" />}
                    {telemetria.bateria.nivel}%
                  </span>
                )}
                {telemetria?.red && (telemetria.red.tipo || telemetria.red.rttMs != null) && (
                  <span
                    className="flex items-center gap-0.5 shrink-0 font-mono tabular-nums"
                    title="Red del supervisado"
                  >
                    <Wifi className="w-3.5 h-3.5" />
                    {telemetria.red.tipo ? telemetria.red.tipo.toUpperCase() : ''}
                    {telemetria.red.rttMs != null ? ` ${telemetria.red.rttMs}ms` : ''}
                  </span>
                )}
              </span>
              <div className="flex items-center gap-2 shrink-0">
                {visitaSel?.lat != null && visitaSel?.lon != null && (
                  <a
                    href={`https://www.google.com/maps?q=${visitaSel.lat},${visitaSel.lon}`}
                    target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-[10.5px] font-bold text-[var(--text-secondary)] border border-[var(--border-color)] transition hover:text-[var(--text-primary)]"
                    title={visitaSel.precision_m != null ? `Precisión aproximada: ${Math.round(visitaSel.precision_m)} m` : 'Ubicación aproximada'}
                  >
                    Ver ubicación
                  </a>
                )}
                {personaSel?.device && (
                  <button
                    type="button" onClick={() => void bloquearAparato()} disabled={bloqueandoAparato}
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-[10.5px] font-bold text-white transition disabled:opacity-50"
                    style={{ background: '#e5484d' }}
                    title="Bloquea este aparato físico en el Kill Switch, al instante"
                  >
                    <Ban className="w-3 h-3" /> Bloquear aparato
                  </button>
                )}
                <span className="font-mono tabular-nums">visto {soloHora(seleccionado.last_seen)}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {viendoPantalla && (
        <VisorPantallaCompleta clave={viendoPantalla} onCerrar={() => setViendoPantalla(null)} />
      )}
    </div>
  );
}
