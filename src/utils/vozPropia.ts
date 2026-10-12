// =====================================================================
// VOZ PROPIA DE JARVIS — siempre la misma, sin Google
// =====================================================================
// Una voz neuronal abierta (Piper, «es_MX-ald», masculina, latina) que
// corre EN EL APARATO: la misma en el teléfono y en la computadora, sin
// depender de las voces que traiga cada sistema. Se baja una sola vez
// (~60 MB) desde Ajustes → Voz y queda guardada; mientras no esté bajada,
// Javier habla con la voz del teléfono como antes.
// =====================================================================

import { aVisual, nivelVoz, rms8 } from './nivelVoz';

export const VOCES_PROPIAS = [
  { id: 'es_MX-ald-medium', nombre: 'Javier', detalle: 'Masculina, latina · ~60 MB' },
  { id: 'es_MX-claude-high', nombre: 'Javier HD', detalle: 'Masculina, más natural · ~110 MB' },
] as const;

const CLAVE_MOTOR = 'tv_voz_motor';      // 'propia' | 'telefono'
const CLAVE_VOZ = 'tv_voz_propia';       // id de la voz elegida
const CLAVE_LISTA = 'tv_voz_propia_lista'; // ids ya bajadas, separadas por coma

const leer = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const escribir = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };

export function vozElegida(): string { return leer(CLAVE_VOZ) || VOCES_PROPIAS[0].id; }
export function elegirVoz(id: string): void { escribir(CLAVE_VOZ, id); }
export function vozBajada(id = vozElegida()): boolean { return (leer(CLAVE_LISTA) || '').split(',').includes(id); }
/** ¿Se habla con la voz propia? (elegida y ya bajada) */
export function usarVozPropia(): boolean { return leer(CLAVE_MOTOR) !== 'telefono' && vozBajada() && soportada(); }
export function fijarMotor(m: 'propia' | 'telefono'): void { escribir(CLAVE_MOTOR, m); }
export function motorElegido(): 'propia' | 'telefono' { return leer(CLAVE_MOTOR) === 'telefono' ? 'telefono' : 'propia'; }

/** Necesita hilos (Worker), WebAssembly y almacenamiento del aparato (OPFS). */
export function soportada(): boolean {
  return typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined' && typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory;
}

// --------------------------- el hilo ---------------------------
let hilo: Worker | null = null;
let siguiente = 1;
const espera = new Map<number, { ok: (v: any) => void; mal: (e: Error) => void; progreso?: (p: number) => void }>();
function obtenerHilo(): Worker {
  if (hilo) return hilo;
  hilo = new Worker(new URL('./vozJarvis.worker.ts', import.meta.url), { type: 'module' });
  hilo.onmessage = (ev: MessageEvent<any>) => {
    const d = ev.data, p = espera.get(d.id);
    if (!p) return;
    if (typeof d.progreso === 'number') { p.progreso?.(d.progreso); return; }
    espera.delete(d.id);
    if (d.error) p.mal(new Error(d.error)); else p.ok(d);
  };
  hilo.onerror = () => { for (const p of espera.values()) p.mal(new Error('La voz se detuvo.')); espera.clear(); hilo = null; };
  return hilo;
}
function pedir(m: Record<string, unknown>, progreso?: (p: number) => void): Promise<any> {
  const id = siguiente++;
  return new Promise((ok, mal) => { espera.set(id, { ok, mal, progreso }); obtenerHilo().postMessage({ id, ...m }); });
}

/** Baja la voz (una sola vez) con su porcentaje. */
export async function bajarVoz(id = vozElegida(), progreso?: (p: number) => void): Promise<void> {
  await pedir({ tipo: 'bajar', voz: id }, progreso);
  const lista = new Set((leer(CLAVE_LISTA) || '').split(',').filter(Boolean)); lista.add(id);
  escribir(CLAVE_LISTA, [...lista].join(','));
}

// ----------------------- generar y sonar -----------------------
// Se genera la oración siguiente mientras suena la actual: así no hay
// silencios entre oraciones.
const cache = new Map<string, Promise<Blob>>();
export function preparar(texto: string): Promise<Blob> {
  const k = `${vozElegida()}|${texto}`;
  let p = cache.get(k);
  if (!p) {
    p = pedir({ tipo: 'decir', texto, voz: vozElegida() }).then(d => d.wav as Blob);
    p.catch(() => cache.delete(k));
    cache.set(k, p);
    if (cache.size > 12) cache.delete(cache.keys().next().value as string);
  }
  return p;
}

/** El volumen de la voz mientras suena, para que el orbe de «manos libres»
 *  la acompañe. Si el aparato no deja medirla, suena igual (sin orbe vivo). */
let contextoSalida: AudioContext | null = null;
async function medirSalida(a: HTMLAudioElement): Promise<() => void> {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    contextoSalida ||= new Ctx();
    if (contextoSalida.state === 'suspended') await contextoSalida.resume().catch(() => {});
    // Si el contexto no quedó andando, NO se conecta: el audio saldría mudo.
    if (contextoSalida.state !== 'running') return () => {};
    const fuente = contextoSalida.createMediaElementSource(a);
    const analizador = contextoSalida.createAnalyser();
    analizador.fftSize = 512;
    fuente.connect(analizador);
    analizador.connect(contextoSalida.destination);
    const datos = new Uint8Array(analizador.fftSize);
    const reloj = setInterval(() => { analizador.getByteTimeDomainData(datos); nivelVoz.fijar(aVisual(rms8(datos)), 'voz'); }, 50);
    return () => { clearInterval(reloj); nivelVoz.apagar(); try { fuente.disconnect(); analizador.disconnect(); } catch { /* ya suelto */ } };
  } catch { return () => {}; }
}

let sonando: HTMLAudioElement | null = null;
export async function decir(texto: string, alEmpezar?: () => void): Promise<void> {
  await reproducir(await preparar(texto), alEmpezar);
}
/** Hace sonar un audio (WAV) con el orbe acompañándolo. Lo usa también la voz natural (vozNube.ts). */
export async function reproducir(wav: Blob, alEmpezar?: () => void): Promise<void> {
  const url = URL.createObjectURL(wav);
  let soltar = () => {};
  try {
    const a = new Audio(url);
    sonando = a;
    soltar = await medirSalida(a);
    if (sonando !== a) return; // mientras se preparaba, alguien la calló
    await new Promise<void>((ok, mal) => {
      a.onended = () => ok();
      a.onerror = () => mal(new Error('No se pudo reproducir la voz.'));
      a.onpause = () => { if (!a.ended) ok(); };
      alEmpezar?.();
      void a.play().catch(mal);
    });
  } finally { soltar(); URL.revokeObjectURL(url); sonando = null; }
}
export function callar(): void { if (sonando) { sonando.pause(); sonando = null; } }
