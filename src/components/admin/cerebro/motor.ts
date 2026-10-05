// =====================================================================
// CEREBRO DE JARVIS — motor 3D (diseño aprobado)
// =====================================================================
// Cada RAMA es una constelación dibujada en un plano tangente a una esfera
// de radio 1. Vista de frente (cámara en la dirección de su normal) la
// figura se ve sin deformarse, como una constelación vista desde la Tierra.
//   · Núcleo (Technoverse) en el centro; axones curvos hacia cada rama.
//   · Temas = estrellas-neurona; las líneas rectas de la figura salen de un
//     árbol de expansión mínima (así se arman las figuras de los mapas
//     estelares). Lo más usado brilla más y tiene destellos en cruz.
//   · Puntos = lo que cuelga de un tema: al elegirlo, sus ramitas crecen y
//     cada punta se enciende con su texto.
//   · Temas de ramas distintas que se relacionan: axones en arco por fuera.
// Cámara orbital: un dedo gira (con inercia), dos dedos acercan y desplazan
// sin girar (levantar uno no hace saltar nada), doble toque acerca, rueda
// acerca. Al elegir algo vuela sola hasta quedar de frente.
// Rendimiento: el fondo y los brillos se dibujan una vez y se copian; 60
// cps al moverse y 30 en reposo; se duerme a los 25 s sin tocar, si no se
// ve o con «reducir movimiento». En equipos de ≤4 núcleos/≤4 GB, menos
// resolución y sin ramitas decorativas lejanas.
// La escena es siempre de noche (es estética); los paneles siguen el tema.
// =====================================================================

export type PuntoM = { id: string; nombre: string };
export type TemaM = { id: string; nombre: string; usos: number; puntos: PuntoM[] };
export type RamaM = { id: string; nombre: string; color: string; temas: TemaM[] };
export type ModeloM = { ramas: RamaM[]; relaciones: [string, string][] };
export type Toque = { tipo: 'nucleo' | 'rama' | 'tema' | 'punto'; id: string; tema?: string } | null;
export type EstadoM = { foco: string | null; sel: string | null; marcado: string | null; nuevo: string | null };

type V = [number, number, number];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V): V => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a: V, b: V, k: number): V => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const lim = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const difAng = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const hexA = (h: string, a: number) => { const n = parseInt(h.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
/** Número estable por texto: cada estrella cae siempre en el mismo lugar. */
const hash = (t: string) => { let h = 2166136261; for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296; };

const ORO = '#E8C27A', ORO_CLARO = '#FFE3A8', FIBRA = '143,163,217';
const MAX_TEMAS = 60, MAX_PUNTOS = 10, MAX_RELACIONES = 80;
const DMIN = 0.45, DMAX = 6, PMAX = 1.3;

type Estrella = {
  tipo: 'nucleo' | 'rama' | 'tema'; id: string; nombre: string; usos: number; p: V; rama: RamaG | null;
  x: number; y: number; z: number; vis: boolean; niebla: number; r: number; flash: number; ext: number;
  local: [number, number]; puntos: PuntoG[]; deco: V[];
};
type PuntoG = { id: string; nombre: string; p: V; c: V; x: number; y: number };
type RamaG = { id: string; nombre: string; color: string; n: V; e1: V; e2: V; estrella: Estrella; temas: Estrella[]; radio: number; rotulo: [number, number] };
type Axon = { a: Estrella; b: Estrella; c1: V; c2: V; peso: number; fase: number; senal: boolean };
type Cam = { t: V; yaw: number; pitch: number; dist: number };

export class Motor {
  private ctx: CanvasRenderingContext2D;
  private W = 0; private H = 0; private dpr = 1; private CY = 0; private F = 1;
  private arriba = 84; private abajo = 300;
  private cam: Cam = { t: [0, 0, 0], yaw: 0.35, pitch: 0.22, dist: 3.05 };
  private meta: Cam = { t: [0, 0, 0], yaw: 0.35, pitch: 0.22, dist: 3.05 };
  private C: V = [0, 0, 0]; private R: V = [1, 0, 0]; private U: V = [0, 1, 0]; private D: V = [0, 0, 1];
  private nucleo: Estrella;
  private ramas: RamaG[] = [];
  private estrellas: Estrella[] = [];
  private figuras: [Estrella, Estrella][] = [];
  private axones: Axon[] = [];
  private porId = new Map<string, Estrella>();
  private puntoDe = new Map<string, { punto: PuntoG; tema: Estrella }>();
  private lejanas: { p: V; m: number; tw: number }[] = [];
  private fondo: HTMLCanvasElement | null = null;
  private cache = new Map<string, HTMLCanvasElement>();
  private est: EstadoM = { foco: null, sel: null, marcado: null, nuevo: null };
  private quieto: boolean; private liviano: boolean;
  private raf = 0; private previo = 0; private toque = Date.now(); private visible = true;
  private vYaw = 0; private vPitch = 0;
  private punteros = new Map<number, { x: number; y: number }>();
  private inicio = { x: 0, y: 0 }; private movio = false;
  private pinza: { d: number; dist: number; m: { x: number; y: number } } | null = null;
  private huella: { x: number; y: number; t: number }[] = [];
  private antes2 = { t: 0, x: 0, y: 0 };
  private fuentes = { astro: 'Georgia, serif', ui: 'system-ui, sans-serif' };
  private limpiar: (() => void)[] = [];

  constructor(private cv: HTMLCanvasElement, private onTocar: (t: Toque) => void) {
    this.ctx = cv.getContext('2d')!;
    this.quieto = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const nav = navigator as Navigator & { deviceMemory?: number };
    this.liviano = (nav.hardwareConcurrency || 8) <= 4 || (nav.deviceMemory || 8) <= 4;
    this.nucleo = this.estrella('nucleo', 'raiz', 'Technoverse', 40, [0, 0, 0], null);
    let s = 11; const az = () => (s = (s * 9301 + 49297) % 233280) / 233280;
    this.lejanas = Array.from({ length: this.liviano ? 240 : 480 }, () => ({ p: mul(norm([az() - 0.5, az() - 0.5, az() - 0.5]), 9 + az() * 4), m: az(), tw: az() * 6.28 }));
    const css = getComputedStyle(cv);
    this.fuentes = { astro: css.getPropertyValue('--jv-f-astro').trim() || this.fuentes.astro, ui: css.getPropertyValue('--jv-f-ui').trim() || this.fuentes.ui };
    this.gestos();
    const io = new IntersectionObserver(es => { this.visible = es[0]?.isIntersecting ?? true; if (this.visible) this.despertar(); });
    io.observe(cv);
    const vis = () => { if (!document.hidden) this.despertar(); };
    document.addEventListener('visibilitychange', vis);
    this.limpiar.push(() => { io.disconnect(); document.removeEventListener('visibilitychange', vis); });
  }

  destruir() { cancelAnimationFrame(this.raf); this.raf = 0; this.limpiar.forEach(f => f()); }

  /** Tamaño del lienzo y huecos de la cabecera (arriba) y la hoja (abajo). */
  medir(arriba: number, abajo: number) {
    const r = this.cv.getBoundingClientRect();
    this.dpr = Math.min(this.liviano ? 1.25 : 2, devicePixelRatio || 1);
    if (Math.round(r.width) !== this.W || Math.round(r.height) !== this.H) {
      this.W = Math.round(r.width); this.H = Math.round(r.height);
      this.cv.width = this.W * this.dpr; this.cv.height = this.H * this.dpr; this.fondo = null;
    }
    this.arriba = arriba; this.abajo = abajo;
    const alto = Math.max(140, this.H - arriba - abajo);
    this.CY = arriba + alto / 2; this.F = Math.min(this.W, alto) * 1.18;
    this.despertar(true);
  }

  /** Arma la geometría desde los datos (se llama al cargar y tras cada cambio). */
  datos(m: ModeloM) {
    const ant = new Map(this.estrellas.map(s => [s.id, s]));
    this.ramas = []; this.figuras = []; this.axones = []; this.porId.clear(); this.puntoDe.clear();
    this.porId.set('raiz', this.nucleo);
    const N = m.ramas.length;
    const sep = Math.sqrt((4 * Math.PI) / Math.max(1, N));
    m.ramas.forEach((rm, i) => {
      // Esfera de Fibonacci: reparto parejo, sin polos (la cámara no llega a ellos).
      const y = N === 1 ? 0.3 : (1 - (2 * (i + 0.5)) / N) * 0.78, rr = Math.sqrt(1 - y * y), phi = i * 2.399963 + 0.4;
      const n = norm([Math.cos(phi) * rr, y, Math.sin(phi) * rr]);
      const e1 = norm([n[2], 0, -n[0]]);
      const e2: V = [n[1] * e1[2] - n[2] * e1[1], n[2] * e1[0] - n[0] * e1[2], n[0] * e1[1] - n[1] * e1[0]];
      const radio = Math.min(0.55, 0.42 * sep);
      const rama: RamaG = { id: rm.id, nombre: rm.nombre, color: rm.color, n, e1, e2, estrella: null as unknown as Estrella, temas: [], radio, rotulo: [0, 0] };
      rama.estrella = this.estrella('rama', rm.id, rm.nombre, 20, n, rama);
      this.recuperar(rama.estrella, ant);
      // Temas en espiral (los más usados al centro), estable por id.
      const temas = [...rm.temas].sort((a, b) => b.usos - a.usos).slice(0, MAX_TEMAS);
      const k = temas.length, giro = hash(rm.id) * 6.28;
      temas.forEach((tm, j) => {
        const rad = k === 1 ? radio * 0.45 : radio * Math.sqrt((j + 0.7) / (k + 0.2));
        const a = giro + j * 2.399963 + (hash(tm.id) - 0.5) * 0.5;
        const local: [number, number] = [Math.cos(a) * rad, Math.sin(a) * rad * 0.85];
        const t = this.estrella('tema', tm.id, tm.nombre, tm.usos, this.enRama(rama, local), rama);
        t.local = local; this.recuperar(t, ant);
        t.puntos = tm.puntos.slice(0, MAX_PUNTOS).map(p => ({ id: p.id, nombre: p.nombre, p: [0, 0, 0], c: [0, 0, 0], x: 0, y: 0 }));
        rama.temas.push(t);
      });
      // Figura: árbol de expansión mínima entre el centro y sus temas.
      const nodos = [rama.estrella, ...rama.temas];
      const dentro = new Set([0]);
      while (dentro.size < nodos.length) {
        let mejor: [number, number, number] | null = null;
        for (const a of dentro) for (let b = 0; b < nodos.length; b++) {
          if (dentro.has(b)) continue;
          const d = Math.hypot(nodos[a].local[0] - nodos[b].local[0], nodos[a].local[1] - nodos[b].local[1]);
          if (!mejor || d < mejor[2]) mejor = [a, b, d];
        }
        if (!mejor) break;
        dentro.add(mejor[1]); this.figuras.push([nodos[mejor[0]], nodos[mejor[1]]]);
      }
      // Puntos en las puntas de las ramitas, abiertos hacia afuera de la figura.
      for (const t of rama.temas) {
        const cerca = Math.min(...nodos.filter(o => o !== t).map(o => Math.hypot(o.local[0] - t.local[0], o.local[1] - t.local[1])), 0.3);
        const rad = lim(cerca * 0.42, 0.035, 0.1), base = Math.atan2(t.local[1], t.local[0]), kk = t.puntos.length;
        const abre = Math.min(0.95, 5.6 / Math.max(1, kk));
        t.puntos.forEach((pu, j) => {
          const a = base + (j - (kk - 1) / 2) * abre, r2 = rad * (j % 2 ? 1.18 : 1);
          pu.p = this.enRama(rama, [t.local[0] + Math.cos(a) * r2, t.local[1] + Math.sin(a) * r2], 0.02);
          pu.c = this.enRama(rama, [t.local[0] + Math.cos(a + 0.35) * r2 * 0.5, t.local[1] + Math.sin(a + 0.35) * r2 * 0.5], 0.01);
          this.puntoDe.set(pu.id, { punto: pu, tema: t });
        });
        t.deco = Array.from({ length: Math.max(0, 3 - kk) }, (_, j) => { const a = base + 2.4 + j * 1.3; return this.enRama(rama, [t.local[0] + Math.cos(a) * rad * 0.5, t.local[1] + Math.sin(a) * rad * 0.5]); });
      }
      const xs = nodos.map(o => o.local[0]), ys = nodos.map(o => o.local[1]);
      rama.rotulo = [(Math.min(...xs) + Math.max(...xs)) / 2, Math.max(...ys) + 0.12];
      this.ramas.push(rama);
      this.axon(this.nucleo, rama.estrella, 3, false);
    });
    for (const [a, b] of m.relaciones.slice(0, MAX_RELACIONES)) {
      const x = this.porId.get(a), y = this.porId.get(b);
      if (x && y && x.rama !== y.rama) this.axon(x, y, 1, true);
    }
    this.estrellas = [this.nucleo, ...this.ramas.map(r => r.estrella), ...this.ramas.flatMap(r => r.temas)];
    this.estado(this.est, true);
    this.despertar(true);
  }

  /** Qué está elegido; la cámara vuela sola hasta quedar de frente. */
  estado(e: EstadoM, sinVuelo = false) {
    const cambio = e.foco !== this.est.foco || e.sel !== this.est.sel || e.marcado !== this.est.marcado;
    this.est = { ...e };
    if (e.nuevo) { const n = this.porId.get(e.nuevo) || this.puntoDe.get(e.nuevo)?.tema; if (n) n.flash = performance.now(); }
    if (!cambio && sinVuelo) return;
    if (!cambio && !sinVuelo) { this.despertar(); return; }
    const sel = this.selEstrella();
    if (sel && sel.rama) this.deFrente(sel.rama.n, add(sel.p, mul(sel.rama.e2, -0.03)), lim(0.6 + this.radioPuntos(sel) * 4, 0.7, 1.2));
    else if (e.foco && this.porId.get(e.foco)?.rama) { const r = this.porId.get(e.foco)!.rama!; this.deFrente(r.n, this.centro(r), lim(r.radio * 3, 1.0, 1.8)); }
    else this.volar({ t: [0, 0, 0], yaw: this.meta.yaw, pitch: 0.22, dist: 3.05 });
  }

  zoom(f: number) { this.volar({ ...this.meta, dist: this.meta.dist / f }); }

  // ------------------------------------------------------------------
  private estrella(tipo: Estrella['tipo'], id: string, nombre: string, usos: number, p: V, rama: RamaG | null): Estrella {
    const s: Estrella = { tipo, id, nombre, usos, p, rama, x: 0, y: 0, z: 0, vis: false, niebla: 1, r: 1, flash: 0, ext: 0.3, local: [0, 0], puntos: [], deco: [] };
    this.porId.set(id, s); return s;
  }
  private recuperar(s: Estrella, ant: Map<string, Estrella>) { const a = ant.get(s.id); if (a) { s.ext = a.ext; s.flash = a.flash; } }
  private enRama(r: RamaG, [x, y]: [number, number], fuera = 0): V { return add(add(mul(r.n, 1 + fuera), mul(r.e1, x)), mul(r.e2, y)); }
  private centro(r: RamaG): V { const ps = [r.estrella, ...r.temas].map(s => s.p); return mul(ps.reduce((a, p) => add(a, p), [0, 0, 0] as V), 1 / ps.length); }
  private radioPuntos(t: Estrella) { return t.puntos.length ? Math.max(...t.puntos.map(p => Math.hypot(...sub(p.p, t.p)))) : 0.06; }
  private selEstrella(): Estrella | null {
    const id = this.est.sel; if (!id) return null;
    return this.porId.get(id) || this.puntoDe.get(id)?.tema || null;
  }
  private axon(a: Estrella, b: Estrella, peso: number, arco: boolean) {
    let c1: V, c2: V;
    // Entre ramas la fibra va por DENTRO del cerebro (de cerca no hace lazos).
    if (arco) { c1 = mul(lerp(a.p, b.p, 0.33), 0.55); c2 = mul(lerp(a.p, b.p, 0.66), 0.55); }
    else { const o = mul(b.rama!.e1, 0.12); c1 = add(mul(b.p, 0.35), o); c2 = add(mul(b.p, 0.72), mul(o, 0.6)); }
    const f = hash(a.id + b.id);
    this.axones.push({ a, b, c1, c2, peso, fase: f, senal: f < 0.75 });
  }
  private volar(c: Cam) {
    this.vYaw = this.vPitch = 0;
    this.meta = { t: [...c.t] as V, yaw: this.cam.yaw + difAng(this.cam.yaw, c.yaw), pitch: lim(c.pitch, -PMAX, PMAX), dist: lim(c.dist, DMIN, DMAX) };
    this.despertar();
  }
  private deFrente(n: V, t: V, dist: number) { this.volar({ t, yaw: Math.atan2(n[0], n[2]), pitch: Math.asin(lim(n[1], -1, 1)), dist }); }
  private base() {
    const { yaw, pitch } = this.cam, cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    this.D = [cp * sy, sp, cp * cy]; this.R = [cy, 0, -sy]; this.U = [-sy * sp, cp, -cy * sp]; this.C = add(this.cam.t, mul(this.D, this.cam.dist));
  }
  private Q = { x: 0, y: 0, z: 0, ok: true };
  private proy(p: V) {
    const v = sub(p, this.C), z = -dot(v, this.D), k = this.F / Math.max(z, 0.08);
    this.Q.ok = z > 0.08; this.Q.x = this.W / 2 + dot(v, this.R) * k; this.Q.y = this.CY - dot(v, this.U) * k; this.Q.z = z; return this.Q;
  }
  private niebla(z: number) { return lim(1.25 - (z - this.cam.dist) * 0.55, 0.22, 1); }

  private sprite(clave: string, tam: number, pintar: (x: CanvasRenderingContext2D) => void) {
    let c = this.cache.get(clave);
    if (!c) { c = document.createElement('canvas'); c.width = c.height = tam; pintar(c.getContext('2d')!); this.cache.set(clave, c); }
    return c;
  }
  private halo(col: string) {
    return this.sprite('h' + col, 64, x => { const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, hexA(col, 0.8)); g.addColorStop(0.22, hexA(col, 0.22)); g.addColorStop(1, hexA(col, 0)); x.fillStyle = g; x.fillRect(0, 0, 64, 64); });
  }
  private destello(col: string) {
    return this.sprite('d' + col, 96, x => { x.translate(48, 48); for (const [w, h] of [[46, 1.2], [1.2, 46]]) { const g = x.createLinearGradient(-w, -h, w, h); g.addColorStop(0, hexA(col, 0)); g.addColorStop(0.5, hexA(col, 0.7)); g.addColorStop(1, hexA(col, 0)); x.fillStyle = g; x.fillRect(-w, -h, w * 2, h * 2); } });
  }
  private pintarFondo() {
    // Espacio profundo: gradiente, franja de la Vía Láctea y estrellas fijas.
    const { W, H, dpr } = this; const f = document.createElement('canvas'); f.width = W * dpr; f.height = H * dpr;
    const x = f.getContext('2d')!; x.setTransform(dpr, 0, 0, dpr, 0, 0);
    let s = 77; const az = () => (s = (s * 9301 + 49297) % 233280) / 233280;
    const g = x.createRadialGradient(W * 0.5, H * 0.32, 0, W * 0.5, H * 0.4, Math.max(W, H) * 0.95);
    g.addColorStop(0, '#0B1430'); g.addColorStop(0.5, '#050915'); g.addColorStop(1, '#010206');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.save(); x.translate(W / 2, H / 2); x.rotate(-0.55);
    for (let i = 0; i < 26; i++) { const cx = (az() - 0.5) * W * 1.6, cy = (az() - 0.5) * 70, r = 40 + az() * 90; const gg = x.createRadialGradient(cx, cy, 0, cx, cy, r); gg.addColorStop(0, `rgba(${150 + az() * 60},${150 + az() * 50},${200 + az() * 55},0.045)`); gg.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = gg; x.fillRect(cx - r, cy - r, r * 2, r * 2); }
    for (let i = 0; i < 700; i++) { const px = (az() - 0.5) * W * 1.7, py = (az() - 0.5) * (az() < 0.6 ? 90 : H * 1.6), m = az(); x.fillStyle = `rgba(220,228,255,${0.12 + m * 0.42})`; const t = m > 0.97 ? 1.4 : 0.7; x.fillRect(px, py, t, t); }
    x.restore(); this.fondo = f;
  }

  // ------------------------------------------------------------------
  private vecinos(s: Estrella) {
    const v = new Set<Estrella>();
    for (const [a, b] of this.figuras) { if (a === s) v.add(b); if (b === s) v.add(a); }
    for (const l of this.axones) { if (l.a === s) v.add(l.b); if (l.b === s) v.add(l.a); }
    v.delete(this.nucleo); return v;
  }

  private dibujar(t: number) {
    const { ctx, W, H } = this; if (!W || !H) return;
    this.base();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (!this.fondo) this.pintarFondo();
    ctx.drawImage(this.fondo!, 0, 0, W, H);
    // Estrellas lejanas: giran con la cámara (paralaje real).
    for (const s of this.lejanas) {
      const q = this.proy(s.p); if (!q.ok || q.x < 0 || q.y < 0 || q.x > W || q.y > H) continue;
      const a = (this.quieto ? 0.7 : 0.5 + 0.5 * Math.sin(t / 1100 + s.tw)) * (0.25 + s.m * 0.5);
      ctx.fillStyle = `rgba(225,232,255,${a.toFixed(3)})`; const k = s.m > 0.96 ? 1.6 : 1; ctx.fillRect(q.x, q.y, k, k);
    }
    const zR = lim(Math.sqrt(3.05 / this.cam.dist), 0.85, 1.9);
    for (const s of this.estrellas) {
      const q = this.proy(s.p); s.x = q.x; s.y = q.y; s.z = q.z; s.vis = q.ok; s.niebla = this.niebla(q.z);
      s.r = (s.tipo === 'nucleo' ? 5 : s.tipo === 'rama' ? 3.4 : 1.5 + Math.min(s.usos, 15) / 6) * zR;
    }
    const sel = this.selEstrella(), foco = this.est.foco ? this.porId.get(this.est.foco)?.rama || null : sel?.rama || null;
    const cerca = sel ? this.vecinos(sel) : null;
    const brillo = (s: Estrella) => {
      let k = 1;
      if (foco && s.rama && s.rama !== foco && !(cerca && cerca.has(s))) k = 0.14;
      else if (sel && s !== sel && s.tipo === 'tema' && s.rama === sel.rama && !cerca!.has(s)) k = 0.5;
      return k * s.niebla;
    };
    const marcado = this.est.marcado;

    // 1) Axones: fibras curvas azul tenue (cómo piensa), resplandor + hilo.
    ctx.lineCap = 'round';
    for (const pasada of [0, 1]) for (const l of this.axones) {
      if (!l.a.vis || !l.b.vis) continue;
      const viva = !!sel && (l.a === sel || l.b === sel), a = viva ? 1 : Math.min(brillo(l.a), brillo(l.b));
      // Las relaciones entre ramas solo se ven al mirar una de ellas (en la vista general enredan).
      if (a < 0.05 || (l.peso === 1 && !viva && !(foco && (l.a.rama === foco || l.b.rama === foco)))) continue;
      const c1 = this.proy(l.c1), x1 = c1.x, y1 = c1.y, c2 = this.proy(l.c2);
      ctx.strokeStyle = viva ? (pasada ? 'rgba(232,194,122,.9)' : 'rgba(232,194,122,.16)') : `rgba(${FIBRA},${((pasada ? 0.32 : 0.06) * a).toFixed(3)})`;
      ctx.lineWidth = pasada ? (viva ? 1.6 : 1) * (l.peso > 1 ? 1.2 : 1) : 5;
      ctx.beginPath(); ctx.moveTo(l.a.x, l.a.y); ctx.bezierCurveTo(x1, y1, c2.x, c2.y, l.b.x, l.b.y); ctx.stroke();
    }
    // 2) Constelaciones: líneas rectas nítidas del color de la rama (lo que sabe).
    ctx.lineWidth = 1.1;
    for (const [a, b] of this.figuras) {
      if (!a.vis || !b.vis) continue;
      const viva = !!sel && (a === sel || b === sel), al = Math.min(brillo(a), brillo(b));
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, ga = a.r + 4, gb = b.r + 4;
      if (d < ga + gb || al < 0.05) continue;
      ctx.strokeStyle = viva ? 'rgba(232,194,122,.95)' : hexA(a.rama!.color, 0.62 * al);
      ctx.beginPath(); ctx.moveTo(a.x + (dx / d) * ga, a.y + (dy / d) * ga); ctx.lineTo(b.x - (dx / d) * gb, b.y - (dy / d) * gb); ctx.stroke();
    }
    // 3) Impulsos por los axones; la estrella que los recibe destella.
    if (!this.quieto) for (const l of this.axones) {
      const viva = !!sel && (l.a === sel || l.b === sel);
      if (!viva && (!l.senal || brillo(l.a) < 0.2 || brillo(l.b) < 0.2 || (l.peso === 1 && !(foco && (l.a.rama === foco || l.b.rama === foco))))) continue;
      const vel = viva ? 1500 : 3400 + l.fase * 2200, k = ((t / vel) + l.fase) % 1;
      if (k > 0.985) l.b.flash = t;
      const col = viva ? ORO_CLARO : (l.b.rama || l.a.rama)!.color, h = this.halo(col);
      for (let j = 0; j < 4; j++) {
        const kk = Math.max(0, k - j * 0.02), u = 1 - kk;
        const p = add(add(mul(l.a.p, u * u * u), mul(l.c1, 3 * u * u * kk)), add(mul(l.c2, 3 * u * kk * kk), mul(l.b.p, kk * kk * kk)));
        const q = this.proy(p); if (!q.ok) continue;
        const r = (3.2 - j * 0.65) * lim(Math.sqrt(3.05 / q.z), 0.7, 1.8);
        ctx.globalAlpha = (0.9 - j * 0.22) * this.niebla(q.z); ctx.drawImage(h, q.x - r * 2.2, q.y - r * 2.2, r * 4.4, r * 4.4);
      }
      ctx.globalAlpha = 1;
    }
    // 4) Neuronas-estrella, de atrás para adelante.
    const orden = this.estrellas.filter(s => s.vis).sort((a, b) => b.z - a.z);
    for (const s of orden) {
      const al = brillo(s); if (al < 0.03) continue;
      const esSel = s === sel, col = esSel ? ORO : s.tipo === 'nucleo' ? '#FFFFFF' : s.rama!.color, r = s.r;
      const fl = s.flash && t - s.flash < 450 ? 1 - (t - s.flash) / 450 : 0;
      if (s.tipo === 'tema' && al > 0.2) {
        // Ramitas: cada una termina en uno de sus PUNTOS; crecen al elegirlo.
        const obj = esSel ? 1 : foco === s.rama ? 0.55 : 0.3; s.ext += (obj - s.ext) * (this.quieto ? 1 : 0.12);
        const lejos = this.liviano && !esSel && foco !== s.rama;
        if (!lejos) {
          ctx.strokeStyle = hexA(col, 0.5 * al); ctx.lineWidth = esSel ? 1 : 0.8; ctx.beginPath();
          for (const pu of s.puntos) {
            const c = this.proy(lerp(s.p, pu.c, s.ext)), cx = c.x, cy = c.y, e = this.proy(lerp(s.p, pu.p, s.ext));
            ctx.moveTo(s.x, s.y); ctx.quadraticCurveTo(cx, cy, e.x, e.y); pu.x = e.x; pu.y = e.y;
          }
          for (const d of s.deco) { const e = this.proy(lerp(s.p, d, s.ext > 0.5 ? 0.6 : 1)); ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y); }
          ctx.stroke();
        }
        if (s.ext > 0.5) for (const pu of s.puntos) {
          const a = (s.ext - 0.5) * 2 * al, m = pu.id === marcado, rr = (m ? 3.2 : 2.2) * zR * 0.8;
          ctx.globalAlpha = a; ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(this.halo(m ? ORO_CLARO : '#FFE9C4'), pu.x - rr * 3, pu.y - rr * 3, rr * 6, rr * 6);
          ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = m ? ORO_CLARO : '#FFF6E6'; ctx.beginPath(); ctx.arc(pu.x, pu.y, rr * 0.45, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
        }
      } else if (s.tipo !== 'tema' && al > 0.2) {
        ctx.strokeStyle = hexA(col, 0.4 * al); ctx.lineWidth = 0.8; ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = i * 1.047 + (s.tipo === 'nucleo' ? 0.3 : 0.8), L = (s.tipo === 'nucleo' ? 13 : 10) * zR;
          ctx.moveTo(s.x + Math.cos(a) * r, s.y + Math.sin(a) * r);
          ctx.quadraticCurveTo(s.x + Math.cos(a + 0.25) * (r + L * 0.55), s.y + Math.sin(a + 0.25) * (r + L * 0.55), s.x + Math.cos(a) * (r + L), s.y + Math.sin(a) * (r + L));
        }
        ctx.stroke();
      }
      const hr = r * (s.tipo === 'tema' ? 3.4 : 4.2) * (1 + fl * 0.7);
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.6 * al;
      ctx.drawImage(this.halo(col), s.x - hr, s.y - hr, hr * 2, hr * 2);
      if (al > 0.5 && (s.tipo === 'nucleo' || s.usos >= 12 || esSel || fl)) { const dr = r * (s.tipo === 'nucleo' ? 6 : 4.5) * (1 + fl * 0.6); ctx.globalAlpha = (0.45 + fl * 0.4) * al; ctx.drawImage(this.destello(col), s.x - dr, s.y - dr, dr * 2, dr * 2); }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.55 * al; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, 7); ctx.fill();
      ctx.globalAlpha = Math.max(0.3, al); ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.arc(s.x, s.y, r * 0.55, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
      if (esSel || s.id === this.est.nuevo) { ctx.strokeStyle = 'rgba(232,194,122,.85)'; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.arc(s.x, s.y, r + 7 + (s.id === this.est.nuevo && !this.quieto ? Math.sin(t / 180) * 2.5 : 0), 0, 7); ctx.stroke(); }
    }
    this.rotular(sel, foco, cerca);
  }

  private rotular(sel: Estrella | null, foco: RamaG | null, cerca: Set<Estrella> | null) {
    const { ctx, W, H } = this;
    const puestos: number[][] = [];
    const choca = (c: number[]) => puestos.some(p => c[0] < p[2] && c[2] > p[0] && c[1] < p[3] && c[3] > p[1]);
    const cabe = (c: number[]) => c[0] > 4 && c[2] < W - 4 && c[1] > this.arriba - 6 && c[3] < H - this.abajo - 4;
    const espacio = (px: string) => { if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = px; };
    ctx.shadowColor = 'rgba(2,4,10,.95)'; ctx.shadowBlur = 6; ctx.textAlign = 'left';
    // Constelaciones que miran hacia la cámara.
    ctx.font = `600 12.5px ${this.fuentes.astro}`; espacio('3px');
    for (const r of this.ramas) {
      const frente = dot(r.n, norm(sub(this.C, r.estrella.p))); if (frente < 0.05) continue;
      const q = this.proy(this.enRama(r, r.rotulo)); if (!q.ok) continue;
      const txt = r.nombre.toUpperCase(), w = ctx.measureText(txt).width, x = q.x - w / 2, caja = [x, q.y - 12, x + w, q.y + 3];
      if (!cabe(caja) || choca(caja)) continue;
      puestos.push(caja); ctx.fillStyle = hexA(r.color, lim(frente * 1.8, 0, 1) * (foco && r !== foco ? 0.35 : 0.95)); ctx.fillText(txt, x, q.y);
    }
    const n = this.nucleo;
    if (n.vis && !foco) {
      ctx.font = `600 10.5px ${this.fuentes.astro}`; espacio('2px');
      const w = ctx.measureText('TECHNOVERSE').width, x = n.x - w / 2, y = n.y + n.r + 20, c = [x, y - 11, x + w, y + 3];
      if (cabe(c) && !choca(c)) { puestos.push(c); ctx.fillStyle = 'rgba(232,237,247,.8)'; ctx.fillText('TECHNOVERSE', x, y); }
    }
    espacio('0px');
    // Temas: los de la rama en foco, los vecinos del elegido, o al acercarse.
    ctx.font = `500 11.5px ${this.fuentes.ui}`;
    const temas = this.estrellas.filter(s => s.tipo === 'tema' && s.vis && (s === sel || s.id === this.est.nuevo || (cerca && cerca.has(s)) || (foco ? s.rama === foco : this.cam.dist < 2.3 && s.niebla > 0.75)));
    temas.sort((a, b) => Number(b === sel) - Number(a === sel) || b.usos - a.usos);
    for (const s of temas) {
      const txt = s.nombre.length > 26 ? s.nombre.slice(0, 25) + '…' : s.nombre, w = ctx.measureText(txt).width, y = s.y + 4;
      const op = [[s.x + s.r + 9, y - 11, s.x + s.r + 9 + w, y + 3], [s.x - s.r - 9 - w, y - 11, s.x - s.r - 9, y + 3], [s.x - w / 2, s.y + s.r + 7, s.x + w / 2, s.y + s.r + 21], [s.x - w / 2, s.y - s.r - 22, s.x + w / 2, s.y - s.r - 8]];
      const caja = op.find(c => cabe(c) && !choca(c)) || (s === sel ? op.find(cabe) : null); if (!caja) continue;
      puestos.push(caja); ctx.fillStyle = s === sel ? ORO : `rgba(221,229,243,${foco && s.rama !== foco ? 0.46 : 0.92})`; ctx.fillText(txt, caja[0], caja[3] - 3);
    }
    // Texto de los puntos del tema elegido.
    if (sel && sel.ext > 0.85) {
      ctx.font = `400 10.5px ${this.fuentes.ui}`;
      for (const pu of sel.puntos) {
        const txt = pu.nombre.length > 24 ? pu.nombre.slice(0, 23) + '…' : pu.nombre, w = ctx.measureText(txt).width, y = pu.y + 4;
        const op = [[pu.x + 7, y - 10, pu.x + 7 + w, y + 3], [pu.x - 7 - w, y - 10, pu.x - 7, y + 3], [pu.x - w / 2, pu.y + 6, pu.x + w / 2, pu.y + 19]];
        const caja = op.find(c => cabe(c) && !choca(c)); if (!caja) continue;
        puestos.push(caja); ctx.fillStyle = pu.id === this.est.marcado ? ORO_CLARO : 'rgba(255,233,196,.85)'; ctx.fillText(txt, caja[0], caja[3] - 3);
      }
    }
    ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
  }

  // ------------------------------------------------------------------
  /** Bucle: 60 cps moviéndose, 30 en reposo; se duerme a los 25 s sin tocar. */
  private despertar(soloUnCuadro = false) {
    if (!soloUnCuadro) this.toque = Date.now();
    if (!this.raf) this.raf = requestAnimationFrame(this.paso);
  }
  private paso = (t: number) => {
    this.raf = 0;
    if (!this.visible || document.hidden) return;
    const cam = this.cam, meta = this.meta;
    const vuela = Math.abs(difAng(cam.yaw, meta.yaw)) + Math.abs(meta.pitch - cam.pitch) + Math.abs(meta.dist - cam.dist) + Math.hypot(...sub(meta.t, cam.t)) > 1e-3;
    const gira = Math.abs(this.vYaw) + Math.abs(this.vPitch) > 1e-6;
    const mueve = this.punteros.size > 0 || gira || vuela;
    const ocioso = Date.now() - this.toque;
    if (!mueve && (this.quieto || ocioso > 25000)) { this.previo = 0; this.dibujar(t); return; }
    this.raf = requestAnimationFrame(this.paso);
    const dt = this.previo ? Math.min(64, t - this.previo) : 16;
    if (this.previo && dt < (mueve ? 14 : this.liviano ? 40 : 30)) return;
    this.previo = t;
    if (!this.punteros.size) {
      if (gira) {
        cam.yaw += this.vYaw * dt; cam.pitch = lim(cam.pitch + this.vPitch * dt, -PMAX, PMAX); meta.yaw = cam.yaw; meta.pitch = cam.pitch;
        const fr = Math.pow(0.9, dt / 16); this.vYaw *= fr; this.vPitch *= fr;
        if (Math.abs(this.vYaw) + Math.abs(this.vPitch) < 2e-6) this.vYaw = this.vPitch = 0;
      } else if (vuela) {
        const k = this.quieto ? 1 : 1 - Math.pow(0.86, dt / 16);
        cam.yaw += difAng(cam.yaw, meta.yaw) * k; cam.pitch += (meta.pitch - cam.pitch) * k; cam.dist += (meta.dist - cam.dist) * k; cam.t = lerp(cam.t, meta.t, k);
      } else if (!this.quieto && !this.est.foco && !this.est.sel && ocioso > 4000) { cam.yaw += 0.00004 * dt; meta.yaw = cam.yaw; }
    }
    this.dibujar(t);
  };

  // ------------------------------------------------------------------
  /** Un dedo gira; dos acercan y desplazan; si queda un dedo de una pinza
   *  no hace nada hasta soltarlo; doble toque acerca; tocar elige. */
  private gestos() {
    const cv = this.cv;
    const rel = (e: PointerEvent | WheelEvent) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const cortar = () => { this.meta = { t: [...this.cam.t] as V, yaw: this.cam.yaw, pitch: this.cam.pitch, dist: this.cam.dist }; this.vYaw = this.vPitch = 0; };
    const empezarPinza = () => { const [a, b] = [...this.punteros.values()]; this.pinza = { d: Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)), dist: this.cam.dist, m: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }; };
    const abajo = (e: PointerEvent) => {
      try { cv.setPointerCapture(e.pointerId); } catch { /* puntero sintético */ }
      const p = rel(e); this.punteros.set(e.pointerId, p); cortar();
      if (this.punteros.size === 1) { this.inicio = p; this.movio = false; this.huella = [{ ...p, t: performance.now() }]; }
      else if (this.punteros.size === 2) { this.movio = true; empezarPinza(); }
      this.despertar();
    };
    const mover = (e: PointerEvent) => {
      const antes = this.punteros.get(e.pointerId); if (!antes) return;
      const p = rel(e); this.punteros.set(e.pointerId, p); this.toque = Date.now();
      if (this.punteros.size >= 2) {
        if (!this.pinza) empezarPinza();
        const [a, b] = [...this.punteros.values()], d = Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const pz = this.pinza!;
        this.cam.dist = lim((pz.dist * pz.d) / d, DMIN, DMAX);
        this.base(); const k = this.cam.dist / this.F;
        this.cam.t = add(this.cam.t, add(mul(this.R, -(m.x - pz.m.x) * k), mul(this.U, (m.y - pz.m.y) * k))); pz.m = m;
        cortar(); this.despertar(); return;
      }
      if (this.pinza) return;
      if (!this.movio && Math.hypot(p.x - this.inicio.x, p.y - this.inicio.y) < 6) return;
      this.movio = true;
      this.cam.yaw -= (p.x - antes.x) * 0.006; this.cam.pitch = lim(this.cam.pitch + (p.y - antes.y) * 0.006, -PMAX, PMAX); cortar();
      const now = performance.now(); this.huella.push({ ...p, t: now }); while (this.huella.length > 2 && now - this.huella[0].t > 90) this.huella.shift();
      this.despertar();
    };
    const arriba = (e: PointerEvent) => {
      if (!this.punteros.has(e.pointerId)) return;
      this.punteros.delete(e.pointerId); if (this.punteros.size) return;
      const fue = !!this.pinza; this.pinza = null; if (fue) return;
      const p = rel(e), now = performance.now();
      if (!this.movio) {
        const t = this.tocar(p);
        if (!t && now - this.antes2.t < 300 && Math.hypot(p.x - this.antes2.x, p.y - this.antes2.y) < 30) { this.volar({ ...this.meta, dist: this.meta.dist * 0.62 }); this.antes2.t = 0; return; }
        this.antes2 = { t: now, x: p.x, y: p.y };
        if (t) this.onTocar(t);
        return;
      }
      const h0 = this.huella[0], dtt = now - h0.t, ult = this.huella[this.huella.length - 1];
      if (this.huella.length > 1 && dtt > 0 && now - ult.t < 60) { this.vYaw = lim((-(p.x - h0.x) * 0.006) / dtt, -0.004, 0.004); this.vPitch = lim(((p.y - h0.y) * 0.006) / dtt, -0.004, 0.004); }
      this.despertar();
    };
    const rueda = (e: WheelEvent) => { e.preventDefault(); this.volar({ ...this.meta, dist: this.meta.dist * Math.exp(lim(e.deltaY, -60, 60) * 0.004) }); };
    const teclas = (e: KeyboardEvent) => {
      const m = this.meta;
      if (e.key === 'ArrowLeft') this.volar({ ...m, yaw: m.yaw + 0.25 }); else if (e.key === 'ArrowRight') this.volar({ ...m, yaw: m.yaw - 0.25 });
      else if (e.key === 'ArrowUp') this.volar({ ...m, pitch: m.pitch - 0.2 }); else if (e.key === 'ArrowDown') this.volar({ ...m, pitch: m.pitch + 0.2 });
      else if (e.key === '+' || e.key === '=') this.zoom(1.3); else if (e.key === '-') this.zoom(1 / 1.3); else return;
      e.preventDefault();
    };
    cv.addEventListener('pointerdown', abajo); cv.addEventListener('pointermove', mover);
    cv.addEventListener('pointerup', arriba); cv.addEventListener('pointercancel', arriba);
    cv.addEventListener('wheel', rueda, { passive: false }); cv.addEventListener('keydown', teclas);
    this.limpiar.push(() => {
      cv.removeEventListener('pointerdown', abajo); cv.removeEventListener('pointermove', mover);
      cv.removeEventListener('pointerup', arriba); cv.removeEventListener('pointercancel', arriba);
      cv.removeEventListener('wheel', rueda); cv.removeEventListener('keydown', teclas);
    });
  }

  /** Qué hay bajo el dedo: los puntos del tema abierto y las estrellas. */
  private tocar(p: { x: number; y: number }): Toque {
    const sel = this.selEstrella();
    let mejor: Toque = null, dm = 24;
    if (sel && sel.ext > 0.6) for (const pu of sel.puntos) { const d = Math.hypot(pu.x - p.x, pu.y - p.y); if (d < 14 && d < dm) { dm = d; mejor = { tipo: 'punto', id: pu.id, tema: sel.id }; } }
    if (!mejor) for (const s of this.estrellas) {
      if (!s.vis || s.niebla < 0.3) continue;
      const d = Math.hypot(s.x - p.x, s.y - p.y); if (d < dm) { dm = d; mejor = { tipo: s.tipo, id: s.id }; }
    }
    return mejor;
  }
}
