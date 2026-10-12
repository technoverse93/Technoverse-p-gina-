// =====================================================================
// LECTOR DE VOZ — el asistente responde hablando
// =====================================================================
// Usa la voz del propio teléfono: gratis, sin gastar cupo de IA, funciona
// sin internet y empieza al instante.
//   · En la APK: el motor de voz de Android (complemento text-to-speech de
//     Capacitor). El WebView no siempre trae la voz del navegador.
//   · En la web: la voz del navegador (speechSynthesis).
//
// Lee por ORACIONES: así «Pausar» se detiene en la oración en curso y
// «Seguir» retoma desde ahí, igual en los dos motores (el de Android no
// sabe pausar). Lee una versión limpia del texto: sin símbolos de formato,
// sin enlaces y sin tablas (avisa que están en pantalla).
//
// Cuándo lee solo: preferencia de este aparato (Ajustes → Voz):
//   'nunca' · 'voz' (por defecto: cuando le preguntaste hablando) · 'siempre'.
//
// HABLA MIENTRAS LA RESPUESTA LLEGA (`abrirFlujo`): en vez de esperar a que
// termine de escribirse, va diciendo cada oración apenas se completa (ver
// flujoVoz.ts). La primera sale a los ~1–2 s en lugar de al final.
// =====================================================================

import { Capacitor } from '@capacitor/core';
import * as propia from './vozPropia';
import { crearFlujoHabla } from './flujoVoz';
import { enOraciones, paraHablar } from './textoHablado';

export { paraHablar };

export type ModoLectura = 'nunca' | 'voz' | 'siempre';
export type EstadoLector = { estado: 'callado' | 'hablando' | 'pausado'; id: string | null };

const CLAVE_MODO = 'tv_voz_respuestas';

export function modoLectura(): ModoLectura {
  try {
    const v = localStorage.getItem(CLAVE_MODO);
    return v === 'nunca' || v === 'siempre' ? v : 'voz';
  } catch { return 'voz'; }
}
export function fijarModoLectura(m: ModoLectura): void {
  try { localStorage.setItem(CLAVE_MODO, m); } catch { /* sin almacenamiento: queda el de siempre */ }
}

// ------------------------- motores -------------------------
type Motor = { decir: (texto: string) => Promise<void>; callar: () => void; preparar?: (texto: string) => void };

/** La voz propia de Phill (neuronal, en el aparato). Si falla una vez en
 *  esta sesión, se vuelve a la voz del teléfono sin cortar la lectura. */
let propiaFallo = false;
function motorPropio(): Motor | null {
  if (propiaFallo || !propia.usarVozPropia()) return null;
  return {
    decir: async (texto: string) => {
      try { await propia.decir(texto); }
      catch (e) {
        propiaFallo = true;
        const otro = (await nativo()) || navegador();
        if (otro) await otro.decir(texto); else throw e;
      }
    },
    callar: () => propia.callar(),
    preparar: (texto: string) => { void propia.preparar(texto).catch(() => {}); },
  };
}

let motorNativo: Promise<Motor | null> | null = null;
function nativo(): Promise<Motor | null> {
  if (!motorNativo) motorNativo = (async () => {
    // En una APK vieja (sin el complemento) se usa la voz del navegador.
    if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('TextToSpeech')) return null;
    try {
      const { TextToSpeech } = await import('@capacitor-community/text-to-speech');
      // El primer español que tenga el teléfono, empezando por el de acá.
      let lang = 'es-US';
      for (const l of ['es-CR', 'es-MX', 'es-US', 'es-419', 'es-ES', 'es']) {
        try { if ((await TextToSpeech.isLanguageSupported({ lang: l })).supported) { lang = l; break; } } catch { /* se prueba el siguiente */ }
      }
      const espera = (ms: number) => new Promise(r => setTimeout(r, ms));
      return {
        // Recién abierta la app, el motor de Android puede no estar listo:
        // se reintenta un momento. Si el idioma no está, se usa «es».
        decir: async (texto: string) => {
          for (let intento = 0; intento < 5; intento++) {
            try { await TextToSpeech.speak({ text: texto, lang, rate: 1.0, pitch: 1.0, volume: 1.0, category: 'playback' }); return; }
            catch (e) {
              const msg = String((e as Error)?.message || e);
              if (/not yet initialized/i.test(msg) && intento < 4) { await espera(400); continue; }
              if (/not supported/i.test(msg) && lang !== 'es') { lang = 'es'; continue; }
              throw e;
            }
          }
        },
        callar: () => { void TextToSpeech.stop().catch(() => {}); },
      };
    } catch { return null; }
  })();
  return motorNativo;
}

function navegador(): Motor | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  const s = window.speechSynthesis;
  const elegirVoz = () => {
    const voces = s.getVoices().filter(v => /^es(-|_|$)/i.test(v.lang));
    for (const pref of ['es-CR', 'es-MX', 'es-US', 'es-419']) {
      const v = voces.find(x => x.lang.replace('_', '-').toLowerCase() === pref.toLowerCase());
      if (v) return v;
    }
    return voces[0] || null;
  };
  return {
    decir: (texto: string) => new Promise<void>(ok => {
      const u = new SpeechSynthesisUtterance(texto);
      const v = elegirVoz();
      if (v) u.voice = v;
      u.lang = v?.lang || 'es-MX';
      u.rate = 1.0;
      u.onend = () => ok(); u.onerror = () => ok();
      s.speak(u);
    }),
    callar: () => s.cancel(),
  };
}

async function motor(): Promise<Motor | null> {
  return motorPropio() || (await nativo()) || navegador();
}

/** ¿Este aparato puede hablar? (para mostrar o no los controles) */
export function puedeHablar(): boolean {
  return propia.usarVozPropia() || (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('TextToSpeech')) || (typeof window !== 'undefined' && 'speechSynthesis' in window);
}

// ------------------------- el lector -------------------------
let actual: EstadoLector = { estado: 'callado', id: null };
const oyentes = new Set<() => void>();
let frases: string[] = [];
let indice = 0;
let generacion = 0;
// Cortes pendientes: el motor de Android no avisa cuando se lo detiene, así
// que cada oración espera «terminó» o «la cortaron», lo que llegue primero.
let cortes: (() => void)[] = [];
// Flujo abierto (habla mientras llega la respuesta): mientras esté abierto, el
// lector espera oraciones nuevas en vez de terminar al agotar las que tiene.
let contadorFlujos = 0;
let flujoVigente = 0;      // id del flujo abierto (0: ninguno)
let flujoAbierto = false;  // todavía pueden llegar oraciones
let despertar: (() => void) | null = null;
let motorActual: Motor | null = null;
let sonando = -1;          // oración que está sonando (-1: ninguna)
/** Cuánto sin texto nuevo antes de decir la última oración que esperaba un espacio. */
const ESPERA_QUIETO_MS = 650;

function fijar(e: EstadoLector) {
  actual = e;
  for (const f of oyentes) f();
}
function despertarLector() { const d = despertar; despertar = null; d?.(); }
function cortar() {
  generacion++;
  sonando = -1;
  for (const c of cortes) c();
  cortes = [];
  despertarLector();
}
/** Suma una oración a la cola (y la va generando si la actual todavía suena). */
function empujar(s: string) {
  frases.push(s);
  if (motorActual?.preparar && sonando >= 0 && frases.length - 1 === sonando + 1) motorActual.preparar(s);
  despertarLector();
}

async function leerDesde(desde: number, gen: number, id: string) {
  const m = await motor();
  if (gen !== generacion) return;
  if (!m) { fijar({ estado: 'callado', id: null }); return; }
  motorActual = m;
  let fallas = 0;
  for (let i = desde; ; i++) {
    if (gen !== generacion) return;
    // En un flujo abierto, la oración que sigue puede estar por llegar.
    while (i >= frases.length && flujoAbierto && gen === generacion) await new Promise<void>(ok => { despertar = ok; });
    if (gen !== generacion) return;
    if (i >= frases.length) break;
    indice = i; sonando = i;
    const cortada = new Promise<void>(ok => { cortes.push(ok); });
    // La siguiente oración se va generando mientras suena esta.
    if (m.preparar && frases[i + 1]) m.preparar(frases[i + 1]);
    const dicha = m.decir(frases[i]).then(() => true, () => false);
    const ok = await Promise.race([dicha, cortada.then(() => true)]);
    if (gen !== generacion) return;
    sonando = -1;
    // Si el motor no puede hablar (sin voces instaladas), no se insiste.
    if (!ok && ++fallas >= 2) break;
  }
  sonando = -1;
  if (gen === generacion && actual.id === id) fijar({ estado: 'callado', id: null });
}

/** Lo que usa quien recibe la respuesta en vivo (ver `lector.abrirFlujo`). */
export interface FlujoLector {
  /** Suma texto nuevo de la respuesta (markdown tal como llega). */
  agregar(delta: string): void;
  /** Dice una frase suelta ya (por ejemplo «Un momento.» mientras piensa). Solo si todavía no habló. */
  decir(frase: string): void;
  /** El texto de la respuesta ya está completo (aunque falte la revisión): se dice hasta lo último. */
  completo(): void;
  /** El texto se borró y empieza otro (otro modelo, o una corrección: avisa «Perdón, corrijo»). */
  reiniciar(correccion?: boolean): void;
  /** Terminó: dice lo que faltaba. Si nunca llegó texto en vivo, dice `textoFinal` completo. */
  cerrar(textoFinal?: string): void;
  /** No se dice más (falló o la cortaron) y se calla lo que sonaba. */
  cancelar(): void;
  /** ¿Ya salió algo a hablar? */
  empezo(): boolean;
}

export const lector = {
  obtener: (): EstadoLector => actual,
  suscribir(f: () => void): () => void { oyentes.add(f); return () => { oyentes.delete(f); }; },

  /** Lee un texto (corta lo que se estuviera leyendo). */
  async hablar(texto: string, id: string): Promise<void> {
    const limpio = paraHablar(texto);
    lector.callar();
    if (!limpio) return;
    frases = enOraciones(limpio);
    indice = 0;
    const gen = generacion;
    fijar({ estado: 'hablando', id });
    await leerDesde(0, gen, id);
  },

  /**
   * Empieza a hablar MIENTRAS la respuesta todavía llega: cada oración se dice
   * apenas se completa. Corta lo que se estuviera leyendo.
   */
  abrirFlujo(id: string): FlujoLector {
    lector.callar();
    const mio = ++contadorFlujos;
    flujoVigente = mio; flujoAbierto = true;
    frases = []; indice = 0;
    const f = crearFlujoHabla();
    let empezado = false, recibido = 0;
    let quieto: ReturnType<typeof setTimeout> | 0 = 0;
    const vigente = () => flujoVigente === mio;
    const sinQuieto = () => { if (quieto) { clearTimeout(quieto); quieto = 0; } };
    const poner = (oraciones: string[]) => {
      if (!vigente() || !oraciones.length) return;
      for (const o of oraciones) empujar(o);
      if (!empezado) {
        empezado = true;
        fijar({ estado: 'hablando', id });
        void leerDesde(0, generacion, id);
      }
    };
    return {
      agregar(delta) {
        if (!vigente() || !delta) return;
        recibido += delta.length;
        poner(f.agregar(delta));
        // Si el texto se queda quieto (la revisión, o una pausa del modelo), la última
        // oración, que esperaba un espacio después del punto, no se queda sin decir.
        sinQuieto();
        quieto = setTimeout(() => { quieto = 0; if (vigente()) poner(f.vaciar(false)); }, ESPERA_QUIETO_MS);
      },
      completo() { sinQuieto(); if (vigente()) poner(f.vaciar(true)); },
      decir(frase) { if (vigente() && !empezado) poner([frase]); },
      reiniciar(correccion = false) {
        if (!vigente()) return;
        sinQuieto();
        // Lo que no se dijo todavía se descarta; lo que ya suena, termina.
        frases.length = Math.min(frases.length, indice + 1);
        f.reiniciar(); recibido = 0;
        if (correccion && empezado) poner(['Perdón, corrijo.']);
      },
      cerrar(textoFinal) {
        sinQuieto();
        if (!vigente()) return;
        if (!recibido && textoFinal) { recibido += textoFinal.length; poner(f.agregar(textoFinal)); }
        poner(f.cerrar());
        flujoAbierto = false;
        despertarLector();
        if (!empezado) flujoVigente = 0;
      },
      cancelar() { sinQuieto(); if (vigente()) lector.callar(); },
      empezo: () => empezado,
    };
  },

  /** Pausa en la oración en curso. */
  pausar(): void {
    if (actual.estado !== 'hablando') return;
    const id = actual.id;
    cortar();
    void motor().then(m => m?.callar());
    fijar({ estado: 'pausado', id });
  },

  /** Sigue desde la oración donde se pausó. */
  seguir(): void {
    if (actual.estado !== 'pausado' || !actual.id) return;
    const id = actual.id, gen = generacion;
    fijar({ estado: 'hablando', id });
    void leerDesde(indice, gen, id);
  },

  /** Silencio total (también cierra un flujo abierto). */
  callar(): void {
    flujoVigente = 0; flujoAbierto = false;
    if (actual.estado === 'callado' && !frases.length) { despertarLector(); return; }
    cortar();
    void motor().then(m => m?.callar());
    frases = []; indice = 0; sonando = -1;
    fijar({ estado: 'callado', id: null });
  },
};
