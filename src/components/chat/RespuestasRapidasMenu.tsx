// =====================================================================
// CHAT · RESPUESTAS RÁPIDAS (escribir «/» + atajo, o «Respuesta rápida» en el menú del clip)
// =====================================================================
// Los textos que el equipo guardó en CRM → Respuestas, a un toque desde el cuadro de respuesta del chat. Elegir una NO la envía: la pone
// en el cuadro con el nombre de la persona ya puesto, para revisarla y mandarla. Se cargan solo cuando se piden y se guardan unos
// minutos (el chat no pregunta nada a la base hasta que alguien las usa). Si todavía no está aplicada la migración del CRM se ofrecen
// las sugeridas de siempre (RESPUESTAS_BASE) en vez de un menú vacío.
// =====================================================================

import { useEffect, useReducer, useRef } from 'react';
import { Zap } from 'lucide-react';
import { listarRespuestas } from '../../utils/crm';
import { RESPUESTAS_BASE, plantillaConNombre } from '../../utils/crmLogica';

export interface OpcionRespuesta { id: string; atajo: string; titulo: string; texto: string }
type Origen = 'cargando' | 'crm' | 'sugeridas';

const VIGENCIA_CRM_MS = 5 * 60_000;
/** Las sugeridas son un plan B (sin migración o sin red): se vuelve a preguntar pronto. */
const VIGENCIA_SUGERIDAS_MS = 30_000;

let cache: { lista: OpcionRespuesta[]; origen: 'crm' | 'sugeridas'; t: number } | null = null;
let enVuelo: Promise<void> | null = null;

const sugeridas = (): OpcionRespuesta[] => RESPUESTAS_BASE.map((r, i) => ({ id: `base-${i}`, ...r }));
const vigente = () => !!cache && Date.now() - cache.t < (cache.origen === 'crm' ? VIGENCIA_CRM_MS : VIGENCIA_SUGERIDAS_MS);

function cargar(): Promise<void> {
  enVuelo ??= (async () => {
    try {
      const filas = await listarRespuestas();
      cache = { origen: 'crm', t: Date.now(), lista: filas.filter(r => r.activa && r.texto.trim()).map(r => ({ id: r.id, atajo: r.atajo, titulo: r.titulo, texto: r.texto })) };
    } catch {
      cache = { origen: 'sugeridas', t: Date.now(), lista: sugeridas() };
    }
  })().finally(() => { enVuelo = null; });
  return enVuelo;
}

/** Las respuestas guardadas; pide a la base solo mientras `activo` (el menú está abierto) y no hay una copia reciente. */
export function useRespuestasRapidas(activo: boolean): { lista: OpcionRespuesta[]; origen: Origen } {
  const [, repintar] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!activo || vigente()) return;
    let vivo = true;
    void cargar().then(() => { if (vivo) repintar(); });
    return () => { vivo = false; };
  }, [activo]);
  return cache ? { lista: cache.lista, origen: cache.origen } : { lista: [], origen: 'cargando' };
}

interface Props {
  opciones: OpcionRespuesta[];
  origen: Origen;
  /** Lo escrito tras «/» (null si se abrió desde el menú del clip). */
  consulta: string | null;
  activa: number;
  nombreCliente: string;
  onElegir: (o: OpcionRespuesta) => void;
  onResaltar: (i: number) => void;
  onClose: () => void;
}

export default function RespuestasRapidasMenu({ opciones, origen, consulta, activa, nombreCliente, onElegir, onResaltar, onClose }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const listaRef = useRef<HTMLUListElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    const alTocarFuera = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose(); };
    const alEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', alTocarFuera);
    document.addEventListener('keydown', alEscape);
    return () => { document.removeEventListener('mousedown', alTocarFuera); document.removeEventListener('keydown', alEscape); };
  }, [onClose]);

  // Con las flechas la opción resaltada se mantiene a la vista DENTRO de la lista (sin mover la pantalla de atrás).
  useEffect(() => {
    const el = itemRefs.current[activa]; const ul = listaRef.current;
    if (!el || !ul) return;
    const arriba = el.offsetTop, abajo = arriba + el.offsetHeight;
    if (arriba < ul.scrollTop) ul.scrollTop = arriba - 4;
    else if (abajo > ul.scrollTop + ul.clientHeight) ul.scrollTop = abajo - ul.clientHeight + 4;
  }, [activa]);

  return (
    // El toque en una opción no le quita el foco al cuadro de texto: en el teléfono el teclado se queda.
    <div ref={rootRef} className="tv-rr tv-chat-pop" id="menu-respuestas-rapidas" onMouseDown={e => e.preventDefault()}>
      <div className="tv-rr-cab">
        <Zap className="w-3.5 h-3.5" aria-hidden="true" />
        <span className="tv-1l">Respuestas rápidas</span>
        <span className="tv-rr-pista tv-1l">{consulta !== null ? 'Enter elige · Esc cierra' : 'Tocá una para usarla'}</span>
      </div>
      {opciones.length === 0 ? (
        <p className="tv-rr-nada">
          {origen === 'cargando' ? 'Cargando…' : 'Todavía no hay respuestas guardadas. Creá las tuyas en CRM → Respuestas.'}
        </p>
      ) : (
        <ul ref={listaRef} className="tv-rr-lista" role="listbox" aria-label="Respuestas rápidas">
          {opciones.map((o, i) => (
            <li key={o.id} role="presentation">
              <button
                type="button" role="option" aria-selected={i === activa} data-activa={i === activa ? '' : undefined}
                ref={el => { itemRefs.current[i] = el; }}
                className="tv-rr-op" onMouseEnter={() => onResaltar(i)} onClick={() => onElegir(o)}
              >
                <span className="tv-rr-fila">
                  <span className="tv-rr-t tv-1l">{o.titulo || o.atajo}</span>
                  <code className="tv-rr-atajo">/{o.atajo}</code>
                </span>
                <span className="tv-rr-x tv-1l">{plantillaConNombre(o.texto, nombreCliente)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {origen === 'sugeridas' && opciones.length > 0 && <p className="tv-rr-pie tv-1l">Sugeridas. Las tuyas se guardan en CRM → Respuestas.</p>}
    </div>
  );
}
