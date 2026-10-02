import React from 'react';

// Glifos propios de Ciberseguridad: dos tonos (relleno suave + trazo).
// No se usan en ningún otro módulo, a propósito: cada apartado tiene su
// propia forma y su propio ícono, para que no se confundan entre sí.
const G: Record<string, [React.ReactNode, React.ReactNode]> = {
  pulso: [<><circle cx="12" cy="12" r="8"/></>, <><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/><path d="M12 12l5-5"/></>],
  libro: [<><rect x="5" y="3" width="14" height="18" rx="3"/></>, <><rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 8h6M9 12h6M9 16h3"/></>],
  cred: [<><rect x="3" y="5" width="18" height="14" rx="4"/></>, <><rect x="3" y="5" width="18" height="14" rx="4"/><circle cx="9" cy="11" r="2"/><path d="M6.5 16c.6-1.6 4.4-1.6 5 0M14 10h4M14 14h3"/></>],
  cuenta: [<><path d="M7 3h10v4l-4 5 4 5v4H7v-4l4-5-4-5z"/></>, <><path d="M7 3h10M7 21h10M8 3v4l4 5-4 5v4M16 3v4l-4 5 4 5v4"/></>],
  pase: [<><path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z"/></>, <><path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z"/><path d="M9 7v10" strokeDasharray="1.5 2.5"/></>],
  boveda: [<><circle cx="12" cy="12" r="9"/></>, <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></>],
  diario: [<><path d="M6 3h11a2 2 0 0 1 2 2v16H8a2 2 0 0 1-2-2z"/></>, <><path d="M6 19V3M6 19a2 2 0 0 1 2-2h11M10 8h5"/></>],
  dir: [<><circle cx="9" cy="9" r="4"/></>, <><circle cx="9" cy="9" r="4"/><path d="M2.5 20c.8-3.4 3.4-5 6.5-5s5.7 1.6 6.5 5M16 6.5a3 3 0 0 1 0 5M18 15c1.8.600 2.8 2.2 3.2 4.5"/></>],
  exp: [<><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></>, <><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M10 12l4 4M14 12l-4 4"/></>],
  etq: [<><path d="M4 6a2 2 0 0 1 2-2h7l7 8-7 8H6a2 2 0 0 1-2-2z"/></>, <><path d="M4 6a2 2 0 0 1 2-2h7l7 8-7 8H6a2 2 0 0 1-2-2z"/><circle cx="8" cy="9" r="1.2"/></>],
  ok: [<><circle cx="12" cy="12" r="9"/></>, <><path d="M8 12.5l2.8 2.8L16 9.5"/></>],
  alerta: [<><path d="M12 3l10 18H2z"/></>, <><path d="M12 10v4.5M12 17.5h.01"/></>],
  prohibido: [<><path d="M8 3h8l5 5v8l-5 5H8l-5-5V8z"/></>, <><path d="M8 3h8l5 5v8l-5 5H8l-5-5V8z"/><path d="M8 8l8 8"/></>],
  cel: [<><rect x="7" y="2.5" width="10" height="19" rx="3"/></>, <><rect x="7" y="2.5" width="10" height="19" rx="3"/><path d="M10.5 18.5h3"/></>],
  pc: [<><rect x="3" y="4" width="18" height="12" rx="3"/></>, <><rect x="3" y="4" width="18" height="12" rx="3"/><path d="M8 20h8M12 16v4"/></>],
  papelera: [<><path d="M6 7h12l-1 13H7z"/></>, <><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></>],
  mas: [<><circle cx="12" cy="12" r="9"/></>, <><path d="M12 8v8M8 12h8"/></>],
  refrescar: [<><circle cx="12" cy="12" r="8"/></>, <><path d="M5 12a7 7 0 0 1 12-4.5l2-1.5v5h-5l2-1.5a5 5 0 1 0 1 5"/></>],
  lupa: [<><circle cx="11" cy="11" r="6"/></>, <><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></>],
  cerrar: [<><circle cx="12" cy="12" r="9"/></>, <><path d="M9 9l6 6M15 9l-6 6"/></>],
  candado: [<><rect x="5" y="10" width="14" height="10" rx="3"/></>, <><rect x="5" y="10" width="14" height="10" rx="3"/><path d="M8 10V8a4 4 0 0 1 8 0v2"/></>],
  abierto: [<><rect x="5" y="10" width="14" height="10" rx="3"/></>, <><rect x="5" y="10" width="14" height="10" rx="3"/><path d="M8 10V8a4 4 0 0 1 7.5-2"/></>],
  info: [<><circle cx="12" cy="12" r="9"/></>, <><path d="M12 11v5.5M12 7.5h.01"/></>],
  lugar: [<><path d="M12 21s7-5.5 7-11a7 7 0 0 0-14 0c0 5.5 7 11 7 11z"/></>, <><path d="M12 21s7-5.5 7-11a7 7 0 0 0-14 0c0 5.5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></>],
  huella: [<><path d="M12 3a7 7 0 0 0-7 7v3a6 6 0 0 0 1 3.5l1.5 2.5h9L18 16.5a6 6 0 0 0 1-3.5v-3a7 7 0 0 0-7-7z"/></>, <><path d="M8.5 10a3.5 3.5 0 0 1 7 0v3M12 10v6M9 14v1.5M15 13v3.5"/></>],
  escudo: [<><path d="M12 3l8 3v6c0 4.5-3.5 7.5-8 9-4.5-1.5-8-4.5-8-9V6z"/></>, <><path d="M12 3l8 3v6c0 4.5-3.5 7.5-8 9-4.5-1.5-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/></>],
  reloj: [<><circle cx="12" cy="12" r="9"/></>, <><path d="M12 7v5l3.5 2"/></>],
  grid: [<><rect x="3" y="3" width="8" height="8" rx="2.5"/></>, <><rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/></>],
  pulsoh: [<><path d="M3 12h4l2.5-6 4 12 2.5-6H21"/></>, <><path d="M3 12h4l2.5-6 4 12 2.5-6H21"/></>],
  pantalla: [<><rect x="3" y="5" width="18" height="12" rx="3"/></>, <><rect x="3" y="5" width="18" height="12" rx="3"/><path d="M8 21h8"/></>],
};

export type NombreGlifo = keyof typeof G;

export function Glifo({ n, className = '' }: { n: string; className?: string }) {
  const g = G[n];
  if (!g) return null;
  return (
    <svg className={`sg-gl ${className}`} viewBox="0 0 24 24" aria-hidden="true">
      <g className="sg-f">{g[0]}</g>
      <g className="sg-s">{g[1]}</g>
    </svg>
  );
}
