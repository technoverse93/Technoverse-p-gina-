// =====================================================================
// CONTROLES DE VOZ DEL ASISTENTE (ver src/utils/lectorVoz.ts)
// =====================================================================
//   · BotonEscuchar: en cada respuesta, «Escuchar» / «Pausar» / «Seguir».
//   · BarraLectura: mientras habla, una barra sobre la caja de escribir con
//     Pausar/Seguir y Callar (siempre a mano, aunque la respuesta quede
//     arriba fuera de vista).
//   · AjusteVoz: cuándo lee solo (Nunca / Cuando hablo / Siempre).
// =====================================================================

import { useState, useSyncExternalStore } from 'react';
import { Volume2, Pause, Play, Square, VolumeX } from 'lucide-react';
import { lector, modoLectura, fijarModoLectura, puedeHablar, type ModoLectura } from '../../utils/lectorVoz';

export function useLector() {
  return useSyncExternalStore(lector.suscribir, lector.obtener, lector.obtener);
}

export function BotonEscuchar({ id, texto }: { id: string; texto: string }) {
  const { estado, id: actual } = useLector();
  if (!puedeHablar() || !texto.trim()) return null;
  const mio = actual === id;
  if (mio && estado === 'hablando') {
    return <button type="button" aria-label="Pausar la lectura" title="Pausar" data-on onClick={() => lector.pausar()}><Pause className="w-4 h-4" /></button>;
  }
  if (mio && estado === 'pausado') {
    return <button type="button" aria-label="Seguir leyendo" title="Seguir" data-on onClick={() => lector.seguir()}><Play className="w-4 h-4" /></button>;
  }
  return <button type="button" aria-label="Escuchar la respuesta" title="Escuchar" onClick={() => void lector.hablar(texto, id)}><Volume2 className="w-4 h-4" /></button>;
}

export function BarraLectura() {
  const { estado } = useLector();
  if (estado === 'callado') return null;
  return (
    <div className="ai-lector" role="status">
      <span className="ai-lector-ondas" data-pausa={estado === 'pausado' || undefined} aria-hidden><i /><i /><i /></span>
      <span className="ai-lector-tx">{estado === 'pausado' ? 'En pausa' : 'Leyendo…'}</span>
      {estado === 'hablando'
        ? <button type="button" className="ai-chip" onClick={() => lector.pausar()} aria-label="Pausar"><Pause className="w-4 h-4" /><span className="ai-lector-lbl">Pausar</span></button>
        : <button type="button" className="ai-chip" onClick={() => lector.seguir()} aria-label="Seguir"><Play className="w-4 h-4" /><span className="ai-lector-lbl">Seguir</span></button>}
      <button type="button" className="ai-chip" onClick={() => lector.callar()} aria-label="Callar"><Square className="w-3.5 h-3.5" /><span className="ai-lector-lbl">Callar</span></button>
    </div>
  );
}

const OPCIONES: { id: ModoLectura; nombre: string; ayuda: string }[] = [
  { id: 'nunca', nombre: 'Nunca', ayuda: 'Solo cuando tocás «Escuchar» en una respuesta.' },
  { id: 'voz', nombre: 'Cuando hablo', ayuda: 'Si le preguntás por voz, te contesta hablando.' },
  { id: 'siempre', nombre: 'Siempre', ayuda: 'Lee en voz alta todas las respuestas.' },
];

export function AjusteVoz() {
  const [modo, setModo] = useState<ModoLectura>(() => modoLectura());
  const cambiar = (m: ModoLectura) => { fijarModoLectura(m); setModo(m); if (m === 'nunca') lector.callar(); };
  const disponible = puedeHablar();
  return (
    <div className="ai-aj">
      <h4>Respuestas habladas <small>gratis</small></h4>
      <div className="ai-modu">
        <span className="ai-modu-ic">{disponible ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}</span>
        <span className="ai-modu-t"><b>Leer en voz alta</b><span>{disponible ? OPCIONES.find(o => o.id === modo)?.ayuda : 'Este navegador no tiene voz; en la app del teléfono sí.'}</span></span>
      </div>
      <div className="ai-seg ai-seg-voz" role="radiogroup" aria-label="Cuándo leer en voz alta">
        {OPCIONES.map(o => (
          <button key={o.id} type="button" role="radio" aria-checked={modo === o.id} data-on={modo === o.id || undefined} disabled={!disponible} onClick={() => cambiar(o.id)}>{o.nombre}</button>
        ))}
      </div>
      {disponible && <button type="button" className="ai-chip ai-voz-prueba" onClick={() => void lector.hablar('Pura vida. Así suena Jarvis cuando te responde hablando.', 'prueba')}><Volume2 className="w-4 h-4" />Probar la voz</button>}
    </div>
  );
}
