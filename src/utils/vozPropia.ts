// =====================================================================
// VOZ PROPIA DE JARVIS — siempre la misma, sin Google
// =====================================================================
// Una voz neuronal abierta (Piper, «es_MX-ald», masculina, latina) que
// corre EN EL APARATO: la misma en el teléfono y en la computadora, sin
// depender de las voces que traiga cada sistema. Se baja una sola vez
// (~60 MB) desde Ajustes → Voz y queda guardada; mientras no esté bajada,
// Jarvis habla con la voz del teléfono como antes.
// =====================================================================

export const VOCES_PROPIAS = [
  { id: 'es_MX-ald-medium', nombre: 'Jarvis', detalle: 'Masculina, latina · ~60 MB' },
  { id: 'es_MX-claude-high', nombre: 'Jarvis HD', detalle: 'Masculina, más natural · ~110 MB' },
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

let sonando: HTMLAudioElement | null = null;
export async function decir(texto: string): Promise<void> {
  const wav = await preparar(texto);
  const url = URL.createObjectURL(wav);
  try {
    await new Promise<void>((ok, mal) => {
      const a = new Audio(url);
      sonando = a;
      a.onended = () => ok();
      a.onerror = () => mal(new Error('No se pudo reproducir la voz.'));
      a.onpause = () => { if (!a.ended) ok(); };
      void a.play().catch(mal);
    });
  } finally { URL.revokeObjectURL(url); sonando = null; }
}
export function callar(): void { if (sonando) { sonando.pause(); sonando = null; } }
