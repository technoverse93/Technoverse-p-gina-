// =====================================================================
// JAVIER ESTUDIA SU PROPIO CÓDIGO
// =====================================================================
// Pedido del dueño (2026-10-12): «Javier tiene todo el conocimiento del
// repositorio. Ponlo a estudiar ya, aunque dure lo que dure». Cada vuelta
// toma unos pocos archivos que todavía no estudió (o que cambiaron desde la
// última vez), los lee del repositorio y una IA saca lo que un experto del
// sistema tiene que saber: qué hace, cómo funciona, sus reglas y por qué está
// así. Eso queda en el cerebro (rama «Sistema Technoverse»), con el enlace al
// archivo, y desde ahí Javier contesta sin buscar en internet.
//
// Corre solo en la tarea programada (cada 15 min, «vigilar») y cuando el
// dueño toca «Estudiar ahora». Un archivo que cambia se vuelve a estudiar y
// lo nuevo reemplaza a lo viejo.
// =====================================================================

import { MAPA_CODIGO } from './mapa-codigo.ts';
import { ClienteRepo, configLectura, rutaPermitida } from './repo.ts';
import type { Cerebro } from './cerebro.ts';

/** Pide a una IA un JSON con la forma pedida (lo pone nucleo.ts). */
export type PedirEstudio = (prompt: string, datos: string) => Promise<{ tema?: unknown; hechos?: unknown } | null>;

const PROMPT = `Sos el cerebro de Javier, el asistente de Technoverse Costa Rica, y estás ESTUDIANDO EL CÓDIGO DE TU PROPIO SISTEMA (el panel, la tienda en línea, la APK de Android, Javier y el servidor). Del archivo que te paso, sacá lo que un experto de este sistema tiene que saber para explicarlo y diagnosticar fallas: qué hace, cómo funciona por dentro, sus reglas importantes, por qué está hecho así (fallos que se corrigieron), con qué otras partes se conecta y los nombres de funciones, pantallas o tablas clave.
Reglas: en español, frases claras y concretas (1 o 2 por hecho), cada hecho entendible solo, sin inventar nada que no esté en el archivo, sin claves, tokens ni datos de clientes.
Devolvé SOLO JSON: {"tema":"nombre corto del área, 2 a 5 palabras (p. ej. «Cobros y facturación»)","hechos":["…","…"]} con 3 a 8 hechos.`;

/** Una huella corta del contenido (para saber si el archivo cambió). */
function huella(texto: string): string {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i++) { h ^= texto.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `${(h >>> 0).toString(36)}:${texto.length}`;
}

/** Los archivos que estudia (las reglas de repo.ts dejan afuera workflows, claves y configuración). */
export function archivosDeEstudio(): string[] {
  return MAPA_CODIGO.map(e => e.ruta).filter(r => /\.(tsx?|java|sql|mjs|js|sh|yml)$/.test(r) && rutaPermitida(r).ok);
}

export interface ResultadoEstudio { estudiados: string[]; fallidos: string[]; total: number; hechos: number; pendientes: number }

/**
 * Estudia hasta `max` archivos (o hasta `hastaMs`). Primero los que nunca estudió; después,
 * de a poco, revisa si los ya estudiados cambiaron.
 */
export async function estudiarRepo(cerebro: Cerebro, pedir: PedirEstudio, op: { max?: number; hastaMs?: number } = {}): Promise<ResultadoEstudio> {
  const max = op.max ?? 6;
  const hasta = op.hastaMs ?? Date.now() + 100_000;
  const cfg = configLectura();
  const repo = new ClienteRepo(cfg);
  const archivos = archivosDeEstudio();
  const progreso = await cerebro.progresoEstudio(archivos);
  // En orden al azar: si un archivo falla siempre (la IA no saca nada), no tranca a los demás.
  const nuevos = archivos.filter(r => !progreso[r]).sort(() => Math.random() - 0.5);
  // Ya estudiados: se revisan rotando (los más viejos primero no se sabe; se toma una muestra al azar).
  const repaso = archivos.filter(r => progreso[r]).sort(() => Math.random() - 0.5).slice(0, 2);
  const cola = [...nuevos, ...repaso];
  const r: ResultadoEstudio = { estudiados: [], fallidos: [], total: archivos.length, hechos: 0, pendientes: nuevos.length };
  for (const ruta of cola) {
    if (r.estudiados.length + r.fallidos.length >= max || Date.now() > hasta - 15_000) break;
    const leido = await repo.leer(ruta);
    if (!leido.ok) { r.fallidos.push(ruta); continue; }
    const h = huella(leido.contenido);
    if (progreso[ruta] === h) continue; // no cambió: nada que estudiar
    const entrada = MAPA_CODIGO.find(e => e.ruta === ruta);
    const datos = `ARCHIVO: ${ruta}\n${entrada?.titulo ? `QUÉ DICE SU CABECERA: ${entrada.titulo}. ${entrada.resumen}\n` : ''}\nCÓDIGO:\n${leido.contenido.slice(0, 24_000)}${leido.contenido.length > 24_000 ? '\n… (el archivo sigue; estudiá lo que hay)' : ''}`;
    const j = await pedir(PROMPT, datos).catch(() => null);
    const hechos = Array.isArray(j?.hechos) ? (j!.hechos as unknown[]).map(x => String(x ?? '').trim()).filter(x => x.length >= 15) : [];
    if (!hechos.length) { r.fallidos.push(ruta); continue; }
    const url = `https://github.com/${cfg.repo}/blob/${cfg.base}/${ruta}`;
    // Cada hecho dice de qué archivo es (así la respuesta puede citarlo).
    // La huella queda con lo aprendido: si la vuelta se corta, lo ya estudiado no se pierde.
    const n = await cerebro.aprenderDelCodigo(ruta, String(j?.tema || entrada?.titulo || ruta), hechos.map(x => (x.includes(ruta) ? x : `${x} (${ruta})`)), url, h);
    if (!n) { r.fallidos.push(ruta); continue; }
    progreso[ruta] = h;
    r.estudiados.push(ruta);
    r.hechos += n;
  }
  r.pendientes = archivos.filter(x => !progreso[x]).length;
  // Los datos nuevos se vectorizan para poder recordarlos por significado.
  await cerebro.vectorizar(100).catch(() => 0);
  return r;
}
