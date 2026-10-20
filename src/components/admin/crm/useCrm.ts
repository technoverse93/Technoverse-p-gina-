// =====================================================================
// CRM · ESTADO COMPARTIDO DEL MÓDULO
// =====================================================================
// Los contactos, los seguimientos pendientes, las respuestas rápidas y los segmentos se leen UNA vez por módulo abierto y
// los usan todas las carpetas (Embudo, Seguimiento, Segmentos, Respuestas y Métricas). Las escrituras pintan el cambio al
// instante y lo confirman con la base; si la base lo rechaza se deshace y se dice por qué. Un canal en vivo recarga cuando
// algo cambia desde otro aparato o desde el servidor (un pedido nuevo, un mensaje del chat).
// =====================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../../supabaseClient';
import { getDB } from '../../../utils/storage';
import { useToast } from '../../ui/Overlays';
import * as crm from '../../../utils/crm';
import type {
  CambiosLead, DatosLeadNuevo, DatosRespuesta, EtapaCrm, FiltroSegmento, LeadCrm, PedidoMin, RecordatorioCrm, RespuestaRapida, SegmentoCrm,
} from '../../../utils/crm';

export type EstadoCarga = 'cargando' | 'listo' | 'sin_migracion' | 'error';

function pedidosDelPanel(): PedidoMin[] {
  try {
    return (getDB().orders || []).map(o => ({ id: o.id, customerEmail: o.customerEmail || '', total: Number(o.total) || 0, status: o.status, timestamp: o.timestamp }));
  } catch { return []; }
}

export function useCrm() {
  const toast = useToast();
  const [estado, setEstado] = useState<EstadoCarga>('cargando');
  const [error, setError] = useState<string | null>(null);
  const [leads, setLeads] = useState<LeadCrm[]>([]);
  const [recordatorios, setRecordatorios] = useState<RecordatorioCrm[]>([]);
  const [respuestas, setRespuestas] = useState<RespuestaRapida[]>([]);
  const [segmentos, setSegmentos] = useState<SegmentoCrm[]>([]);
  const [equipo, setEquipo] = useState<string[]>([]);
  const [pedidos, setPedidos] = useState<PedidoMin[]>(pedidosDelPanel);
  const [ahora, setAhora] = useState(() => Date.now());
  /** Sube con cada recarga: la ficha abierta vuelve a leer su línea de tiempo. */
  const [version, setVersion] = useState(0);

  const montado = useRef(true);
  const leadsRef = useRef<LeadCrm[]>([]);
  leadsRef.current = leads;
  useEffect(() => { montado.current = true; return () => { montado.current = false; }; }, []);

  const recargar = useCallback(async () => {
    try {
      const [l, r, resp, seg] = await Promise.all([crm.listarLeads(), crm.listarRecordatorios(true), crm.listarRespuestas(), crm.listarSegmentos()]);
      if (!montado.current) return;
      setLeads(l); setRecordatorios(r); setRespuestas(resp); setSegmentos(seg);
      setEstado('listo'); setError(null); setVersion(v => v + 1);
    } catch (e: any) {
      if (!montado.current) return;
      if (e instanceof crm.FaltaMigracionCrm) { setEstado('sin_migracion'); return; }
      setError(crm.mensajeDeError(e));
      setEstado(prev => (prev === 'listo' ? 'listo' : 'error'));
    }
  }, []);

  useEffect(() => { void recargar(); }, [recargar]);

  // En vivo: solo si las tablas existen.
  useEffect(() => {
    if (estado !== 'listo') return;
    return crm.suscribirCrm(() => { void recargar(); });
  }, [estado, recargar]);

  // Los pedidos los mantiene al día el resto del panel (`technoverse_db_updated`).
  useEffect(() => {
    const alActualizar = () => setPedidos(pedidosDelPanel());
    window.addEventListener('technoverse_db_updated', alActualizar);
    return () => window.removeEventListener('technoverse_db_updated', alActualizar);
  }, []);

  // «Vencido» y «hoy» cambian solos con el reloj.
  useEffect(() => {
    const reloj = setInterval(() => setAhora(Date.now()), 60_000);
    return () => clearInterval(reloj);
  }, []);

  // Quiénes del personal pueden ser «responsable».
  useEffect(() => {
    let vivo = true;
    supabase.from('profiles').select('email').in('role', ['superadmin', 'admin', 'empleado']).then(({ data }) => {
      if (vivo && data) setEquipo(data.map((p: any) => String(p.email || '').toLowerCase()).filter(Boolean).sort());
    });
    return () => { vivo = false; };
  }, []);

  const compras = useMemo(() => crm.comprasPorCorreo(pedidos), [pedidos]);
  const metricas = useMemo(() => crm.calcularMetricas(leads, pedidos, ahora), [leads, pedidos, ahora]);

  const fallo = useCallback((e: any) => { toast.error(e?.message || crm.mensajeDeError(e)); }, [toast]);
  const reemplazar = useCallback((nuevo: LeadCrm) => setLeads(ls => ls.map(l => (l.id === nuevo.id ? nuevo : l))), []);

  // ---- contactos ----
  const crear = useCallback(async (d: DatosLeadNuevo): Promise<LeadCrm | null> => {
    try {
      const nuevo = await crm.crearLead(d);
      setLeads(ls => [nuevo, ...ls]);
      return nuevo;
    } catch (e) { fallo(e); return null; }
  }, [fallo]);

  const editar = useCallback(async (id: string, cambios: CambiosLead): Promise<LeadCrm | null> => {
    try {
      const nuevo = await crm.actualizarLead(id, cambios);
      reemplazar(nuevo);
      return nuevo;
    } catch (e) { fallo(e); return null; }
  }, [fallo, reemplazar]);

  const mover = useCallback(async (id: string, etapa: EtapaCrm) => {
    const previo = leadsRef.current.find(l => l.id === id);
    if (!previo || previo.etapa === etapa) return;
    setLeads(ls => ls.map(l => (l.id === id ? { ...l, etapa, etapaDesde: new Date().toISOString() } : l)));
    try { reemplazar(await crm.actualizarLead(id, { etapa })); }
    catch (e) { setLeads(ls => ls.map(l => (l.id === id ? previo : l))); fallo(e); }
  }, [fallo, reemplazar]);

  const archivar = useCallback(async (id: string, archivado: boolean) => {
    const previo = leadsRef.current.find(l => l.id === id);
    if (!previo) return;
    setLeads(ls => ls.map(l => (l.id === id ? { ...l, archivado } : l)));
    try { reemplazar(await crm.actualizarLead(id, { archivado })); }
    catch (e) { setLeads(ls => ls.map(l => (l.id === id ? previo : l))); fallo(e); }
  }, [fallo, reemplazar]);

  const borrar = useCallback(async (id: string): Promise<boolean> => {
    try {
      await crm.eliminarLead(id);
      setLeads(ls => ls.filter(l => l.id !== id));
      setRecordatorios(rs => rs.filter(r => r.leadId !== id));
      return true;
    } catch (e) { fallo(e); return false; }
  }, [fallo]);

  // ---- seguimientos ----
  const agendar = useCallback(async (leadId: string, vence: Date, texto: string): Promise<boolean> => {
    try {
      const r = await crm.crearRecordatorio(leadId, vence, texto);
      setRecordatorios(rs => [...rs, r].sort((a, b) => Date.parse(a.vence) - Date.parse(b.vence)));
      setLeads(ls => ls.map(l => {
        if (l.id !== leadId) return l;
        const t = Date.parse(r.vence);
        return !l.proximoContacto || t < Date.parse(l.proximoContacto) ? { ...l, proximoContacto: r.vence } : l;
      }));
      return true;
    } catch (e) { fallo(e); return false; }
  }, [fallo]);

  const cumplir = useCallback(async (id: string) => {
    const previo = recordatorios.find(r => r.id === id);
    setRecordatorios(rs => rs.filter(r => r.id !== id));
    try { await crm.marcarRecordatorio(id, true); void recargar(); }
    catch (e) { if (previo) setRecordatorios(rs => [...rs, previo]); fallo(e); }
  }, [recordatorios, fallo, recargar]);

  const posponer = useCallback(async (id: string, nueva: Date) => {
    setRecordatorios(rs => rs.map(r => (r.id === id ? { ...r, vence: nueva.toISOString() } : r)));
    try { await crm.posponerRecordatorio(id, nueva); void recargar(); }
    catch (e) { fallo(e); void recargar(); }
  }, [fallo, recargar]);

  const quitarRecordatorio = useCallback(async (id: string) => {
    setRecordatorios(rs => rs.filter(r => r.id !== id));
    try { await crm.eliminarRecordatorio(id); void recargar(); }
    catch (e) { fallo(e); void recargar(); }
  }, [fallo, recargar]);

  // ---- respuestas rápidas ----
  const guardarRespuesta = useCallback(async (d: DatosRespuesta, id?: string): Promise<boolean> => {
    try {
      const r = await crm.guardarRespuesta(d, id);
      setRespuestas(rs => (id ? rs.map(x => (x.id === id ? r : x)) : [...rs, r]).sort((a, b) => a.orden - b.orden || a.atajo.localeCompare(b.atajo)));
      return true;
    } catch (e) { fallo(e); return false; }
  }, [fallo]);

  const quitarRespuesta = useCallback(async (id: string) => {
    try { await crm.eliminarRespuesta(id); setRespuestas(rs => rs.filter(r => r.id !== id)); }
    catch (e) { fallo(e); }
  }, [fallo]);

  // ---- segmentos ----
  const guardarSegmento = useCallback(async (nombre: string, filtro: FiltroSegmento): Promise<boolean> => {
    try { const s = await crm.guardarSegmento(nombre, filtro); setSegmentos(ss => [...ss, s]); return true; }
    catch (e) { fallo(e); return false; }
  }, [fallo]);

  const quitarSegmento = useCallback(async (id: string) => {
    try { await crm.eliminarSegmento(id); setSegmentos(ss => ss.filter(s => s.id !== id)); }
    catch (e) { fallo(e); }
  }, [fallo]);

  const etiquetasUsadas = useMemo(() => {
    const cuenta = new Map<string, number>();
    for (const l of leads) for (const e of l.etiquetas) cuenta.set(e, (cuenta.get(e) || 0) + 1);
    return [...cuenta.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([e]) => e);
  }, [leads]);

  return {
    estado, error, leads, recordatorios, respuestas, segmentos, equipo, pedidos, compras, metricas, ahora, version, etiquetasUsadas,
    recargar, crear, editar, mover, archivar, borrar, agendar, cumplir, posponer, quitarRecordatorio,
    guardarRespuesta, quitarRespuesta, guardarSegmento, quitarSegmento,
  };
}

export type Crm = ReturnType<typeof useCrm>;
