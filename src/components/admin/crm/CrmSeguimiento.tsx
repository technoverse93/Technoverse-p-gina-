// =====================================================================
// CRM · SEGUIMIENTO (qué hay que hacer hoy y a quién se le está olvidando)
// =====================================================================
// Los seguimientos agendados, ordenados por urgencia (vencidos, hoy, esta semana, más adelante), y debajo los contactos
// abiertos que nadie atiende: sin seguimiento y con varios días quietos. Se resuelve con un toque: hecho, posponer, o agendar.
// =====================================================================

import { useMemo } from 'react';
import { BellRing, CalendarCheck, Check, ExternalLink, UserX } from 'lucide-react';
import { Btn, Card, Chip, Empty, Stat } from '../AdminKit';
import {
  ETAPAS, cuandoVence, diasDesde, estaEstancado, etiquetaDeLead, fechaDeSeguimiento, haceCuanto, type LeadCrm, type RecordatorioCrm,
} from '../../../utils/crm';
import type { Crm } from './useCrm';
import { Avatar } from './crmPiezas';

type Fila = { r: RecordatorioCrm; lead: LeadCrm };

export default function CrmSeguimiento({ crm, onAbrir }: { crm: Crm; onAbrir: (id: string) => void }) {
  const hoy = crm.ahora;

  const { vencidos, paraHoy, semana, despues, estancados } = useMemo(() => {
    const porLead = new Map<string, LeadCrm>(crm.leads.map(l => [l.id, l] as [string, LeadCrm]));
    const filas: Fila[] = crm.recordatorios.flatMap(r => { const lead = porLead.get(r.leadId); return lead && !lead.archivado ? [{ r, lead }] : []; });
    const finDeHoy = new Date(hoy); finDeHoy.setHours(23, 59, 59, 999);
    const finSemana = finDeHoy.getTime() + 7 * 86_400_000;
    const t = (f: Fila) => Date.parse(f.r.vence);
    return {
      vencidos: filas.filter(f => t(f) < hoy),
      paraHoy: filas.filter(f => t(f) >= hoy && t(f) <= finDeHoy.getTime()),
      semana: filas.filter(f => t(f) > finDeHoy.getTime() && t(f) <= finSemana),
      despues: filas.filter(f => t(f) > finSemana),
      estancados: crm.leads.filter(l => estaEstancado(l, hoy)).sort((a, b) => Date.parse(a.ultimaInteraccion) - Date.parse(b.ultimaInteraccion)),
    };
  }, [crm.leads, crm.recordatorios, hoy]);

  const lista = (titulo: string, filas: Fila[], urgente = false) => filas.length === 0 ? null : (
    <Card title={`${titulo} (${filas.length})`}>
      <ul className="crm-lista-rec">
        {filas.map(({ r, lead }) => (
          <li key={r.id} className="crm-rec" data-vencido={urgente || undefined}>
            <button type="button" className="crm-hecho" onClick={() => void crm.cumplir(r.id)} aria-label="Marcar como hecho" title="Marcar como hecho"><Check className="w-4 h-4" aria-hidden="true" /></button>
            <span className="crm-rec-tx" data-no-1l>
              <span className="crm-rec-t tv-1l">{r.texto}</span>
              <span className="crm-rec-c tv-1l">{etiquetaDeLead(lead)} · {cuandoVence(r.vence, hoy)}</span>
            </span>
            <button type="button" className="crm-mini" onClick={() => void crm.posponer(r.id, fechaDeSeguimiento(1, Math.max(hoy, Date.parse(r.vence))))} title="Posponer un día">+1 d</button>
            <button type="button" className="crm-mini" onClick={() => onAbrir(lead.id)} aria-label={`Abrir la ficha de ${etiquetaDeLead(lead)}`} title="Abrir la ficha"><ExternalLink className="w-3.5 h-3.5" aria-hidden="true" /></button>
          </li>
        ))}
      </ul>
    </Card>
  );

  const hayAlgo = vencidos.length + paraHoy.length + semana.length + despues.length + estancados.length > 0;

  return (
    <div className="tv-stack">
      <div className="crm-kpis">
        <Stat label="Vencidos" value={vencidos.length} icon={BellRing} alert={vencidos.length > 0} foot={vencidos.length ? 'Ya pasó su fecha' : 'Todo al día'} />
        <Stat label="Para hoy" value={paraHoy.length} icon={CalendarCheck} foot="Hasta la medianoche" />
        <Stat label="Esta semana" value={semana.length} icon={CalendarCheck} foot="Los próximos 7 días" />
        <Stat label="Sin atender" value={estancados.length} icon={UserX} alert={estancados.length > 0} foot="Abiertos y quietos hace días" />
      </div>

      {!hayAlgo && (
        <Card><Empty icon={CalendarCheck} title="Nada pendiente" text="Agendá un seguimiento desde la ficha de un contacto («Llamar el jueves», «Mandar la cotización»). Aquí aparecen ordenados por urgencia." /></Card>
      )}

      {lista('Vencidos', vencidos, true)}
      {lista('Para hoy', paraHoy)}
      {lista('Esta semana', semana)}
      {lista('Más adelante', despues)}

      {estancados.length > 0 && (
        <Card title={`Contactos sin atender (${estancados.length})`}>
          <p className="crm-nada">Están en una etapa abierta, no tienen seguimiento agendado y llevan varios días sin movimiento. Agendá uno con un toque o ábrelos.</p>
          <ul className="crm-lista-rec">
            {estancados.slice(0, 30).map(l => (
              <li key={l.id} className="crm-estancado">
                <button type="button" className="crm-estancado-id" data-no-1l onClick={() => onAbrir(l.id)}>
                  <Avatar nombre={l.nombre} email={l.email} />
                  <span className="crm-rec-tx" data-no-1l>
                    <span className="crm-rec-t tv-1l">{etiquetaDeLead(l)}</span>
                    <span className="crm-rec-c tv-1l">{ETAPAS.find(e => e.id === l.etapa)?.corto} · quieto {diasDesde(l.ultimaInteraccion, hoy)} d · {haceCuanto(l.ultimaInteraccion, hoy)}</span>
                  </span>
                </button>
                <span className="crm-presets crm-presets-corto" role="group" aria-label={`Agendar seguimiento para ${etiquetaDeLead(l)}`}>
                  {([[1, 'Mañana'], [3, '3 días'], [7, '1 sem']] as const).map(([d, t]) => (
                    <button key={d} type="button" onClick={() => void crm.agendar(l.id, fechaDeSeguimiento(d, hoy), 'Dar seguimiento')}><span className="tv-1l">{t}</span></button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
          {estancados.length > 30 && <Chip>y {estancados.length - 30} más</Chip>}
        </Card>
      )}
    </div>
  );
}
