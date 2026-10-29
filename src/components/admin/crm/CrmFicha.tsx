// =====================================================================
// CRM · FICHA INTEGRAL DEL CONTACTO
// =====================================================================
// Todo lo de una persona en un solo lugar: sus datos, de dónde llegó, sus seguimientos, lo que compró y lo que dejó en el
// taller, su conversación del chat y la línea de tiempo (lo automático lo escribe el servidor; el equipo agrega notas y los
// contactos que hizo). La etapa y el responsable se cambian al instante; el resto de los datos, con «Guardar cambios».
// =====================================================================

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Archive, ArchiveRestore, Bell, Check, ExternalLink, Mail, MessageCircle, MessageSquare, Phone, Plus, ShoppingCart, Trash2, X } from 'lucide-react';
import { Btn, Chip, Field, colones } from '../AdminKit';
import { CustomSelect } from '../../CustomSelect';
import { Modal, useConfirm, useToast } from '../../ui/Overlays';
import TextoMedio from '../../ui/TextoMedio';
import { getDB } from '../../../utils/storage';
import {
  agregarEvento, eliminarEvento, listarEventos, mensajeDeError,
} from '../../../utils/crm';
import {
  CANALES, ETAPAS, FUENTES, PROVINCIAS, TIPOS_EVENTO, comprasDe, cuandoVence, etiquetaDeLead, fechaDeSeguimiento, haceCuanto, normalizarEmail,
  normalizarTelefono, type CambiosLead, type EtapaCrm, type EventoCrm, type LeadCrm,
} from '../../../utils/crm';
import type { Crm } from './useCrm';
import { Avatar, ICONO_CANAL, ICONO_EVENTO } from './crmPiezas';
import { ArmarVenta, EscribirWhatsApp, type CobroPrecargado } from './CrmWhatsApp';

const aInputLocal = (d: Date): string => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

interface Borrador { nombre: string; email: string; telefono: string; provincia: string; valor: string; etiquetas: string[] }
const borradorDe = (l: LeadCrm): Borrador => ({
  nombre: l.nombre, email: l.email || '', telefono: l.telefono || '', provincia: l.provincia || '', valor: l.valorEstimado ? String(l.valorEstimado) : '', etiquetas: l.etiquetas,
});

function Seccion({ titulo, derecha, children }: { titulo: string; derecha?: ReactNode; children: ReactNode }) {
  return (
    <section className="crm-sec">
      <header className="crm-sec-cab"><h4 className="crm-sec-t tv-1l">{titulo}</h4>{derecha}</header>
      {children}
    </section>
  );
}

export default function CrmFicha({ crm, leadId, esDueno, onCerrar, onAbrirChat, onCobrar }: {
  crm: Crm; leadId: string; esDueno: boolean; onCerrar: () => void; onAbrirChat: (conversacionId: string) => void;
  /** «SINPE recibido» de una venta por chat: abre Cobros con el cliente y el producto cargados. */
  onCobrar: (c: CobroPrecargado) => void;
}) {
  const [modalWa, setModalWa] = useState<null | 'escribir' | 'venta'>(null);
  const toast = useToast();
  const confirmar = useConfirm();
  const lead = crm.leads.find(l => l.id === leadId) || null;

  const [borrador, setBorrador] = useState<Borrador | null>(lead ? borradorDe(lead) : null);
  const [etiquetaNueva, setEtiquetaNueva] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [eventos, setEventos] = useState<EventoCrm[] | null>(null);
  const [nota, setNota] = useState('');
  const [tipoNota, setTipoNota] = useState<'nota' | 'contacto'>('nota');
  const [enviandoNota, setEnviandoNota] = useState(false);
  const [textoRec, setTextoRec] = useState('');
  const [diasRec, setDiasRec] = useState<number | 'otra'>(1);
  const [fechaRec, setFechaRec] = useState(() => aInputLocal(fechaDeSeguimiento(1, Date.now())));

  // Cuando llega otra versión del contacto (otro aparato, el servidor) y no hay cambios sin guardar, se refresca el borrador.
  const sucio = !!(lead && borrador && JSON.stringify(borrador) !== JSON.stringify(borradorDe(lead)));
  useEffect(() => { if (lead && !sucio) setBorrador(borradorDe(lead)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [lead?.actualizado, lead?.id]);

  // Línea de tiempo: al abrir y cada vez que el módulo recarga (cambió algo en vivo).
  useEffect(() => {
    let vivo = true;
    listarEventos(leadId).then(e => { if (vivo) setEventos(e); }).catch(() => { if (vivo) setEventos([]); });
    return () => { vivo = false; };
  }, [leadId, crm.version]);

  const pendientes = useMemo(() => crm.recordatorios.filter(r => r.leadId === leadId), [crm.recordatorios, leadId]);

  // Lo que ya compró, lo que dejó en el taller y su conversación (los lee el panel de todos modos).
  const datosLocales = useMemo(() => {
    if (!lead) return { pedidos: [] as any[], equipos: [] as any[], conversacion: null as any };
    const correo = normalizarEmail(lead.email);
    const tel = normalizarTelefono(lead.telefono);
    const db = getDB();
    const pedidos = correo ? (db.orders || []).filter(o => normalizarEmail(o.customerEmail) === correo).sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)) : [];
    const equipos = (db.repair_orders || []).filter(r => (correo && normalizarEmail(r.customerEmail) === correo) || (tel && normalizarTelefono(r.customerPhone) === tel))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const conversaciones = correo ? (db.chat_conversations || []).filter(c => normalizarEmail(c.customerEmail) === correo) : [];
    const ultimaDe = (c: any) => Date.parse(c.messages?.[c.messages.length - 1]?.timestamp || '') || 0;
    const conversacion = conversaciones.sort((a, b) => ultimaDe(b) - ultimaDe(a))[0] || null;
    return { pedidos, equipos, conversacion };
  // `crm.version` fuerza a releer cuando el módulo recarga.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead?.email, lead?.telefono, crm.version, crm.pedidos]);

  if (!lead || !borrador) {
    return (
      <Modal open onClose={onCerrar} title="Contacto" size="md" footer={<Btn onClick={onCerrar}>Cerrar</Btn>}>
        <p>Este contacto ya no existe (alguien lo borró).</p>
      </Modal>
    );
  }

  const compras = comprasDe(lead, crm.compras);
  const nombre = etiquetaDeLead(lead);
  const hoy = crm.ahora;

  const quitarEtiqueta = (e: string) => setBorrador(b => (b ? { ...b, etiquetas: b.etiquetas.filter(x => x !== e) } : b));
  const sumarEtiqueta = (crudo: string) => {
    const e = crudo.trim().replace(/\s+/g, ' ').slice(0, 30);
    if (!e) return;
    if (borrador.etiquetas.length >= 20) { toast.warning('Máximo 20 etiquetas.'); return; }
    setBorrador(b => (b && !b.etiquetas.includes(e) ? { ...b, etiquetas: [...b.etiquetas, e] } : b));
    setEtiquetaNueva('');
  };

  const guardar = async () => {
    const c: CambiosLead = {};
    if (borrador.nombre.trim() !== lead.nombre) c.nombre = borrador.nombre;
    if ((borrador.email.trim() || null) !== lead.email) c.email = borrador.email;
    if ((borrador.telefono.trim() || null) !== lead.telefono) c.telefono = borrador.telefono;
    if ((borrador.provincia || null) !== lead.provincia) c.provincia = borrador.provincia || null;
    const valor = Math.max(0, Number(borrador.valor.replace(/[^\d.]/g, '')) || 0);
    if (valor !== lead.valorEstimado) c.valorEstimado = valor;
    if (JSON.stringify(borrador.etiquetas) !== JSON.stringify(lead.etiquetas)) c.etiquetas = borrador.etiquetas;
    if (!borrador.email.trim() && !borrador.telefono.trim()) { toast.warning('Hace falta al menos un correo o un teléfono.'); return; }
    setGuardando(true);
    const nuevo = await crm.editar(lead.id, c);
    setGuardando(false);
    if (nuevo) { setBorrador(borradorDe(nuevo)); toast.success('Cambios guardados.'); }
  };

  const agregarNota = async () => {
    if (!nota.trim()) return;
    setEnviandoNota(true);
    try {
      const ev = await agregarEvento(lead.id, tipoNota, nota);
      setEventos(es => [ev, ...(es || [])]);
      setNota('');
      void crm.recargar();
    } catch (e: any) { toast.error(mensajeDeError(e)); }
    finally { setEnviandoNota(false); }
  };

  const borrarEvento = async (ev: EventoCrm) => {
    try { await eliminarEvento(ev.id); setEventos(es => (es || []).filter(x => x.id !== ev.id)); }
    catch (e: any) { toast.error(e?.message || mensajeDeError(e)); }
  };

  const agendar = async () => {
    const vence = diasRec === 'otra' ? new Date(fechaRec) : fechaDeSeguimiento(diasRec, hoy);
    if (!Number.isFinite(vence.getTime())) { toast.warning('Elegí una fecha válida.'); return; }
    const ok = await crm.agendar(lead.id, vence, textoRec.trim() || 'Dar seguimiento');
    if (ok) { setTextoRec(''); toast.success('Seguimiento agendado.'); }
  };

  const eliminar = async () => {
    const si = await confirmar({
      title: 'Borrar contacto', variant: 'danger', confirmText: 'Borrar',
      message: `Se borrará a ${nombre} con toda su línea de tiempo y sus seguimientos. Sus pedidos y chats no se tocan. No se puede deshacer.`,
    });
    if (si && await crm.borrar(lead.id)) onCerrar();
  };

  const opcionesEtapa = ETAPAS.map(e => ({ value: e.id, label: e.label }));
  const opcionesResponsable = [{ value: '', label: 'Sin responsable' }, ...crm.equipo.map(c => ({ value: c, label: c })),
    ...(lead.responsable && !crm.equipo.includes(lead.responsable.toLowerCase()) ? [{ value: lead.responsable, label: lead.responsable }] : [])];
  const opcionesProvincia = [{ value: '', label: 'Sin provincia' }, ...PROVINCIAS.map(p => ({ value: p, label: p }))];
  const Canal = ICONO_CANAL[lead.canal];
  const o = lead.origen;
  const mensajes = (datosLocales.conversacion?.messages || []).slice(-5);

  return (
    <Modal
      open onClose={onCerrar} size="xl"
      title={<span className="crm-ficha-titulo"><Avatar nombre={lead.nombre} email={lead.email} grande /><span className="tv-1l">{nombre}</span>{lead.archivado && <Chip>Archivado</Chip>}</span>}
      footer={<>
        <Btn variant="ghost" onClick={onCerrar}>Cerrar</Btn>
        <Btn variant="primary" icon={Check} onClick={guardar} disabled={!sucio || guardando}>{guardando ? 'Guardando…' : 'Guardar cambios'}</Btn>
      </>}
    >
      <div className="crm-ficha">
        {/* Lo que se cambia con un toque */}
        <div className="crm-resumen">
          <Field label="Etapa del embudo">
            <CustomSelect value={lead.etapa} onChange={v => void crm.mover(lead.id, v as EtapaCrm)} options={opcionesEtapa} />
          </Field>
          <Field label="Responsable">
            <CustomSelect value={lead.responsable || ''} onChange={v => void crm.editar(lead.id, { responsable: v || null })} options={opcionesResponsable} />
          </Field>
        </div>
        {/* Columnas iguales (llamar · correo · chat), una línea cada una: no se corre nada con la letra grande ni hay tira que deslizar. */}
        {(lead.telefono || lead.email || datosLocales.conversacion) && (
          <div className="crm-acciones">
            {lead.telefono && <a className="tv-btn" data-variant="default" href={`tel:${lead.telefono.replace(/[^\d+]/g, '')}`} title={`Llamar al ${lead.telefono}`}><Phone className="w-4 h-4 flex-none" aria-hidden="true" /><span className="tv-btn-label">Llamar</span></a>}
            {lead.email && <a className="tv-btn" data-variant="default" href={`mailto:${lead.email}`} title={`Escribir un correo a ${lead.email}`}><Mail className="w-4 h-4 flex-none" aria-hidden="true" /><span className="tv-btn-label">Correo</span></a>}
            {datosLocales.conversacion && <Btn icon={MessageSquare} title="Abrir el chat con esta persona" onClick={() => onAbrirChat(datosLocales.conversacion.id)}>Chat</Btn>}
          </div>
        )}
        {/* Vender por WhatsApp: escribirle con una respuesta rápida o armar el pedido (ver CrmWhatsApp.tsx). */}
        {lead.telefono && (
          <div className="crm-acciones">
            <Btn icon={MessageCircle} title="Escribirle por WhatsApp con una respuesta rápida" onClick={() => setModalWa('escribir')}>WhatsApp</Btn>
            <Btn icon={ShoppingCart} title="Armar un pedido por chat" onClick={() => setModalWa('venta')}>Armar venta</Btn>
          </div>
        )}
        {modalWa === 'escribir' && (
          <EscribirWhatsApp lead={lead} respuestas={crm.respuestas.filter(r => r.activa !== false)} onCerrar={() => setModalWa(null)}
            onAnotado={() => { void crm.recargar(); void listarEventos(lead.id).then(setEventos).catch(() => {}); }} />
        )}
        {modalWa === 'venta' && (
          <ArmarVenta lead={lead} onCerrar={() => setModalWa(null)}
            onPendiente={async (total, resumen) => {
              await crm.mover(lead.id, 'pago_pendiente');
              await crm.editar(lead.id, { valorEstimado: total });
              try { await agregarEvento(lead.id, 'contacto', resumen); } catch { /* el pedido igual quedó */ }
              void listarEventos(lead.id).then(setEventos).catch(() => {});
              toast.success('Resumen abierto en WhatsApp. El contacto pasó a «Pendiente de pago».');
            }}
            onCobrar={c => { setModalWa(null); onCobrar(c); }} />
        )}

        <Seccion titulo="Datos del contacto">
          <div className="crm-grid2">
            <Field label="Nombre"><input className="tv-input" value={borrador.nombre} maxLength={120} onChange={e => setBorrador({ ...borrador, nombre: e.target.value })} /></Field>
            <Field label="Correo"><input className="tv-input" type="email" value={borrador.email} maxLength={160} onChange={e => setBorrador({ ...borrador, email: e.target.value })} /></Field>
            <Field label="Teléfono"><input className="tv-input" type="tel" value={borrador.telefono} maxLength={30} onChange={e => setBorrador({ ...borrador, telefono: e.target.value })} /></Field>
            <Field label="Provincia (aproximada)">
              <CustomSelect value={borrador.provincia} onChange={v => setBorrador({ ...borrador, provincia: v })} options={opcionesProvincia} />
            </Field>
            <Field label="Valor estimado (₡)" hint="Lo que podría comprar: suma al «en juego» de su etapa.">
              <input className="tv-input" inputMode="numeric" value={borrador.valor} onChange={e => setBorrador({ ...borrador, valor: e.target.value })} placeholder="0" />
            </Field>
            <div className="crm-etiquetas-campo">
              <span className="tv-label tv-1l">Etiquetas</span>
              <div className="crm-etiquetas">
                {borrador.etiquetas.map(e => (
                  <span key={e} className="crm-etq-x"><span className="tv-1l">{e}</span>
                    <button type="button" onClick={() => quitarEtiqueta(e)} aria-label={`Quitar la etiqueta ${e}`}><X className="w-3 h-3" aria-hidden="true" /></button></span>
                ))}
                <input className="crm-etq-in" list="crm-etiquetas-sugeridas" value={etiquetaNueva} placeholder={borrador.etiquetas.length ? 'Otra…' : 'Ej: mayorista, vip'} maxLength={30}
                  onChange={e => setEtiquetaNueva(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); sumarEtiqueta(etiquetaNueva); } }}
                  onBlur={() => sumarEtiqueta(etiquetaNueva)} />
                <datalist id="crm-etiquetas-sugeridas">{crm.etiquetasUsadas.filter(e => !borrador.etiquetas.includes(e)).map(e => <option key={e} value={e} />)}</datalist>
              </div>
            </div>
          </div>
        </Seccion>

        <Seccion titulo="Seguimiento" derecha={pendientes.length > 0 ? <Chip tone="accent">{pendientes.length}</Chip> : undefined}>
          {pendientes.length === 0 && <p className="crm-nada">Sin seguimientos pendientes.</p>}
          <ul className="crm-lista-rec">
            {pendientes.map(r => {
              const vencido = Date.parse(r.vence) < hoy;
              return (
                <li key={r.id} className="crm-rec" data-vencido={vencido || undefined}>
                  <button type="button" className="crm-hecho" onClick={() => void crm.cumplir(r.id)} aria-label="Marcar como hecho" title="Marcar como hecho"><Check className="w-4 h-4" aria-hidden="true" /></button>
                  <span className="crm-rec-tx" data-no-1l><span className="crm-rec-t tv-1l">{r.texto}</span><span className="crm-rec-c tv-1l">{cuandoVence(r.vence, hoy)}</span></span>
                  <button type="button" className="crm-mini" onClick={() => void crm.posponer(r.id, fechaDeSeguimiento(1, Math.max(hoy, Date.parse(r.vence))))} title="Posponer un día">+1 d</button>
                  <button type="button" className="crm-mini" onClick={() => void crm.quitarRecordatorio(r.id)} aria-label="Quitar el seguimiento"><Trash2 className="w-3.5 h-3.5" aria-hidden="true" /></button>
                </li>
              );
            })}
          </ul>
          <div className="crm-nuevo-rec">
            <input className="tv-input" value={textoRec} maxLength={300} onChange={e => setTextoRec(e.target.value)} placeholder="Qué hay que hacer: llamar, mandar la cotización…"
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void agendar(); } }} aria-label="Texto del seguimiento" />
            <div className="crm-presets" role="group" aria-label="Cuándo">
              {([[1, 'Mañana'], [3, 'En 3 días'], [7, 'En 1 semana'], ['otra', 'Otra fecha']] as const).map(([d, t]) => (
                <button key={String(d)} type="button" aria-pressed={diasRec === d} onClick={() => setDiasRec(d)}><span className="tv-1l">{t}</span></button>
              ))}
            </div>
            {diasRec === 'otra' && <input className="tv-input" type="datetime-local" value={fechaRec} onChange={e => setFechaRec(e.target.value)} aria-label="Fecha y hora" />}
            <Btn icon={Bell} onClick={agendar}>Agendar seguimiento</Btn>
          </div>
        </Seccion>

        <Seccion titulo="Compras y taller">
          <div className="crm-compras">
            <div data-no-1l><b>{compras?.pedidos || 0}</b><span className="tv-1l">pedidos</span></div>
            <div data-no-1l><b>{colones(compras?.total || 0)}</b><span className="tv-1l">comprado</span></div>
            <div data-no-1l><b>{compras?.ultima ? haceCuanto(compras.ultima, hoy) : '—'}</b><span className="tv-1l">última compra</span></div>
          </div>
          {datosLocales.pedidos.slice(0, 5).map((p: any) => (
            <div key={p.id} className="crm-fila"><span className="crm-fila-t tv-1l">{p.id}</span><span className="crm-fila-c tv-1l">{new Date(p.timestamp).toLocaleDateString('es-CR')} · {colones(p.total)}{p.status !== 'Completado' ? ` · ${p.status}` : ''}</span></div>
          ))}
          {datosLocales.equipos.slice(0, 4).map((r: any) => (
            <div key={r.id} className="crm-fila"><span className="crm-fila-t tv-1l">{r.ticket || r.id} · {r.device}</span><span className="crm-fila-c tv-1l">{r.status}</span></div>
          ))}
          {!datosLocales.pedidos.length && !datosLocales.equipos.length && <p className="crm-nada">Todavía sin compras ni equipos en el taller.</p>}
        </Seccion>

        <Seccion titulo="De dónde llegó">
          <div className="crm-origen">
            <Chip><Canal className="w-3 h-3 flex-none" aria-hidden="true" /><span className="tv-1l">{CANALES[lead.canal]}</span></Chip>
            <Chip><span className="tv-1l">{FUENTES[lead.fuente]}</span></Chip>
            {lead.provincia && <Chip><span className="tv-1l">{lead.provincia}</span></Chip>}
            {o.utm_campaign && <Chip tone="accent"><span className="tv-1l">Campaña: {o.utm_campaign}</span></Chip>}
            {o.utm_content && <Chip><span className="tv-1l">Anuncio: {o.utm_content}</span></Chip>}
            {o.referrer && <Chip><span className="tv-1l">Desde: {o.referrer}</span></Chip>}
            {o.landing && <Chip><span className="tv-1l">Entró por: {o.landing}</span></Chip>}
            {o.producto && <Chip><span className="tv-1l">Interés: {o.producto}</span></Chip>}
          </div>
          <p className="crm-nada">Apareció {haceCuanto(lead.creado, hoy)} · {lead.mensajes} {lead.mensajes === 1 ? 'mensaje' : 'mensajes'} suyos en el chat · movimiento {haceCuanto(lead.ultimaInteraccion, hoy)}.</p>
        </Seccion>

        {mensajes.length > 0 && (
          <Seccion titulo="Su conversación" derecha={<Btn variant="ghost" icon={ExternalLink} onClick={() => onAbrirChat(datosLocales.conversacion.id)}>Abrir</Btn>}>
            <ul className="crm-chat">
              {mensajes.map((m: any) => (
                <li key={m.id} data-de={m.sender} data-no-1l>
                  <span className="crm-chat-q tv-1l">{m.isInternalNote ? 'Nota interna' : m.sender === 'customer' ? 'Cliente' : m.sender === 'bot' ? 'Automático' : 'Equipo'} · {haceCuanto(m.timestamp, hoy)}</span>
                  <span className="crm-chat-t">{(m.text || (m.imageUrl ? '📷 Imagen' : m.audioUrl ? '🎤 Nota de voz' : m.videoUrl ? '🎬 Video' : '')).slice(0, 220)}</span>
                </li>
              ))}
            </ul>
          </Seccion>
        )}

        <Seccion titulo="Línea de tiempo">
          <div className="crm-nota">
            <div className="crm-presets" role="group" aria-label="Qué agregar">
              <button type="button" aria-pressed={tipoNota === 'nota'} onClick={() => setTipoNota('nota')}><span className="tv-1l">Nota</span></button>
              <button type="button" aria-pressed={tipoNota === 'contacto'} onClick={() => setTipoNota('contacto')}><span className="tv-1l">Contacto que hice</span></button>
            </div>
            <textarea className="tv-input" rows={2} maxLength={1000} value={nota} onChange={e => setNota(e.target.value)}
              placeholder={tipoNota === 'nota' ? 'Una nota para el equipo (el cliente no la ve)…' : 'Qué hablaron: «Lo llamé, quiere esperar a quincena»…'} aria-label="Texto" />
            <Btn icon={Plus} onClick={agregarNota} disabled={!nota.trim() || enviandoNota}>Agregar</Btn>
          </div>
          {eventos === null && <p className="crm-nada">Cargando…</p>}
          <ul className="crm-linea">
            {(eventos || []).map(ev => {
              const Icono = ICONO_EVENTO[ev.tipo];
              return (
                <li key={ev.id} data-tipo={ev.tipo}>
                  <span className="crm-ev-ic" aria-hidden="true"><Icono className="w-3.5 h-3.5" /></span>
                  <span className="crm-ev-cuerpo" data-no-1l>
                    <span className="crm-ev-t">{ev.resumen}</span>
                    <span className="crm-ev-m tv-1l">{TIPOS_EVENTO[ev.tipo]} · {ev.autor && ev.autor !== 'sistema' ? <TextoMedio texto={ev.autor} /> : 'automático'} · {haceCuanto(ev.creado, hoy)}</span>
                  </span>
                  {esDueno && (ev.tipo === 'nota' || ev.tipo === 'contacto') && (
                    <button type="button" className="crm-mini" onClick={() => void borrarEvento(ev)} aria-label="Borrar esta entrada"><Trash2 className="w-3.5 h-3.5" aria-hidden="true" /></button>
                  )}
                </li>
              );
            })}
          </ul>
          {eventos && eventos.length === 0 && <p className="crm-nada">Todavía no hay movimientos.</p>}
        </Seccion>

        <div className="crm-peligro">
          <Btn variant="ghost" icon={lead.archivado ? ArchiveRestore : Archive} onClick={() => void crm.archivar(lead.id, !lead.archivado)}>{lead.archivado ? 'Reactivar' : 'Archivar'}</Btn>
          {esDueno && <Btn variant="danger" icon={Trash2} onClick={eliminar}>Borrar contacto</Btn>}
        </div>
        {lead.archivado && <p className="crm-nada">Archivado: no sale en el tablero ni en las métricas. Si vuelve a escribir, se reactiva solo.</p>}
        {sucio && <p className="crm-nada" role="status">Hay cambios sin guardar: tocá «Guardar cambios».</p>}
      </div>
    </Modal>
  );
}
