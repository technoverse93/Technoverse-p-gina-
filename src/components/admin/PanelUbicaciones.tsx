// =====================================================================
// PANEL DE UBICACIÓN INTERNO — mapa embebido, sin salir a Google Maps
// =====================================================================
// Muestra, DENTRO del panel, las ubicaciones que clientes y
// administradores compartieron a propósito (el permiso lo pidió el
// navegador/APK; la persona aceptó). El mapa es Leaflet con tiles de
// OpenStreetMap: la CSP de la app deja pasar imágenes `https:`, así que
// los tiles cargan sin abrir nada externo ni redirigir a ningún lado.
//
// Solo lo ve el administrador supremo (ver `soloAdminSupremo` en
// adminNav y la RLS `is_superadmin()` de la tabla). Los datos llegan por
// Realtime: una ubicación nueva aparece en el mapa sin recargar.
// =====================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin, RefreshCw, Crosshair, Trash2, User as UserIcon, ShieldCheck } from 'lucide-react';
import { PageHead, Card, Btn, Chip, Empty } from './AdminKit';
import { useToast } from '../ui/Overlays';
import type { User } from '../../types';
import {
  listarUbicaciones,
  suscribirUbicaciones,
  compartirUbicacion,
  olvidarUbicacionRegistro,
  type UbicacionRegistro,
} from '../../utils/ubicaciones';

// Centro aproximado del país, para el encuadre inicial antes de tener puntos.
const CENTRO_CR: [number, number] = [9.86, -84.1];

function haceCuanto(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'ahora mismo';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} d`;
}

export default function PanelUbicaciones({ currentUser }: { currentUser: User | null }) {
  const toast = useToast();
  const [registros, setRegistros] = useState<UbicacionRegistro[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [compartiendo, setCompartiendo] = useState(false);

  const contenedorRef = useRef<HTMLDivElement | null>(null);
  const mapaRef = useRef<L.Map | null>(null);
  const capaRef = useRef<L.LayerGroup | null>(null);
  const marcadoresRef = useRef<Record<string, L.CircleMarker>>({});
  // El encuadre automático solo la primera vez que llegan puntos: después
  // manda lo que el administrador haya movido a mano.
  const encuadradoRef = useRef(false);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const lista = await listarUbicaciones();
      setRegistros(lista);
    } catch (e: any) {
      // El caso normal de "todavía no existe la tabla" no debe verse como
      // una pantalla rota: se explica en texto y se puede reintentar.
      const msg = String(e?.message || e || '');
      setError(
        /relation .*does not exist|schema cache|not exist/i.test(msg)
          ? 'El panel está listo, pero falta aplicar la migración de la base (supabase/migracion_ubicaciones_panel.sql). En cuanto se aplique, las ubicaciones aparecen aquí.'
          : `No se pudieron leer las ubicaciones: ${msg}`
      );
    } finally {
      setCargando(false);
    }
  }, []);

  // Carga inicial + suscripción en vivo.
  useEffect(() => {
    void cargar();
    const desuscribir = suscribirUbicaciones(() => { void cargar(); });
    return desuscribir;
  }, [cargar]);

  // Crear el mapa UNA vez. Leaflet necesita un nodo con tamaño; como el
  // panel vive en una pestaña que puede montarse oculta, se re-mide con un
  // ResizeObserver en cuanto el contenedor recibe alto.
  useEffect(() => {
    if (mapaRef.current || !contenedorRef.current) return;

    const mapa = L.map(contenedorRef.current, {
      center: CENTRO_CR,
      zoom: 8,
      zoomControl: true,
      attributionControl: true,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(mapa);
    capaRef.current = L.layerGroup().addTo(mapa);
    mapaRef.current = mapa;

    const obs = new ResizeObserver(() => mapa.invalidateSize());
    obs.observe(contenedorRef.current);

    return () => {
      obs.disconnect();
      mapa.remove();
      mapaRef.current = null;
      capaRef.current = null;
      marcadoresRef.current = {};
    };
  }, []);

  // Repintar los marcadores cuando cambian los registros.
  useEffect(() => {
    const mapa = mapaRef.current;
    const capa = capaRef.current;
    if (!mapa || !capa) return;

    capa.clearLayers();
    marcadoresRef.current = {};

    const puntos: L.LatLngExpression[] = [];
    for (const r of registros) {
      if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon)) continue;
      const esAdmin = r.rol === 'administrador';
      const color = esAdmin ? '#2563EB' : '#0E6B4F';

      // Círculo de precisión (si el aparato la reportó), tenue.
      if (r.precisionM && r.precisionM > 0 && r.precisionM < 5000) {
        L.circle([r.lat, r.lon], {
          radius: r.precisionM,
          color,
          weight: 1,
          opacity: 0.35,
          fillColor: color,
          fillOpacity: 0.08,
        }).addTo(capa);
      }

      const marcador = L.circleMarker([r.lat, r.lon], {
        radius: 8,
        color: '#ffffff',
        weight: 2,
        fillColor: color,
        fillOpacity: 0.95,
      })
        .addTo(capa)
        .bindPopup(
          `<strong>${(r.nombre || (esAdmin ? 'Administrador' : 'Cliente')).replace(/</g, '&lt;')}</strong>` +
            `<br>${esAdmin ? 'Administrador' : 'Cliente'}` +
            (r.provincia ? `<br>${r.provincia}` : '') +
            (r.precisionM != null ? `<br>±${r.precisionM} m` : '') +
            `<br>${haceCuanto(r.createdAt)}`
        )
        .on('click', () => setSeleccion(r.id));

      marcadoresRef.current[r.id] = marcador;
      puntos.push([r.lat, r.lon]);
    }

    // Encuadre: solo la primera vez que llegan puntos, para no forcejear
    // con el administrador que ya movió el mapa a mano.
    if (puntos.length && !encuadradoRef.current) {
      if (puntos.length === 1) mapa.setView(puntos[0], 15);
      else mapa.fitBounds(L.latLngBounds(puntos).pad(0.2));
      encuadradoRef.current = true;
    }
  }, [registros]);

  // Al elegir de la lista: centrar y abrir su globo.
  useEffect(() => {
    if (!seleccion) return;
    const mapa = mapaRef.current;
    const reg = registros.find(r => r.id === seleccion);
    const marc = marcadoresRef.current[seleccion];
    if (mapa && reg) {
      mapa.setView([reg.lat, reg.lon], Math.max(mapa.getZoom(), 15), { animate: true });
      marc?.openPopup();
    }
  }, [seleccion, registros]);

  const compartirLaMia = async () => {
    setCompartiendo(true);
    try {
      const u = await compartirUbicacion({
        rol: 'administrador',
        nombre: currentUser?.name || 'Administrador',
        email: currentUser?.email || null,
        contexto: 'panel',
      });
      if (u) { toast.success('Tu ubicación se compartió con el panel.'); void cargar(); }
      else toast.warning('No se pudo obtener la ubicación (permiso negado o sin señal).');
    } finally {
      setCompartiendo(false);
    }
  };

  const quitar = async (id: string) => {
    try {
      await olvidarUbicacionRegistro(id);
      if (seleccion === id) setSeleccion(null);
      void cargar();
    } catch (e: any) {
      toast.error(`No se pudo quitar: ${String(e?.message || e)}`);
    }
  };

  const conteo = useMemo(() => ({
    clientes: registros.filter(r => r.rol === 'cliente').length,
    admins: registros.filter(r => r.rol === 'administrador').length,
  }), [registros]);

  return (
    <div className="tv-stack" id="view-ubicaciones">
      <PageHead
        title="Ubicaciones"
        subtitle="Ubicaciones que clientes y administradores compartieron a propósito, sobre un mapa dentro del panel."
        actions={
          <>
            <Btn variant="default" icon={RefreshCw} onClick={() => { setCargando(true); void cargar(); }}>
              Actualizar
            </Btn>
            <Btn variant="primary" icon={Crosshair} onClick={compartirLaMia} disabled={compartiendo}>
              {compartiendo ? 'Compartiendo…' : 'Compartir mi ubicación'}
            </Btn>
          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,340px)_1fr] gap-3">
        {/* Lista */}
        <Card title={`Compartidas (${registros.length})`} padded={false}>
          <div className="px-3 py-2 flex gap-2 border-b border-[var(--border-color)]">
            <Chip tone="accent">{conteo.clientes} clientes</Chip>
            <Chip tone="ok">{conteo.admins} admins</Chip>
          </div>

          {cargando ? (
            <div className="p-6 text-center text-[13px] text-[var(--text-muted)]">Cargando…</div>
          ) : error ? (
            <div className="p-4 text-[12.5px] leading-relaxed text-[var(--text-secondary)]">{error}</div>
          ) : registros.length === 0 ? (
            <Empty
              icon={MapPin}
              title="Aún no hay ubicaciones"
              text="Cuando un cliente comparta su ubicación en el checkout, o toques “Compartir mi ubicación”, aparecerá aquí."
            />
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto divide-y divide-[var(--border-color)]">
              {registros.map(r => {
                const esAdmin = r.rol === 'administrador';
                const activo = r.id === seleccion;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setSeleccion(r.id)}
                      className={`w-full text-left px-3 py-2.5 flex gap-2.5 items-start transition ${activo ? 'bg-[var(--accent)]/10' : 'hover:bg-[var(--bg-sunken)]'}`}
                    >
                      <span
                        className="mt-0.5 w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                        style={{ background: esAdmin ? '#2563EB22' : '#0E6B4F22', color: esAdmin ? '#2563EB' : '#0E6B4F' }}
                      >
                        {esAdmin ? <ShieldCheck className="w-4 h-4" /> : <UserIcon className="w-4 h-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-[13px] font-bold text-[var(--text-primary)] truncate">
                            {r.nombre || (esAdmin ? 'Administrador' : 'Cliente')}
                          </span>
                          <span className="text-[11px] text-[var(--text-muted)] shrink-0">{haceCuanto(r.createdAt)}</span>
                        </span>
                        <span className="block text-[11.5px] text-[var(--text-secondary)] truncate">
                          {r.email || (r.contexto === 'checkout' ? 'Compartida en el checkout' : 'Compartida desde el panel')}
                        </span>
                        <span className="block text-[11px] text-[var(--text-muted)] mt-0.5">
                          {r.provincia || 'Provincia aprox. no resuelta'}
                          {r.precisionM != null ? ` · ±${r.precisionM} m` : ''}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Mapa */}
        <Card padded={false} className="overflow-hidden">
          <div className="relative">
            <div
              ref={contenedorRef}
              className="w-full"
              style={{ height: 'min(70vh, 560px)', minHeight: 320, background: 'var(--bg-sunken)' }}
            />
            {seleccion && (() => {
              const r = registros.find(x => x.id === seleccion);
              if (!r) return null;
              return (
                <div className="absolute bottom-3 left-3 right-3 z-[500] mx-auto max-w-md rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-color)] shadow-[var(--float-shadow-lg)] p-3 flex items-center gap-3">
                  <MapPin className="w-4 h-4 text-[var(--accent)] shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-bold text-[var(--text-primary)] truncate">
                      {r.nombre || (r.rol === 'administrador' ? 'Administrador' : 'Cliente')}
                    </div>
                    <div className="text-[11.5px] text-[var(--text-secondary)] truncate font-mono">
                      {r.lat.toFixed(5)}, {r.lon.toFixed(5)}
                    </div>
                  </div>
                  <Btn variant="danger" icon={Trash2} onClick={() => quitar(r.id)}>Quitar</Btn>
                </div>
              );
            })()}
          </div>
        </Card>
      </div>
    </div>
  );
}
