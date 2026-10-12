// =====================================================================
// LA TARJETA DE UN ENCARGO — Javier trabajando por su cuenta
// =====================================================================
// «Investigá los precios y avisame»: Javier lo deja en marcha en el servidor
// (aunque cierres la app) y esta tarjeta muestra cómo va: en cola, en qué paso
// está y, al terminar, que el resultado quedó abajo en el chat. Se puede
// cancelar mientras sigue en curso. El avance llega en vivo (Realtime) y, por
// si se pierde, se vuelve a leer cada 20 s mientras no termine.
// =====================================================================

import { useEffect, useRef, useState } from 'react';
import { Check, ClipboardList, Loader2, TriangleAlert, X } from 'lucide-react';
import { supabase } from '../../supabaseClient';

interface Paso { n: number; objetivo: string; estado: 'pendiente' | 'hecho' | 'fallo' }
interface Fila { estado: 'pendiente' | 'corriendo' | 'lista' | 'error' | 'cancelada'; plan: Paso[]; error: string | null }

export const EVENTO_REFRESCAR_CHAT = 'tv:phill-refrescar';

export default function TarjetaTarea({ id, titulo }: { id: string; titulo: string }) {
  const [f, setF] = useState<Fila | null>(null);
  const [cancelando, setCancelando] = useState(false);
  const anterior = useRef<string | null>(null);

  useEffect(() => {
    let vivo = true;
    const aplicar = (n: Partial<Fila> | null | undefined) => {
      if (!vivo || !n) return;
      const previo = anterior.current;
      setF(prev => ({ ...(prev || { estado: 'pendiente', plan: [], error: null }), ...n }) as Fila);
      if (n.estado) {
        anterior.current = n.estado;
        // Al terminar, el chat se refresca para mostrar el resultado que Javier dejó.
        if (n.estado === 'lista' && previo && previo !== 'lista') window.dispatchEvent(new Event(EVENTO_REFRESCAR_CHAT));
      }
    };
    const leer = async () => {
      const { data } = await supabase.from('jarvis_tareas').select('estado,plan,error').eq('id', id).maybeSingle();
      aplicar(data as Fila | null);
    };
    void leer();
    // Nombre propio por tarjeta: si la misma se vuelve a montar mientras la anterior se cierra, no choca con su canal.
    const canal = supabase.channel(`tarea-${id}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'jarvis_tareas', filter: `id=eq.${id}` }, (p: { new: Partial<Fila> }) => aplicar(p.new))
      .subscribe();
    const reloj = setInterval(() => { if (anterior.current !== 'lista' && anterior.current !== 'error' && anterior.current !== 'cancelada') void leer(); }, 20000);
    return () => { vivo = false; clearInterval(reloj); void supabase.removeChannel(canal); };
  }, [id]);

  const cancelar = async () => {
    setCancelando(true);
    const { error } = await supabase.from('jarvis_tareas').update({ estado: 'cancelada' }).eq('id', id);
    if (!error) setF(prev => ({ ...(prev || { plan: [], error: null }), estado: 'cancelada' }) as Fila);
    setCancelando(false);
  };

  const plan = f?.plan || [];
  const hechos = plan.filter(p => p.estado !== 'pendiente').length;
  const actual = plan.find(p => p.estado === 'pendiente');
  const enCurso = !f || f.estado === 'pendiente' || f.estado === 'corriendo';
  const texto = !f ? 'Encargo en marcha…'
    : f.estado === 'pendiente' ? 'En cola: arranca en un momento.'
      : f.estado === 'corriendo' ? (plan.length ? `Trabajando · paso ${Math.min(hechos + 1, plan.length)} de ${plan.length}` : 'Armando el plan…')
        : f.estado === 'lista' ? 'Terminado. El resultado está abajo, en el chat.'
          : f.estado === 'cancelada' ? 'Cancelado.' : (f.error || 'No pude terminarlo.');

  return (
    <article className="jv-tarea" data-estado={f?.estado || 'pendiente'} aria-label={`Encargo: ${titulo}`}>
      <header>
        <span className="jv-tarea-ic" aria-hidden="true"><ClipboardList className="w-4 h-4" /></span>
        <b>{titulo}</b>
        {enCurso && <button type="button" className="jv-tarea-x" onClick={() => void cancelar()} disabled={cancelando} aria-label="Cancelar el encargo" title="Cancelar"><X className="w-4 h-4" /></button>}
      </header>
      <p className="jv-tarea-msj" role="status">
        {enCurso ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
          : f?.estado === 'lista' ? <Check className="w-3.5 h-3.5" aria-hidden="true" />
            : <TriangleAlert className="w-3.5 h-3.5" aria-hidden="true" />}
        <span>{texto}</span>
      </p>
      {f?.estado === 'corriendo' && actual && <p className="jv-tarea-paso">{actual.objetivo.length > 110 ? `${actual.objetivo.slice(0, 107)}…` : actual.objetivo}</p>}
      {enCurso && plan.length > 0 && <div className="jv-tarea-barra" aria-hidden="true"><i style={{ width: `${Math.round((hechos / plan.length) * 100)}%` }} /></div>}
    </article>
  );
}
