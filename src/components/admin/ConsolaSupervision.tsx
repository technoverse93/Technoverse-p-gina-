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
import { MonitorPlay, Smartphone, Monitor, RefreshCw, Radio } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { soloHora } from '../chat/formatoChat';

interface Presencia {
  user_id: string;
  email: string | null;
  ruta: string | null;
  entorno: string | null;
  last_seen: string;
  watch: boolean;
}

/**
 * Un cliente navegando la tienda. A propósito NO tiene correo, nombre, IP
 * ni user_id: lo único que identifica a un cliente es el MODELO de su
 * aparato. La tabla del servidor está hecha igual, para que la regla no
 * dependa de que alguien se acuerde de no mostrarlo.
 */
interface Visitante {
  visita: string;
  modelo: string | null;
  tipo: string | null;
  entorno: string | null;
  ruta: string | null;
  last_seen: string;
  watch: boolean;
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
  const [estado, setEstado] = useState<'idle' | 'esperando' | 'vivo'>('idle');
  const [refrescando, setRefrescando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  /** Último cuadro de la cámara del supervisado, para el recuadro PiP. */
  const [caraCuadro, setCaraCuadro] = useState<string | null>(null);

  const lienzoRef = useRef<HTMLDivElement>(null);
  const replayerRef = useRef<any>(null);
  const iniciandoRef = useRef(false);
  const colaRef = useRef<any[]>([]);
  const canalEventosRef = useRef<any>(null);
  const canalEspejoRef = useRef<any>(null);
  const trozosRef = useRef<Map<string, { n: number; partes: string[] }>>(new Map());
  /** Último tema conocido del supervisado. Se reaplica tras cada foto. */
  const temaRef = useRef<{ clase: string; estilo: string; data: string } | null>(null);
  const selRef = useRef<string | null>(null);
  selRef.current = sel;

  // --------------------------- Presencia ---------------------------
  const cargar = useCallback(async () => {
    const [personal, clientes] = await Promise.all([
      supabase
        .from('supervision_state')
        .select('user_id, email, ruta, entorno, last_seen, watch')
        .order('last_seen', { ascending: false }),
      supabase
        .from('supervision_visitantes')
        .select('visita, modelo, tipo, entorno, ruta, last_seen, watch')
        .order('last_seen', { ascending: false }),
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
      estilo.textContent = cssDelDocumento();
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
    // La cara es de quien se miraba: no debe quedar colgada al soltar ni
    // reaparecer sobre el espejo de otra persona.
    setCaraCuadro(null);
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
      if (ev?.type === 5 && ev?.data?.tag === 'tema') {
        const p = ev.data.payload || {};
        temaRef.current = { clase: p.clase || '', estilo: p.estilo || '', data: p.data || '' };
        aplicarTema();
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
  }, [iniciarSiHayFoto, aplicarTema]);

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
        }
      });
      espejo.subscribe();
      canalEspejoRef.current = espejo;
    } catch { /* si el canal no se puede abrir, queda el respaldo */ }

    // Camino de respaldo por tabla: solo existe para el personal.
    if (!esVisita(clave)) {
      const canal = supabase
        .channel(`supervision-ev-${clave}`)
        .on('postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'supervision_events', filter: `user_id=eq.${clave}` },
          (payload: any) => { if (selRef.current === clave) void manejarLote(payload?.new?.lote || []); })
        .subscribe();
      canalEventosRef.current = canal;
    }

    // Se pide la grabación DESPUÉS de estar escuchando, para no perderse
    // la primera foto.
    await pedirGrabacion(clave, true);
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

      // (b) Sigue conectada: reconexión limpia del canal.
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
  const seleccionado = personaSel || visitaSel
    ? {
        titulo: personaSel ? (personaSel.email || 'desconocido') : nombreDeAparato(visitaSel!),
        ruta: (personaSel ? personaSel.ruta : visitaSel!.ruta) || '—',
        last_seen: personaSel ? personaSel.last_seen : visitaSel!.last_seen,
      }
    : null;

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
              return (
                <button
                  key={p.user_id}
                  type="button"
                  onClick={() => void mirar(p.user_id)}
                  className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 border-b border-[var(--border-color)]/50 last:border-b-0 transition ${
                    activo ? 'bg-[var(--accent)]/10' : 'hover:bg-[var(--bg-sunken)]'
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
              return (
                <button
                  key={v.visita}
                  type="button"
                  onClick={() => void mirar(clave)}
                  className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 border-b border-[var(--border-color)]/50 last:border-b-0 transition ${
                    activo ? 'bg-[var(--accent)]/10' : 'hover:bg-[var(--bg-sunken)]'
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
            {estado === 'vivo' && (
              <span className="flex items-center gap-1.5 text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-[var(--ok-soft)] text-[var(--ok)]">
                <Radio className="w-3 h-3 animate-pulse" /> En vivo
              </span>
            )}
            {estado === 'esperando' && (
              <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-[var(--bg-sunken)] text-[var(--text-muted)]">Conectando…</span>
            )}
          </div>

          {/* Lienzo del reproductor. Fondo oscuro neutro para que la
              pantalla replicada resalte sea cual sea el tema. */}
          <div className="flex-1 relative bg-[#0b0f0e] overflow-hidden">
            <div ref={lienzoRef} className="w-full" />

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
            <div className="px-3 py-2 border-t border-[var(--border-color)] bg-[var(--bg-surface)] flex items-center justify-between text-[11px] text-[var(--text-secondary)]">
              <span className="truncate">{seleccionado.ruta}</span>
              <span className="font-mono tabular-nums shrink-0">visto {soloHora(seleccionado.last_seen)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
