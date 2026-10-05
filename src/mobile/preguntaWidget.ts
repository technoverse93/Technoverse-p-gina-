// =====================================================================
// PREGUNTA DESDE EL WIDGET, SIN VENTANA
// =====================================================================
// Lo dictado (o escrito en la barrita) va a Jarvis con la sesión de la app
// —la misma puerta que el panel, con el mismo carril privado— y la
// respuesta vuelve al recuadro del widget. La conversación del widget se
// sigue durante 30 minutos; «Abrir conversación» la abre completa.
// =====================================================================

import { supabase } from '../supabaseClient';
import { separarPrivados, restaurarPrivados } from '../utils/privados';
import { aparatoActual } from '../seguridad/killSwitch';

const CLAVE = 'tv_widget_conversacion';
const VIGENCIA_MS = 30 * 60_000;

type Guardada = { id: string; en: number; privados: Record<string, string> };

function leer(): Guardada | null {
  try {
    const g = JSON.parse(localStorage.getItem(CLAVE) || 'null') as Guardada | null;
    return g && Date.now() - g.en < VIGENCIA_MS ? g : null;
  } catch { return null; }
}
function guardar(g: Guardada): void {
  try { localStorage.setItem(CLAVE, JSON.stringify(g)); } catch { /* sin almacenamiento: cada pregunta empieza conversación */ }
}

/** La conversación del widget, si sigue vigente (para abrirla completa). */
export function conversacionDelWidget(): string | null {
  return leer()?.id || null;
}

export type RespuestaWidget = { ok: true; texto: string; conversacion: string; acciones: string[] } | { ok: false; error: string };

export async function preguntarDesdeWidget(crudo: string, porVoz: boolean): Promise<RespuestaWidget> {
  const previa = leer();
  const sep = separarPrivados(crudo.trim(), previa?.privados || {});
  let perfil = 'rapido';
  try { const p = localStorage.getItem('tv_jarvis_perfil'); if (p === 'equilibrado' || p === 'profundo') perfil = p; } catch { /* rápido */ }
  const { data, error } = await supabase.functions.invoke('asistente-ia', {
    body: {
      accion: 'enviar', desde: 'widget', texto: sep.texto, conversacionId: previa?.id || null,
      persona: 'jarvis', perfil, porVoz: porVoz ? 1 : undefined, privados: sep.privados,
      yo: { device: aparatoActual().huella, modelo: aparatoActual().modelo },
    },
  });
  let r: any = data;
  if (error && (error as any).context?.json) { try { r = await (error as any).context.json(); } catch { /* sin cuerpo */ } }
  if (!r?.ok) return { ok: false, error: r?.error || 'Sin conexión. Revisá internet y probá de nuevo.' };
  const conversacion = String(r.conversacionId || previa?.id || '');
  guardar({ id: conversacion, en: Date.now(), privados: sep.privados });
  const consultas: any[] = r.mensaje?.consultas || [];
  const acciones = consultas.filter(c => c?.tipo === 'accion' && c?.id).map(c => String(c.id));
  return { ok: true, texto: restaurarPrivados(String(r.mensaje?.texto || ''), sep.privados), conversacion, acciones };
}

type FilaAccion = { id: string; estado: string; tarjeta?: { auto?: boolean }; resultado?: { detalle?: string; texto?: string } | null };

/**
 * Las órdenes cotidianas (p. ej. responder el único chat que coincide) se
 * confirman solas, igual que en la app: aquí se espera a que terminen. Lo
 * que pide confirmación queda para «Abrir conversación».
 */
export async function esperarAcciones(ids: string[], topeMs = 40_000): Promise<{ hechas: string[]; pendientes: number }> {
  const fin = Date.now() + topeMs;
  let filas: FilaAccion[] = [];
  while (Date.now() < fin) {
    const { data } = await supabase.from('ia_acciones').select('id,estado,tarjeta,resultado').in('id', ids);
    filas = (data || []) as FilaAccion[];
    const enCurso = filas.some(f => f.tarjeta?.auto && (f.estado === 'propuesta' || f.estado === 'ejecutando'));
    if (filas.length && !enCurso) break;
    await new Promise(ok => setTimeout(ok, 1000));
  }
  const hechas = filas.filter(f => f.tarjeta?.auto && f.estado !== 'propuesta').map(f => {
    const d = f.resultado?.detalle || f.resultado?.texto || '';
    return f.estado === 'ejecutada' ? `✓ ${d || 'Hecho.'}` : `⚠ ${d || 'No se pudo hacer.'}`;
  });
  const pendientes = filas.filter(f => !f.tarjeta?.auto && f.estado === 'propuesta').length;
  return { hechas, pendientes };
}
