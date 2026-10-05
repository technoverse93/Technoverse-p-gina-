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
// =====================================================================

import { Capacitor } from '@capacitor/core';

export type ModoLectura = 'nunca' | 'voz' | 'siempre';
export type EstadoLector = { estado: 'callado' | 'hablando' | 'pausado'; id: string | null };

const CLAVE_MODO = 'tv_voz_respuestas';
const MAX_CARACTERES = 1800;

export function modoLectura(): ModoLectura {
  try {
    const v = localStorage.getItem(CLAVE_MODO);
    return v === 'nunca' || v === 'siempre' ? v : 'voz';
  } catch { return 'voz'; }
}
export function fijarModoLectura(m: ModoLectura): void {
  try { localStorage.setItem(CLAVE_MODO, m); } catch { /* sin almacenamiento: queda el de siempre */ }
}

/** El texto tal como se dice: sin formato, sin enlaces, con «colones». */
export function paraHablar(md: string): string {
  let t = String(md || '');
  let tabla = false, codigo = false;
  t = t.replace(/```[\s\S]*?```/g, () => { codigo = true; return ' '; });
  t = t.split('\n').filter(l => { if (/^\s*\|.*\|\s*$/.test(l)) { tabla = true; return false; } return true; }).join('\n');
  t = t
    .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, '$1')               // [texto](enlace) → texto
    .replace(/https?:\/\/\S+/g, ' ')                           // enlaces sueltos
    .replace(/\[[A-ZÉ]+·\d+\]/g, ' ')                          // marcas del carril privado
    .replace(/^#{1,6}\s*/gm, '')                               // títulos
    .replace(/^\s*>\s?/gm, '')                                 // citas
    .replace(/^\s*[-*•]\s+/gm, '')                             // viñetas
    .replace(/^\s*(\d+)[.)]\s+/gm, '$1. ')                     // listas numeradas
    .replace(/[*_~`]+/g, '')                                   // negritas, cursivas, código
    .replace(/₡\s?([\d.,\s]*\d)/g, (_m, n: string) => `${n.replace(/\s+/g, ' ').trim()} colones`)
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
  if (t.length > MAX_CARACTERES) {
    const corte = t.lastIndexOf('.', MAX_CARACTERES);
    t = `${t.slice(0, corte > 400 ? corte + 1 : MAX_CARACTERES)} El resto lo tenés en pantalla.`;
  }
  if (tabla) t += ' Te dejé una tabla en pantalla.';
  if (codigo) t += ' Te dejé un bloque de código en pantalla.';
  return t;
}

/** Oraciones de hasta ~220 caracteres (las largas se parten en las comas). */
function enOraciones(t: string): string[] {
  const base = t.split(/(?<=[.!?…:;])\s+|\n+/).map(x => x.trim()).filter(Boolean);
  const out: string[] = [];
  for (const o of base) {
    if (o.length <= 220) { out.push(o); continue; }
    let resto = o;
    while (resto.length > 220) {
      const c = resto.lastIndexOf(',', 220);
      const i = c > 60 ? c + 1 : 220;
      out.push(resto.slice(0, i).trim()); resto = resto.slice(i).trim();
    }
    if (resto) out.push(resto);
  }
  return out;
}

// ------------------------- motores -------------------------
type Motor = { decir: (texto: string) => Promise<void>; callar: () => void };

let motorNativo: Promise<Motor | null> | null = null;
function nativo(): Promise<Motor | null> {
  if (!motorNativo) motorNativo = (async () => {
    if (!Capacitor.isNativePlatform()) return null;
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
  return (await nativo()) || navegador();
}

/** ¿Este aparato puede hablar? (para mostrar o no los controles) */
export function puedeHablar(): boolean {
  return Capacitor.isNativePlatform() || (typeof window !== 'undefined' && 'speechSynthesis' in window);
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

function fijar(e: EstadoLector) {
  actual = e;
  for (const f of oyentes) f();
}
function cortar() {
  generacion++;
  for (const c of cortes) c();
  cortes = [];
}

async function leerDesde(desde: number, gen: number, id: string) {
  const m = await motor();
  if (!m) { fijar({ estado: 'callado', id: null }); return; }
  let fallas = 0;
  for (let i = desde; i < frases.length; i++) {
    if (gen !== generacion) return;
    indice = i;
    const cortada = new Promise<void>(ok => { cortes.push(ok); });
    const dicha = m.decir(frases[i]).then(() => true, () => false);
    const ok = await Promise.race([dicha, cortada.then(() => true)]);
    if (gen !== generacion) return;
    // Si el motor no puede hablar (sin voces instaladas), no se insiste.
    if (!ok && ++fallas >= 2) break;
  }
  if (gen === generacion && actual.id === id) fijar({ estado: 'callado', id: null });
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

  /** Silencio total. */
  callar(): void {
    if (actual.estado === 'callado' && !frases.length) return;
    cortar();
    void motor().then(m => m?.callar());
    frases = []; indice = 0;
    fijar({ estado: 'callado', id: null });
  },
};
