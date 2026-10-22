// =====================================================================
// CRM · SEGMENTOS (a quién dirigirle una promoción)
// =====================================================================
// Se combinan filtros (etapa, canal, origen, etiquetas, provincia, qué compraron y cuándo, cuánto llevan sin movimiento) y la
// lista que sale se puede copiar (los correos, para pegarlos en «CCO»), bajar como CSV o guardar como segmento para volver a
// usarlo. Hay segmentos sugeridos de partida. Copiar o bajar contactos queda anotado en la bitácora (son datos personales).
// =====================================================================

import { Fragment, useMemo, useState } from 'react';
import { Bookmark, ClipboardCopy, Download, Megaphone, Trash2 } from 'lucide-react';
import { Btn, Card, Chip, Empty, TableShell, colones } from '../AdminKit';
import TextoMedio from '../../ui/TextoMedio';
import { useToast } from '../../ui/Overlays';
import { addAuditLog } from '../../../utils/storage';
import {
  CANALES, ETAPAS, FUENTES, PROVINCIAS, SEGMENTOS_SUGERIDOS, aCsv, aplicarFiltro, comprasDe, correosDe, describirFiltro, etiquetaDeLead, haceCuanto,
  type CanalCrm, type EtapaCrm, type FiltroSegmento, type FuenteCrm,
} from '../../../utils/crm';
import type { Crm } from './useCrm';
import { Avatar } from './crmPiezas';

/** Una fila de botones que se prenden y se apagan (varias opciones a la vez). Se desplaza dentro de sí misma si no cabe. */
function Alternar<T extends string>({ titulo, opciones, valor, onChange }: {
  titulo: string; opciones: { id: T; label: string }[]; valor: T[] | undefined; onChange: (v: T[] | undefined) => void;
}) {
  const sel = valor || [];
  return (
    <div className="crm-faceta">
      <span className="tv-label tv-1l">{titulo}</span>
      <div className="crm-presets" role="group" aria-label={titulo}>
        {opciones.map(o => (
          <button key={o.id} type="button" aria-pressed={sel.includes(o.id)}
            onClick={() => { const n = sel.includes(o.id) ? sel.filter(x => x !== o.id) : [...sel, o.id]; onChange(n.length ? n : undefined); }}>
            <span className="tv-1l">{o.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const numero = (v: string): number | undefined => { const n = Number(v.replace(/[^\d]/g, '')); return v.trim() === '' || !Number.isFinite(n) ? undefined : n; };

export default function CrmSegmentos({ crm, correoDelPersonal, onAbrir, onAbrirModulo }: {
  crm: Crm; correoDelPersonal: string; onAbrir: (id: string) => void; onAbrirModulo: (modulo: string) => void;
}) {
  const toast = useToast();
  const [filtro, setFiltro] = useState<FiltroSegmento>({});
  const [nombre, setNombre] = useState('');
  const [verTodos, setVerTodos] = useState(false);
  const cambiar = (c: Partial<FiltroSegmento>) => setFiltro(f => {
    const n = { ...f, ...c } as Record<string, unknown>;
    for (const k of Object.keys(n)) if (n[k] === undefined || n[k] === false || n[k] === '') delete n[k];
    return n as FiltroSegmento;
  });

  const resultado = useMemo(() => aplicarFiltro(crm.leads, filtro, crm.compras, crm.ahora), [crm.leads, filtro, crm.compras, crm.ahora]);
  const correos = useMemo(() => correosDe(resultado), [resultado]);
  const frases = describirFiltro(filtro);
  const totalComprado = useMemo(() => resultado.reduce((s, l) => s + (comprasDe(l, crm.compras)?.total || 0), 0), [resultado, crm.compras]);
  const mostrados = verTodos ? resultado : resultado.slice(0, 50);

  const copiarCorreos = async () => {
    if (!correos.length) { toast.warning('Ninguno de esos contactos tiene correo.'); return; }
    const texto = correos.join(', ');
    try { await navigator.clipboard.writeText(texto); }
    catch {
      const t = document.createElement('textarea'); t.value = texto; t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch { /* sin portapapeles */ } t.remove();
    }
    addAuditLog(correoDelPersonal || 'admin', 'CRM', 'Copiar correos', `${correos.length} correos de un segmento (${frases.join('; ') || 'todos'})`);
    toast.success(`${correos.length} correos copiados. Pegalos en «CCO» para que no se vean entre sí.`);
  };

  const bajarCsv = () => {
    if (!resultado.length) { toast.warning('No hay contactos para exportar.'); return; }
    const blob = new Blob(['﻿' + aCsv(resultado, crm.compras)], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `segmento-crm-${new Date().toISOString().slice(0, 10)}.csv`;
    a.style.visibility = 'hidden';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    addAuditLog(correoDelPersonal || 'admin', 'CRM', 'Exportar CSV', `${resultado.length} contactos de un segmento (${frases.join('; ') || 'todos'})`);
  };

  const guardar = async () => {
    if (!nombre.trim()) { toast.warning('Ponele un nombre al segmento.'); return; }
    if (!frases.length) { toast.warning('Elegí al menos un filtro.'); return; }
    if (await crm.guardarSegmento(nombre, filtro)) { setNombre(''); toast.success('Segmento guardado.'); }
  };

  const etapas = ETAPAS.map(e => ({ id: e.id as EtapaCrm, label: e.corto }));
  const canales = (Object.keys(CANALES) as CanalCrm[]).map(c => ({ id: c, label: CANALES[c] }));
  const fuentes = (Object.keys(FUENTES) as FuenteCrm[]).map(c => ({ id: c, label: FUENTES[c] }));
  const provincias = PROVINCIAS.map(p => ({ id: p as string, label: p }));
  const etiquetas = crm.etiquetasUsadas.map(e => ({ id: e, label: e }));

  return (
    <div className="tv-stack">
      <Card title="Segmentos de partida">
        <div className="crm-presets crm-sugeridos" role="group" aria-label="Segmentos sugeridos y guardados">
          {SEGMENTOS_SUGERIDOS.map(s => (
            <button key={s.id} type="button" title={s.ayuda} onClick={() => setFiltro(s.filtro)}><span className="tv-1l">{s.nombre}</span></button>
          ))}
          {crm.segmentos.map(s => (
            <span key={s.id} className="crm-seg-guardado">
              <button type="button" onClick={() => setFiltro(s.filtro)} title="Aplicar este segmento"><Bookmark className="w-3.5 h-3.5 flex-none" aria-hidden="true" /><span className="tv-1l">{s.nombre}</span></button>
              <button type="button" onClick={() => void crm.quitarSegmento(s.id)} aria-label={`Borrar el segmento ${s.nombre}`}><Trash2 className="w-3.5 h-3.5" aria-hidden="true" /></button>
            </span>
          ))}
        </div>
      </Card>

      <Card title="Filtros" actions={frases.length ? <Btn variant="ghost" onClick={() => setFiltro({})}>Limpiar</Btn> : undefined}>
        <div className="crm-facetas">
          <label className="crm-faceta">
            <span className="tv-label tv-1l">Buscar</span>
            <input className="tv-input" value={filtro.texto || ''} onChange={e => cambiar({ texto: e.target.value })} placeholder="Nombre, correo, teléfono o etiqueta" />
          </label>
          <Alternar titulo="Etapa" opciones={etapas} valor={filtro.etapas} onChange={v => cambiar({ etapas: v })} />
          <Alternar titulo="Canal" opciones={canales} valor={filtro.canales} onChange={v => cambiar({ canales: v })} />
          <Alternar titulo="Origen" opciones={fuentes} valor={filtro.fuentes} onChange={v => cambiar({ fuentes: v })} />
          {etiquetas.length > 0 && <Alternar titulo="Etiquetas (cualquiera)" opciones={etiquetas} valor={filtro.etiquetas} onChange={v => cambiar({ etiquetas: v })} />}
          <Alternar titulo="Provincia" opciones={provincias} valor={filtro.provincias} onChange={v => cambiar({ provincias: v })} />
          <div className="crm-faceta">
            <span className="tv-label tv-1l">Compras</span>
            <div className="crm-presets" role="group" aria-label="Compras">
              {([[undefined, 'Cualquiera'], ['si', 'Ya compraron'], ['no', 'Nunca compraron']] as const).map(([v, t]) => (
                <button key={t} type="button" aria-pressed={filtro.compra === v} onClick={() => cambiar({ compra: v })}><span className="tv-1l">{t}</span></button>
              ))}
            </div>
          </div>
          <div className="crm-numeros">
            <label className="crm-faceta"><span className="tv-label tv-1l">Compraron al menos (₡)</span>
              <input className="tv-input" inputMode="numeric" value={filtro.gastoMinimo ?? ''} onChange={e => cambiar({ gastoMinimo: numero(e.target.value) })} placeholder="Ej: 50000" /></label>
            <label className="crm-faceta"><span className="tv-label tv-1l">Última compra hace más de (días)</span>
              <input className="tv-input" inputMode="numeric" value={filtro.ultimaCompraHaceMasDe ?? ''} onChange={e => cambiar({ ultimaCompraHaceMasDe: numero(e.target.value) })} placeholder="Ej: 60" /></label>
            <label className="crm-faceta"><span className="tv-label tv-1l">Sin actividad hace más de (días)</span>
              <input className="tv-input" inputMode="numeric" value={filtro.sinActividadMasDe ?? ''} onChange={e => cambiar({ sinActividadMasDe: numero(e.target.value) })} placeholder="Ej: 15" /></label>
          </div>
          <div className="crm-filtros-pie">
            <label className="crm-check"><input type="checkbox" checked={!!filtro.conCorreo} onChange={e => cambiar({ conCorreo: e.target.checked })} /><span className="tv-1l">Solo con correo</span></label>
            <label className="crm-check"><input type="checkbox" checked={!!filtro.incluirArchivados} onChange={e => cambiar({ incluirArchivados: e.target.checked })} /><span className="tv-1l">Incluir archivados</span></label>
          </div>
        </div>
      </Card>

      <Card
        title={`Resultado: ${resultado.length} ${resultado.length === 1 ? 'contacto' : 'contactos'}`}
        actions={<>
          <Btn icon={ClipboardCopy} onClick={copiarCorreos} disabled={!correos.length}>{`Copiar ${correos.length} correos`}</Btn>
          <Btn icon={Download} onClick={bajarCsv} disabled={!resultado.length}>CSV</Btn>
          <Btn icon={Megaphone} onClick={() => onAbrirModulo('marketing')} title="Crear un cupón o una campaña en Marketing">Crear cupón</Btn>
        </>}
        padded={false}
      >
        <div className="crm-resumen-seg">
          {frases.length ? frases.map(f => <Fragment key={f}><Chip>{f}</Chip></Fragment>) : <Chip>Todos los contactos</Chip>}
          <span className="crm-nada">{correos.length} con correo · {colones(totalComprado)} comprados en total</span>
        </div>
        <div className="crm-guardar-seg">
          <input className="tv-input" value={nombre} maxLength={60} onChange={e => setNombre(e.target.value)} placeholder="Nombre para guardar este segmento" aria-label="Nombre del segmento"
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void guardar(); } }} />
          <Btn icon={Bookmark} onClick={guardar} disabled={!nombre.trim() || !frases.length}>Guardar segmento</Btn>
        </div>
        {resultado.length === 0 ? (
          <Empty title="Ningún contacto cumple todo eso" text="Probá quitando un filtro." />
        ) : (
          <TableShell head={<><th>Contacto</th><th>Etapa</th><th>Correo / teléfono</th><th>Movimiento</th><th>Compras</th></>}>
            <tbody>
              {mostrados.map(l => {
                const c = comprasDe(l, crm.compras);
                return (
                  <tr key={l.id} className="crm-fila-tabla" onClick={() => onAbrir(l.id)}>
                    <td><span className="crm-celda-id"><Avatar nombre={l.nombre} email={l.email} /><span className="tv-1l">{etiquetaDeLead(l)}</span></span></td>
                    <td><span className="tv-nw">{ETAPAS.find(e => e.id === l.etapa)?.corto}</span></td>
                    <td>{l.email ? <TextoMedio texto={l.email} /> : <span className="tv-nw">{l.telefono}</span>}</td>
                    <td><span className="tv-nw">{haceCuanto(l.ultimaInteraccion, crm.ahora)}</span></td>
                    <td><span className="tv-nw">{c ? `${c.pedidos} · ${colones(c.total)}` : '—'}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </TableShell>
        )}
        {resultado.length > 50 && !verTodos && <div className="crm-mas"><Btn variant="ghost" onClick={() => setVerTodos(true)}>Mostrar los {resultado.length}</Btn></div>}
      </Card>
    </div>
  );
}
