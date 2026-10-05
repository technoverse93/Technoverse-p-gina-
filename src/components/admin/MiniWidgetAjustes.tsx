// =====================================================================
// AJUSTES → MINI-WIDGET DEL TELÉFONO
// =====================================================================
// Enciende en ESTE teléfono el mini-widget de Jarvis: una ventanita sobre
// la pantalla de inicio que es Jarvis completo con tu sesión, sin huella y
// sin abrir la app (lo pidió el dueño: el teléfono es solo suyo). Ver
// src/mobile/jarvisWidget.ts y src/rapido.tsx.
//
// Encender o apagar es una marca del teléfono; queda en la bitácora.
// =====================================================================

import { useCallback, useEffect, useState } from 'react';
import { Smartphone, LayoutGrid, Power } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { widgetNativo, VERSION_WIDGET, type EstadoWidget } from '../../mobile/jarvisWidget';
import { aparatoActual } from '../../seguridad/killSwitch';

const COMO_PONERLO = 'Mantené presionada la pantalla de inicio → Widgets → Technoverse → Jarvis.';

async function anotar(accion: string): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const { addAuditLog } = await import('../../utils/storage');
    addAuditLog(session?.user?.email || 'superadmin', 'Seguridad', accion, `Teléfono: ${aparatoActual().modelo || 'sin nombre'}`);
  } catch { /* la bitácora no frena el cambio */ }
}

export default function MiniWidgetAjustes() {
  const nativo = widgetNativo.disponible();
  const [estado, setEstado] = useState<EstadoWidget | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);

  const cargar = useCallback(async () => { setEstado(await widgetNativo.estado()); }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  // La APK del widget anterior (con llave) no sabe abrir Jarvis con la sesión.
  const apkVieja = nativo && !!estado && estado.version < VERSION_WIDGET;
  const activo = !!estado?.activo && !apkVieja;

  const activar = async () => {
    setOcupado(true); setAviso(null);
    try {
      await widgetNativo.activar();
    } catch {
      setOcupado(false); setAviso({ tipo: 'error', texto: 'El teléfono no pudo activarlo. Probá de nuevo.' });
      return;
    }
    await anotar('Mini-widget activado');
    await cargar();
    const pedido = await widgetNativo.ponerEnInicio();
    setOcupado(false);
    setAviso({ tipo: 'ok', texto: pedido ? 'Listo. Aceptá «Agregar» y el widget queda en tu pantalla de inicio.' : `Listo. Para ponerlo: ${COMO_PONERLO.charAt(0).toLowerCase()}${COMO_PONERLO.slice(1)}` });
  };

  const desactivar = async () => {
    setOcupado(true); setAviso(null);
    try { await widgetNativo.desactivar(); } catch { /* ya estaba apagado */ }
    await anotar('Mini-widget desactivado');
    // Apagado desde la propia ventanita: ya no tiene permiso de seguir abierta.
    if (estado?.enVentanita) { void widgetNativo.cerrar(); return; }
    await cargar();
    setOcupado(false);
    setAviso({ tipo: 'ok', texto: 'Apagado: el widget de este teléfono ya no abre Jarvis.' });
  };

  const titulo = !nativo ? 'Se activa desde la app del teléfono'
    : apkVieja ? 'Hace falta la APK nueva'
    : activo ? (estado?.enVentanita ? 'Activo: lo estás usando ahora' : 'Activo en este teléfono')
    : 'Apagado en este teléfono';

  return (
    <div className="ai-aj">
      <h4>Mini-widget del teléfono <small>con tu sesión · sin huella</small></h4>
      <div className="ai-modu">
        <span className="ai-modu-ic"><Smartphone className="w-4 h-4" /></span>
        <span className="ai-modu-t">
          <b>{titulo}</b>
          <span>Jarvis en tu pantalla de inicio, con tu sesión y sin huella: le hablás desde el widget y la respuesta sale ahí mismo; se agranda para ver la conversación. «Abrir conversación» da Jarvis completo para cobrar, responder chats, mover el taller o ajustar inventario. Bloquear o cerrar sesiones te sigue pidiendo confirmación.</span>
        </span>
      </div>
      {nativo && !apkVieja && estado && (
        <div className="ai-mw-acc">
          {activo ? (
            <>
              {!estado.enVentanita && (
                <button type="button" className="ai-chip" disabled={ocupado} onClick={() => void widgetNativo.ponerEnInicio().then(p => setAviso({ tipo: 'ok', texto: p ? 'Aceptá «Agregar» en el aviso.' : COMO_PONERLO }))}><LayoutGrid className="w-4 h-4" />Poner en la pantalla de inicio</button>
              )}
              <button type="button" className="ai-chip" disabled={ocupado} onClick={() => void desactivar()}><Power className="w-4 h-4" />Apagar en este teléfono</button>
            </>
          ) : (
            <button type="button" className="ai-chip" data-primario disabled={ocupado} onClick={() => void activar()}><Power className="w-4 h-4" />{ocupado ? 'Activando…' : 'Activar en este teléfono'}</button>
          )}
        </div>
      )}
      {apkVieja && <p className="ai-mw-nota">Instalá la APK nueva (la de la última compilación) y volvé aquí para activarlo.</p>}
      {!nativo && <p className="ai-mw-nota">Abrí Jarvis en la app del teléfono → Ajustes → Mini-widget → «Activar en este teléfono».</p>}
      {activo && <p className="ai-mw-nota">Si perdés el teléfono, bloquearlo o cerrar sus sesiones también apaga el widget.</p>}
      {aviso && <p className="ai-mw-aviso" data-tipo={aviso.tipo} role="status">{aviso.texto}</p>}
    </div>
  );
}
