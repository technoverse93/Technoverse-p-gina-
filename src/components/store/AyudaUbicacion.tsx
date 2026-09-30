// =====================================================================
// AYUDA CUANDO LA UBICACIÓN ESTÁ BLOQUEADA
// =====================================================================
// Si la persona ya rechazó el permiso una vez, el navegador no vuelve a
// preguntar: la única salida es reactivarlo en los ajustes. Esto muestra los
// pasos para SU aparato (APK, Chrome, Samsung, iPhone, PC) y un botón para
// reintentar. Además, si el navegador avisa que el permiso volvió a quedar
// activo, reintenta solo, sin que tenga que tocar nada.
// =====================================================================

import { useEffect, useRef } from 'react';
import { alCambiarPermisoUbicacion, pasosParaReactivarUbicacion, type MotivoUbicacion } from '../../utils/ubicacionCliente';

interface Props {
  motivo: MotivoUbicacion | null;
  onReintentar: () => void;
  /** 'oscuro' para el pie de página (fondo oscuro fijo); 'tema' para el checkout. */
  tono?: 'oscuro' | 'tema';
}

export default function AyudaUbicacion({ motivo, onReintentar, tono = 'tema' }: Props) {
  const { titulo, pasos } = pasosParaReactivarUbicacion(motivo);
  const reintentarRef = useRef(onReintentar);
  reintentarRef.current = onReintentar;

  // Reintento automático al reactivar el permiso en los ajustes.
  useEffect(() => alCambiarPermisoUbicacion(estado => {
    if (estado === 'granted' || estado === 'prompt') reintentarRef.current();
  }), []);

  const oscuro = tono === 'oscuro';
  return (
    <div
      role="status"
      className={`mt-2 rounded-lg p-2.5 text-[11.5px] leading-relaxed ${oscuro ? '' : 'border border-[var(--border-color)] bg-[var(--bg-sunken)] text-[var(--text-secondary)]'}`}
      style={oscuro ? { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', color: '#A7AFBD' } : undefined}
    >
      <p className={`font-bold mb-1 ${oscuro ? '' : 'text-[var(--text-primary)]'}`} style={oscuro ? { color: '#E6EDE9' } : undefined}>
        {titulo}
      </p>
      <ol className="list-decimal pl-4 space-y-0.5">
        {pasos.map(p => <li key={p}>{p}</li>)}
      </ol>
      <button
        type="button"
        onClick={onReintentar}
        className="mt-2 inline-flex items-center rounded-lg px-3 py-1.5 text-[12px] font-bold"
        style={{ background: '#0F766E', color: '#FFFFFF' }}
      >
        {motivo === 'denegada' ? 'Ya lo activé' : 'Intentar de nuevo'}
      </button>
    </div>
  );
}
