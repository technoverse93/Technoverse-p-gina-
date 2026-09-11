// =====================================================================
// MODO EDICIÓN (lapicito) — el interruptor global del CMS en contexto
// =====================================================================
// Un administrador autenticado ve un botón de lápiz flotante. Al
// activarlo, los textos marcados con <TextoEditable> se vuelven
// editables en el mismo lugar donde se muestran. A un cliente no le
// aparece nada: `puedeEditar` llega en `false` y el contexto queda inerte.
// =====================================================================

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Pencil, Check } from 'lucide-react';
import { cargarContenido } from '../utils/contenidoSitio';

interface EstadoModoEdicion {
  /** true solo si está activado Y la persona puede editar. */
  activo: boolean;
  /** ¿Esta persona tiene permiso de editar el sitio? */
  puedeEditar: boolean;
  /** Quién edita (correo), para la auditoría del guardado. */
  quien: string | null;
  alternar: () => void;
}

const Contexto = createContext<EstadoModoEdicion>({
  activo: false,
  puedeEditar: false,
  quien: null,
  alternar: () => {},
});

export function useModoEdicion(): EstadoModoEdicion {
  return useContext(Contexto);
}

export function ModoEdicionProvider({
  puedeEditar,
  quien,
  children,
}: {
  puedeEditar: boolean;
  quien?: string | null;
  children: ReactNode;
}) {
  const [activo, setActivo] = useState(false);

  // Al montar (o al ganar permiso) se trae el contenido guardado, para que
  // los textos ya salgan con lo último editado y no con el default.
  useEffect(() => { void cargarContenido(); }, []);

  // Si la persona pierde el permiso (cierra sesión), se apaga el modo.
  useEffect(() => { if (!puedeEditar) setActivo(false); }, [puedeEditar]);

  const valor: EstadoModoEdicion = {
    activo: activo && puedeEditar,
    puedeEditar,
    quien: quien || null,
    alternar: () => setActivo(a => !a),
  };

  return (
    <Contexto.Provider value={valor}>
      {children}
      {puedeEditar && <BotonModoEdicion />}
    </Contexto.Provider>
  );
}

/** El lápiz flotante. Solo se monta si la persona puede editar. */
function BotonModoEdicion() {
  const { activo, alternar } = useModoEdicion();
  return (
    <button
      type="button"
      onClick={alternar}
      aria-pressed={activo}
      title={activo ? 'Terminar de editar' : 'Editar la página'}
      className="fixed z-[900] bottom-5 right-5 flex items-center gap-2 rounded-full px-4 py-3 shadow-lg font-bold text-[13px] transition"
      style={{
        background: activo ? 'var(--accent)' : 'var(--bg-elevated)',
        color: activo ? 'var(--accent-ink, #fff)' : 'var(--text-primary)',
        border: '1px solid var(--border-color)',
      }}
    >
      {activo ? <Check className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
      {activo ? 'Listo' : 'Editar'}
    </button>
  );
}
