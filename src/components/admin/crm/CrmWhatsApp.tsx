// =====================================================================
// CRM · VENDER POR WHATSAPP (desde la ficha del contacto)
// =====================================================================
// Pedido del dueño (2026-10-28): mucha gente no quiere comprar sola en la tienda en línea sino conversando. Dos
// herramientas para eso, en la ficha del contacto:
//   · «WhatsApp»: elegir una respuesta rápida ({nombre} ya puesto) y abrir WhatsApp con ese texto. Queda anotado en
//     la línea de tiempo como «contacto» («WhatsApp: …»).
//   · «Armar venta»: los productos y cantidades, retiro o envío, y el total. «Enviar resumen» manda por WhatsApp el
//     detalle con los datos del SINPE y pasa el contacto a «Pendiente de pago». «SINPE recibido» abre Cobros con el
//     cliente y el producto ya cargados: recién ahí se descuenta el stock, se emite la factura y sale el correo. Así
//     ninguna factura de una venta por chat sale sin haber visto el pago.
// =====================================================================

import { useMemo, useState } from 'react';
import { MessageCircle, Plus, Send, Trash2, Wallet } from 'lucide-react';
import { Btn, Field } from '../AdminKit';
import { CustomSelect } from '../../CustomSelect';
import { Modal, useToast } from '../../ui/Overlays';
import { getDB } from '../../../utils/storage';
import { colones } from '../../../utils/dinero';
import { abrirWhatsApp, enlaceWhatsApp } from '../../../utils/whatsapp';
import { agregarEvento } from '../../../utils/crm';
import type { LeadCrm, RespuestaRapida } from '../../../utils/crmLogica';

/** Clave con la que Cobros recibe una venta armada desde el CRM (ver FacturacionPanel). */
export const CLAVE_COBRO_PRECARGADO = 'tv_cobro_precargado';
export const EVENTO_COBRO_PRECARGADO = 'technoverse_cobro_precargado';

export interface CobroPrecargado { nombre: string; telefono: string; correo: string; productoId: string; cantidad: number }

const primerNombre = (n: string) => (n || '').trim().split(/\s+/)[0] || '';

/** Elegir una respuesta rápida y abrir WhatsApp con ella. */
export function EscribirWhatsApp({ lead, respuestas, onCerrar, onAnotado }: {
  lead: LeadCrm; respuestas: RespuestaRapida[]; onCerrar: () => void; onAnotado: () => void;
}) {
  const toast = useToast();
  const [texto, setTexto] = useState(`¡Hola ${primerNombre(lead.nombre)}! `);
  const [titulo, setTitulo] = useState('mensaje propio');

  const enviar = async () => {
    const url = enlaceWhatsApp(lead.telefono, texto.trim());
    if (!url) { toast.warning('Este contacto no tiene un teléfono válido.'); return; }
    abrirWhatsApp(url);
    try { await agregarEvento(lead.id, 'contacto', `WhatsApp: ${titulo}`); onAnotado(); } catch { /* el mensaje igual salió */ }
    onCerrar();
  };

  return (
    <Modal open onClose={onCerrar} size="md" title={`Escribirle a ${primerNombre(lead.nombre) || 'este contacto'}`}
      footer={<><Btn variant="ghost" onClick={onCerrar}>Cancelar</Btn><Btn variant="primary" icon={MessageCircle} onClick={() => void enviar()} disabled={!texto.trim()}>Abrir WhatsApp</Btn></>}>
      <div className="tv-stack">
        {respuestas.length > 0 && (
          <div className="crm-wa-resp" role="list" aria-label="Respuestas rápidas">
            {respuestas.map(r => (
              <button key={r.id} type="button" role="listitem" className="crm-wa-op"
                onClick={() => { setTexto(r.texto.replace(/\{nombre\}/g, primerNombre(lead.nombre))); setTitulo(`/${r.atajo}`); }}>
                <b className="tv-1l">/{r.atajo}</b><span className="tv-1l">{r.titulo}</span>
              </button>
            ))}
          </div>
        )}
        <Field label="Mensaje" hint="Se abre en WhatsApp para revisarlo antes de enviar.">
          <textarea className="tv-input" rows={4} maxLength={1500} value={texto} onChange={e => setTexto(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

interface Linea { productoId: string; cantidad: number }

/** Armar el pedido por chat, mandar el resumen y, con el SINPE visto, cobrarlo en Cobros. */
export function ArmarVenta({ lead, onCerrar, onPendiente, onCobrar }: {
  lead: LeadCrm; onCerrar: () => void; onPendiente: (total: number, resumen: string) => Promise<void>; onCobrar: (c: CobroPrecargado) => void;
}) {
  const toast = useToast();
  const productos = useMemo(() => (getDB().products || []).filter(p => p && p.active !== false && Number(p.stock) > 0 && (p.price || 0) > 0), []);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [elegido, setElegido] = useState('');
  const [entrega, setEntrega] = useState<'retiro' | 'envio'>('retiro');
  const [enviando, setEnviando] = useState(false);

  const detalle = lineas.map(l => ({ ...l, p: productos.find(p => p.id === l.productoId)! })).filter(l => l.p);
  const total = detalle.reduce((s, l) => s + (l.p.price || 0) * l.cantidad, 0);
  const sinpe = getDB().settings?.companyPhone || '';

  const sumar = () => {
    if (!elegido) return;
    setLineas(ls => ls.some(l => l.productoId === elegido) ? ls.map(l => l.productoId === elegido ? { ...l, cantidad: l.cantidad + 1 } : l) : [...ls, { productoId: elegido, cantidad: 1 }]);
    setElegido('');
  };

  const resumen = () => [
    `¡Hola ${primerNombre(lead.nombre)}! Este es tu pedido en Technoverse:`,
    ...detalle.map(l => `• ${l.cantidad} × ${l.p.name} — ${colones((l.p.price || 0) * l.cantidad)}`),
    `Total: ${colones(total)}`,
    entrega === 'retiro' ? 'Entrega: retiro en la tienda.' : 'Entrega: envío (te confirmamos el costo).',
    sinpe ? `Podés pagar por SINPE Móvil al ${sinpe} (Technoverse Costa Rica) y mandarnos el comprobante por aquí.` : '',
  ].filter(Boolean).join('\n');

  const enviarResumen = async () => {
    if (!detalle.length) { toast.warning('Agregá al menos un producto.'); return; }
    const url = enlaceWhatsApp(lead.telefono, resumen());
    if (!url) { toast.warning('Este contacto no tiene un teléfono válido.'); return; }
    setEnviando(true);
    abrirWhatsApp(url);
    try { await onPendiente(total, `WhatsApp: pedido por chat (${detalle.map(l => `${l.cantidad} × ${l.p.name}`).join(', ')}) · ${colones(total)} · ${entrega === 'retiro' ? 'retiro' : 'envío'}`); }
    finally { setEnviando(false); }
  };

  const cobrar = () => {
    if (!detalle.length) { toast.warning('Agregá al menos un producto.'); return; }
    if (detalle.length > 1) toast.info(`Cobros va producto por producto: empezá por ${detalle[0].p.name} y después los demás.`);
    onCobrar({ nombre: lead.nombre, telefono: lead.telefono || '', correo: lead.email || '', productoId: detalle[0].productoId, cantidad: detalle[0].cantidad });
  };

  return (
    <Modal open onClose={onCerrar} size="md" title={`Venta por chat · ${primerNombre(lead.nombre) || 'contacto'}`}
      footer={<>
        <Btn variant="ghost" onClick={onCerrar}>Cerrar</Btn>
        <Btn icon={Send} onClick={() => void enviarResumen()} disabled={!detalle.length || enviando}>Enviar resumen</Btn>
        <Btn variant="primary" icon={Wallet} onClick={cobrar} disabled={!detalle.length}>SINPE recibido</Btn>
      </>}>
      <div className="tv-stack">
        <div className="crm-wa-fila">
          <div className="min-w-0 flex-1">
            <CustomSelect value={elegido} onChange={setElegido} placeholder="Elegí un producto…" searchable
              options={productos.map(p => ({ value: p.id, label: `${p.name} — ${colones(p.price || 0)}` }))} />
          </div>
          <Btn icon={Plus} onClick={sumar} disabled={!elegido}>Agregar</Btn>
        </div>
        {detalle.length > 0 ? (
          <div className="crm-wa-lista">
            {detalle.map(l => (
              <div key={l.productoId} className="crm-wa-item">
                <span className="tv-1l min-w-0 flex-1">{l.p.name}</span>
                <input className="tv-input crm-wa-cant" type="number" min={1} max={Math.max(1, Number(l.p.stock) || 1)} value={l.cantidad}
                  aria-label={`Cantidad de ${l.p.name}`}
                  onChange={e => setLineas(ls => ls.map(x => x.productoId === l.productoId ? { ...x, cantidad: Math.max(1, Math.min(Number(l.p.stock) || 1, Number(e.target.value) || 1)) } : x))} />
                <b className="tabular-nums flex-none">{colones((l.p.price || 0) * l.cantidad)}</b>
                <button type="button" className="tv-btn" data-variant="ghost" aria-label={`Quitar ${l.p.name}`} onClick={() => setLineas(ls => ls.filter(x => x.productoId !== l.productoId))}><Trash2 className="w-4 h-4" aria-hidden="true" /></button>
              </div>
            ))}
            <div className="crm-wa-total"><span>Total</span><b className="tabular-nums">{colones(total)}</b></div>
          </div>
        ) : <p className="crm-nada">Agregá lo que la persona pidió por el chat.</p>}
        <Field label="Entrega">
          <CustomSelect value={entrega} onChange={v => setEntrega(v as 'retiro' | 'envio')} options={[{ value: 'retiro', label: 'Retiro en la tienda' }, { value: 'envio', label: 'Envío' }]} />
        </Field>
        <p className="crm-nada">«Enviar resumen» manda el pedido y los datos del SINPE por WhatsApp y pasa el contacto a «Pendiente de pago». Cuando veas el SINPE, «SINPE recibido» abre Cobros con todo cargado: ahí se descuenta el stock y sale la factura.</p>
      </div>
    </Modal>
  );
}
