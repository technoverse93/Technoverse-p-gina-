// =====================================================================
// UBICACIONES COMPARTIDAS — el lado servidor del panel interno de mapa
// =====================================================================
// `ubicacionCliente.ts` pide y guarda la ubicación EN ESTE aparato. Este
// módulo es lo que falta para que el administrador la vea: manda la
// ubicación ya consentida a Supabase (por un RPC `security definer`, así
// quien la comparte nunca lee la tabla) y la lee de vuelta para el panel.
//
// Nada aquí pide permisos por su cuenta: la ubicación llega YA obtenida
// desde el gesto de la persona (el botón de "usar mi ubicación" del
// checkout, o "compartir mi ubicación" del panel). El navegador o la APK
// es quien mostró el permiso nativo y quien la persona aceptó o negó.
// =====================================================================

import { supabase } from '../supabaseClient';
import { pedirUbicacion, type UbicacionCliente } from './ubicacionCliente';
import { obtenerDeviceId } from './huella';

export type RolUbicacion = 'cliente' | 'administrador';

export interface UbicacionRegistro {
  id: string;
  rol: RolUbicacion;
  nombre: string | null;
  email: string | null;
  lat: number;
  lon: number;
  precisionM: number | null;
  provincia: string | null;
  contexto: string | null;
  createdAt: string;
}

interface OpcionesRegistro {
  rol: RolUbicacion;
  nombre?: string | null;
  email?: string | null;
  contexto?: string | null;
}

/**
 * Manda al servidor una ubicación YA obtenida (no vuelve a pedir permiso).
 * Falla en silencio a propósito: si la tabla todavía no existe o no hay
 * red, la ubicación local sigue sirviendo para la entrega y la compra no
 * se cae por esto.
 */
export async function registrarUbicacionEnServidor(
  u: UbicacionCliente,
  opts: OpcionesRegistro
): Promise<void> {
  try {
    await supabase.rpc('registrar_ubicacion', {
      p_rol: opts.rol,
      p_nombre: opts.nombre?.trim() || null,
      p_email: opts.email?.trim() || null,
      p_lat: u.lat,
      p_lon: u.lon,
      p_precision: u.precisionM,
      p_provincia: u.provincia,
      p_contexto: opts.contexto || null,
      p_device: obtenerDeviceId(),
    });
  } catch {
    /* sin tabla/red: la ubicación local ya quedó guardada por su cuenta */
  }
}

/**
 * Pide la ubicación (permiso nativo) y, si la persona la concede, la
 * registra en el servidor. Es lo que usa el botón "compartir mi
 * ubicación" del propio administrador dentro del panel.
 */
export async function compartirUbicacion(opts: OpcionesRegistro): Promise<UbicacionCliente | null> {
  const u = await pedirUbicacion();
  if (!u) return null;
  await registrarUbicacionEnServidor(u, opts);
  return u;
}

// Se pregunta UNA sola vez por aparato al entrar. El navegador recuerda su
// propia decisión igual, pero esta bandera evita volver a disparar el
// pedido en cada recarga.
const CLAVE_PEDIDA_INICIO = 'technoverse_ubicacion_inicio_v1';

/**
 * Al entrar a la tienda por primera vez, ofrece el permiso NATIVO de
 * ubicación (el navegador/APK muestra aceptar o rechazar). Si acepta, se
 * comparte con nosotros; si rechaza, no pasa nada y sigue comprando igual.
 * No requiere un clic: la geolocalización sí puede pedirse al cargar.
 */
export async function pedirUbicacionAlEntrar(): Promise<void> {
  try {
    if (localStorage.getItem(CLAVE_PEDIDA_INICIO)) return;
    localStorage.setItem(CLAVE_PEDIDA_INICIO, '1');
  } catch {
    /* incógnito: no se puede recordar, se pide igual esta vez */
  }
  const u = await pedirUbicacion();
  if (u) await registrarUbicacionEnServidor(u, { rol: 'cliente', contexto: 'inicio' });
}

function desdeFila(r: any): UbicacionRegistro {
  return {
    id: String(r.id),
    rol: r.rol === 'administrador' ? 'administrador' : 'cliente',
    nombre: r.nombre || null,
    email: r.email || null,
    lat: Number(r.lat),
    lon: Number(r.lon),
    precisionM: r.precision_m == null ? null : Number(r.precision_m),
    provincia: r.provincia || null,
    contexto: r.contexto || null,
    createdAt: r.created_at,
  };
}

/** Lista las ubicaciones, más recientes primero. Solo responde al admin (RLS). */
export async function listarUbicaciones(limite = 200): Promise<UbicacionRegistro[]> {
  const { data, error } = await supabase
    .from('ubicaciones_compartidas')
    .select('id,rol,nombre,email,lat,lon,precision_m,provincia,contexto,created_at')
    .order('created_at', { ascending: false })
    .limit(limite);
  if (error) throw error;
  return (data || []).map(desdeFila);
}

/** Borra una ubicación (botón "Quitar"). Solo el superadmin puede (RLS). */
export async function olvidarUbicacionRegistro(id: string): Promise<void> {
  const { error } = await supabase.from('ubicaciones_compartidas').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Avisa al panel cuando entra o se borra una ubicación, para refrescar en
 * vivo sin recargar. Devuelve la función para desuscribirse.
 */
export function suscribirUbicaciones(alCambiar: () => void): () => void {
  const canal = supabase
    .channel(`ubicaciones-${Date.now()}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'ubicaciones_compartidas' },
      () => alCambiar()
    )
    .subscribe();
  return () => {
    try { supabase.removeChannel(canal); } catch { /* nada */ }
  };
}
