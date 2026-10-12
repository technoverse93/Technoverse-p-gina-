// =====================================================================
// CONTROLES DE VOZ DEL ASISTENTE (ver src/utils/lectorVoz.ts)
// =====================================================================
//   · BotonEscuchar: en cada respuesta, «Escuchar» / «Pausar» / «Seguir».
//   · BarraLectura: mientras habla, una barra sobre la caja de escribir con
//     Pausar/Seguir y Callar (siempre a mano, aunque la respuesta quede
//     arriba fuera de vista).
//   · AjusteVoz: cuándo lee solo (Nunca / Cuando hablo / Siempre) y cuánto
//     espera Javier, en manos libres, antes de dar por terminado lo que decís.
// =====================================================================

import { useEffect, useState, useSyncExternalStore } from 'react';
import { Volume2, Pause, Play, Square, VolumeX, Download, Check, Timer, Mic, Captions, Sparkles } from 'lucide-react';
import { lector, modoLectura, fijarModoLectura, puedeHablar, type ModoLectura } from '../../utils/lectorVoz';
import * as propia from '../../utils/vozPropia';
import { fijarVozNatural, usarVozNatural } from '../../utils/vozNube';
import { fijarInterrumpir, fijarPausa, interrumpirActivo, PAUSAS, pausaElegida, type PausaVoz } from '../../utils/manosLibres';
import { dictadoNativo } from '../../mobile/dictadoNativo';

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
      <PausaManos />
      <DictadoTelefono />
      <VozPropia />
      {disponible && <button type="button" className="ai-chip ai-voz-prueba" onClick={() => void lector.hablar('Pura vida. Soy Javier, y así suena mi voz cuando te respondo hablando.', 'prueba')}><Volume2 className="w-4 h-4" />Probar la voz</button>}
    </div>
  );
}

/** Dictado del teléfono: al tocar el micrófono, el texto aparece mientras hablás. Solo en la app; opcional. */
function DictadoTelefono() {
  const disponible = dictadoNativo.disponible();
  const [on, setOn] = useState(() => dictadoNativo.preferido());
  const [hay, setHay] = useState<boolean | null>(null);
  useEffect(() => { if (disponible) void dictadoNativo.hayReconocedor().then(setHay); }, [disponible]);
  if (!disponible) return null;
  return (
    <div className="ai-modu">
      <span className="ai-modu-ic"><Captions className="w-4 h-4" /></span>
      <span className="ai-modu-t">
        <b>Dictado del teléfono</b>
        <span>{hay === false
          ? 'Este teléfono no trae reconocimiento de voz.'
          : 'Al tocar el micrófono ves lo que decís mientras hablás. Usa el reconocimiento de voz de Android (puede usar internet). Si falla, Javier usa su micrófono de siempre. En manos libres no se usa.'}</span>
      </span>
      <button type="button" role="switch" aria-checked={on} className="ai-sw" data-on={on || undefined} disabled={hay === false}
        onClick={() => { dictadoNativo.fijarPreferido(!on); setOn(!on); }} aria-label="Dictado del teléfono con texto en vivo" />
    </div>
  );
}

/** Manos libres: cuánto silencio espera Javier antes de dar por terminado lo que decís. */
function PausaManos() {
  const [pausa, setPausa] = useState<PausaVoz>(() => pausaElegida());
  const [interrumpir, setInterrumpir] = useState(() => interrumpirActivo());
  return (
    <>
      <div className="ai-modu">
        <span className="ai-modu-ic"><Mic className="w-4 h-4" /></span>
        <span className="ai-modu-t"><b>Interrumpirlo hablando</b><span>En manos libres, si le hablás encima, Javier se calla y te escucha. Funciona mejor con auriculares; si el altavoz lo hace interrumpirse solo, apagalo.</span></span>
        <button type="button" role="switch" aria-checked={interrumpir} className="ai-sw" data-on={interrumpir || undefined}
          onClick={() => { fijarInterrumpir(!interrumpir); setInterrumpir(!interrumpir); }} aria-label="Interrumpir a Javier hablándole encima" />
      </div>
      <div className="ai-modu">
        <span className="ai-modu-ic"><Timer className="w-4 h-4" /></span>
        <span className="ai-modu-t"><b>Pausa para contestar</b><span>{PAUSAS.find(p => p.id === pausa)?.ayuda}</span></span>
      </div>
      <div className="ai-seg ai-seg-voz" role="radiogroup" aria-label="Cuánto esperar antes de contestar en manos libres">
        {PAUSAS.map(p => (
          <button key={p.id} type="button" role="radio" aria-checked={pausa === p.id} data-on={pausa === p.id || undefined} onClick={() => { fijarPausa(p.id); setPausa(p.id); }}>{p.nombre}</button>
        ))}
      </div>
    </>
  );
}

/** La voz propia de Javier: elegirla, bajarla una vez y usarla. */
function VozPropia() {
  const [voz, setVoz] = useState(() => propia.vozElegida());
  const [motor, setMotor] = useState(() => propia.motorElegido());
  const [bajando, setBajando] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [, refrescar] = useState(0);
  const [natural, setNatural] = useState(() => usarVozNatural());
  const filaNatural = (
    <div className="ai-modu">
      <span className="ai-modu-ic"><Sparkles className="w-4 h-4" /></span>
      <span className="ai-modu-t"><b>Voz natural</b><span>{natural
        ? 'Javier habla con una voz neuronal de Google, como una persona (usa internet). Si no hay conexión, usa la de abajo.'
        : 'Apagada: Javier usa la voz de abajo, sin internet.'}</span></span>
      <button type="button" role="switch" aria-checked={natural} className="ai-sw" data-on={natural || undefined}
        onClick={() => { fijarVozNatural(!natural); setNatural(!natural); }} aria-label="Voz natural de Javier" />
    </div>
  );
  if (!propia.soportada()) return filaNatural;
  const lista = propia.vozBajada(voz);
  const bajar = async () => {
    setError(''); setBajando(0);
    try { await propia.bajarVoz(voz, p => setBajando(p)); propia.fijarMotor('propia'); setMotor('propia'); }
    catch (e) { setError(`No se pudo bajar la voz (${e instanceof Error ? e.message : e}). Revisá la conexión y probá de nuevo.`); }
    finally { setBajando(null); refrescar(x => x + 1); }
  };
  return (
    <>
      {filaNatural}
      <div className="ai-modu">
        <span className="ai-modu-ic"><Volume2 className="w-4 h-4" /></span>
        <span className="ai-modu-t"><b>{natural ? 'Voz de respaldo' : 'Voz de Javier'}</b><span>{motor === 'propia' && lista ? 'Su voz propia: la misma en todos tus aparatos, sin Google.' : 'La voz del teléfono. Bajá la voz propia de Javier (una sola vez).'}</span></span>
      </div>
      <div className="ai-seg ai-seg-voz ai-seg-dos" role="radiogroup" aria-label="Qué voz usa Javier">
        <button type="button" role="radio" aria-checked={motor === 'propia'} data-on={motor === 'propia' || undefined} onClick={() => { propia.fijarMotor('propia'); setMotor('propia'); }}>Propia</button>
        <button type="button" role="radio" aria-checked={motor === 'telefono'} data-on={motor === 'telefono' || undefined} onClick={() => { propia.fijarMotor('telefono'); setMotor('telefono'); }}>Del teléfono</button>
      </div>
      {motor === 'propia' && (
        <div className="ai-voces">
          {propia.VOCES_PROPIAS.map(v => (
            <button key={v.id} type="button" className="ai-voz-op" data-on={voz === v.id || undefined} onClick={() => { propia.elegirVoz(v.id); setVoz(v.id); }}>
              <b>{v.nombre}</b><span>{v.detalle}</span>{propia.vozBajada(v.id) && <Check className="w-3.5 h-3.5" aria-label="Bajada" />}
            </button>
          ))}
          {!lista && (
            <button type="button" className="ai-chip" disabled={bajando !== null} onClick={() => void bajar()}>
              <Download className="w-4 h-4" />{bajando !== null ? `Bajando… ${bajando}%` : 'Bajar la voz (una vez, mejor con wifi)'}
            </button>
          )}
          {error && <p className="ai-voz-error" role="alert">{error}</p>}
        </div>
      )}
    </>
  );
}
