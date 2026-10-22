// =====================================================================
// CRM · ACCESO A LOS DATOS (solo el personal, por RLS)
// =====================================================================
// Lecturas y escrituras de las tablas `crm_*` (supabase/migracion_crm.sql). La lógica que decide cosas —etapas,
// seguimiento, segmentos, métricas— vive aparte y sin red en `crmLogica.ts`.
//
// Si la migración todavía no está aplicada las tablas no existen: las lecturas lanzan `FaltaMigracionCrm` y el panel lo
// explica en vez de mostrarse roto. Los errores de la base se traducen a frases que entiende quien usa el panel.
// =====================================================================

import { supabase } from '../supabaseClient';
import {
  eventoDesdeFila, leadDesdeFila, recordatorioDesdeFila, respuestaDesdeFila, segmentoDesdeFila,
  type EtapaCrm, type EventoCrm, type FiltroSegmento, type LeadCrm, type RecordatorioCrm, type RespuestaRapida, type SegmentoCrm,
} from './crmLogica';

export * from './crmLogica';

export class FaltaMigracionCrm extends Error {
  constructor() { super('Falta aplicar supabase/migracion_crm.sql en la base.'); this.name = 'FaltaMigracionCrm'; }
}

/** ¿La tabla o la función no existe todavía? (migración sin aplicar) */
export function esFaltaDeMigracion(e: any): boolean {
  return /42P01|PGRST205|PGRST202|42883|schema cache|does not exist|Could not find the (table|function)/i.test(`${e?.code || ''} ${e?.message || ''}`);
}

/** El error de la base, en una frase para el personal. */
export function mensajeDeError(e: any): string {
  const t = `${e?.code || ''} ${e?.message || ''}`;
  if (esFaltaDeMigracion(e)) return 'Falta aplicar la migración del CRM (supabase/migracion_crm.sql).';
  if (/23505|duplicate key/i.test(t)) {
    return /email/i.test(t) ? 'Ya hay un contacto con ese correo.' : /tel/i.test(t) ? 'Ya hay un contacto con ese teléfono.' : 'Ese contacto ya existe.';
  }
  if (/crm_leads_tiene_contacto/i.test(t)) return 'Hace falta al menos un correo o un teléfono.';
  if (/crm_leads_email_check/i.test(t)) return 'El correo no tiene un formato válido.';
  if (/crm_leads_etiquetas_check/i.test(t)) return 'Máximo 20 etiquetas de hasta 30 letras.';
  if (/42501|row-level security|permission denied/i.test(t)) return 'Tu cuenta no tiene permiso para esto.';
  if (/crm_respuestas_rapidas_atajo/i.test(t)) return 'El atajo va en minúsculas, sin espacios (letras, números, guion).';
  return e?.message || 'No se pudo completar la acción.';
}

async function leer<T>(consulta: PromiseLike<{ data: any[] | null; error: any }>, mapa: (f: any) => T): Promise<T[]> {
  const { data, error } = await consulta;
  if (error) { if (esFaltaDeMigracion(error)) throw new FaltaMigracionCrm(); throw error; }
  return (data || []).map(mapa);
}
async function escribir<T = any>(consulta: PromiseLike<{ data: T | null; error: any }>): Promise<T | null> {
  const { data, error } = await consulta;
  if (error) throw Object.assign(new Error(mensajeDeError(error)), { causa: error });
  return data;
}

// ---------------------------------------------------------------------
// Contactos
// ---------------------------------------------------------------------

const TOPE_CONTACTOS = 3000;

export const listarLeads = (): Promise<LeadCrm[]> =>
  leer(supabase.from('crm_leads').select('*').order('ultima_interaccion', { ascending: false }).limit(TOPE_CONTACTOS), leadDesdeFila);

export async function buscarLeadPorCorreo(email: string): Promise<LeadCrm | null> {
  const correo = email.trim().toLowerCase();
  if (!correo) return null;
  try {
    const l = await leer(supabase.from('crm_leads').select('*').eq('email_norm', correo).limit(1), leadDesdeFila);
    return l[0] || null;
  } catch { return null; }
}

export interface DatosLeadNuevo {
  nombre: string; email?: string | null; telefono?: string | null; etapa?: EtapaCrm; provincia?: string | null;
  etiquetas?: string[]; valorEstimado?: number; responsable?: string | null;
}

export async function crearLead(d: DatosLeadNuevo): Promise<LeadCrm> {
  const fila = await escribir(supabase.from('crm_leads').insert({
    nombre: d.nombre.trim(), email: d.email?.trim() || null, telefono: d.telefono?.trim() || null, canal: 'manual',
    etapa: d.etapa || 'nuevo', provincia: d.provincia || null, etiquetas: d.etiquetas || [], valor_estimado: d.valorEstimado || 0,
    responsable: d.responsable || null,
  }).select('*').single());
  return leadDesdeFila(fila);
}

export interface CambiosLead {
  nombre?: string; email?: string | null; telefono?: string | null; etapa?: EtapaCrm; provincia?: string | null; etiquetas?: string[];
  valorEstimado?: number; responsable?: string | null; archivado?: boolean;
}

export async function actualizarLead(id: string, c: CambiosLead): Promise<LeadCrm> {
  const fila: Record<string, unknown> = {};
  if (c.nombre !== undefined) fila.nombre = c.nombre.trim();
  if (c.email !== undefined) fila.email = c.email?.trim() || null;
  if (c.telefono !== undefined) fila.telefono = c.telefono?.trim() || null;
  if (c.etapa !== undefined) fila.etapa = c.etapa;
  if (c.provincia !== undefined) fila.provincia = c.provincia || null;
  if (c.etiquetas !== undefined) fila.etiquetas = c.etiquetas;
  if (c.valorEstimado !== undefined) fila.valor_estimado = c.valorEstimado;
  if (c.responsable !== undefined) fila.responsable = c.responsable || null;
  if (c.archivado !== undefined) fila.archivado = c.archivado;
  const r = await escribir(supabase.from('crm_leads').update(fila).eq('id', id).select('*').single());
  return leadDesdeFila(r);
}

export async function eliminarLead(id: string): Promise<void> {
  const r = await escribir(supabase.from('crm_leads').delete().eq('id', id).select('id'));
  // RLS no da error cuando no te deja borrar: simplemente no borra nada. Solo el dueño puede.
  if (!Array.isArray(r) || r.length === 0) throw new Error('Solo el dueño puede borrar contactos.');
}

// ---------------------------------------------------------------------
// Línea de tiempo
// ---------------------------------------------------------------------

export const listarEventos = (leadId: string, limite = 80): Promise<EventoCrm[]> =>
  leer(supabase.from('crm_eventos').select('*').eq('lead_id', leadId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limite), eventoDesdeFila);

export async function agregarEvento(leadId: string, tipo: 'nota' | 'contacto', resumen: string): Promise<EventoCrm> {
  const f = await escribir(supabase.from('crm_eventos').insert({ lead_id: leadId, tipo, resumen: resumen.trim().slice(0, 1000) }).select('*').single());
  return eventoDesdeFila(f);
}

export async function eliminarEvento(id: number): Promise<void> {
  const r = await escribir(supabase.from('crm_eventos').delete().eq('id', id).select('id'));
  if (!Array.isArray(r) || r.length === 0) throw new Error('Solo el dueño puede borrar la línea de tiempo.');
}

// ---------------------------------------------------------------------
// Recordatorios
// ---------------------------------------------------------------------

export const listarRecordatorios = (soloPendientes = true): Promise<RecordatorioCrm[]> => {
  let q = supabase.from('crm_recordatorios').select('*').order('vence', { ascending: true }).limit(2000);
  if (soloPendientes) q = q.eq('hecho', false);
  return leer(q, recordatorioDesdeFila);
};

export const listarRecordatoriosDe = (leadId: string): Promise<RecordatorioCrm[]> =>
  leer(supabase.from('crm_recordatorios').select('*').eq('lead_id', leadId).order('vence', { ascending: true }).limit(100), recordatorioDesdeFila);

export async function crearRecordatorio(leadId: string, vence: Date, textoRecordatorio: string): Promise<RecordatorioCrm> {
  const f = await escribir(supabase.from('crm_recordatorios').insert({ lead_id: leadId, vence: vence.toISOString(), texto: textoRecordatorio.trim().slice(0, 300) }).select('*').single());
  return recordatorioDesdeFila(f);
}

export async function marcarRecordatorio(id: string, hecho: boolean): Promise<void> {
  await escribir(supabase.from('crm_recordatorios').update({ hecho }).eq('id', id).select('id'));
}

export async function posponerRecordatorio(id: string, nuevaFecha: Date): Promise<void> {
  await escribir(supabase.from('crm_recordatorios').update({ vence: nuevaFecha.toISOString() }).eq('id', id).select('id'));
}

export async function eliminarRecordatorio(id: string): Promise<void> {
  await escribir(supabase.from('crm_recordatorios').delete().eq('id', id).select('id'));
}

// ---------------------------------------------------------------------
// Respuestas rápidas
// ---------------------------------------------------------------------

export const listarRespuestas = (): Promise<RespuestaRapida[]> =>
  leer(supabase.from('crm_respuestas_rapidas').select('*').order('orden', { ascending: true }).order('atajo', { ascending: true }).limit(200), respuestaDesdeFila);

export interface DatosRespuesta { atajo: string; titulo: string; texto: string; orden?: number; activa?: boolean }

export async function guardarRespuesta(d: DatosRespuesta, id?: string): Promise<RespuestaRapida> {
  const fila = { atajo: d.atajo.trim().toLowerCase().replace(/^\//, ''), titulo: d.titulo.trim(), texto: d.texto.trim(), orden: d.orden ?? 0, activa: d.activa ?? true, updated_at: new Date().toISOString() };
  const f = await escribir(id
    ? supabase.from('crm_respuestas_rapidas').update(fila).eq('id', id).select('*').single()
    : supabase.from('crm_respuestas_rapidas').insert(fila).select('*').single());
  return respuestaDesdeFila(f);
}

export async function eliminarRespuesta(id: string): Promise<void> {
  await escribir(supabase.from('crm_respuestas_rapidas').delete().eq('id', id).select('id'));
}

// ---------------------------------------------------------------------
// Segmentos guardados
// ---------------------------------------------------------------------

export const listarSegmentos = (): Promise<SegmentoCrm[]> =>
  leer(supabase.from('crm_segmentos').select('*').order('created_at', { ascending: true }).limit(100), segmentoDesdeFila);

export async function guardarSegmento(nombre: string, filtro: FiltroSegmento): Promise<SegmentoCrm> {
  const f = await escribir(supabase.from('crm_segmentos').insert({ nombre: nombre.trim().slice(0, 60), filtro }).select('*').single());
  return segmentoDesdeFila(f);
}

export async function eliminarSegmento(id: string): Promise<void> {
  await escribir(supabase.from('crm_segmentos').delete().eq('id', id).select('id'));
}

// ---------------------------------------------------------------------
// En vivo
// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// Abrir la ficha de un contacto desde otra pantalla (el chat, por ejemplo)
// ---------------------------------------------------------------------

export const CLAVE_ABRIR_LEAD = 'tv_abrir_lead_crm';
export const EVENTO_ABRIR_LEAD = 'tv:abrir-lead-crm';

/** Deja pedido que el CRM abra la ficha de este contacto (lo recoge al montarse o, si ya está abierto, por el evento). */
export function pedirAbrirLead(id: string): void {
  try { sessionStorage.setItem(CLAVE_ABRIR_LEAD, id); } catch { /* va solo el evento */ }
  window.dispatchEvent(new CustomEvent(EVENTO_ABRIR_LEAD, { detail: id }));
}

/** Avisa cuando cambia un contacto o un recordatorio (un solo canal por pantalla). Devuelve cómo cerrarlo. */
export function suscribirCrm(alCambiar: () => void): () => void {
  let pendiente: ReturnType<typeof setTimeout> | null = null;
  // Varias filas pueden cambiar a la vez (un pedido toca el contacto, su evento y su etapa): se recarga una sola vez.
  const avisar = () => { if (pendiente) return; pendiente = setTimeout(() => { pendiente = null; alCambiar(); }, 400); };
  const canal = supabase
    .channel('crm-panel')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_leads' }, avisar)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_recordatorios' }, avisar)
    .subscribe();
  return () => {
    if (pendiente) clearTimeout(pendiente);
    try { void supabase.removeChannel(canal); } catch { /* nada */ }
  };
}
