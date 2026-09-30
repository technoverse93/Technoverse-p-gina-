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
import { MonitorPlay, Smartphone, Monitor, RefreshCw, Radio, Ban, BatteryFull, BatteryMedium, BatteryLow, BatteryCharging, Wifi } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { soloHora } from '../chat/formatoChat';
import { leerCssCrudo, leerCssDelCssom } from '../../supervision/cssCrudo';
import { retirarCanales } from '../../supervision/canales';

// NOTA: esta consola quedó reducida a SUPERVISIÓN VISUAL de la ventana
// (espejo del DOM por rrweb). Se retiraron a propósito el control remoto,
// la cámara del supervisado y la captura de pantalla completa del aparato:
// aquí solo se MIRA la página, no se opera el equipo ni se ve su cámara.

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
 * Un cliente navegando la tienda. Sin correo, nombre, IP ni user_id: el
 * ÚNICO identificador es el modelo del aparato. La ubicación NO viaja por
 * aquí — es un flujo aparte y consentido (ver utils/ubicacionCliente.ts y
 * el panel de Ubicaciones).
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
// El <link> de la hoja no sirve dentro del espejo: en la APK el espejo vive
// en https://localhost y la CSP bloquea la hoja del dominio web de quien se
// está mirando; y aunque cargara, un <link> llega tarde y deja un instante
// sin estilos en cada foto completa. Por eso el CSS se inyecta como <style>
// con el texto ya dentro.
//
// FALLO CORREGIDO — "se ve el HTML crudo": antes se inyectaba el CSS que
// mandaba el APARATO supervisado EN LUGAR del propio. Ese texto lo armaba el
// navegador del aparato desde su CSSOM, y en aparatos reales llegaba
// mutilado o vacío (un navegador sin `@layer` pierde todo Tailwind; una hoja
// que no deja leer sus reglas no aporta nada). La consola tiraba su propio
// CSS completo y se quedaba con ese: viñetas, subrayados, títulos a tamaño
// por defecto — lo único que sobrevivía eran los estilos en línea.
//
// Ahora la BASE es siempre el CSS de esta misma aplicación (mismo código que
// el aparato), leído crudo del servidor. El del aparato se SUMA encima: aporta
// lo que esta consola no tenga cargado (módulos que se cargan por trozos) y,
// si llega vacío o roto, no se lleva nada por delante.
let cssPropioPartes: string[] | null = null;
let cssPropioPromesa: Promise<string[]> | null = null;

function cargarCssPropio(): Promise<string[]> {
  if (!cssPropioPromesa) {
    cssPropioPromesa = leerCssCrudo(document)
      .catch(() => [] as string[])
      .then(partes => {
        cssPropioPartes = partes.length > 0 ? partes : [leerCssDelCssom(document)];
        return cssPropioPartes;
      });
  }
  return cssPropioPromesa;
}

/** Lo mejor disponible YA: el texto crudo si llegó, si no el CSSOM propio. */
function cssPropio(): string[] {
  return cssPropioPartes ?? [leerCssDelCssom(document)];
}

// rrweb se carga una sola vez; `unpack` se usa en cada lote.
let rrwebConsola: Promise<typeof import('rrweb')> | null = null;
function cargarRrwebConsola(): Promise<typeof import('rrweb')> {
  if (!rrwebConsola) rrwebConsola = import('rrweb');
  return rrwebConsola;
}

export default function ConsolaSupervision() {
  const [gente, setGente] = useState<Presencia[]>([]);
  const [visitantes, setVisitantes] = useState<Visitante[]>([]);
  // ¿Ya volvió la PRIMERA consulta de presencia? Antes de esto, `gente` y
  // `visitantes` empiezan en `[]` — sin esta bandera se leía igual que
  // "no hay nadie conectado", un dato falso mostrado como si fuera real
  // mientras la consulta todavía viaja. Con la bandera se distingue "no
  // hay nadie" (de verdad) de "todavía no se sabe".
  const [presenciaLista, setPresenciaLista] = useState(false);
  const [sel, setSel] = useState<string | null>(null);

  const [estado, setEstado] = useState<'idle' | 'esperando' | 'vivo'>('idle');
  const [refrescando, setRefrescando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const lienzoRef = useRef<HTMLDivElement>(null);
  const replayerRef = useRef<any>(null);
  const iniciandoRef = useRef(false);
  const colaRef = useRef<any[]>([]);
  const canalEventosRef = useRef<any>(null);
  const canalEspejoRef = useRef<any>(null);
  const trozosRef = useRef<Map<string, { n: number; partes: string[]; venc: ReturnType<typeof setTimeout> }>>(new Map());
  /** Próximo número de lote esperado del emisor (null = aún no se sabe). */
  const secEsperadaRef = useRef<number | null>(null);
  const ultimoPedidoFotoRef = useRef(0);
  /** Último tema conocido del supervisado. Se reaplica tras cada foto. */
  const temaRef = useRef<{ clase: string; estilo: string; data: string } | null>(null);
  /**
   * CSS del SUPERVISADO, hoja por hoja. Se SUMA encima del propio (nunca lo
   * reemplaza): aporta lo que esta consola no tenga cargado —hojas de
   * módulos que se cargan por trozos, clases de una versión más nueva— y,
   * si llega vacío o roto, no se lleva nada por delante.
   */
  const cssRemotoRef = useRef<{ firma: string; partes: string[] } | null>(null);
  /**
   * SELLO DE LLEGADA — cada evento se re-sella con la hora de ESTE aparato
   * en el momento en que llega, en vez de usar la hora con que lo sacó el
   * aparato supervisado.
   *
   * FALLO CORREGIDO — "se ve atrasado / desactualizado". rrweb en vivo
   * compara la hora de cada evento con la hora en que ESTE reproductor
   * arrancó, y con relojes distintos fallaba de dos maneras:
   *   · reloj del supervisado ADELANTADO N s → cada cambio se mostraba N s
   *     tarde (medido: +20 s de reloj → 20 s de atraso fijo);
   *   · reloj ATRASADO, o un evento que salió justo antes de arrancar el
   *     reproductor y llegó justo después → rrweb lo toma como "pasado" y lo
   *     aplica en un DOM VIRTUAL que en vivo no se vuelca nunca a la
   *     pantalla: el espejo quedaba congelado hasta la próxima foto completa.
   * Sellando con la hora de llegada ningún evento queda "en el pasado" ni
   * "en el futuro": se aplica en el cuadro siguiente.
   *
   * La hora sale del reloj MONÓTONO (`performance.now`) contado desde que
   * arrancó el reproductor —el mismo que usa el temporizador de rrweb—, así
   * un ajuste del reloj de la tablet (sincronización de hora) no descuadra
   * nada. Nunca retrocede, para conservar el orden de llegada.
   */
  const selloRef = useRef(0);
  const relojRef = useRef<{ base: number; perf: number } | null>(null);
  /** ¿Ya se construyó la primera foto del reproductor actual? */
  const listoRef = useRef(false);
  /** Eventos que llegaron antes de esa primera foto: se aplican después. */
  const pendientesRef = useRef<any[]>([]);
  /** Procesa los lotes de a uno, en el orden de llegada. */
  const cadenaRef = useRef<Promise<void>>(Promise.resolve());
  /**
   * No llega nada del aparato desde hace rato: el espejo muestra la última
   * imagen conocida y la etiqueta pasa de "En vivo" a "Sin señal". Se
   * retira sola con el próximo lote que llegue.
   */
  const sinSenalRef = useRef(false);
  const [sinSenal, setSinSenal] = useState(false);
  /** Último estado del canal del espejo según Supabase ('SUBSCRIBED', …). */
  const estadoCanalRef = useRef<string>('');
  /**
   * Cámara frontal que el CLIENTE aceptó compartir desde el pie de página.
   * Nunca se pide desde aquí: llega SOLO si la persona la encendió con su
   * permiso. `caraJpg` es el último fotograma (se repinta a ~3/s); `caraTs`
   * marca cuándo llegó, para ocultarla si dejan de llegar. Se limpia al
   * cambiar de persona o al soltar.
   */
  const [caraJpg, setCaraJpg] = useState<string | null>(null);
  const caraTsRef = useRef(0);
  const selRef = useRef<string | null>(null);
  selRef.current = sel;
  /**
   * Batería y red del supervisado, tal como llegan por el canal del
   * espejo (evento suelto 'telemetria', ver motorEspejo.ts). Es
   * información de a quién se está mirando AHORA MISMO, así que se
   * limpia al cambiar de persona o al soltar — igual que caraCuadro.
   */
  /**
   * DIAGNÓSTICO — lo que de verdad llega del aparato. Existe porque el
   * espejo se reportó mal en aparatos reales y no se pudo reproducir en
   * pruebas: con estos números (y una captura) se distingue si el problema
   * es de red, de versión o del propio reproductor.
   */
  const diagVacio = () => ({ lotes: 0, bytes: 0, fotos: 0, huecos: 0, descartados: 0, cssBytes: 0, cssBaseBytes: 0, errores: 0, reintentos: 0, desfaseMs: null as number | null, canal: '', remoto: null as null | { build: string; ancho: number; alto: number; hojas: number } });
  const diagRef = useRef(diagVacio());
  const [diag, setDiag] = useState(diagRef.current);
  const [verDiag, setVerDiag] = useState(false);
  useEffect(() => {
    if (!verDiag) return;
    const t = setInterval(() => setDiag({ ...diagRef.current, canal: estadoCanalRef.current }), 1000);
    return () => clearInterval(t);
  }, [verDiag]);
  const [telemetria, setTelemetria] = useState<{ bateria: { nivel: number; cargando: boolean } | null; red: { tipo: string; rttMs: number | null; downlinkMbps: number | null } | null } | null>(null);

  /**
   * LATIDO DEL ESPEJO — marca de la última vez que llegó CUALQUIER señal
   * del supervisado (un lote de rrweb, el CSS, el tema o la telemetría:
   * todo pasa por `manejarLote`, así que basta un solo punto). Sirve para
   * el vigía de congelamiento de abajo: mientras el canal siga
   * "SUBSCRIBED" a los ojos de Supabase pero el otro lado dejó de mandar
   * nada —su pestaña se congeló en segundo plano, el aparato se quedó sin
   * red sin que el WebSocket se enterara— esto es lo único que lo nota.
   */
  const ultimaSenalRef = useRef<number>(0);
  /** Cuándo fue el último intento de recuperación, y cuántos van sin respuesta. */
  const ultimoIntentoRef = useRef<number>(0);
  const intentosSeguidosRef = useRef(0);
  /** Evita que el vigía dispare una reconexión encima de otra ya en curso. */
  const reconectandoAutoRef = useRef(false);

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
        .select('visita, modelo, tipo, entorno, ruta, last_seen, watch')
        .gte('last_seen', desde)
        .order('last_seen', { ascending: false })
        .limit(50),
    ]);
    const filas = (personal.data as Presencia[]) || [];
    const visitas = (clientes.data as Visitante[]) || [];
    setGente(filas);
    setVisitantes(visitas);
    setPresenciaLista(true);
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
  // Lo que faltaba era el CSS. El grabador no empotra las hojas de estilo
  // (rrweb las reconstruiría regla por regla y perdería los @layer de
  // Tailwind v4). Aquí se inyectan como TEXTO: primero la base propia y
  // encima lo que el aparato tenga de más (ver "CSS DEL ESPEJO", arriba).
  const inyectarEstilos = useCallback(() => {
    try {
      const doc = (replayerRef.current?.iframe as HTMLIFrameElement | undefined)?.contentDocument;
      if (!doc?.head) return;
      const head = doc.head;
      const crear = (texto: string, tipo: 'base' | 'remoto', firma = '') => {
        const estilo = doc.createElement('style');
        estilo.setAttribute('data-tv-css', tipo);
        if (firma) estilo.setAttribute('data-firma', firma);
        estilo.textContent = texto;
        return estilo;
      };

      // 1) BASE: el CSS propio, completo. Primero en el <head> para que esté
      //    aplicado antes del primer pintado del contenido reconstruido.
      //    Tras cada foto completa rrweb rehace el <head> y hay que volver a
      //    ponerlo; si sigue ahí, no se duplica.
      if (!head.querySelector('style[data-tv-css="base"]')) {
        const frag = doc.createDocumentFragment();
        const base = cssPropio();
        for (const texto of base) frag.appendChild(crear(texto, 'base'));
        diagRef.current.cssBaseBytes = base.reduce((n, t) => n + t.length, 0);
        head.insertBefore(frag, head.firstChild);
      }

      // 2) REMOTO: el del aparato, DESPUÉS de la base. Cada hoja en su propio
      //    <style>, porque una @import solo vale al principio de su hoja. Las
      //    hojas idénticas a una de la base (mismo build: lo normal) no se
      //    repiten — serían cientos de KB más que reparsear en cada foto.
      const remoto = cssRemotoRef.current;
      const actuales = Array.from(head.querySelectorAll('style[data-tv-css="remoto"]'));
      if (remoto && actuales[0]?.getAttribute('data-firma') !== remoto.firma) {
        actuales.forEach(n => n.remove());
        const base = cssPropio();
        const extra = remoto.partes.filter(texto => !base.includes(texto));
        const bases = head.querySelectorAll('style[data-tv-css="base"]');
        const despues = bases[bases.length - 1]?.nextSibling ?? null;
        const frag = doc.createDocumentFragment();
        for (const texto of extra) frag.appendChild(crear(texto, 'remoto', remoto.firma));
        head.insertBefore(frag, despues);
      }
    } catch { /* iframe aún no accesible: la próxima foto lo reintenta */ }
  }, []);

  // El CSS propio crudo se lee apenas se abre la consola, para que ya esté
  // cuando llegue la primera foto. Si el reproductor ya existía con el
  // respaldo del CSSOM, se rehace todo con el texto crudo (también lo del
  // aparato, que se compara contra la base para no repetir hojas).
  useEffect(() => {
    let vigente = true;
    void cargarRrwebConsola();
    void cargarCssPropio().then(() => {
      if (!vigente) return;
      try {
        const doc = (replayerRef.current?.iframe as HTMLIFrameElement | undefined)?.contentDocument;
        doc?.head?.querySelectorAll('style[data-tv-css]').forEach(n => n.remove());
      } catch { /* nada */ }
      inyectarEstilos();
    });
    return () => { vigente = false; };
  }, [inyectarEstilos]);

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
    const viejo = replayerRef.current;
    replayerRef.current = null;
    if (viejo) {
      // FUGA CORREGIDA: en vivo, `pause()` y `destroy()` de rrweb NO paran su
      // temporizador —solo pausan si está "reproduciendo", y en vivo nunca lo
      // está—, así que cada reproductor descartado seguía con su bucle de
      // cuadros andando y reteniendo todos sus eventos (fotos completas
      // incluidas). Con cada reconexión se sumaba uno más y la tablet se
      // iba poniendo lenta. Se para el temporizador a mano.
      try { viejo.service?.state?.context?.timer?.clear?.(); } catch { /* nada */ }
      try { viejo.destroy?.(); } catch { /* el lienzo ya se vació */ }
    }
    colaRef.current = [];
    trozosRef.current.forEach(t => clearTimeout(t.venc));
    trozosRef.current.clear();
    secEsperadaRef.current = null;
    diagRef.current = diagVacio();
    listoRef.current = false;
    pendientesRef.current = [];
    relojRef.current = null;
    // El tema es de QUIEN se estaba mirando: si no se olvida, el siguiente
    // supervisado heredaría el claro/oscuro del anterior hasta su primer
    // cambio de tema.
    temaRef.current = null;
    cssRemotoRef.current = null;
    caraTsRef.current = 0;
    setCaraJpg(null);
    setTelemetria(null);
    if (lienzoRef.current) lienzoRef.current.innerHTML = '';
  }, []);

  // Arranca el reproductor SOLO cuando ya tenemos una foto completa
  // (evento tipo 2). rrweb no puede pintar el interior sin ella: por eso,
  // si se engancha entre foto y foto, todo el panel se veía en blanco.
  // Como el grabador reenvía una foto cada 12 s, esto se autocura solo.
  /** Sella un evento con la hora de llegada a ESTE aparato (ver `selloRef`). */
  const sellar = (ev: any) => {
    const reloj = relojRef.current;
    const ahora = reloj ? reloj.base + Math.floor(performance.now() - reloj.perf) : Date.now();
    const t = Math.max(ahora, selloRef.current);
    selloRef.current = t;
    return { ...ev, timestamp: t };
  };

  /**
   * En vivo rrweb guarda TODOS los eventos recibidos para siempre (una foto
   * completa cada 12 s son decenas de MB por hora en la tablet). Lo anterior
   * a la última foto completa ya no sirve para nada: se descarta.
   */
  const podarHistorial = (r: any) => {
    try {
      const eventos: any[] | undefined = r?.service?.state?.context?.events;
      if (!Array.isArray(eventos) || eventos.length < 300) return;
      let i = eventos.length - 1;
      while (i > 0 && eventos[i]?.type !== 2) i--;
      const desde = i > 0 && eventos[i - 1]?.type === 4 ? i - 1 : i;
      if (desde > 0) eventos.splice(0, desde);
    } catch { /* interno de rrweb: si cambia, simplemente no se poda */ }
  };

  const agregarAlReproductor = (ev: any) => {
    try { replayerRef.current?.addEvent(sellar(ev)); } catch { diagRef.current.errores++; }
  };

  /** Aplica lo que llegó mientras se construía la primera foto. */
  const soltarPendientes = () => {
    if (listoRef.current) return;
    listoRef.current = true;
    const pendientes = pendientesRef.current;
    pendientesRef.current = [];
    for (const ev of pendientes) agregarAlReproductor(ev);
  };

  const iniciarSiHayFoto = useCallback(async () => {
    if (replayerRef.current || iniciandoRef.current) return;
    if (!colaRef.current.some(e => e?.type === 2)) return; // todavía sin foto: seguir esperando
    iniciandoRef.current = true;
    try {
      const { Replayer } = await cargarRrwebConsola();
      if (!lienzoRef.current || replayerRef.current) return;
      // La cola se lee DESPUÉS de cargar rrweb: lo que llegó mientras tanto
      // también cuenta (antes se tomaba antes de la espera y se perdía).
      const cola = colaRef.current;
      colaRef.current = [];
      let snap = -1;
      for (let i = cola.length - 1; i >= 0; i--) { if (cola[i]?.type === 2) { snap = i; break; } }
      if (snap === -1) { colaRef.current = cola; return; }
      // rrweb quiere el Meta (tipo 4) justo antes de la foto.
      const desde = (snap > 0 && cola[snap - 1]?.type === 4) ? snap - 1 : snap;
      // El constructor solo construye la foto: en vivo, cualquier otro evento
      // que se le pase ahí queda sin aplicar. Los que vinieron DESPUÉS de la
      // foto se entregan con addEvent una vez construida (ver soltarPendientes).
      // Reloj nuevo para este reproductor: los sellos de uno anterior no
      // cuentan (ver `selloRef`).
      relojRef.current = null;
      selloRef.current = 0;
      const iniciales = cola.slice(desde, snap + 1).map(sellar);
      listoRef.current = false;
      pendientesRef.current = cola.slice(snap + 1);

      lienzoRef.current.innerHTML = '';
      const r = new Replayer(iniciales, {
        root: lienzoRef.current,
        liveMode: true,
        mouseTail: false,
        speed: 1,
        // FALLO CORREGIDO — "el espejo sale a medias / sin contenido".
        //
        // rrweb, por defecto, PAUSA todas las animaciones CSS del
        // documento reproducido: tras cada foto completa marca el <html>
        // como `rrweb-paused` si el reproductor no está en estado
        // "playing" —y en modo en vivo nunca lo está, es "live"— e inyecta
        // `animation-play-state: paused !important` para todo el árbol.
        // Está pensado para pausar una GRABACIÓN vista en diferido, no una
        // transmisión en vivo.
        //
        // El efecto aquí era devastador y silencioso: cualquier elemento
        // que entra con una animación desde `opacity: 0` se quedaba
        // congelado en su primer cuadro, o sea INVISIBLE, para siempre.
        // Cada pestaña del panel de administración entra así
        // (`tv-entra-pestana`), como los menús, los modales y las
        // burbujas del chat. El DOM llegaba completo —los mismos
        // elementos, las mismas medidas— pero el contenido no se
        // pintaba: una pantalla con el marco y sin lo de adentro, que se
        // leía como "formato roto" y como "desactualizado" (los cambios
        // sí llegaban, pero lo nuevo también entraba invisible).
        pauseAnimation: false,
        // Sin DOM virtual. rrweb lo usa para aplicar de golpe lo que queda
        // "en el pasado" y lo vuelca a pantalla solo al darle Play, cosa que
        // en vivo no ocurre nunca: un cambio que cayera ahí no se veía hasta
        // la próxima foto completa. Con el sello de llegada ya no debería
        // caer ninguno; esto lo garantiza aunque cayera.
        useVirtualDom: false,
      });
      r.on('resize', (e: any) => ajustarEscala(e?.width, e?.height));
      // Cada foto completa rehace el documento del iframe y se lleva por
      // delante el CSS inyectado y la clase de tema. Se vuelven a poner.
      r.on('fullsnapshot-rebuilded', () => { rehidratar(); soltarPendientes(); podarHistorial(r); });
      replayerRef.current = r;
      // El reloj del reproductor arranca aquí: `base` es su hora cero y
      // `perf` se toma DESPUÉS de arrancarlo, para que ningún sello quede
      // por delante del temporizador de rrweb (se aplicaría un cuadro tarde).
      const base = Date.now();
      selloRef.current = Math.min(selloRef.current, base);
      r.startLive(base);
      relojRef.current = { base, perf: performance.now() };
      rehidratar();
      // Red de seguridad: si la primera foto no llegara a construirse, los
      // eventos retenidos no se quedan colgados para siempre.
      setTimeout(() => { if (replayerRef.current === r) soltarPendientes(); }, 1500);
      setEstado('vivo');
    } catch {
      /* si rrweb no cargó, se queda en "esperando" hasta el próximo checkout */
    } finally {
      iniciandoRef.current = false;
    }
  }, [ajustarEscala, rehidratar]);

  const manejarLote = useCallback((lote: any[]) => {
    if (!Array.isArray(lote) || lote.length === 0) return;
    // Cualquier lote real —eventos de rrweb, css, tema o telemetría— cuenta
    // como "sigue vivo". Ver `ultimaSenalRef` para el porqué.
    ultimaSenalRef.current = Date.now();
    intentosSeguidosRef.current = 0;
    if (sinSenalRef.current) { sinSenalRef.current = false; setSinSenal(false); setAviso(null); }

    // Hora del aparato menos hora de esta tablet (la demora de la red la
    // hace un poco negativa). Solo informativa: el espejo ya no depende de ella.
    const ultimoTs = lote.reduce((m, e) => (typeof e?.timestamp === 'number' && e.timestamp > m ? e.timestamp : m), 0);
    if (ultimoTs) diagRef.current.desfaseMs = ultimoTs - Date.now();

    for (const ev of lote) {
      // El supervisado manda SU hoja de estilos. Se guarda y se inyecta
      // ENCIMA de la base propia (ver `cssRemotoRef`).
      if (ev?.type === 5 && ev?.data?.tag === 'css') {
        const pl = ev.data.payload || {};
        // Emisores nuevos: `partes` (texto crudo, hoja por hoja). Emisores
        // anteriores: `texto` (reconstruido desde su CSSOM, puede venir
        // mutilado). Los dos se SUMAN a la base, nunca la reemplazan.
        const partes: string[] = Array.isArray(pl.partes)
          ? pl.partes.filter((x: unknown) => typeof x === 'string' && x.length > 0)
          : (typeof pl.texto === 'string' && pl.texto.length > 0 ? [pl.texto] : []);
        if (partes.length > 0) {
          const total = partes.reduce((n, t) => n + t.length, 0);
          const firma = typeof pl.firma === 'string' ? pl.firma : `${partes.length}:${total}`;
          diagRef.current.cssBytes = total;
          // Si no cambió, no se rehace nada: reinyectar cientos de KB de CSS
          // fuerza un reparseo completo del documento del espejo.
          if (cssRemotoRef.current?.firma !== firma) {
            cssRemotoRef.current = { firma, partes };
            inyectarEstilos();
          }
        }
        continue;
      }

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

      // Latido del emisor: solo sirve para que el lote llegue (y con él la
      // numeración que delata un hueco). No es parte del DOM replicado.
      if (ev?.type === 5 && ev?.data?.tag === 'latido') continue;
      if (ev?.type === 5 && ev?.data?.tag === 'version') { diagRef.current.remoto = ev.data.payload || null; continue; }
      if (ev?.type === 2) diagRef.current.fotos++;

      // Batería y red del supervisado (ver utils/telemetria.ts). Es
      // informativo, no forma parte del DOM replicado: no va a rrweb.
      if (ev?.type === 5 && ev?.data?.tag === 'telemetria') {
        setTelemetria(ev.data.payload || null);
        continue;
      }

      if (replayerRef.current) {
        if (!listoRef.current) { pendientesRef.current.push(ev); continue; }
        agregarAlReproductor(ev);
        continue;
      }

      // Aún sin reproductor: acumula hasta que llegue una foto completa.
      colaRef.current.push(ev);
      if (colaRef.current.length > 2000) colaRef.current = colaRef.current.slice(-2000);
    }

    if (!replayerRef.current) void iniciarSiHayFoto();
  }, [iniciarSiHayFoto, aplicarTema, inyectarEstilos]);

  /**
   * Pide al supervisado una foto COMPLETA nueva por el canal del espejo.
   *
   * Es la forma de sanar cualquier desincronización: se perdió un lote, un
   * trozo no llegó, un evento no se pudo descomprimir. Con una foto
   * completa el espejo queda igual que el origen en un instante, sin
   * esperar al checkout periódico (12 s). Se limita a una por 1,5 s para
   * no inundar al supervisado si el problema es una racha de pérdidas;
   * `forzar` se salta ese límite (canal recién suscrito, botón Actualizar).
   */
  const pedirFotoNueva = useCallback((forzar = false) => {
    const ahora = Date.now();
    if (!forzar && ahora - ultimoPedidoFotoRef.current < 1500) return;
    ultimoPedidoFotoRef.current = ahora;
    try { void canalEspejoRef.current?.send({ type: 'broadcast', event: 'pedir-foto', payload: {} }); } catch { /* nada */ }
  }, []);

  /** Reensambla los trozos del canal rápido y descomprime los eventos. */
  const manejarTrozo = useCallback(async (p: any) => {
    if (!p?.id || typeof p.d !== 'string') return;

    // DETECCIÓN DE LOTES PERDIDOS. Cada lote trae su número (`s`); si salta
    // uno, faltó un lote entero y todo lo que venga encima se aplicaría
    // sobre un documento distinto del origen. Los emisores anteriores a
    // este cambio no numeran: sin `s` no se comprueba nada.
    if (typeof p.s === 'number') {
      const esperada = secEsperadaRef.current;
      if (esperada !== null && p.s > esperada) { diagRef.current.huecos++; pedirFotoNueva(); }
      // Si `s` es MENOR que lo esperado, el emisor reinició su cuenta (otro
      // arranque): se toma su número como nuevo punto de partida.
      secEsperadaRef.current = esperada === null || p.s < esperada - 1 ? p.s + 1 : Math.max(esperada, p.s + 1);
    }

    const mapa = trozosRef.current;
    let entrada = mapa.get(p.id);
    if (!entrada) {
      // Un lote que no se completa en 4 s perdió al menos un trozo: se
      // descarta y se pide foto nueva, en vez de dejar el resto colgado.
      const id = p.id;
      entrada = {
        n: p.n || 1,
        partes: [],
        venc: setTimeout(() => {
          if (trozosRef.current.delete(id)) { diagRef.current.huecos++; pedirFotoNueva(); }
        }, 4000),
      };
      mapa.set(id, entrada);
    }
    entrada.partes[p.i || 0] = p.d;
    diagRef.current.bytes += p.d.length;

    const completo = entrada.partes.filter(Boolean).length === entrada.n;
    if (!completo) return;
    clearTimeout(entrada.venc);
    mapa.delete(p.id);

    const texto = entrada.partes.join('');
    // En cadena: cada lote espera al anterior, así se aplican en el mismo
    // orden en que llegaron aunque descomprimir uno tarde más que otro.
    cadenaRef.current = cadenaRef.current.then(() => procesarLoteRef.current(texto)).catch(() => { /* nada */ });
  }, [pedirFotoNueva]);

  const procesarLote = useCallback(async (texto: string) => {
    try {
      const crudo = JSON.parse(texto);
      const { unpack } = await cargarRrwebConsola();
      // El grabador comprime cada evento; `unpack` devuelve el objeto.
      const eventos = (crudo as any[]).map(e => { try { return unpack(e); } catch { return e; } });
      // Un evento que no se pudo descomprimir se queda como texto y no
      // tiene `type` numérico: dárselo a rrweb lo confunde. Se descarta y
      // se pide foto nueva para no quedar desincronizados.
      const validos = eventos.filter(e => e && typeof e.type === 'number');
      diagRef.current.lotes++;
      if (validos.length !== eventos.length) { diagRef.current.descartados += eventos.length - validos.length; pedirFotoNueva(); }
      manejarLote(validos);
    } catch {
      diagRef.current.errores++;
      /* lote corrupto: se pide una foto nueva en vez de esperar al checkout */
      pedirFotoNueva();
    }
  }, [manejarLote, pedirFotoNueva]);
  const procesarLoteRef = useRef(procesarLote);
  procesarLoteRef.current = procesarLote;

  // --------------------------- Enganche / desenganche ---------------------------
  // La selección es UNA clave para los dos tipos de supervisado:
  //   · personal  → su user_id
  //   · cliente   → "v:" + el id de su aparato
  // Así todo el motor del espejo (canales, cola, remonte por tema) es el
  // mismo para ambos y no hay dos caminos que mantener en paralelo.
  const esVisita = (clave: string) => clave.startsWith('v:');
  const idDeVisita = (clave: string) => clave.slice(2);
  const topicoDe = (clave: string) => (esVisita(clave) ? `espejo:v:${idDeVisita(clave)}` : `espejo:${clave}`);

  /** Sube con cada apertura o cierre: una apertura en vuelo que ya no es la última se abandona. */
  const canalGenRef = useRef(0);

  /** Suelta los dos canales (el rápido y el de respaldo). */
  const cerrarCanales = useCallback(() => {
    canalGenRef.current++;
    const espejo = canalEspejoRef.current;
    const respaldo = canalEventosRef.current;
    canalEspejoRef.current = null;
    canalEventosRef.current = null;
    estadoCanalRef.current = '';
    if (espejo) { try { void supabase.removeChannel(espejo); } catch { /* nada */ } }
    if (respaldo) { try { void supabase.removeChannel(respaldo); } catch { /* nada */ } }
  }, []);

  /**
   * Abre (o reabre) el canal rápido del espejo de `clave`.
   *
   * Cada vez que queda SUSCRITO —la primera vez y en cada reconexión que
   * Supabase haga sola por debajo— se pide una foto completa: es el instante
   * en que de verdad hay tubo, así el espejo arranca o se pone al día sin
   * esperar al checkout periódico.
   */
  const abrirCanalEspejo = useCallback(async (clave: string) => {
    const mia = ++canalGenRef.current;
    const anterior = canalEspejoRef.current;
    canalEspejoRef.current = null;
    estadoCanalRef.current = '';
    if (anterior) { try { void supabase.removeChannel(anterior); } catch { /* nada */ } }
    const topic = topicoDe(clave);
    // Nada de lo anterior con este tema puede quedar en la lista: el
    // `channel()` de abajo lo devolvería en vez de uno nuevo.
    await retirarCanales(topic);
    if (mia !== canalGenRef.current || selRef.current !== clave) return;
    try {
      const espejo = supabase.channel(topic, { config: { private: true } });
      canalEspejoRef.current = espejo;
      espejo.on('broadcast', { event: 'lote' }, (msg: any) => {
        // Solo lo que entra por EL canal vigente.
        if (canalEspejoRef.current !== espejo || selRef.current !== clave) return;
        void manejarTrozo(msg?.payload);
      });
      // Cámara frontal que el CLIENTE decidió compartir desde el pie de
      // página (ver camaraCliente.ts). Llega como fotogramas JPEG sueltos;
      // solo se muestra si de verdad están llegando.
      espejo.on('broadcast', { event: 'camara' }, (msg: any) => {
        if (canalEspejoRef.current !== espejo || selRef.current !== clave) return;
        const jpg = msg?.payload?.jpg;
        if (typeof jpg === 'string' && jpg.startsWith('data:image')) {
          caraTsRef.current = Date.now();
          setCaraJpg(jpg);
        }
      });
      espejo.on('broadcast', { event: 'camara-fin' }, () => {
        if (canalEspejoRef.current !== espejo || selRef.current !== clave) return;
        caraTsRef.current = 0;
        setCaraJpg(null);
      });
      espejo.subscribe((estado: string) => {
        if (canalEspejoRef.current !== espejo) return;
        estadoCanalRef.current = estado;
        if (estado === 'SUBSCRIBED' && selRef.current === clave) pedirFotoNueva(true);
      });
    } catch { /* si el canal no se puede abrir, queda el respaldo */ }
  }, [manejarTrozo, pedirFotoNueva]);

  const pedirGrabacion = useCallback(async (clave: string, encendido: boolean) => {
    try {
      if (esVisita(clave)) {
        await supabase.rpc('visitante_mirar', { p_visita: idDeVisita(clave), p_watch: encendido });
      } else {
        await supabase.from('supervision_state').update({ watch: encendido }).eq('user_id', clave);
      }
    } catch { /* nada */ }
  }, []);

  /** Deja de mirar a `clave`: canales, reproductor y SU grabación. */
  const soltar = useCallback(async (clave: string | null) => {
    cerrarCanales();
    destruirReplayer();
    sinSenalRef.current = false;
    setSinSenal(false);
    if (clave) await pedirGrabacion(clave, false);
  }, [destruirReplayer, cerrarCanales, pedirGrabacion]);

  /** Abre los dos caminos (rápido y respaldo) y pide la grabación. */
  const engancharA = useCallback(async (clave: string) => {
    setEstado('esperando');
    // Arranca el latido en cero: le da al primer fotograma su propio
    // margen para llegar antes de que el vigía pudiera tomar el silencio
    // inicial por una falta de señal.
    ultimaSenalRef.current = Date.now();
    ultimoIntentoRef.current = Date.now();
    intentosSeguidosRef.current = 0;
    sinSenalRef.current = false;
    setSinSenal(false);

    // Camino rápido: canal privado de broadcast. Es el único que tienen
    // los clientes de la tienda (no pueden escribir en la tabla). La
    // grabación se pide EN PARALELO con la apertura: es lo único que el
    // supervisado necesita para empezar a mandar.
    const abriendo = abrirCanalEspejo(clave);
    await pedirGrabacion(clave, true);
    await abriendo;

    // "Volcá tu DOM ya", repetido por si la grabación aún se estaba
    // levantando cuando llegó el primer pedido (el del canal suscrito).
    for (const ms of [250, 700, 1500, 3000]) {
      setTimeout(() => { if (selRef.current === clave && !replayerRef.current) pedirFotoNueva(true); }, ms);
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
  }, [manejarLote, abrirCanalEspejo, pedirFotoNueva, pedirGrabacion]);

  const mirar = useCallback(async (clave: string) => {
    if (sel === clave) {
      await soltar(clave);
      selRef.current = null;
      setSel(null);
      setEstado('idle');
      return;
    }
    await soltar(sel);
    // `selRef` se adelanta a mano: el render que lo pondría llega después, y
    // el enganche de abajo ya lo consulta.
    selRef.current = clave;
    setSel(clave);
    await engancharA(clave);
  }, [sel, soltar, engancharA]);

  /**
   * RECUPERACIÓN SIN APAGAR NADA — lo que hacen el vigía y el botón
   * Actualizar cuando no llega señal.
   *
   * FALLO CORREGIDO: antes se "reconectaba" soltando a la persona —lo que
   * APAGABA su grabación (watch = false)— y destruyendo el reproductor, para
   * volver a engancharla 300 ms después. Un cliente de la tienda solo se
   * entera de que lo miran en su latido (cada 10 s): si ese latido caía en
   * el hueco, dejaba de transmitir, el vigía volvía a ver silencio y el
   * ciclo se repetía — el "Sin señal: reconectando…" que no terminaba, con
   * la pantalla en negro entre medio.
   *
   * Ahora la grabación se REAFIRMA (mientras la persona siga elegida nunca
   * se apaga), se reabre SOLO el canal y se pide una foto completa. El
   * reproductor se conserva: se sigue viendo la última imagen, marcada
   * "Sin señal", hasta que llegue la nueva.
   */
  const recuperarSenal = useCallback(async (clave: string) => {
    diagRef.current.reintentos++;
    ultimoIntentoRef.current = Date.now();
    await pedirGrabacion(clave, true);
    if (selRef.current !== clave) return;
    await abrirCanalEspejo(clave);
  }, [pedirGrabacion, abrirCanalEspejo]);

  // --------------------------- Botón "Actualizar" ---------------------------
  // Dos trabajos distintos, según lo que pase de verdad:
  //
  //   a) La ficha quedó colgada porque la persona ya cerró sesión o cerró
  //      la app  → se retira de la lista en el acto.
  //   b) La persona sigue conectada → se pide una foto completa nueva y, si
  //      el canal no está suscrito, se reabre. Sin apagar su grabación ni
  //      tirar el reproductor.
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
        selRef.current = null;
        setSel(null);
        setEstado('idle');
        setAviso('Esa persona ya cerró sesión. Se quitó de la lista.');
        return;
      }

      // (b) Sigue conectada. Con el canal suscrito basta pedir una foto
      // COMPLETA nueva (el equivalente a un keyframe): la imagen se rehace
      // en milisegundos. La grabación se reafirma por si el aparato se la
      // perdió. Sin canal suscrito, se reabre solo el canal.
      if (canalEspejoRef.current && estadoCanalRef.current === 'SUBSCRIBED') {
        pedirFotoNueva(true);
        void pedirGrabacion(actual, true);
        setAviso(replayerRef.current ? 'Imagen actualizada.' : 'Pidiendo la imagen al aparato…');
        return;
      }
      await recuperarSenal(actual);
      setAviso('Canal reconectado. Pidiendo la imagen al aparato…');
    } finally {
      setRefrescando(false);
    }
  }, [cargar, soltar, pedirFotoNueva, pedirGrabacion, recuperarSenal]);

  // ---------------------------------------------------------------------
  // VIGÍA DE SEÑAL — recuperación automática y silenciosa
  // ---------------------------------------------------------------------
  // Supabase Realtime reconecta el WebSocket SOLO cuando de verdad se cae.
  // Si en cambio el lado que transmite se congela —su pestaña pasó a
  // segundo plano, el aparato se quedó sin red sin que el WebSocket se
  // enterara, un error cortó la grabación— aquí el canal sigue "SUBSCRIBED"
  // y solo hay silencio. Este vigía mira cuánto hace que llegó la última
  // señal real (`ultimaSenalRef`, marcada en `manejarLote`).
  //
  // Un emisor actual late cada 3 s aunque la pantalla esté quieta (ver
  // motorEspejo.ts), así que 10 s de silencio ya es falta de señal. Uno
  // anterior —sin numeración de lotes— solo manda algo cada 12-15 s: a ese
  // se le dan 22 s. Al cumplirse: etiqueta "Sin señal" (la última imagen se
  // queda a la vista) y `recuperarSenal`. Si sigue sin respuesta, cada
  // reintento espera el doble que el anterior (tope 60 s): un aparato que
  // quedó en segundo plano un buen rato no recibe un pedido cada 10 s.
  const UMBRAL_SIN_SENAL_MS = 10000;
  const UMBRAL_SIN_SENAL_EMISOR_VIEJO_MS = 22000;

  useEffect(() => {
    const vigia = setInterval(() => {
      const actual = selRef.current;
      if (!actual || reconectandoAutoRef.current) return;
      const umbral = secEsperadaRef.current !== null ? UMBRAL_SIN_SENAL_MS : UMBRAL_SIN_SENAL_EMISOR_VIEJO_MS;
      const ahora = Date.now();
      if (ahora - ultimaSenalRef.current < umbral) return;
      const espera = Math.min(umbral * 2 ** intentosSeguidosRef.current, 60000);
      if (ahora - ultimoIntentoRef.current < espera) return;

      if (!sinSenalRef.current) {
        sinSenalRef.current = true;
        setSinSenal(true);
        setAviso('Sin señal del aparato: reconectando automáticamente…');
      }
      reconectandoAutoRef.current = true;
      intentosSeguidosRef.current++;
      void recuperarSenal(actual).finally(() => { reconectandoAutoRef.current = false; });
    }, 2000);
    return () => clearInterval(vigia);
  }, [recuperarSenal]);

  // Si la cámara del cliente deja de llegar sin un cierre limpio (se cayó
  // la red, cerró la pestaña), se oculta a los pocos segundos en vez de
  // dejar congelado el último fotograma como si siguiera en vivo.
  useEffect(() => {
    if (!caraJpg) return;
    const t = setInterval(() => {
      if (caraTsRef.current && Date.now() - caraTsRef.current > 6000) setCaraJpg(null);
    }, 1000);
    return () => clearInterval(t);
  }, [caraJpg]);

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
          {!presenciaLista ? (
            <div className="flex items-center justify-center gap-2 px-3 py-6 text-[var(--text-muted)]">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span className="text-[11.5px]">Consultando…</span>
            </div>
          ) : gente.filter(enLinea).length === 0 ? (
            <p className="text-[12px] text-[var(--text-muted)] italic px-3 py-6 text-center">Nadie del personal en línea.</p>
          ) : (
            gente.filter(enLinea).map(p => {
              const esApk = p.entorno === 'apk';
              const activo = p.user_id === sel;
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
          {!presenciaLista ? (
            <div className="flex items-center justify-center gap-2 px-3 py-5 text-[var(--text-muted)]">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span className="text-[11.5px]">Consultando…</span>
            </div>
          ) : visitantes.filter(visitaEnLinea).length === 0 ? (
            <p className="text-[12px] text-[var(--text-muted)] italic px-3 py-5 text-center">Ningún cliente navegando ahora.</p>
          ) : (
            visitantes.filter(visitaEnLinea).map(v => {
              const clave = `v:${v.visita}`;
              const esApk = v.entorno === 'apk';
              const activo = clave === sel;
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
              {estado === 'vivo' && !sinSenal && (
                <span className="flex items-center gap-1.5 text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-[var(--ok-soft)] text-[var(--ok)]">
                  <Radio className="w-3 h-3 animate-pulse" /> En vivo
                </span>
              )}
              {/* La imagen que queda a la vista es la última que llegó: se
                  dice, en vez de seguir anunciando "En vivo". */}
              {estado === 'vivo' && sinSenal && (
                <span
                  className="text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-[#c9862c]/15 text-[#c9862c]"
                  title="Se muestra la última imagen recibida; se reconecta sola"
                >
                  Sin señal
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
            <div ref={lienzoRef} className="w-full" />

            {/* Cámara frontal que el cliente ACEPTÓ compartir desde el pie
                de página. Solo aparece si están llegando fotogramas; no hay
                forma de encenderla desde aquí. Recuadro flotante, espejado
                como cualquier autovista. */}
            {caraJpg && (
              <div className="absolute bottom-3 right-3 w-40 sm:w-48 rounded-lg overflow-hidden shadow-xl ring-1 ring-white/20 bg-black">
                <img src={caraJpg} alt="Cámara del cliente" className="block w-full" style={{ transform: 'scaleX(-1)' }} />
                <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold text-white bg-black/60">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#e5484d] animate-pulse" aria-hidden="true" />
                  Cámara compartida por el cliente
                </div>
              </div>
            )}


            {/* No se muestra NADA del lienzo hasta que `estado === 'vivo'`:
                esta capa lo tapa por completo mientras tanto, así que el
                DOM que rrweb va reconstruyendo por debajo —a medio armar,
                sin estilos aplicados todavía— nunca llega a pintarse. Es
                lo que impide el "recuadro sin diseño" al enganchar. */}
            {estado !== 'vivo' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6 pointer-events-none bg-[#0b0f0e]">
                {seleccionado
                  ? <RefreshCw className="w-8 h-8 text-white/30 animate-spin" />
                  : <MonitorPlay className="w-9 h-9 text-white/20" />}
                <p className="text-[12.5px] text-white/45">
                  {seleccionado ? 'Esperando la señal del dispositivo…' : 'El espejo aparece al elegir a alguien conectado.'}
                </p>
              </div>
            )}
          </div>

          {seleccionado && verDiag && (
            <div className="px-3 py-2 border-t border-[var(--border-color)] bg-[var(--bg-sunken)] font-mono text-[10.5px] leading-relaxed text-[var(--text-secondary)] grid grid-cols-2 sm:grid-cols-4 gap-x-4">
              <span>versión panel: {typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : '?'}</span>
              <span className={diag.remoto && diag.remoto.build !== __BUILD_ID__ ? 'text-[#e5484d] font-bold' : ''}>
                versión aparato: {diag.remoto?.build || 'sin dato (versión vieja)'}
              </span>
              <span>pantalla aparato: {diag.remoto ? `${diag.remoto.ancho}×${diag.remoto.alto}` : '—'}</span>
              <span>hojas CSS aparato: {diag.remoto?.hojas ?? '—'}</span>
              <span>lotes recibidos: {diag.lotes}</span>
              <span>datos: {Math.round(diag.bytes / 1024)} KB</span>
              <span>fotos completas: {diag.fotos}</span>
              <span className={diag.cssBaseBytes < 20480 ? 'text-[#e5484d] font-bold' : ''}>CSS base (panel): {Math.round(diag.cssBaseBytes / 1024)} KB</span>
              <span>CSS del aparato: {diag.cssBytes ? `${Math.round(diag.cssBytes / 1024)} KB` : 'no llegó'}</span>
              <span className={diag.huecos ? 'text-[#c9862c] font-bold' : ''}>lotes perdidos: {diag.huecos}</span>
              <span className={diag.descartados ? 'text-[#c9862c] font-bold' : ''}>eventos descartados: {diag.descartados}</span>
              <span className={diag.errores ? 'text-[#e5484d] font-bold' : ''}>errores: {diag.errores}</span>
              <span className={diag.reintentos ? 'text-[#c9862c] font-bold' : ''}>reconexiones: {diag.reintentos}</span>
              <span>canal: {diag.canal || '—'}</span>
              {/* Cuánto adelanta (+) o atrasa (−) el reloj del aparato respecto
                  de esta tablet, con la demora de la red incluida. Solo
                  informativo: el espejo ya no depende de los relojes. */}
              <span>reloj del aparato: {diag.desfaseMs == null ? '—' : `${diag.desfaseMs > 0 ? '+' : ''}${(diag.desfaseMs / 1000).toFixed(1).replace('.', ',')} s`}</span>
              <span>última señal: hace {Math.max(0, Math.round((Date.now() - ultimaSenalRef.current) / 1000))} s</span>
            </div>
          )}

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
                <button
                  type="button"
                  onClick={() => setVerDiag(v => !v)}
                  className="px-2 py-1 rounded-md border border-[var(--border-color)] text-[10.5px] font-bold hover:text-[var(--accent)]"
                >
                  {verDiag ? 'Ocultar diagnóstico' : 'Diagnóstico'}
                </button>
                <span className="font-mono tabular-nums">visto {soloHora(seleccionado.last_seen)}</span>
              </div>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
