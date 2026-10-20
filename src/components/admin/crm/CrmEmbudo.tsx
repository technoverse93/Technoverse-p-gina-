// =====================================================================
// CRM · EMBUDO (tablero de 6 etapas)
// =====================================================================
// Una columna por etapa. En escritorio se arrastra una tarjeta de una columna a otra; en el teléfono (y con teclado) cada
// tarjeta trae una flecha para pasarla a la etapa siguiente, y el resto de las etapas se cambia desde la ficha. En pantallas
// angostas se ve UNA etapa a la vez, elegida con las pestañas de arriba. Los vencidos van primero en cada columna.
// =====================================================================

import { Fragment, useMemo, useState, type DragEvent } from 'react';
import { ArrowRight, Filter, Search, Users } from 'lucide-react';
import { Btn, Card, Empty, colones } from '../AdminKit';
import { CustomSelect } from '../../CustomSelect';
import TextoMedio from '../../ui/TextoMedio';
import {
  CANALES, ETAPAS, FUENTES, coincideTexto, estadoSeguimiento, haceCuanto, ordenarPorUrgencia,
  type CanalCrm, type FuenteCrm, type InfoEtapa, type LeadCrm,
} from '../../../utils/crm';
import type { Crm } from './useCrm';
import { Avatar, ChipSeguimiento, ICONO_CANAL, ICONO_ETAPA } from './crmPiezas';

interface Filtros {
  responsable: string;   // 'todos' | 'sin' | 'mios' | un correo
  canal: '' | CanalCrm;
  fuente: '' | FuenteCrm;
  etiqueta: string;
  soloVencidos: boolean;
  archivados: boolean;
}
const SIN_FILTROS: Filtros = { responsable: 'todos', canal: '', fuente: '', etiqueta: '', soloVencidos: false, archivados: false };
const POR_COLUMNA = 40;

function TarjetaContacto({ l, ahora, siguiente, onAbrir, onMover, onArrastrar, arrastrando }: {
  l: LeadCrm; ahora: number; siguiente: InfoEtapa | null; onAbrir: (id: string) => void; onMover: (id: string, etapa: InfoEtapa['id']) => void;
  onArrastrar: (e: DragEvent, id: string | null) => void; arrastrando: boolean;
}) {
  const Canal = ICONO_CANAL[l.canal];
  const seg = estadoSeguimiento(l, ahora);
  const conSeguimiento = !!l.proximoContacto && (seg === 'vencido' || seg === 'hoy');
  const nombre = l.nombre.trim() || l.email || l.telefono || 'Sin nombre';
  // Sin nombre, el correo ya es el título: la segunda línea trae otro dato en vez de repetirlo.
  const dato = l.nombre.trim() ? (l.email ? <TextoMedio texto={l.email} /> : l.telefono) : (l.telefono || l.provincia);
  return (
    <article className="crm-tarjeta" draggable onDragStart={e => onArrastrar(e, l.id)} onDragEnd={e => onArrastrar(e, null)} data-arrastrando={arrastrando || undefined}>
      <button type="button" className="crm-t-abrir" data-no-1l onClick={() => onAbrir(l.id)} aria-label={`Abrir la ficha de ${nombre}`}>
        <span className="crm-t-fila">
          <Avatar nombre={l.nombre} email={l.email} />
          <span className="crm-t-nombre tv-1l">{!l.nombre.trim() && l.email ? <TextoMedio texto={l.email} /> : nombre}</span>
          {l.valorEstimado > 0 && <span className="crm-t-valor">{colones(l.valorEstimado)}</span>}
        </span>
        {dato && <span className="crm-t-sub tv-1l">{dato}</span>}
        <span className="crm-t-meta">
          <span className="crm-t-canal" title={`${CANALES[l.canal]} · ${FUENTES[l.fuente]}`}>
            <Canal className="w-3.5 h-3.5 flex-none" aria-hidden="true" />
            <span className="tv-1l">{haceCuanto(l.ultimaInteraccion, ahora)}</span>
          </span>
        </span>
        {/* Segunda fila fija (nunca se mezcla con la hora): el estado del seguimiento y hasta dos etiquetas. */}
        {(conSeguimiento || l.etiquetas.length > 0) && (
          <span className="crm-t-chips">
            {conSeguimiento && <ChipSeguimiento estado={seg as 'vencido' | 'hoy'} texto={seg === 'vencido' ? 'Vencido' : 'Hoy'} />}
            {l.etiquetas.slice(0, 2).map(e => <span key={e} className="crm-etq tv-1l" title={e}>{e}</span>)}
          </span>
        )}
      </button>
      {siguiente && (
        <button type="button" className="crm-t-sig" onClick={() => onMover(l.id, siguiente.id)} aria-label={`Pasar a «${siguiente.label}»`} title={`Pasar a «${siguiente.label}»`}>
          <ArrowRight className="w-4 h-4" aria-hidden="true" />
        </button>
      )}
    </article>
  );
}

export default function CrmEmbudo({ crm, miCorreo, onAbrir, onNuevo }: {
  crm: Crm; miCorreo: string; onAbrir: (id: string) => void; onNuevo: () => void;
}) {
  const [texto, setTexto] = useState('');
  const [filtros, setFiltros] = useState<Filtros>(SIN_FILTROS);
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
  const [etapaMovil, setEtapaMovil] = useState<InfoEtapa['id']>('nuevo');
  const [arrastrando, setArrastrando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  const [limites, setLimites] = useState<Record<string, number>>({});

  const activos = useMemo(() => (
    (filtros.responsable !== 'todos' ? 1 : 0) + (filtros.canal ? 1 : 0) + (filtros.fuente ? 1 : 0) + (filtros.etiqueta ? 1 : 0)
    + (filtros.soloVencidos ? 1 : 0) + (filtros.archivados ? 1 : 0)
  ), [filtros]);

  const visibles = useMemo(() => crm.leads.filter(l => {
    if (l.archivado !== filtros.archivados) return false;
    if (texto && !coincideTexto(l, texto)) return false;
    if (filtros.responsable === 'mios' && (l.responsable || '').toLowerCase() !== miCorreo) return false;
    if (filtros.responsable === 'sin' && l.responsable) return false;
    if (filtros.responsable.includes('@') && (l.responsable || '').toLowerCase() !== filtros.responsable) return false;
    if (filtros.canal && l.canal !== filtros.canal) return false;
    if (filtros.fuente && l.fuente !== filtros.fuente) return false;
    if (filtros.etiqueta && !l.etiquetas.includes(filtros.etiqueta)) return false;
    if (filtros.soloVencidos && estadoSeguimiento(l, crm.ahora) !== 'vencido') return false;
    return true;
  }), [crm.leads, crm.ahora, texto, filtros, miCorreo]);

  const columnas = useMemo(() => ETAPAS.map((e, i) => {
    const de = ordenarPorUrgencia(visibles.filter(l => l.etapa === e.id), crm.ahora);
    return { info: e, siguiente: ETAPAS[i + 1] || null, leads: de, valor: de.reduce((s, l) => s + l.valorEstimado, 0) };
  }), [visibles, crm.ahora]);

  const arrastrar = (e: DragEvent, id: string | null) => {
    if (id) { e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move'; }
    setArrastrando(id);
    if (!id) setSobre(null);
  };
  const soltar = (e: DragEvent, etapa: InfoEtapa['id']) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    setSobre(null); setArrastrando(null);
    if (id) void crm.mover(id, etapa);
  };

  const opcionesResponsable = [
    { value: 'todos', label: 'Todos los responsables' }, { value: 'mios', label: 'Solo mis contactos' }, { value: 'sin', label: 'Sin responsable' },
    ...crm.equipo.map(c => ({ value: c, label: c })),
  ];
  const opcionesCanal = [{ value: '', label: 'Todos los canales' }, ...(Object.keys(CANALES) as CanalCrm[]).map(c => ({ value: c, label: CANALES[c] }))];
  const opcionesFuente = [{ value: '', label: 'Todos los orígenes' }, ...(Object.keys(FUENTES) as FuenteCrm[]).map(c => ({ value: c, label: FUENTES[c] }))];
  const opcionesEtiqueta = [{ value: '', label: 'Todas las etiquetas' }, ...crm.etiquetasUsadas.map(e => ({ value: e, label: e }))];

  const hayContactos = crm.leads.length > 0;

  return (
    <div className="tv-stack">
      <div className="crm-barra">
        <label className="crm-busca">
          <Search className="w-4 h-4 flex-none" aria-hidden="true" />
          <input type="search" className="tv-input" value={texto} onChange={e => setTexto(e.target.value)}
            placeholder="Buscar por nombre, correo, teléfono o etiqueta" aria-label="Buscar contactos" />
        </label>
        <Btn icon={Filter} onClick={() => setFiltrosAbiertos(v => !v)} aria-expanded={filtrosAbiertos}>
          {activos ? `Filtros (${activos})` : 'Filtros'}
        </Btn>
      </div>

      {filtrosAbiertos && (
        <Card>
          <div className="crm-filtros">
            <CustomSelect value={filtros.responsable} onChange={v => setFiltros(f => ({ ...f, responsable: v }))} options={opcionesResponsable} />
            <CustomSelect value={filtros.canal} onChange={v => setFiltros(f => ({ ...f, canal: v as Filtros['canal'] }))} options={opcionesCanal} />
            <CustomSelect value={filtros.fuente} onChange={v => setFiltros(f => ({ ...f, fuente: v as Filtros['fuente'] }))} options={opcionesFuente} />
            <CustomSelect value={filtros.etiqueta} onChange={v => setFiltros(f => ({ ...f, etiqueta: v }))} options={opcionesEtiqueta} />
          </div>
          <div className="crm-filtros-pie">
            <label className="crm-check"><input type="checkbox" checked={filtros.soloVencidos} onChange={e => setFiltros(f => ({ ...f, soloVencidos: e.target.checked }))} />
              <span className="tv-1l">Solo con seguimiento vencido</span></label>
            <label className="crm-check"><input type="checkbox" checked={filtros.archivados} onChange={e => setFiltros(f => ({ ...f, archivados: e.target.checked }))} />
              <span className="tv-1l">Ver archivados</span></label>
            {activos > 0 && <Btn variant="ghost" onClick={() => setFiltros(SIN_FILTROS)}>Quitar filtros</Btn>}
          </div>
        </Card>
      )}

      {!hayContactos ? (
        <Card>
          <Empty icon={Users} title="Todavía no hay contactos"
            text="Llegan solos: cada chat de la página, registro de cliente, pedido o equipo del taller crea su contacto. También podés agregar uno a mano."
            action={<Btn variant="primary" onClick={onNuevo}>Nuevo contacto</Btn>} />
        </Card>
      ) : (
        <>
          <div className="crm-etapas-tab" role="tablist" aria-label="Etapas del embudo">
            {columnas.map(c => {
              const Icono = ICONO_ETAPA[c.info.id];
              return (
                <button key={c.info.id} type="button" role="tab" aria-selected={etapaMovil === c.info.id} className="crm-etapa-tab" onClick={() => setEtapaMovil(c.info.id)}>
                  <Icono className="w-3.5 h-3.5 flex-none" aria-hidden="true" />
                  <span className="tv-1l">{c.info.corto}</span>
                  <span className="crm-n">{c.leads.length}</span>
                </button>
              );
            })}
          </div>

          <div className="crm-tablero">
            {columnas.map(c => {
              const Icono = ICONO_ETAPA[c.info.id];
              const limite = limites[c.info.id] || POR_COLUMNA;
              return (
                <section key={c.info.id} className="crm-col" data-activa={etapaMovil === c.info.id} data-sobre={sobre === c.info.id || undefined}
                  onDragOver={e => { e.preventDefault(); if (sobre !== c.info.id) setSobre(c.info.id); }}
                  onDragLeave={() => setSobre(s => (s === c.info.id ? null : s))}
                  onDrop={e => soltar(e, c.info.id)} aria-label={c.info.label}>
                  <header className="crm-col-cab" title={c.info.ayuda}>
                    <Icono className="w-4 h-4 flex-none" aria-hidden="true" />
                    <span className="crm-col-t tv-1l">{c.info.label}</span>
                    <span className="crm-n">{c.leads.length}</span>
                  </header>
                  {c.valor > 0 && <div className="crm-col-valor tv-1l">{colones(c.valor)} en juego</div>}
                  <div className="crm-col-lista">
                    {c.leads.slice(0, limite).map(l => (
                      <Fragment key={l.id}>
                        <TarjetaContacto l={l} ahora={crm.ahora} siguiente={c.siguiente} onAbrir={onAbrir}
                          onMover={(id, etapa) => void crm.mover(id, etapa)} onArrastrar={arrastrar} arrastrando={arrastrando === l.id} />
                      </Fragment>
                    ))}
                    {c.leads.length === 0 && <p className="crm-col-vacio">{activos || texto ? 'Nada con esos filtros.' : 'Sin contactos en esta etapa.'}</p>}
                    {c.leads.length > limite && (
                      <Btn variant="ghost" onClick={() => setLimites(m => ({ ...m, [c.info.id]: limite + POR_COLUMNA }))}>Mostrar {Math.min(POR_COLUMNA, c.leads.length - limite)} más</Btn>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
