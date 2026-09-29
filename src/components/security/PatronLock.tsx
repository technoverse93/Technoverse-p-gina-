import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Cuadrícula de 9 puntos para dibujar un patrón, como el del bloqueo de
 * Android.
 *
 * El patrón sale de aquí codificado como los índices tocados en orden y
 * separados por guion ("0-3-4-5-8"), que es exactamente el formato que
 * valida `motivoSecretoInvalido` en desbloqueoLocal.ts.
 *
 * ---------------------------------------------------------------------
 * POR QUÉ EVENTOS DE PUNTERO Y NO DE RATÓN O DE TOQUE
 * ---------------------------------------------------------------------
 * `pointerdown/move/up` cubre dedo, ratón y lápiz con UN solo camino. Con
 * `touchstart/mousedown` por separado habría que duplicar toda la lógica
 * y, peor, en un teléfono llegan LOS DOS (el navegador emula los de ratón
 * después de los de toque), lo que dispararía el trazo dos veces.
 *
 * `touch-action: none` en el contenedor es imprescindible y no es
 * decorativo: sin eso, arrastrar el dedo para dibujar hace que la página
 * haga scroll y el trazo se corta a la mitad. Con él, el gesto pertenece
 * a esta cuadrícula.
 *
 * `setPointerCapture` mantiene el trazo vivo aunque el dedo se salga del
 * recuadro: si no, soltar por fuera dejaría el patrón a medio dibujar sin
 * emitir nada ni limpiarse.
 */

interface Props {
  /** Se llama al levantar el dedo, con el patrón dibujado. */
  onCompleto: (patron: string) => void;
  /** Bloquea el dibujo (mientras se verifica, o durante una espera por intentos). */
  disabled?: boolean;
  /** Pinta el trazo en rojo tras un intento fallido. */
  error?: boolean;
  /** Etiqueta accesible del gesto. */
  ariaLabel?: string;
}

/** Centro de cada punto en el sistema de coordenadas del SVG (0-100). */
const CENTROS = Array.from({ length: 9 }, (_, i) => ({
  x: 16.67 + (i % 3) * 33.33,
  y: 16.67 + Math.floor(i / 3) * 33.33,
}));

/** Radio de acierto, en unidades del SVG. Generoso a propósito: con el dedo no se apunta fino. */
const RADIO_ACIERTO = 14;

export default function PatronLock({ onCompleto, disabled, error, ariaLabel }: Props) {
  const [ruta, setRuta] = useState<number[]>([]);
  const [punta, setPunta] = useState<{ x: number; y: number } | null>(null);
  const dibujando = useRef(false);
  const contenedor = useRef<HTMLDivElement>(null);
  // La ruta se lee dentro de manejadores que no se vuelven a crear en
  // cada render; un ref evita depender del valor capturado por el cierre.
  const rutaRef = useRef<number[]>([]);

  useEffect(() => { rutaRef.current = ruta; }, [ruta]);

  /** Convierte la posición del puntero a coordenadas del SVG (0-100). */
  const aCoordenadas = useCallback((e: React.PointerEvent): { x: number; y: number } | null => {
    const caja = contenedor.current?.getBoundingClientRect();
    if (!caja || !caja.width || !caja.height) return null;
    return {
      x: ((e.clientX - caja.left) / caja.width) * 100,
      y: ((e.clientY - caja.top) / caja.height) * 100,
    };
  }, []);

  const puntoBajo = (p: { x: number; y: number }): number | null => {
    for (let i = 0; i < CENTROS.length; i++) {
      const dx = p.x - CENTROS[i].x;
      const dy = p.y - CENTROS[i].y;
      if (Math.hypot(dx, dy) <= RADIO_ACIERTO) return i;
    }
    return null;
  };

  const agregarSiToca = (p: { x: number; y: number }) => {
    const indice = puntoBajo(p);
    if (indice === null) return;
    if (rutaRef.current.includes(indice)) return;   // no se repiten puntos
    setRuta(prev => [...prev, indice]);
  };

  const alBajar = (e: React.PointerEvent) => {
    if (disabled) return;
    const p = aCoordenadas(e);
    if (!p) return;
    dibujando.current = true;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* sin captura el trazo aún funciona dentro del recuadro */ }
    setRuta([]);
    rutaRef.current = [];
    setPunta(p);
    agregarSiToca(p);
  };

  const alMover = (e: React.PointerEvent) => {
    if (!dibujando.current || disabled) return;
    const p = aCoordenadas(e);
    if (!p) return;
    setPunta(p);
    agregarSiToca(p);
  };

  const alSoltar = () => {
    if (!dibujando.current) return;
    dibujando.current = false;
    setPunta(null);
    const dibujado = rutaRef.current;
    if (dibujado.length > 0) onCompleto(dibujado.join('-'));
    // La ruta se limpia enseguida: quien llama decide qué hacer con el
    // patrón, y dejarlo pintado mientras tanto sugeriría que sigue activo.
    setRuta([]);
    rutaRef.current = [];
  };

  const colorTrazo = error ? '#E5484D' : 'var(--accent)';

  return (
    <div
      ref={contenedor}
      role="application"
      aria-label={ariaLabel || 'Dibuje su patrón de desbloqueo'}
      onPointerDown={alBajar}
      onPointerMove={alMover}
      onPointerUp={alSoltar}
      onPointerCancel={alSoltar}
      className={`relative mx-auto aspect-square w-full max-w-[260px] select-none rounded-2xl border border-[var(--border-color)] bg-[var(--bg-base)] ${
        disabled ? 'opacity-50' : ''
      }`}
      style={{ touchAction: 'none' }}
    >
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden="true">
        {/* Trazo entre los puntos ya unidos */}
        {ruta.length > 1 && (
          <polyline
            points={ruta.map(i => `${CENTROS[i].x},${CENTROS[i].y}`).join(' ')}
            fill="none"
            stroke={colorTrazo}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {/* Tramo suelto que sigue al dedo */}
        {ruta.length > 0 && punta && (
          <line
            x1={CENTROS[ruta[ruta.length - 1]].x}
            y1={CENTROS[ruta[ruta.length - 1]].y}
            x2={punta.x}
            y2={punta.y}
            stroke={colorTrazo}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        )}
        {CENTROS.map((c, i) => {
          const tocado = ruta.includes(i);
          return (
            <g key={i}>
              <circle cx={c.x} cy={c.y} r="9" fill="transparent" />
              <circle
                cx={c.x}
                cy={c.y}
                r={tocado ? 5.5 : 4}
                fill={tocado ? colorTrazo : 'var(--text-muted, #9aa0a6)'}
                opacity={tocado ? 1 : 0.5}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
