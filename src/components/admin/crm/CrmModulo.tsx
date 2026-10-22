// =====================================================================
// CRM INTERNO · EL MÓDULO (embudo, seguimiento, segmentos, respuestas rápidas y métricas)
// =====================================================================
// Un solo módulo con cinco carpetas (ver `crm_embudo` en adminNav). Los datos se leen una vez (`useCrm`) y los comparten todas las
// carpetas. La ficha de un contacto se abre encima de cualquiera de ellas. Los contactos no se cargan a mano: los crean solos el chat,
// los registros, los pedidos y el taller (supabase/migracion_crm.sql); aquí se les da seguimiento.
// Esta pantalla solo la ve el personal (RLS en la base).
// =====================================================================

import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Btn, Card, Empty, Field, PageHead } from '../AdminKit';
import { CustomSelect } from '../../CustomSelect';
import { Modal, useToast } from '../../ui/Overlays';
import { esGestion } from '../../../utils/roles';
import { CLAVE_ABRIR_CONV, EVENTO_ABRIR_CONV } from '../../../mobile/jarvisAtajo';
import { CLAVE_ABRIR_LEAD, EVENTO_ABRIR_LEAD, ETAPAS, PROVINCIAS, buscarDuplicado, etiquetaDeLead, type EtapaCrm } from '../../../utils/crm';
import type { User } from '../../../types';
import '../../../styles/crm.css';
import { useCrm } from './useCrm';
import { AvisoMigracion } from './crmPiezas';
import CrmEmbudo from './CrmEmbudo';
import CrmFicha from './CrmFicha';
import CrmSeguimiento from './CrmSeguimiento';
import CrmSegmentos from './CrmSegmentos';
import CrmRespuestas from './CrmRespuestas';
import CrmMetricas from './CrmMetricas';

type Vista = 'embudo' | 'seguimiento' | 'segmentos' | 'respuestas' | 'metricas';

const PISTA: Record<Vista, string> = {
  embudo: 'Tus contactos por etapa, de nuevo prospecto a postventa. Arrastrá una tarjeta o usá la flecha.',
  seguimiento: 'Qué hay que hacer hoy y a quién se le está olvidando.',
  segmentos: 'Filtrá a tus contactos y dirigí una promoción a quien corresponde.',
  respuestas: 'Textos preparados para el chat: un toque y listo.',
  metricas: 'Cuánto convierte lo que llega y de dónde viene.',
};

function vistaDe(tab: string): Vista {
  const v = tab.replace(/^crm_/, '');
  return (['embudo', 'seguimiento', 'segmentos', 'respuestas', 'metricas'] as const).includes(v as Vista) ? (v as Vista) : 'embudo';
}

function NuevoContacto({ crm, onCerrar, onAbrir }: { crm: ReturnType<typeof useCrm>; onCerrar: () => void; onAbrir: (id: string) => void }) {
  const toast = useToast();
  const [d, setD] = useState({ nombre: '', email: '', telefono: '', provincia: '', valor: '', etapa: 'nuevo' as EtapaCrm });
  const [guardando, setGuardando] = useState(false);
  const duplicado = buscarDuplicado(crm.leads, d.email, d.telefono);

  const crear = async () => {
    if (!d.nombre.trim()) { toast.warning('Falta el nombre.'); return; }
    if (!d.email.trim() && !d.telefono.trim()) { toast.warning('Hace falta al menos un correo o un teléfono.'); return; }
    if (duplicado) { toast.warning(`Ya existe: ${etiquetaDeLead(duplicado)}.`); return; }
    setGuardando(true);
    const nuevo = await crm.crear({
      nombre: d.nombre, email: d.email, telefono: d.telefono, provincia: d.provincia || null, etapa: d.etapa,
      valorEstimado: Math.max(0, Number(d.valor.replace(/[^\d.]/g, '')) || 0),
    });
    setGuardando(false);
    if (nuevo) { onCerrar(); onAbrir(nuevo.id); }
  };

  return (
    <Modal open onClose={onCerrar} size="md" title="Nuevo contacto"
      footer={<><Btn variant="ghost" onClick={onCerrar}>Cancelar</Btn><Btn variant="primary" icon={Plus} onClick={crear} disabled={guardando || !!duplicado}>{guardando ? 'Creando…' : 'Crear contacto'}</Btn></>}>
      <div className="tv-stack">
        <p className="crm-nada">Los contactos llegan solos desde el chat, los registros, los pedidos y el taller. Usá esto para quien te escribió por otro lado.</p>
        <Field label="Nombre"><input className="tv-input" value={d.nombre} maxLength={120} autoFocus onChange={e => setD({ ...d, nombre: e.target.value })} /></Field>
        <div className="crm-grid2">
          <Field label="Correo"><input className="tv-input" type="email" value={d.email} maxLength={160} onChange={e => setD({ ...d, email: e.target.value })} /></Field>
          <Field label="Teléfono"><input className="tv-input" type="tel" value={d.telefono} maxLength={30} onChange={e => setD({ ...d, telefono: e.target.value })} /></Field>
          <Field label="Provincia"><CustomSelect value={d.provincia} onChange={v => setD({ ...d, provincia: v })} options={[{ value: '', label: 'Sin provincia' }, ...PROVINCIAS.map(p => ({ value: p, label: p }))]} /></Field>
          <Field label="Valor estimado (₡)"><input className="tv-input" inputMode="numeric" value={d.valor} onChange={e => setD({ ...d, valor: e.target.value })} placeholder="0" /></Field>
        </div>
        <Field label="Etapa"><CustomSelect value={d.etapa} onChange={v => setD({ ...d, etapa: v as EtapaCrm })} options={ETAPAS.map(e => ({ value: e.id, label: e.label }))} /></Field>
        {duplicado && (
          <div className="crm-aviso" role="status">
            <div className="min-w-0"><div className="crm-aviso-t">Esa persona ya está en el CRM</div>
              <p className="crm-aviso-p">{etiquetaDeLead(duplicado)} tiene el mismo correo o teléfono. <button type="button" className="crm-enlace" onClick={() => { onCerrar(); onAbrir(duplicado.id); }}>Abrir su ficha</button></p></div>
          </div>
        )}
      </div>
    </Modal>
  );
}

export default function CrmModulo({ tab, currentUser, onAbrirModulo }: { tab: string; currentUser: User | null; onAbrirModulo: (modulo: string) => void }) {
  const crm = useCrm();
  const vista = vistaDe(tab);
  const miCorreo = (currentUser?.email || '').toLowerCase();
  const [abierto, setAbierto] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState(false);

  // Abrir la ficha de un contacto pedida desde otra pantalla (por ejemplo, el chat).
  useEffect(() => {
    try { const id = sessionStorage.getItem(CLAVE_ABRIR_LEAD); if (id) { sessionStorage.removeItem(CLAVE_ABRIR_LEAD); setAbierto(id); } } catch { /* sin almacenamiento */ }
    const alPedir = (e: Event) => { const id = (e as CustomEvent<string>).detail; if (id) { try { sessionStorage.removeItem(CLAVE_ABRIR_LEAD); } catch { /* nada */ } setAbierto(id); } };
    window.addEventListener(EVENTO_ABRIR_LEAD, alPedir);
    return () => window.removeEventListener(EVENTO_ABRIR_LEAD, alPedir);
  }, []);

  const abrirChat = useCallback((conversacionId: string) => {
    try { sessionStorage.setItem(CLAVE_ABRIR_CONV, conversacionId); } catch { /* va solo el evento */ }
    window.dispatchEvent(new CustomEvent(EVENTO_ABRIR_CONV, { detail: conversacionId }));
    setAbierto(null);
    onAbrirModulo('chat');
  }, [onAbrirModulo]);

  const abrir = useCallback((id: string) => setAbierto(id), []);

  return (
    <div className="tv-stack crm-raiz" id="view-crm">
      <PageHead
        title="CRM"
        subtitle={PISTA[vista]}
        actions={vista !== 'respuestas' && vista !== 'metricas' && crm.estado === 'listo'
          ? <Btn variant="primary" icon={Plus} onClick={() => setNuevo(true)}>Nuevo contacto</Btn>
          : undefined}
      />

      {crm.estado === 'cargando' && <Card><p className="crm-nada" role="status">Cargando contactos…</p></Card>}
      {crm.estado === 'sin_migracion' && <AvisoMigracion />}
      {crm.estado === 'error' && (
        <Card><Empty title="No se pudieron leer los contactos" text={crm.error || undefined} action={<Btn variant="primary" onClick={() => void crm.recargar()}>Reintentar</Btn>} /></Card>
      )}

      {crm.estado === 'listo' && (
        <>
          {vista === 'embudo' && <CrmEmbudo crm={crm} miCorreo={miCorreo} onAbrir={abrir} onNuevo={() => setNuevo(true)} />}
          {vista === 'seguimiento' && <CrmSeguimiento crm={crm} onAbrir={abrir} />}
          {vista === 'segmentos' && <CrmSegmentos crm={crm} correoDelPersonal={miCorreo} onAbrir={abrir} onAbrirModulo={onAbrirModulo} />}
          {vista === 'respuestas' && <CrmRespuestas crm={crm} />}
          {vista === 'metricas' && <CrmMetricas crm={crm} />}
        </>
      )}

      {abierto && <CrmFicha crm={crm} leadId={abierto} esDueno={esGestion(currentUser?.role)} onCerrar={() => setAbierto(null)} onAbrirChat={abrirChat} />}
      {nuevo && <NuevoContacto crm={crm} onCerrar={() => setNuevo(false)} onAbrir={abrir} />}
    </div>
  );
}
