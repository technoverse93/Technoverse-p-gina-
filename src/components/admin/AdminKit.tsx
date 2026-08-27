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
import type { LucideIcon } from 'lucide-react';

// ---------------------------------------------------------------------
// ENCABEZADO DE PANTALLA
// ---------------------------------------------------------------------

export function PageHead({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="tv-page-head">
      <div className="min-w-0">
        <h1 className="tv-page-title">{title}</h1>
        {subtitle && <p className="tv-page-sub">{subtitle}</p>}
      </div>
      {actions && <div className="tv-row">{actions}</div>}
    </div>
  );
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
