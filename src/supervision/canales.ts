// =====================================================================
// CANALES DEL ESPEJO — abrir uno nuevo sin heredar restos del anterior
// =====================================================================
// realtime-js (2.110) guarda los canales en una lista y `supabase.channel(t)`
// DEVUELVE EL EXISTENTE si ya hay uno con ese tema. Normalmente
// `removeChannel` lo saca de la lista en el acto, pero no siempre: si la baja
// termina en error, el canal se queda en la lista (a medio cerrar) y el
// próximo `channel(t)` lo devolvería — oyentes colgados de un canal que ya
// no recibe nada.
//
// Esta función se llama justo antes de volver a pedir un tema: retira todo
// lo que quede con ese nombre y, si algo no se deja retirar, lo arranca a
// mano de las dos listas (la de realtime-js y la del socket de Phoenix que
// reparte los mensajes).
// =====================================================================

import { supabase } from '../supabaseClient';

const esperar = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Saca el canal de las listas internas, sin esperar a nadie. */
function arrancarDeLasListas(c: any): void {
  try { c.teardown?.(); } catch { /* nada */ }
  try { (supabase as any).realtime?._remove?.(c); } catch { /* nada */ }
  try {
    const phoenix = c.channelAdapter?.getChannel?.();
    const socket = (supabase as any).realtime?.socketAdapter?.getSocket?.();
    if (phoenix && socket?.remove) socket.remove(phoenix);
  } catch { /* nada */ }
}

/**
 * Cierra todos los canales de `topic` (con tope de espera) y garantiza que
 * ninguno quede en la lista. Llamarlo SIEMPRE antes de volver a pedir ese
 * tema. Si no hay ninguno, vuelve en el acto.
 */
export async function retirarCanales(topic: string, topeMs = 3000): Promise<void> {
  // Nunca lanza: quien la llama va a abrir el canal igual.
  try {
    const nombre = `realtime:${topic}`;
    const deEseTema = () => ((supabase.getChannels?.() || []) as any[]).filter(c => c?.topic === nombre);
    const viejos = deEseTema();
    if (viejos.length === 0) return;
    await Promise.all(viejos.map(c => Promise.race([
      Promise.resolve().then(() => supabase.removeChannel(c)).catch(() => 'error'),
      esperar(topeMs),
    ])));
    for (const c of deEseTema()) arrancarDeLasListas(c);
  } catch { /* nada */ }
}
