// =====================================================================
// DICTADO DEL TELÉFONO CON TEXTO EN VIVO — puente con el complemento nativo
// =====================================================================
// El reconocedor de voz de Android (native-android/oye/DictadoNativoPlugin):
// mientras hablás, el texto va apareciendo. Es opcional (Ajustes → Voz →
// «Dictado del teléfono»); apagado, el micrófono de Phill graba el audio y el
// servidor lo pasa a texto al terminar. No se usa en manos libres.
//
// Todo responde en vez de lanzar: si falla, quien lo llama sigue con la
// grabadora de siempre.
// =====================================================================

import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

interface Resp { ok: boolean; error?: string; codigo?: string }
interface PluginDictado {
  disponible(): Promise<Resp & { disponible?: boolean; enDispositivo?: boolean }>;
  empezar(o: { idioma?: string; soloLocal?: boolean }): Promise<Resp>;
  detener(): Promise<Resp>;
  cancelar(): Promise<Resp>;
  addListener(evento: string, fn: (d: any) => void): Promise<PluginListenerHandle>;
}

const P = registerPlugin<PluginDictado>('DictadoNativo');
const CLAVE = 'tv_dictado_nativo';

const leer = (): string | null => { try { return localStorage.getItem(CLAVE); } catch { return null; } };

/** Lo que pasa mientras se dicta. Cada uno es opcional. */
export interface OyenteDictado {
  alParcial?: (texto: string) => void;
  /** El texto entero al terminar (puede venir vacío). */
  alFinal?: (texto: string) => void;
  alNivel?: (n: number) => void;
  /** Algo falló: `codigo` es sin_voz, red, servicio, idioma, ocupado, audio, sin_permiso, cliente u otro. */
  alError?: (codigo: string, mensaje: string) => void;
  /** Se cortó sin resultado (la app pasó a segundo plano). */
  alFin?: () => void;
}

let sueltas: Array<() => void> = [];
function soltarTodo(): void {
  const l = sueltas; sueltas = [];
  for (const f of l) { try { f(); } catch { /* ya estaba suelto */ } }
}

async function suscribir(evento: string, fn: (d: any) => void): Promise<void> {
  const h = await P.addListener(evento, fn);
  sueltas.push(() => { void h.remove(); });
}

export const dictadoNativo = {
  /** ¿Esta APK trae el dictado del teléfono? */
  disponible(): boolean {
    return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('DictadoNativo');
  },
  /** ¿La persona lo prendió? (y la APK lo trae) */
  preferido(): boolean {
    return dictadoNativo.disponible() && leer() === '1';
  },
  fijarPreferido(si: boolean): void {
    try { localStorage.setItem(CLAVE, si ? '1' : '0'); } catch { /* sin almacenamiento */ }
  },
  /** ¿El teléfono tiene reconocedor de voz? */
  async hayReconocedor(): Promise<boolean> {
    if (!dictadoNativo.disponible()) return false;
    try { return !!(await P.disponible()).disponible; } catch { return false; }
  },
  /** Empieza a escuchar. Si no se pudo, devuelve { ok: false, error } y no queda nada suscripto. */
  async empezar(oyente: OyenteDictado, opciones: { idioma?: string; soloLocal?: boolean } = {}): Promise<Resp> {
    if (!dictadoNativo.disponible()) return { ok: false, error: 'Este teléfono no tiene el dictado nativo.', codigo: 'sin_servicio' };
    soltarTodo();
    // Una sesión termina una sola vez: lo que llegue después (un aviso repetido, un parcial tardío) se ignora.
    let cerrada = false;
    const cerrar = () => { cerrada = true; soltarTodo(); };
    try {
      await suscribir('parcial', d => { if (!cerrada) oyente.alParcial?.(String(d?.texto ?? '')); });
      await suscribir('final', d => { if (cerrada) return; cerrar(); oyente.alFinal?.(String(d?.texto ?? '')); });
      await suscribir('error', d => { if (cerrada) return; cerrar(); oyente.alError?.(String(d?.codigo ?? 'otro'), String(d?.error ?? 'No se pudo dictar.')); });
      await suscribir('fin', () => { if (cerrada) return; cerrar(); oyente.alFin?.(); });
      if (oyente.alNivel) await suscribir('nivel', d => { if (!cerrada) oyente.alNivel?.(Math.max(0, Math.min(1, Number(d?.n) || 0))); });
      const r = await P.empezar({ idioma: opciones.idioma || 'es-CR', soloLocal: !!opciones.soloLocal });
      if (!r.ok) { soltarTodo(); return { ok: false, error: r.error || 'No se pudo empezar a dictar.', codigo: r.codigo || 'otro' }; }
      return { ok: true };
    } catch {
      soltarTodo();
      return { ok: false, error: 'No se pudo empezar a dictar.', codigo: 'otro' };
    }
  },
  /** Termina de escuchar y entrega lo entendido (por alFinal). */
  async detener(): Promise<void> { try { await P.detener(); } catch { /* ya terminó */ } },
  /** Corta sin entregar nada. */
  async cancelar(): Promise<void> {
    soltarTodo();
    try { await P.cancelar(); } catch { /* ya terminó */ }
  },
};
