// =====================================================================
// TELÉFONO — Phill hace cosas en el celular del dueño
// =====================================================================
// La función (supabase/functions/asistente-ia/telefono.ts) valida el pedido
// y lo manda en vivo (evento «telefono»). Aquí se ejecuta EN EL APARATO:
//   · En la app del teléfono, con el complemento nativo (alarma, llamada,
//     WhatsApp, calendario, mapas…).
//   · En el navegador solo lo que se puede con un enlace (llamar, WhatsApp,
//     SMS, mapa, calendario de Google, enlace): se deja un botón, porque el
//     navegador no deja abrir nada sin un toque.
//
// PRIVACIDAD: los números no pasan por la IA. Para llamar o escribir, la IA
// pasa el NOMBRE del contacto y aquí se busca en los contactos del teléfono;
// si el dueño dictó un número, llega como marca del carril privado
// ([TEL·1]) y se restaura aquí. Si hay dudas (dos Laura), se muestran las
// opciones en la tarjeta para que él toque la correcta.
// =====================================================================

import { useSyncExternalStore } from 'react';
import { restaurarPrivados } from './privados';
import { enAppDelTelefono, telefonoNativo, telefonoNativoDisponible, type PluginTelefono } from '../mobile/telefonoNativo';

export type AccionTelefono =
  | 'alarma' | 'temporizador' | 'abrir_app' | 'llamar' | 'whatsapp' | 'sms'
  | 'calendario' | 'mapa' | 'musica' | 'linterna' | 'ajustes' | 'enlace';

export interface PedidoTelefono {
  id: string; accion: AccionTelefono; titulo: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  datos: Record<string, any>;
}

export type EstadoTelefono = 'ejecutando' | 'hecho' | 'elegir' | 'permiso' | 'sin_contacto' | 'error' | 'solo_app' | 'web';
export interface OpcionTelefono { etiqueta: string; detalle?: string; valor: string }
export interface ResultadoTelefono {
  estado: EstadoTelefono;
  mensaje: string;
  /** Qué elegir (contactos con su número, o apps parecidas). */
  opciones?: OpcionTelefono[];
  /** Si se eligen apps, el `valor` es el paquete; si se eligen contactos, el número. */
  tipoOpciones?: 'numero' | 'app';
  /** Navegador: el enlace que abre la tarjeta con un toque. */
  enlace?: string;
}

// ------------------------- números y enlaces (puro) -------------------------
/** Un número para marcar: con «+» y código de país (Costa Rica, +506, si son 8 dígitos). */
export function aNumeroMarcable(v: string): string {
  const t = String(v || '').trim();
  const d = t.replace(/\D/g, '');
  if (!d) return '';
  if (t.startsWith('+')) return `+${d}`;
  if (d.length === 8) return `+506${d}`;
  if (d.length === 11 && d.startsWith('506')) return `+${d}`;
  return d.length > 8 ? `+${d}` : d;
}

const enc = encodeURIComponent;
const aFechaGoogle = (ms: number, soloFecha: boolean) => {
  const iso = new Date(ms).toISOString();
  return soloFecha ? iso.slice(0, 10).replace(/-/g, '') : iso.replace(/[-:]|\.\d{3}/g, '');
};

/** El enlace equivalente para el navegador (null si eso no se puede con un enlace). */
export function enlaceWeb(p: PedidoTelefono, numero: string, mensaje: string): string | null {
  const d = p.datos;
  switch (p.accion) {
    case 'llamar': return numero ? `tel:${numero}` : null;
    case 'whatsapp': return numero ? `https://wa.me/${numero.replace(/\D/g, '')}${mensaje ? `?text=${enc(mensaje)}` : ''}` : null;
    case 'sms': return numero ? `sms:${numero}${mensaje ? `?body=${enc(mensaje)}` : ''}` : null;
    case 'mapa': return d.navegar
      ? `https://www.google.com/maps/dir/?api=1&destination=${enc(String(d.consulta))}`
      : `https://www.google.com/maps/search/?api=1&query=${enc(String(d.consulta))}`;
    case 'calendario': {
      const ini = Number(d.inicioMs), fin = Number(d.finMs), todo = !!d.todoElDia;
      return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${enc(String(d.titulo))}&dates=${aFechaGoogle(ini, todo)}/${aFechaGoogle(fin, todo)}`
        + `${d.descripcion ? `&details=${enc(String(d.descripcion))}` : ''}${d.lugar ? `&location=${enc(String(d.lugar))}` : ''}`;
    }
    case 'enlace': return /^https?:\/\//i.test(String(d.url)) ? String(d.url) : null;
    default: return null;
  }
}

// ------------------------------- ejecutar -------------------------------
/** De dónde sale lo nativo (las pruebas lo cambian por uno de mentira). */
interface Entorno { plugin: () => PluginTelefono; nativo: () => boolean; enApp: () => boolean }
let entorno: Entorno = { plugin: () => telefonoNativo, nativo: telefonoNativoDisponible, enApp: enAppDelTelefono };
export function usarEntornoTelefono(e: Partial<Entorno> | null): void {
  entorno = e ? { ...entorno, ...e } : { plugin: () => telefonoNativo, nativo: telefonoNativoDisponible, enApp: enAppDelTelefono };
}

const hecho = (mensaje: string): ResultadoTelefono => ({ estado: 'hecho', mensaje });
const fallo = (mensaje: string): ResultadoTelefono => ({ estado: 'error', mensaje });

/**
 * Resuelve a quién: un número ya conocido, o busca el contacto por nombre.
 * Devuelve el número o un resultado listo para mostrar (elegir, permiso, no está…).
 */
async function resolverNumero(p: PedidoTelefono, privados: Record<string, string>, elegido?: string): Promise<{ numero: string } | { resultado: ResultadoTelefono }> {
  if (elegido) return { numero: aNumeroMarcable(elegido) };
  const dado = restaurarPrivados(String(p.datos.numero || ''), privados);
  if (dado && !/\[[A-ZÉ]+·\d+\]/.test(dado)) { const n = aNumeroMarcable(dado); if (n) return { numero: n }; }
  const nombre = String(p.datos.contacto || '').trim();
  if (!nombre) return { resultado: fallo('Me falta a quién. Decime el nombre del contacto o el número.') };
  if (!entorno.nativo()) {
    return { resultado: fallo(`Desde acá no puedo ver tus contactos. Decime el número de ${nombre} (o escribilo) y lo intento.`) };
  }
  const r = await entorno.plugin().contactos({ nombre });
  if (r.permiso === 'denegado') return { resultado: { estado: 'permiso', mensaje: `Para buscar a «${nombre}» necesito ver tus contactos. Tocá «Dar permiso» (el número no sale del teléfono).` } };
  if (!r.ok && r.error) return { resultado: fallo(r.error) };
  const lista = r.contactos || [];
  if (!lista.length) return { resultado: { estado: 'sin_contacto', mensaje: `No encontré a «${nombre}» en tus contactos. Decime su número (o escribilo) y lo intento.` } };
  const opciones: OpcionTelefono[] = lista.flatMap(c => c.numeros.map(n => ({ etiqueta: c.nombre, detalle: n, valor: n })));
  if (opciones.length === 1) return { numero: aNumeroMarcable(opciones[0].valor) };
  return { resultado: { estado: 'elegir', tipoOpciones: 'numero', mensaje: `Encontré más de una opción para «${nombre}». ¿Cuál?`, opciones: opciones.slice(0, 8) } };
}

/** Ejecuta un pedido. `elegido`: el número o el paquete que tocó el dueño entre las opciones. */
export async function ejecutarTelefono(p: PedidoTelefono, privados: Record<string, string>, elegido?: string): Promise<ResultadoTelefono> {
  const d = p.datos;
  const nativo = entorno.nativo();
  const plugin = nativo ? entorno.plugin() : null;
  const necesitaNumero = p.accion === 'llamar' || p.accion === 'whatsapp' || p.accion === 'sms';
  let numero = '';
  if (necesitaNumero) {
    const r = await resolverNumero(p, privados, elegido);
    if ('resultado' in r) return r.resultado;
    numero = r.numero;
  }
  const mensaje = restaurarPrivados(String(d.mensaje || ''), privados);

  if (!nativo) {
    // APK vieja (sin el complemento): se avisa. Navegador: un enlace con botón.
    if (entorno.enApp()) return { estado: 'solo_app', mensaje: 'Esta versión de la app todavía no puede hacer eso. Instalá la nueva.' };
    const enlace = enlaceWeb(p, numero, mensaje);
    if (enlace) return { estado: 'web', mensaje: 'Estás en el navegador: tocá para abrirlo.', enlace };
    return { estado: 'solo_app', mensaje: 'Eso solo se puede desde la app del teléfono.' };
  }

  let r: { ok: boolean; error?: string; app?: string; candidatos?: { nombre: string; paquete: string }[] };
  switch (p.accion) {
    case 'alarma': r = await plugin!.alarma({ hora: Number(d.hora), minutos: Number(d.minutos), dias: Array.isArray(d.dias) ? d.dias : [], etiqueta: String(d.etiqueta || '') }); break;
    case 'temporizador': r = await plugin!.temporizador({ segundos: Number(d.segundos), etiqueta: String(d.etiqueta || '') }); break;
    case 'abrir_app': r = await plugin!.abrirApp(elegido ? { paquete: elegido } : { nombre: String(d.app || '') }); break;
    case 'llamar': r = await plugin!.marcar({ numero }); break;
    case 'whatsapp': r = await plugin!.whatsapp({ numero: numero.replace(/\D/g, ''), mensaje }); break;
    case 'sms': r = await plugin!.sms({ numero, mensaje }); break;
    case 'calendario': r = await plugin!.calendario({ titulo: String(d.titulo), inicioMs: Number(d.inicioMs), finMs: Number(d.finMs), todoElDia: !!d.todoElDia, lugar: String(d.lugar || ''), descripcion: String(d.descripcion || '') }); break;
    case 'mapa': r = await plugin!.mapa({ consulta: String(d.consulta), navegar: !!d.navegar }); break;
    case 'musica': r = await plugin!.musica({ consulta: String(d.consulta) }); break;
    case 'linterna': r = await plugin!.linterna({ encender: d.encender !== false }); break;
    case 'ajustes': r = await plugin!.ajustes({ pantalla: String(d.pantalla || 'general') }); break;
    case 'enlace': r = await plugin!.enlace({ url: String(d.url) }); break;
    default: return fallo('No sé hacer eso todavía.');
  }
  if (r.candidatos?.length) {
    return { estado: 'elegir', tipoOpciones: 'app', mensaje: `Hay varias apps parecidas a «${d.app}». ¿Cuál abro?`, opciones: r.candidatos.slice(0, 6).map(c => ({ etiqueta: c.nombre, valor: c.paquete })) };
  }
  if (!r.ok) return fallo(r.error || 'No se pudo.');
  return hecho(p.accion === 'abrir_app' && r.app ? `Abrí ${r.app}.` : MENSAJE_HECHO[p.accion]);
}

const MENSAJE_HECHO: Record<AccionTelefono, string> = {
  alarma: 'Puesta en el reloj del teléfono.',
  temporizador: 'Corriendo en el reloj del teléfono.',
  abrir_app: 'Abierta.',
  llamar: 'Marcador abierto: tocá «Llamar».',
  whatsapp: 'WhatsApp abierto con el mensaje: tocá «Enviar».',
  sms: 'Mensaje listo: tocá «Enviar».',
  calendario: 'Evento listo: tocá «Guardar» en el calendario.',
  mapa: 'Mapa abierto.',
  musica: 'Buscando música.',
  linterna: 'Listo.',
  ajustes: 'Ajustes abiertos.',
  enlace: 'Abierto.',
};

// ------------------------- estado de cada tarjeta -------------------------
const estados = new Map<string, ResultadoTelefono>();
const oyentes = new Set<() => void>();
const avisar = () => { for (const f of oyentes) f(); };
const fijar = (id: string, r: ResultadoTelefono) => { estados.set(id, r); avisar(); };

export function estadoTelefono(id: string): ResultadoTelefono | undefined { return estados.get(id); }
export function useEstadoTelefono(id: string): ResultadoTelefono | undefined {
  return useSyncExternalStore(f => { oyentes.add(f); return () => { oyentes.delete(f); }; }, () => estados.get(id), () => undefined);
}

/**
 * Hace el pedido y deja el resultado a la vista de su tarjeta. Si ya se hizo (la IA
 * lo repitió, o es el mismo evento), no se repite; `forzar` es para «Hacerlo de nuevo».
 */
export async function correrTelefono(p: PedidoTelefono, privados: Record<string, string>, opciones: { elegido?: string; forzar?: boolean } = {}): Promise<void> {
  if (!p?.id || !p.accion) return;
  const previo = estados.get(p.id);
  if (previo && !opciones.elegido && !opciones.forzar) return;
  if (previo?.estado === 'ejecutando') return;
  fijar(p.id, { estado: 'ejecutando', mensaje: 'Haciéndolo…' });
  let r: ResultadoTelefono;
  try { r = await ejecutarTelefono(p, privados, opciones.elegido); }
  catch (e) { r = fallo(e instanceof Error && e.message ? e.message : 'No se pudo hacer en el teléfono.'); }
  fijar(p.id, r);
  for (const f of alTerminar) { try { f(p, r); } catch { /* quien escucha no frena el pedido */ } }
}

/** Pedidos que dejan OTRA app al frente (la ventanita de Phill se quita para que se vea). */
export const ABRE_OTRA_APP: ReadonlySet<AccionTelefono> = new Set<AccionTelefono>(['abrir_app', 'llamar', 'whatsapp', 'sms', 'calendario', 'mapa', 'musica', 'ajustes', 'enlace']);

const alTerminar = new Set<(p: PedidoTelefono, r: ResultadoTelefono) => void>();
/** Avisa cada pedido terminado (hecho o no). Devuelve cómo dejar de escuchar. */
export function alTerminarTelefono(f: (p: PedidoTelefono, r: ResultadoTelefono) => void): () => void {
  alTerminar.add(f);
  return () => { alTerminar.delete(f); };
}

/** Para pruebas: borra los estados. */
export function olvidarEstadosTelefono(): void { estados.clear(); avisar(); }
