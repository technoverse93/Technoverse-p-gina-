// =====================================================================
// AJUSTES → MINI-WIDGET DEL TELÉFONO
// =====================================================================
// Activa en ESTE teléfono el mini-widget de Jarvis: una ventanita sobre la
// pantalla de inicio que contesta sin huella y sin abrir la app (lo pidió
// el dueño: el teléfono es solo suyo). Por ahí solo se pregunta; las
// órdenes se hacen en la app.
//
// Activar = el servidor crea una llave y se la entrega UNA vez al teléfono,
// que la guarda cifrada (Keystore). Aquí también se ven las llaves vivas
// (en qué teléfono, último uso) y se pueden revocar.
// =====================================================================

import { useCallback, useEffect, useState } from 'react';
import { Smartphone, Trash2, LayoutGrid, Power } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { widgetNativo } from '../../mobile/jarvisWidget';
import { aparatoActual } from '../../seguridad/killSwitch';

type Llave = { id: string; dispositivo: string | null; modelo: string | null; creada_en: string; ultimo_uso: string | null; usos: number };
const CLAVE_ID = 'tv_widget_llave_id';

async function llamar(cuerpo: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('asistente-ia', { body: cuerpo });
  if (error && (error as any).context?.json) { try { return await (error as any).context.json(); } catch { /* sin cuerpo */ } }
  return data || { ok: false, error: 'Sin respuesta del servidor.' };
}
function hace(f: string | null): string {
  if (!f) return 'nunca';
  const m = Math.max(1, Math.round((Date.now() - new Date(f).getTime()) / 60_000));
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60); if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24); return d === 1 ? 'ayer' : `hace ${d} días`;
}

export default function MiniWidgetAjustes() {
  const nativo = widgetNativo.disponible();
  const [activo, setActivo] = useState(false);
  const [llaves, setLlaves] = useState<Llave[]>([]);
  const [sinTabla, setSinTabla] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const yo = () => { const a = aparatoActual(); return { device: a.huella, modelo: a.modelo }; };

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.from('ia_widget_llaves').select('id,dispositivo,modelo,creada_en,ultimo_uso,usos')
      .is('revocada_en', null).order('creada_en', { ascending: false }).limit(10);
    setSinTabla(!!error && /does not exist|schema cache|could not find/i.test(error.message));
    setLlaves((data || []) as Llave[]);
    setActivo(await widgetNativo.activo());
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  const activar = async () => {
    setOcupado(true); setAviso(null);
    const r = await llamar({ accion: 'widget_activar', yo: yo() });
    if (!r?.ok) { setOcupado(false); setAviso({ tipo: 'error', texto: r?.error || 'No se pudo activar.' }); return; }
    try {
      await widgetNativo.activar(r.url, r.llave);
      try { localStorage.setItem(CLAVE_ID, r.id); } catch { /* se revoca por teléfono */ }
    } catch {
      // La llave no quedó guardada en el teléfono: no se deja viva.
      await llamar({ accion: 'widget_revocar', id: r.id, yo: yo() });
      setOcupado(false); setAviso({ tipo: 'error', texto: 'El teléfono no pudo guardar la llave. Probá de nuevo.' });
      return;
    }
    await cargar();
    const pedido = await widgetNativo.ponerEnInicio();
    setOcupado(false);
    setAviso({ tipo: 'ok', texto: pedido
      ? 'Listo. Aceptá «Agregar» y el widget queda en tu pantalla de inicio.'
      : 'Listo. Para ponerlo: mantené presionada la pantalla de inicio → Widgets → Technoverse → Jarvis.' });
  };

  const desactivar = async () => {
    setOcupado(true); setAviso(null);
    let id: string | null = null;
    try { id = localStorage.getItem(CLAVE_ID); } catch { /* nada */ }
    try { await widgetNativo.desactivar(); } catch { /* ya no estaba */ }
    await llamar({ accion: 'widget_revocar', ...(id ? { id } : {}), yo: yo() });
    try { localStorage.removeItem(CLAVE_ID); } catch { /* nada */ }
    await cargar();
    setOcupado(false);
    setAviso({ tipo: 'ok', texto: 'Desactivado: el widget de este teléfono ya no contesta.' });
  };

  const revocar = async (l: Llave) => {
    setOcupado(true); setAviso(null);
    const r = await llamar({ accion: 'widget_revocar', id: l.id, yo: yo() });
    let mia: string | null = null;
    try { mia = localStorage.getItem(CLAVE_ID); } catch { /* nada */ }
    if (r?.ok && mia === l.id) { try { await widgetNativo.desactivar(); localStorage.removeItem(CLAVE_ID); } catch { /* nada */ } }
    await cargar();
    setOcupado(false);
    setAviso(r?.ok ? { tipo: 'ok', texto: 'Llave revocada: ese widget ya no contesta.' } : { tipo: 'error', texto: r?.error || 'No se pudo revocar.' });
  };

  return (
    <div className="ai-aj">
      <h4>Mini-widget del teléfono <small>sin huella · solo preguntas</small></h4>
      <div className="ai-modu">
        <span className="ai-modu-ic"><Smartphone className="w-4 h-4" /></span>
        <span className="ai-modu-t">
          <b>{!nativo ? 'Se activa desde la app del teléfono' : activo ? 'Activo en este teléfono' : 'No está activado en este teléfono'}</b>
          <span>Una ventanita sobre la pantalla de inicio: escribís o hablás y Jarvis te contesta ahí mismo, sin huella y sin abrir la app. Responde todas las consultas; las órdenes (cobrar, chats, bloquear) se hacen en la app.</span>
        </span>
      </div>
      {sinTabla && <p className="ai-mw-aviso" data-tipo="error">Falta correr «migracion_jarvis_widget.sql» en Supabase.</p>}
      {nativo && !sinTabla && (
        <div className="ai-mw-acc">
          {activo ? (
            <>
              <button type="button" className="ai-chip" disabled={ocupado} onClick={() => void widgetNativo.ponerEnInicio().then(p => setAviso({ tipo: 'ok', texto: p ? 'Aceptá «Agregar» en el aviso.' : 'Mantené presionada la pantalla de inicio → Widgets → Technoverse → Jarvis.' }))}><LayoutGrid className="w-4 h-4" />Poner en la pantalla de inicio</button>
              <button type="button" className="ai-chip" disabled={ocupado} onClick={() => void desactivar()}><Power className="w-4 h-4" />Desactivar aquí</button>
            </>
          ) : (
            <button type="button" className="ai-chip" data-primario disabled={ocupado} onClick={() => void activar()}><Power className="w-4 h-4" />{ocupado ? 'Activando…' : 'Activar en este teléfono'}</button>
          )}
        </div>
      )}
      {!nativo && <p className="ai-mw-nota">Abrí Jarvis en la app del teléfono (APK nueva) → Ajustes → Mini-widget → «Activar en este teléfono».</p>}
      {!!llaves.length && (
        <ul className="ai-mw-lista" aria-label="Teléfonos con el mini-widget activo">
          {llaves.map(l => (
            <li key={l.id}>
              <span><b>{l.modelo || 'Teléfono'}</b><small>Activado {new Date(l.creada_en).toLocaleDateString('es-CR', { day: 'numeric', month: 'short' })} · último uso {hace(l.ultimo_uso)} · {l.usos} {l.usos === 1 ? 'pregunta' : 'preguntas'}</small></span>
              <button type="button" className="ai-chip" disabled={ocupado} onClick={() => void revocar(l)} aria-label={`Revocar el widget de ${l.modelo || 'ese teléfono'}`}><Trash2 className="w-4 h-4" />Revocar</button>
            </li>
          ))}
        </ul>
      )}
      {aviso && <p className="ai-mw-aviso" data-tipo={aviso.tipo} role="status">{aviso.texto}</p>}
    </div>
  );
}
