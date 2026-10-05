// =====================================================================
// JARVIS · piezas del lenguaje visual (diseño aprobado «Sistema visual de
// Jarvis»): el orbe —una constelación chiquita del cerebro con señales que
// viajan—, el «pensando» de tres neuronas y el color de cada área.
// Todo el color sale de los tokens --jv-* de admin.css (claro y oscuro).
// =====================================================================

import React from 'react';

/** Área (constelación) de cada módulo: da el color del punto de las señales. */
export type Area = 'neg' | 'dis' | 'tal' | 'int' | 'vos';
const AREA_DE: Record<string, Area> = {
  Inventario: 'dis', Productos: 'dis', 'Facturación': 'neg', Finanzas: 'neg', Ventas: 'neg', Cobros: 'neg', Ingresos: 'neg',
  Taller: 'tal', Agenda: 'tal', Chat: 'vos', Memoria: 'vos', Ciberseguridad: 'vos', 'Errores del sistema': 'vos', Seguridad: 'vos', Sesiones: 'vos',
  Internet: 'int', Enlace: 'int', 'Código': 'int', Cerebro: 'int', Panel: 'neg',
};
export const areaDe = (modulo?: string | null): Area => AREA_DE[String(modulo || '')] || 'neg';

/** Saludo según la hora de Costa Rica. */
export function saludo(): string {
  const h = Number(new Intl.DateTimeFormat('es-CR', { hour: 'numeric', hour12: false, timeZone: 'America/Costa_Rica' }).format(new Date()));
  return h < 12 ? 'BUENOS DÍAS' : h < 19 ? 'BUENAS TARDES' : 'BUENAS NOCHES';
}

/** Logo vivo de Jarvis: 5 neuronas, fibras curvas y dos señales. */
export const Orbe = React.memo(function Orbe({ tam = 30, className = '' }: { tam?: number; className?: string }) {
  return (
    <svg className={`jv-orbe ${className}`} viewBox="0 0 100 100" width={tam} height={tam} aria-hidden="true" focusable="false">
      <path className="f" d="M50 50C38 40 30 30 24 22M50 50C62 44 70 36 78 26M50 50C48 64 40 72 30 78M50 50C62 60 72 66 80 74M24 22C40 14 60 14 78 26" />
      <path className="p" d="M24 22C40 14 60 14 78 26C70 36 62 44 50 50C48 64 40 72 30 78" />
      <path className="p b" d="M80 74C72 66 62 60 50 50C38 40 30 30 24 22" />
      <circle cx="24" cy="22" r="4" /><circle cx="78" cy="26" r="4.5" /><circle cx="30" cy="78" r="3.5" /><circle cx="80" cy="74" r="4" />
      <circle className="c" cx="50" cy="50" r="6" />
    </svg>
  );
});

/** «Pensando»: una señal que viaja entre tres neuronas. */
export function Pensando({ texto }: { texto: string }) {
  return (
    <div className="jv-pensando" role="status">
      <svg viewBox="0 0 46 16" aria-hidden="true">
        <path d="M4 8C14 1 20 15 23 8S34 1 42 8" />
        <path className="s" d="M4 8C14 1 20 15 23 8S34 1 42 8" />
        <circle cx="4" cy="8" r="2.6" /><circle cx="23" cy="8" r="2.6" /><circle cx="42" cy="8" r="2.6" />
      </svg>
      <span>{texto}</span>
    </div>
  );
}

/** Ícono de constelación (botón «Cerebro» de la cabecera). */
export function IconoConstelacion({ className = 'w-[18px] h-[18px]' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="6" cy="7" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="12" cy="17" r="2" />
      <path d="M8 7.5c3 0 5-1.5 8-1.5M7 9c1 4 3 6 4 6.5M17 8c-.5 4-2.5 6.5-3.5 7.5" />
    </svg>
  );
}
