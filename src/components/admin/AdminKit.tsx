// =====================================================================
// PIEZAS DE INTERFAZ DE LA CONSOLA
// =====================================================================
// Los ladrillos con los que se arma cualquier pantalla del panel:
// encabezado, tarjeta, métrica, tabla, estado vacío, botón y campo.
//
// ---------------------------------------------------------------------
// PARA QUÉ SIRVE ESTO
// ---------------------------------------------------------------------
// El panel anterior no tenía piezas: cada pantalla escribía sus propias
// cajas con utilidades sueltas. El resultado era que la misma cosa —una
// tarjeta— tenía cinco radios de borde distintos, cuatro paddings y tres
// tamaños de título según quién la hubiera escrito. Esa incoherencia es
// la mitad de la sensación de "anticuado y desproporcionado": no es que
// cada pieza esté mal, es que no se parecen entre sí.
//
// Con estas piezas, cambiar el aspecto de TODAS las tarjetas del panel
// es cambiar un archivo, y una pantalla nueva sale alineada con el
// resto sin que nadie tenga que acordarse de los valores.
// =====================================================================

import React from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';

// =====================================================================
// PUENTES HACIA LA REGLETA
// =====================================================================
// En el modelo "Regleta y Carpetas" el nombre del módulo, sus acciones y
// sus carpetas viven en la regleta —la franja fina de arriba— y no
// dentro de cada pantalla. Pero quien SABE qué acciones y qué carpetas
// tiene una pantalla es la pantalla misma, no el armazón.
//
// El puente son portales y no un contexto con estado, a propósito: unas
// acciones son `ReactNode` que cambian de identidad en cada render, así
// que guardarlas en el estado del armazón provocaría un `setState` por
// render y un bucle infinito. Un portal vuelve a renderizar sus hijos
// sin tocar ningún estado.
// ---------------------------------------------------------------------

/**
 * Resuelve el nodo destino de un portal DESPUÉS del montaje.
 *
 * El efecto corre en cada render y no una sola vez porque el destino
 * cambia al cambiar de módulo (el armazón lo vuelve a montar). El
 * `setNodo` compara antes de escribir, así que un render extra no
 * dispara otro render.
 */
/**
 * Si la pestaña que contiene a este componente es la que se está viendo.
 *
 * ---------------------------------------------------------------------
 * POR QUÉ HACE FALTA
 * ---------------------------------------------------------------------
 * Con pestañas, los módulos de las pestañas de fondo siguen MONTADOS —de
 * eso se trata: es lo que conserva un cobro a medio llenar—. Pero seguir
 * montado significa que sus portales seguían escribiendo: la regleta
 * acababa con las acciones de Cobros y las de Inventario juntas, y la
 * línea de pista mostraba los dos subtítulos pegados uno detrás de otro.
 *
 * El armazón envuelve cada pestaña con este contexto, y los portales de
 * las pestañas de fondo no se abren. Por defecto es `true` para que
 * cualquier pantalla usada fuera de una pestaña siga funcionando igual.
 */
export const ContextoPestanaActiva = React.createContext(true);

function usePortalEn(id: string): HTMLElement | null {
  const activa = React.useContext(ContextoPestanaActiva);
  const [nodo, setNodo] = React.useState<HTMLElement | null>(null);
  React.useEffect(() => {
    const encontrado =
      activa && typeof document !== 'undefined' ? document.getElementById(id) : null;
    setNodo(prev => (prev === encontrado ? prev : encontrado));
  });
  return activa ? nodo : null;
}

// ---------------------------------------------------------------------
// ENCABEZADO DE PANTALLA
// ---------------------------------------------------------------------

/**
 * Ya NO dibuja un bloque de título.
 *
 * Antes pintaba un título de 23px, un subtítulo y una fila de acciones:
 * entre 60 y 85 px de alto en cada módulo para repetir el nombre que la
 * miga de pan ya decía justo encima. Medido sobre el panel real, esa
 * repetición era una de las cinco capas que dejaban el contenido de
 * Inventario empezando a los 330 px.
 *
 * Ahora reparte lo suyo donde corresponde: el nombre lo pone la regleta
 * a partir del módulo activo, las acciones viajan a la regleta y el
 * subtítulo —que sí aporta, porque explica qué se hace en la pantalla—
 * queda como una línea fina de pista bajo las carpetas.
 *
 * Se conserva la misma firma para no tener que tocar ni un solo sitio
 * de llamada.
 */
export function PageHead({
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  const destinoAcciones = usePortalEn('tv-regleta-acciones');
  const destinoPista = usePortalEn('tv-pista-slot');

  return (
    <>
      {actions && destinoAcciones ? createPortal(<div className="tv-row">{actions}</div>, destinoAcciones) : null}
      {subtitle && destinoPista ? createPortal(<>{subtitle}</>, destinoPista) : null}
    </>
  );
}

// ---------------------------------------------------------------------
// CARPETAS
// ---------------------------------------------------------------------

export interface CarpetaUI {
  id: string;
  label: string;
  icon?: LucideIcon;
  /** Se dibuja como número al lado del nombre. Un 0 no se dibuja. */
  contador?: number;
  /** Carpetas con distinto `grupo` quedan separadas por una línea. */
  grupo?: string;
}

/**
 * La fila de carpetas del módulo activo.
 *
 * Se renderiza SIEMPRE en la regleta, aunque la llame una pantalla que
 * está dentro del contenido: así hay una única fila de sub-navegación en
 * todo el panel y en un único sitio. Ese es el fallo que este modelo
 * corrige — en el panel medido, Inventario dibujaba sus cinco vistas en
 * el menú de arriba Y otra vez como pestañas propias.
 */
export function Carpetas({
  items,
  activa,
  onElegir,
}: {
  items: CarpetaUI[];
  activa: string;
  onElegir: (id: string) => void;
}) {
  const destino = usePortalEn('tv-carpetas-slot');
  if (!destino || items.length === 0) return null;

  const fila = (
    <div className="tv-folders" role="tablist" aria-label="Vistas del módulo">
      {items.map((c, i) => {
        const Icono = c.icon;
        const nuevoGrupo = i > 0 && c.grupo && c.grupo !== items[i - 1].grupo;
        return (
          <React.Fragment key={c.id}>
            {nuevoGrupo && <span className="tv-folder-sep" aria-hidden="true" />}
            <button
              type="button"
              role="tab"
              aria-selected={c.id === activa}
              className="tv-folder"
              data-active={c.id === activa || undefined}
              onClick={() => onElegir(c.id)}
            >
              {Icono && <Icono className="w-[13px] h-[13px] flex-shrink-0" aria-hidden="true" />}
              <span className="tv-folder-label">{c.label}</span>
              {typeof c.contador === 'number' && c.contador > 0 && (
                <span className="tv-folder-count">{c.contador}</span>
              )}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );

  return createPortal(fila, destino);
}

// ---------------------------------------------------------------------
// TARJETA
// ---------------------------------------------------------------------

export function Card({
  title,
  actions,
  children,
  padded = true,
  className = '',
}: {
  title?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  /** `false` cuando el contenido es una tabla, que trae su propio aire. */
  padded?: boolean;
  className?: string;
}) {
  return (
    <section className={`tv-card ${className}`}>
      {(title || actions) && (
        <header className="tv-card-head">
          {title && <span className="tv-card-title">{title}</span>}
          {actions && <div className="tv-row">{actions}</div>}
        </header>
      )}
      {padded ? <div className="tv-card-body">{children}</div> : children}
    </section>
  );
}

// ---------------------------------------------------------------------
// MÉTRICA
// ---------------------------------------------------------------------

export function Stat({
  label,
  value,
  foot,
  icon: Icon,
  alert = false,
}: {
  label: string;
  value: React.ReactNode;
  foot?: React.ReactNode;
  icon?: LucideIcon;
  /**
   * Marca la métrica en rojo. Se reserva para lo que exige que alguien
   * HAGA algo hoy; si todo se pinta de rojo, nada es urgente.
   */
  alert?: boolean;
}) {
  return (
    <div className="tv-card tv-stat" data-alert={alert || undefined}>
      <div className="tv-stat-label">
        {Icon && <Icon className="w-3.5 h-3.5" aria-hidden="true" />}
        {label}
      </div>
      <div className="tv-stat-value">{value}</div>
      {foot && <div className="tv-stat-foot">{foot}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------
// ETIQUETA DE ESTADO
// ---------------------------------------------------------------------

export function Chip({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: 'ok' | 'alert' | 'accent';
}) {
  return <span className="tv-chip" data-tone={tone}>{children}</span>;
}

// ---------------------------------------------------------------------
// BOTÓN
// ---------------------------------------------------------------------

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'default' | 'danger' | 'ghost';
  icon?: LucideIcon;
};

export function Btn({ variant = 'default', icon: Icon, children, className = '', ...rest }: BtnProps) {
  return (
    // El icono nunca se encoge; la etiqueta se recorta con puntos si no
    // cabe. Así el botón conserva su alto y su forma con cualquier texto,
    // en vez de estirarse hasta desbordar la fila que lo contiene.
    <button className={`tv-btn ${className}`} data-variant={variant} {...rest}>
      {Icon && <Icon className="w-4 h-4 flex-shrink-0" aria-hidden="true" />}
      <span className="tv-btn-label">{children}</span>
    </button>
  );
}

// ---------------------------------------------------------------------
// CAMPO DE FORMULARIO
// ---------------------------------------------------------------------

export function Field({
  label,
  hint,
  children,
  className = '',
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`tv-field ${className}`}>
      <span className="tv-label">{label}</span>
      {children}
      {hint && <span className="tv-hint">{hint}</span>}
    </label>
  );
}

// ---------------------------------------------------------------------
// TABLA
// ---------------------------------------------------------------------

/**
 * Envoltorio de tabla.
 *
 * El scroll horizontal vive AQUÍ y no en la página: una tabla ancha
 * dentro de una tarjeta se desplaza sola, y el resto de la pantalla
 * queda quieto. Sin esto, en un teléfono la página entera se movía de
 * lado y el menú se salía de cuadro.
 */
export function TableShell({
  head,
  children,
}: {
  head: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="tv-table-wrap">
      <table className="tv-table">
        <thead><tr>{head}</tr></thead>
        {children}
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------
// ESTADO VACÍO
// ---------------------------------------------------------------------

/**
 * Qué se ve cuando todavía no hay datos.
 *
 * Importa más de lo que parece: una tabla vacía sin explicación se lee
 * como un error de carga, y alguien acaba recargando la página o
 * reportando un fallo que no existe.
 */
export function Empty({
  icon: Icon,
  title,
  text,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  text?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="tv-empty">
      {Icon && <Icon className="w-7 h-7 opacity-30" aria-hidden="true" />}
      <div className="tv-empty-title">{title}</div>
      {text && <p className="tv-empty-text">{text}</p>}
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------
// FORMATO
// ---------------------------------------------------------------------

/** Colones con separador de miles y sin decimales. */
export function colones(monto: number): string {
  return `₡${Math.round(monto || 0).toLocaleString('es-CR')}`;
}
