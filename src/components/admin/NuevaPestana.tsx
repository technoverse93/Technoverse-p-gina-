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

import React, { useMemo } from 'react';
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

function NuevaPestana({ onElegir, esSupremo, abiertas }: Props) {
  // Se calcula una sola vez al montar: si el uso cambia mientras esta
  // pestaña sigue abierta de fondo, la fila de frecuentes se pone al día
  // la próxima vez que se abra una «Nueva pestaña», no en caliente. Es
  // el mismo comportamiento que el accesos-directos de un navegador, que
  // tampoco se reordena solo mientras se lo mira.
  const frecuentes = useMemo(() => modulosFrecuentes(4).map(resolverModulo), []);

  return (
    <div className="tv-nueva">
      <h1 className="tv-nueva-titulo">Abrir un módulo</h1>

      {frecuentes.length > 0 && (
        <section className="tv-nueva-seccion">
          <div className="tv-nueva-lbl">Frecuentes</div>
          <div className="tv-nueva-frec-fila">
            {frecuentes.map(m => (
              <button
                key={m.id}
                type="button"
                className="tv-nueva-frec"
                onClick={() => onElegir(m.id)}
              >
                <span className="tv-nueva-circulo">
                  <m.icon className="w-5 h-5" aria-hidden="true" />
                </span>
                <span className="tv-nueva-frec-n">{m.label}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="tv-nueva-grid">
        {NAV_GROUPS.map(grupo => {
          const items = grupo.items.filter(i => !i.soloAdminSupremo || esSupremo);
          if (items.length === 0) return null;
          return (
            <div className="tv-nueva-zona" key={grupo.titulo}>
              <div className="tv-nueva-zona-cab">{grupo.titulo}</div>
              <div className="tv-nueva-zona-lista">
                {items.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    className="tv-nueva-item"
                    data-abierto={abiertas.includes(item.id) || undefined}
                    onClick={() => onElegir(item.id)}
                    title={item.label}
                  >
                    <span className="tv-nueva-ic">
                      <item.icon className="w-4 h-4" aria-hidden="true" />
                    </span>
                    <span className="tv-nueva-n">{item.label}</span>
                    {/* El punto no es un contador ni un aviso: es el mismo
                        estado de "ya abierto" que llevaba el selector
                        anterior, para que quede claro que tocarlo salta a
                        esa pestaña en vez de duplicarla. */}
                    {abiertas.includes(item.id) && (
                      <span className="tv-nueva-punto-abierto" aria-label="Ya abierto" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
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
