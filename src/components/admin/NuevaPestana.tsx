// =====================================================================
// NUEVA PESTAÑA — el lanzador que reemplaza al modal del botón «+»
// =====================================================================
// Antes, tocar el «+» abría un recuadro flotante encima del contenido
// (`.tv-palette-backdrop`). Ahora abre una pestaña de verdad, en blanco,
// como la página de inicio de un navegador: esta pantalla es su
// contenido.
//
// ---------------------------------------------------------------------
// POR QUÉ AGRUPADA POR ZONA, Y POR QUÉ EN MÓVIL NO SE VE IGUAL
// ---------------------------------------------------------------------
// El negocio tiene cuatro áreas —General, Inventario, Operación,
// Administración— y agruparlas ayuda a encontrar un módulo sin haber
// memorizado los once nombres: "lo de cobros está en Administración" es
// más fácil de recordar que una posición suelta en una cuadrícula.
//
// La primera versión llevaba esa idea al teléfono tal cual: cuatro
// bloques con su propio borde y relleno, uno debajo del otro. Con once
// módulos repartidos en cuatro zonas eso eran casi dos pantallas de
// scroll antes de llegar a la última. En un teléfono sobra ancho para
// una cuadrícula de tres columnas y falta alto para cuatro cajas
// apiladas, así que ahí la zona deja de ser una CAJA con peso propio y
// pasa a ser una etiqueta fina — igual que ya agrupaba, sin campo de
// búsqueda, el selector que esta pantalla reemplaza. Los once módulos
// caen en una sola cuadrícula continua; lo único que marca dónde
// empieza cada zona es esa etiqueta. Ver el bloque `@media` en
// admin.css: es un solo árbol de HTML, `display:contents` en el envoltorio
// de zona es lo que deja que sus hijos se acomoden directo en la
// cuadrícula exterior sin que el navegador tenga que pintar dos veces.
//
// Ni aquí ni en el escritorio hay un color por zona. El panel entero
// reserva el color para "esto está activo" o "esto requiere acción"
// (ver `--tv-accent` en admin.css) desde que se midió que el panel
// anterior usaba cinco colores de énfasis a la vez y ninguno significaba
// nada — cuatro colores más, uno por zona, sería el mismo error otra vez.
// =====================================================================

import React, { useMemo, useState } from 'react';
import { Search, Lock } from 'lucide-react';
import { NAV_GROUPS } from './adminNav';
import { modulosFrecuentes } from './usePestanas';
import { resolverModulo } from './adminNav';

interface Props {
  /** Abre el módulo elegido, reemplazando esta pestaña. */
  onElegir: (tab: string) => void;
  /** Oculta los módulos marcados `soloAdminSupremo`. */
  esSupremo: boolean;
  /** Módulos con una pestaña abierta ahora mismo, para la marca "abierto". */
  abiertas: string[];
}

/** Sin tildes ni mayúsculas: «configuracion» encuentra «Configuración». */
const normal = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Diseño Cristal: buscador en píldora arriba (Enter abre el primero),
// frecuentes como baldosas de vidrio, y cada zona como una rejilla de
// tarjetas con su descripción. Los módulos exclusivos del superadmin
// llevan un candado: es la misma regla `soloAdminSupremo` de siempre, solo
// que ahora se ve.
function NuevaPestana({ onElegir, esSupremo, abiertas }: Props) {
  const frecuentes = useMemo(() => modulosFrecuentes(4).map(resolverModulo), []);
  const [q, setQ] = useState('');

  const zonas = useMemo(() => {
    const t = normal(q.trim());
    return NAV_GROUPS.map(g => ({
      titulo: g.titulo,
      items: g.items.filter(i => (!i.soloAdminSupremo || esSupremo) && (!t
        || normal(i.label).includes(t)
        || normal(i.descripcion || '').includes(t)
        || (i.buscar || []).some(b => normal(b).includes(t)))),
    })).filter(g => g.items.length > 0);
  }, [q, esSupremo]);
  const primero = zonas[0]?.items[0];

  return (
    <div className="tv-lz">
      <header className="tv-lz-cab">
        <h1 className="tv-lz-titulo">¿Qué abrimos?</h1>
        <label className="tv-lz-busca">
          <Search className="w-[18px] h-[18px] shrink-0" aria-hidden="true" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && primero) onElegir(primero.id); }}
            placeholder="Buscar: cobros, mapa, usuarios…"
            aria-label="Buscar un módulo"
            autoFocus
          />
        </label>
      </header>

      {!q && frecuentes.length > 0 && (
        <section className="tv-lz-sec">
          <div className="tv-lz-lbl">Frecuentes</div>
          <div className="tv-lz-frec">
            {frecuentes.map(m => (
              <button key={m.id} type="button" className="tv-lz-frec-b" onClick={() => onElegir(m.id)}>
                <span className="tv-lz-tile"><m.icon className="w-5 h-5" aria-hidden="true" /></span>
                <span>{m.label}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {zonas.length === 0 && (
        <p className="tv-lz-vacio">Ningún módulo coincide con «{q}».</p>
      )}

      {zonas.map(grupo => (
        <section className="tv-lz-sec" key={grupo.titulo}>
          <div className="tv-lz-lbl">{grupo.titulo}</div>
          <div className="tv-lz-grid">
            {grupo.items.map(item => {
              const abierto = abiertas.includes(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  className="tv-lz-card"
                  data-abierto={abierto || undefined}
                  onClick={() => onElegir(item.id)}
                  title={item.descripcion || item.label}
                >
                  <span className="tv-lz-tile"><item.icon className="w-5 h-5" aria-hidden="true" /></span>
                  <span className="tv-lz-tx">
                    <span className="tv-lz-n">
                      {item.label}
                      {item.soloAdminSupremo && <Lock className="w-3 h-3 tv-lz-lock" aria-label="Solo superadmin" />}
                    </span>
                    {item.descripcion && <span className="tv-lz-d">{item.descripcion}</span>}
                  </span>
                  {abierto && <span className="tv-lz-abierto">Abierto</span>}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

// Igual que el resto de contenidos de pestaña (`InventarioControl`,
// `TallerKanban`…): con `<Activity mode="hidden">` de por medio, sin
// `memo` este componente se volvía a ejecutar entero cada vez que el
// panel se repintaba por algo ajeno — un dato de otra pestaña llegando
// por Realtime, por ejemplo — aunque estuviera de fondo y sus props no
// hubieran cambiado.
export default React.memo(NuevaPestana);
