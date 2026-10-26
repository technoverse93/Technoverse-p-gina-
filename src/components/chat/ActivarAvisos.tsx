// =====================================================================
// ACTIVAR AVISOS — una fila en el Chat del panel (solo en el navegador)
// =====================================================================
// Con el panel abierto en Chrome (teléfono o compu), un toque activa los
// avisos web: cada mensaje nuevo de un cliente llega aunque el navegador
// esté cerrado (ver utils/avisosWeb.ts). En la APK no aparece: ahí avisa
// la propia app (y con la app cerrada, Firebase).
// Discreta: una sola fila; «Ahora no» la esconde dos semanas en este aparato.
// =====================================================================

import { useEffect, useState } from 'react';
import { BellRing, X } from 'lucide-react';
import { activarAvisosWeb, estadoAvisosWeb, soportaAvisosWeb, TEXTO_ESTADO_WEB, type EstadoWeb } from '../../utils/avisosWeb';

const CLAVE_DESCARTE = 'tv_avisos_web_descartado';
const DESCARTE_MS = 14 * 86_400_000;
const descartado = () => { try { return Date.now() - Number(localStorage.getItem(CLAVE_DESCARTE) || 0) < DESCARTE_MS; } catch { return false; } };

const CORTO: Partial<Record<EstadoWeb, string>> = {
  bloqueado: 'Avisos bloqueados en este navegador',
  sin_sql: 'Avisos: falta un paso en el servidor',
  error: 'No se pudieron activar los avisos',
};

export default function ActivarAvisos() {
  const [estado, setEstado] = useState<EstadoWeb | null>(null);
  const [oculto, setOculto] = useState(() => !soportaAvisosWeb() || descartado());
  const [ocupado, setOcupado] = useState(false);
  const [listo, setListo] = useState(false);
  useEffect(() => { if (!oculto) void estadoAvisosWeb().then(setEstado); }, [oculto]);

  if (oculto || !estado || estado === 'sin_soporte' || (estado === 'activo' && !listo)) return null;
  const activar = async () => {
    setOcupado(true);
    const e = await activarAvisosWeb();
    setOcupado(false);
    setEstado(e);
    if (e === 'activo') { setListo(true); setTimeout(() => setOculto(true), 3500); }
  };
  const cerrar = () => { try { localStorage.setItem(CLAVE_DESCARTE, String(Date.now())); } catch { /* sin almacenamiento */ } setOculto(true); };
  const texto = listo ? 'Listo: te avisa aunque cierres el navegador' : CORTO[estado] || 'Avisos con el navegador cerrado';
  return (
    <div className="tv-chat-avisos" role="status">
      <BellRing className="w-4 h-4" aria-hidden="true" />
      <span className="tv-1l" title={TEXTO_ESTADO_WEB[estado]}>{texto}</span>
      {estado === 'apagado' && (
        <button type="button" className="tv-chat-avisos-si" disabled={ocupado} onClick={() => void activar()}>
          {ocupado ? 'Activando…' : 'Activar'}
        </button>
      )}
      {estado === 'error' && (
        <button type="button" className="tv-chat-avisos-si" disabled={ocupado} onClick={() => void activar()}>Reintentar</button>
      )}
      {!listo && <button type="button" className="tv-chat-avisos-x" onClick={cerrar} aria-label="Ahora no"><X className="w-4 h-4" /></button>}
    </div>
  );
}
