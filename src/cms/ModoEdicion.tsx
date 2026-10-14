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
import { cargarContenido, contenidoFresco, esperarContenido, hayContenidoLocal } from '../utils/contenidoSitio';

// Cuánto se espera, como máximo, el contenido editable antes de dibujar la
// tienda cuando NO vino con el HTML (servidor de desarrollo, la APK, o el
// Worker no alcanzó a leerlo). Con una copia guardada en el aparato basta un
// instante; sin nada, un poco más. Pasado el tope se dibuja igual.
const ESPERA_CON_COPIA_MS = 400;
const ESPERA_SIN_COPIA_MS = 1200;

/**
 * La misma pantalla de carga que trae index.html (mismo id y mismas clases),
 * para que esperar el contenido no se note como un cambio de pantalla.
 */
function PantallaDeCarga() {
  // Si la página ya lleva rato cargando, el aro sale de una vez (no repite
  // el retardo con el que index.html lo muestra).
  const yaTardo = typeof performance !== 'undefined' && performance.now() > 600;
  return (
    <div id="tv-arranque" role="status" aria-label="Cargando">
      <div className="tv-arranque-rueda" style={yaTardo ? { animationDelay: '0s, 0s' } : undefined} />
    </div>
  );
}

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

  // SIN PARPADEOS: el contenido editable tiene que estar ANTES del primer
  // dibujo. Si no, la tienda sale con los textos, el ícono y el color de
  // fábrica y a los pocos instantes cambia a lo que el dueño editó (así se
  // veía en el video del 2026-10-14). Normalmente ya está (llegó dentro del
  // HTML); si no, se espera un instante y, pasado el tope, se dibuja igual.
  const [listo, setListo] = useState(() => contenidoFresco());
  useEffect(() => {
    if (listo) {
      // Ya se dibujó con lo definitivo: solo se confirma contra la base (si
      // nada cambió, no se avisa a nadie y no se repinta nada).
      void cargarContenido();
      return;
    }
    let vivo = true;
    void esperarContenido(hayContenidoLocal() ? ESPERA_CON_COPIA_MS : ESPERA_SIN_COPIA_MS)
      .then(() => { if (vivo) setListo(true); });
    return () => { vivo = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Si la persona pierde el permiso (cierra sesión), se apaga el modo.
  useEffect(() => { if (!puedeEditar) setActivo(false); }, [puedeEditar]);

  if (!listo) return <PantallaDeCarga />;

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

/** El lápiz flotante. Solo se monta si la persona puede editar.
 *  Es un círculo de 44 px apilado ENCIMA del botón del chat de la tienda
 *  (misma columna: right-4 / sm:right-6, que está en bottom-5): antes era
 *  una pastilla «Editar» en la misma esquina y lo tapaba. Va bajo la
 *  ventana del chat (z-45) para no quedar encima de ella si se abre. */
function BotonModoEdicion() {
  const { activo, alternar } = useModoEdicion();
  const etiqueta = activo ? 'Terminar de editar' : 'Editar la página';
  return (
    <button
      type="button"
      onClick={alternar}
      aria-pressed={activo}
      aria-label={etiqueta}
      title={etiqueta}
      className="fixed z-[44] bottom-[76px] right-4 sm:right-6 w-11 h-11 rounded-[14px] grid place-items-center shadow-[var(--float-shadow-lg)] transition"
      style={{
        background: activo ? 'var(--accent)' : 'var(--bg-elevated)',
        color: activo ? 'var(--accent-ink, #fff)' : 'var(--text-primary)',
        border: '1px solid var(--border-color)',
      }}
    >
      {activo ? <Check className="w-5 h-5" /> : <Pencil className="w-5 h-5" />}
    </button>
  );
}
