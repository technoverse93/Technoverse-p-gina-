// =====================================================================
// MAPA INTERNO — "Ver mapa" SIN salir de la aplicación
// =====================================================================
// Un modal con el mapa embebido (Leaflet + tiles de OpenStreetMap, lo mismo
// que ya usa el panel de Ubicaciones). Reemplaza a los enlaces que abrían
// Google Maps o una pestaña nueva: la posición compartida se ve DENTRO de la
// app, en pantalla, y se cierra con la X o el botón.
//
// Leaflet se carga por `import()` diferido: quien nunca abre un mapa no baja
// la librería. Los marcadores son círculos dibujados (no los PNG por
// defecto de Leaflet), así que no dependen de ningún archivo que la CSP
// pudiera bloquear.
// =====================================================================

import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
import { Modal } from './Overlays';

interface Props {
  abierto: boolean;
  onClose: () => void;
  lat: number;
  lon: number;
  /** Precisión en metros, si se conoce: dibuja el círculo de margen. */
  precisionM?: number | null;
  /** Título del modal. */
  titulo?: string;
  /** Texto bajo el mapa (dirección, provincia, quién compartió…). */
  etiqueta?: string;
}

export default function MapaModal({ abierto, onClose, lat, lon, precisionM, titulo = 'Ubicación en el mapa', etiqueta }: Props) {
  const contenedorRef = useRef<HTMLDivElement>(null);
  const mapaRef = useRef<any>(null);

  useEffect(() => {
    if (!abierto) return;
    let vivo = true;
    let obs: ResizeObserver | null = null;

    void (async () => {
      const L = (await import('leaflet')).default;
      if (!vivo || !contenedorRef.current || mapaRef.current) return;

      const centro: [number, number] = [lat, lon];
      const mapa = L.map(contenedorRef.current, { center: centro, zoom: 16, zoomControl: true, attributionControl: true });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(mapa);

      if (precisionM && precisionM > 0 && precisionM < 5000) {
        L.circle(centro, { radius: precisionM, color: '#0E6B4F', weight: 1, opacity: 0.4, fillColor: '#0E6B4F', fillOpacity: 0.1 }).addTo(mapa);
      }
      L.circleMarker(centro, { radius: 8, color: '#FFFFFF', weight: 2, fillColor: '#0E6B4F', fillOpacity: 1 }).addTo(mapa);

      mapaRef.current = mapa;
      // El modal anima su entrada; Leaflet midió el contenedor antes de que
      // tuviera tamaño. Un par de re-mediciones lo dejan encajado.
      obs = new ResizeObserver(() => mapa.invalidateSize());
      obs.observe(contenedorRef.current);
      setTimeout(() => mapa.invalidateSize(), 60);
      setTimeout(() => mapa.invalidateSize(), 320);
    })();

    return () => {
      vivo = false;
      obs?.disconnect();
      if (mapaRef.current) { try { mapaRef.current.remove(); } catch { /* nada */ } mapaRef.current = null; }
    };
  }, [abierto, lat, lon, precisionM]);

  if (!abierto) return null;
  return (
    <Modal open onClose={onClose} title={titulo} size="xl">
      <div className="space-y-2">
        <div ref={contenedorRef} className="w-full rounded-xl overflow-hidden" style={{ height: 'min(60vh, 460px)', background: 'var(--bg-sunken)' }} />
        {etiqueta && <p className="text-[12.5px] text-[var(--text-secondary)]">{etiqueta}</p>}
        <p className="text-[11px] text-[var(--text-muted)] font-mono tabular-nums">{lat.toFixed(5)}, {lon.toFixed(5)}</p>
      </div>
    </Modal>
  );
}
