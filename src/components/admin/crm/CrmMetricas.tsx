// =====================================================================
// CRM · MÉTRICAS
// =====================================================================
// Qué tan bien se está convirtiendo lo que llega: cuántos contactos hay en cada etapa y cuántos pasan a la siguiente, de dónde
// vienen y cuáles terminan comprando, cuántos entran por semana y cuánto se vende. Todo se calcula con los contactos y los pedidos
// que el panel ya tiene (`calcularMetricas`), así que cambia en vivo. Cada gráfico lleva sus números escritos (no hay que adivinar
// una altura) y un resumen para lectores de pantalla; las barras usan un solo color del tema.
// =====================================================================

import { BarChart3, CircleDollarSign, Hourglass, Percent, TrendingUp, Users, BellRing, Wallet } from 'lucide-react';
import { Card, Empty, Stat, colones } from '../AdminKit';
import { CANALES, ETAPAS, FUENTES, type MetricasCrm } from '../../../utils/crm';
import type { Crm } from './useCrm';

const pct = (x: number | null | undefined): string => (x == null ? '—' : `${Math.round(x * 100)} %`);

function dif(actual: number, previo: number): string {
  const d = actual - previo;
  return d === 0 ? 'Igual que la semana anterior' : `${d > 0 ? '+' : '−'}${Math.abs(d)} que la semana anterior`;
}

function Tabla({ titulo, filas, nombre }: { titulo: string; filas: { clave: string; n: number; ganados: number }[]; nombre: (c: string) => string }) {
  const max = Math.max(1, ...filas.map(f => f.n));
  return (
    <Card title={titulo}>
      {filas.length === 0 ? <p className="crm-nada">Sin datos todavía.</p> : (
        <ul className="crm-barras">
          {filas.map(f => (
            <li key={f.clave} title={`${nombre(f.clave)}: ${f.n} contactos, ${f.ganados} compraron`}>
              <span className="crm-barra-n tv-1l">{nombre(f.clave)}</span>
              <span className="crm-barra-pista" aria-hidden="true"><span className="crm-barra-lleno" style={{ width: `${(f.n / max) * 100}%` }} /></span>
              <span className="crm-barra-v">{f.n}</span>
              <span className="crm-barra-c" title="Compraron">{pct(f.n ? f.ganados / f.n : null)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="crm-nota-graf">Contactos y, a la derecha, qué parte terminó comprando.</p>
    </Card>
  );
}

export default function CrmMetricas({ crm }: { crm: Crm }) {
  const m: MetricasCrm = crm.metricas;

  if (m.total === 0) {
    return <Card><Empty icon={BarChart3} title="Todavía no hay datos" text="Las métricas aparecen cuando entran los primeros contactos (chat, registros, pedidos o taller)." /></Card>;
  }

  const primero = Math.max(1, m.embudo[0]?.n || 1);
  const maxSemana = Math.max(1, ...m.semanas.map(s => s.n));
  const resumenEmbudo = m.embudo.map((e, i) => `${ETAPAS[i].corto}: ${e.n}`).join('; ');

  return (
    <div className="tv-stack">
      <div className="crm-kpis">
        <Stat label="Contactos" value={m.total} icon={Users} foot={`${m.abiertos} en etapas abiertas`} />
        <Stat label="Nuevos (7 días)" value={m.nuevos7} icon={TrendingUp} foot={dif(m.nuevos7, m.nuevosPrevios7)} />
        <Stat label="Conversión" value={pct(m.conversion)} icon={Percent} foot={`${m.ganados} de ${m.total} compraron`} />
        <Stat label="En juego" value={colones(m.valorAbierto)} icon={Wallet} foot="Valor estimado en etapas abiertas" />
        <Stat label="Ventas (30 días)" value={colones(m.ventas30)} icon={CircleDollarSign} foot="A contactos del CRM" />
        <Stat label="Tiempo de cierre" value={m.diasPromedioCierre == null ? '—' : `${Math.round(m.diasPromedioCierre)} d`} icon={Hourglass} foot="Desde que aparece hasta que compra" />
        <Stat label="Seguimientos vencidos" value={m.vencidos} icon={BellRing} alert={m.vencidos > 0} foot={`${m.paraHoy} para hoy · ${m.estancados} sin atender`} />
      </div>

      <Card title="Embudo de ventas">
        <ol className="crm-embudo" role="img" aria-label={`Embudo: ${resumenEmbudo}`}>
          {m.embudo.map((e, i) => (
            <li key={e.etapa} title={`${ETAPAS[i].label}: ${e.n} contactos llegaron al menos hasta aquí`}>
              <span className="crm-barra-n tv-1l">{ETAPAS[i].label}</span>
              <span className="crm-barra-pista" aria-hidden="true"><span className="crm-barra-lleno" style={{ width: `${(e.n / primero) * 100}%` }} /></span>
              <span className="crm-barra-v">{e.n}</span>
              <span className="crm-barra-c" title="Pasan a la etapa siguiente">{e.paso == null ? '' : `→ ${pct(e.paso)}`}</span>
            </li>
          ))}
        </ol>
        <p className="crm-nota-graf">Cuántos contactos llegaron al menos hasta cada etapa, y qué parte pasa a la siguiente.</p>
      </Card>

      <Card title="Contactos nuevos por semana">
        <div className="crm-semanas" role="img" aria-label={`Contactos nuevos por semana, de la más antigua a la actual: ${m.semanas.map(s => s.n).join(', ')}`}>
          {m.semanas.map((s, i) => {
            const [a, mes, d] = s.desde.split('-');
            return (
              <div key={s.desde} className="crm-semana" data-no-1l title={`Semana del ${d}/${mes}/${a}: ${s.n} ${s.n === 1 ? 'contacto' : 'contactos'}${i === m.semanas.length - 1 ? ' (en curso)' : ''}`}>
                <span className="crm-semana-v tv-1l">{s.n}</span>
                <span className="crm-semana-pista" aria-hidden="true"><span className="crm-semana-barra" data-actual={i === m.semanas.length - 1 || undefined} style={{ height: `${Math.max(s.n ? 6 : 0, (s.n / maxSemana) * 100)}%` }} /></span>
                <span className="crm-semana-e tv-1l">{`${d}/${mes}`}</span>
              </div>
            );
          })}
        </div>
        <p className="crm-nota-graf">Semanas que empiezan el lunes indicado; la última está en curso.</p>
      </Card>

      <div className="crm-dos">
        <Tabla titulo="De dónde llegan" filas={m.porFuente} nombre={c => FUENTES[c as keyof typeof FUENTES] || c} />
        <Tabla titulo="Por qué canal" filas={m.porCanal} nombre={c => CANALES[c as keyof typeof CANALES] || c} />
      </div>
    </div>
  );
}
