// =====================================================================
// CRM · RESPUESTAS RÁPIDAS
// =====================================================================
// Textos preparados para las preguntas de siempre. En el chat se eligen con el rayo (⚡) o escribiendo «/» y el atajo;
// `{nombre}` se cambia por el primer nombre del cliente. Aquí se crean, se editan y se borran.
// =====================================================================

import { useState } from 'react';
import { Pencil, Plus, Trash2, Zap } from 'lucide-react';
import { Btn, Card, Chip, Empty, Field } from '../AdminKit';
import { Modal, useConfirm, useToast } from '../../ui/Overlays';
import { RESPUESTAS_BASE, plantillaConNombre, type RespuestaRapida } from '../../../utils/crm';
import type { Crm } from './useCrm';

interface Borrador { id?: string; atajo: string; titulo: string; texto: string }
const VACIO: Borrador = { atajo: '', titulo: '', texto: '' };

export default function CrmRespuestas({ crm }: { crm: Crm }) {
  const toast = useToast();
  const confirmar = useConfirm();
  const [edicion, setEdicion] = useState<Borrador | null>(null);
  const [guardando, setGuardando] = useState(false);

  const guardar = async () => {
    if (!edicion) return;
    const atajo = edicion.atajo.trim().toLowerCase().replace(/^\//, '');
    if (!/^[a-z0-9_-]{2,24}$/.test(atajo)) { toast.warning('El atajo va en minúsculas, sin espacios (2 a 24 letras, números o guion).'); return; }
    if (!edicion.titulo.trim() || !edicion.texto.trim()) { toast.warning('Falta el título o el texto.'); return; }
    setGuardando(true);
    const ok = await crm.guardarRespuesta({ atajo, titulo: edicion.titulo, texto: edicion.texto, orden: crm.respuestas.find(r => r.id === edicion.id)?.orden ?? crm.respuestas.length + 1 }, edicion.id);
    setGuardando(false);
    if (ok) setEdicion(null);
  };

  const borrar = async (r: RespuestaRapida) => {
    if (await confirmar({ title: 'Borrar respuesta', message: `Se borra «${r.titulo}» (/${r.atajo}).`, confirmText: 'Borrar', variant: 'danger' })) void crm.quitarRespuesta(r.id);
  };

  const cargarSugeridas = async () => {
    let n = 0;
    for (const [i, r] of RESPUESTAS_BASE.entries()) if (await crm.guardarRespuesta({ ...r, orden: i + 1 })) n++;
    if (n) toast.success(`${n} respuestas cargadas.`);
  };

  return (
    <div className="tv-stack">
      <Card title="Respuestas rápidas" actions={<Btn variant="primary" icon={Plus} onClick={() => setEdicion(VACIO)}>Nueva respuesta</Btn>}>
        <p className="crm-nada">
          En el chat escribí <code>/</code> y el atajo (por ejemplo <code>/garantia</code>), o tocá el clip y elegí «Respuesta rápida», para poner el texto
          en el cuadro y revisarlo antes de enviar. <code>{'{nombre}'}</code> se cambia por el primer nombre del cliente.
        </p>
        {crm.respuestas.length === 0 ? (
          <Empty icon={Zap} title="Todavía no hay respuestas" text="Cargá las sugeridas (saludo, cotización, pagos, garantía, seguimiento y agradecimiento) y editalas a tu gusto."
            action={<Btn variant="primary" onClick={cargarSugeridas}>Cargar las sugeridas</Btn>} />
        ) : (
          <ul className="crm-respuestas">
            {crm.respuestas.map(r => (
              <li key={r.id} className="crm-resp">
                <div className="crm-resp-cab">
                  <Chip tone="accent">/{r.atajo}</Chip>
                  <span className="crm-resp-t tv-1l">{r.titulo}</span>
                  <button type="button" className="crm-mini" onClick={() => setEdicion({ id: r.id, atajo: r.atajo, titulo: r.titulo, texto: r.texto })} aria-label={`Editar ${r.titulo}`}><Pencil className="w-3.5 h-3.5" aria-hidden="true" /></button>
                  <button type="button" className="crm-mini" onClick={() => void borrar(r)} aria-label={`Borrar ${r.titulo}`}><Trash2 className="w-3.5 h-3.5" aria-hidden="true" /></button>
                </div>
                <p className="crm-resp-x">{r.texto}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal open={!!edicion} onClose={() => setEdicion(null)} size="md" title={edicion?.id ? 'Editar respuesta' : 'Nueva respuesta'}
        footer={<><Btn variant="ghost" onClick={() => setEdicion(null)}>Cancelar</Btn><Btn variant="primary" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</Btn></>}>
        {edicion && (
          <div className="tv-stack">
            <Field label="Atajo" hint="Lo que se escribe después de «/». Minúsculas, sin espacios.">
              <input className="tv-input" value={edicion.atajo} maxLength={25} onChange={e => setEdicion({ ...edicion, atajo: e.target.value })} placeholder="garantia" />
            </Field>
            <Field label="Título"><input className="tv-input" value={edicion.titulo} maxLength={80} onChange={e => setEdicion({ ...edicion, titulo: e.target.value })} placeholder="Garantía" /></Field>
            <Field label="Texto" hint="Usá {nombre} donde va el nombre del cliente.">
              <textarea className="tv-input" rows={5} maxLength={1500} value={edicion.texto} onChange={e => setEdicion({ ...edicion, texto: e.target.value })} />
            </Field>
            {edicion.texto.trim() && (
              <div className="crm-prueba" aria-live="polite"><span className="tv-label tv-1l">Así le llega a «Ana Mora»</span><p>{plantillaConNombre(edicion.texto, 'Ana Mora')}</p></div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
