// =====================================================================
// CRM · LÓGICA PURA: tipos, embudo, seguimiento, segmentos y métricas
// =====================================================================
// Todo lo que decide el CRM sin tocar la red ni la pantalla (así se prueba con `npm run probar-crm`):
//   · las 6 etapas del embudo y sus rótulos;
//   · de la fila de la base (snake_case) al contacto de la app (camelCase);
//   · qué contactos están vencidos, para hoy o estancados;
//   · segmentos: un filtro que se aplica a los contactos (y a lo que compraron) para dirigir promociones;
//   · métricas: embudo, conversión, nuevos por semana, por canal y por origen, valor y ventas.
// La lectura y escritura en Supabase vive en `utils/crm.ts`; la captación desde la tienda, en `utils/crmCaptura.ts`.
// =====================================================================

export type EtapaCrm = 'nuevo' | 'conversacion' | 'cotizacion' | 'pago_pendiente' | 'cerrado' | 'postventa';
export type CanalCrm = 'chat_web' | 'tienda_form' | 'registro' | 'pedido' | 'taller' | 'manual' | 'whatsapp';
export type FuenteCrm = 'directo' | 'busqueda' | 'redes' | 'pauta' | 'correo' | 'referido';
export type TipoEventoCrm = 'creado' | 'etapa' | 'nota' | 'chat' | 'pedido' | 'taller' | 'registro' | 'formulario' | 'recordatorio' | 'contacto' | 'sistema';

export interface InfoEtapa { id: EtapaCrm; label: string; corto: string; ayuda: string }

/** El embudo, en orden. Las etapas solo avanzan solas; el personal las mueve a mano en cualquier sentido. */
export const ETAPAS: readonly InfoEtapa[] = [
  { id: 'nuevo',          label: 'Nuevo prospecto',          corto: 'Nuevos',       ayuda: 'Escribió o se registró y todavía nadie le respondió.' },
  { id: 'conversacion',   label: 'En conversación',          corto: 'Conversación', ayuda: 'Ya se habló con la persona: se está entendiendo qué necesita.' },
  { id: 'cotizacion',     label: 'Cotización / interés',     corto: 'Cotización',   ayuda: 'Tiene un precio en la mano o un equipo en diagnóstico.' },
  { id: 'pago_pendiente', label: 'Pendiente de pago',        corto: 'Por pagar',    ayuda: 'Aceptó: falta que pague o que retire lo que ya está listo.' },
  { id: 'cerrado',        label: 'Venta cerrada',            corto: 'Cerradas',     ayuda: 'Compró o pagó su reparación.' },
  { id: 'postventa',      label: 'Postventa / fidelización', corto: 'Postventa',    ayuda: 'Seguimiento después de la venta: garantía, recompra, recomendación.' },
];
export const ETAPAS_ABIERTAS: readonly EtapaCrm[] = ['nuevo', 'conversacion', 'cotizacion', 'pago_pendiente'];

export const CANALES: Record<CanalCrm, string> = {
  chat_web: 'Chat de la página', tienda_form: 'Formulario de la tienda', registro: 'Registro en la tienda',
  pedido: 'Pedido', taller: 'Taller', manual: 'Agregado a mano', whatsapp: 'WhatsApp',
};
export const FUENTES: Record<FuenteCrm, string> = {
  directo: 'Tráfico directo', busqueda: 'Buscadores', redes: 'Redes sociales', pauta: 'Pauta pagada', correo: 'Correo', referido: 'Otro sitio',
};
export const TIPOS_EVENTO: Record<TipoEventoCrm, string> = {
  creado: 'Contacto nuevo', etapa: 'Cambio de etapa', nota: 'Nota', chat: 'Chat', pedido: 'Pedido', taller: 'Taller',
  registro: 'Registro', formulario: 'Formulario', recordatorio: 'Seguimiento', contacto: 'Contacto hecho', sistema: 'Sistema',
};

export const PROVINCIAS = ['San José', 'Alajuela', 'Cartago', 'Heredia', 'Guanacaste', 'Puntarenas', 'Limón'] as const;

export interface OrigenCrm {
  utm_source?: string; utm_medium?: string; utm_campaign?: string; utm_content?: string;
  referrer?: string; landing?: string; producto?: string;
}

export interface LeadCrm {
  id: string;
  nombre: string;
  email: string | null;
  telefono: string | null;
  etapa: EtapaCrm;
  etapaDesde: string;
  canal: CanalCrm;
  origen: OrigenCrm;
  fuente: FuenteCrm;
  provincia: string | null;
  etiquetas: string[];
  valorEstimado: number;
  responsable: string | null;
  clienteId: string | null;
  conversacionId: string | null;
  proximoContacto: string | null;
  ultimaInteraccion: string;
  mensajes: number;
  archivado: boolean;
  creadoPor: string | null;
  creado: string;
  actualizado: string;
}

export interface EventoCrm { id: number; leadId: string; tipo: TipoEventoCrm; resumen: string; datos: Record<string, unknown>; autor: string | null; creado: string }
export interface RecordatorioCrm { id: string; leadId: string; vence: string; texto: string; hecho: boolean; hechoEn: string | null; creadoPor: string | null }
export interface RespuestaRapida { id: string; atajo: string; titulo: string; texto: string; orden: number; activa: boolean }
export interface SegmentoCrm { id: string; nombre: string; filtro: FiltroSegmento; creadoPor: string | null }

// ---------------------------------------------------------------------
// Fila de la base → objeto de la app
// ---------------------------------------------------------------------

const ETAPAS_VALIDAS = new Set<string>(ETAPAS.map(e => e.id));
const texto = (v: unknown): string => (typeof v === 'string' ? v : '');
const textoONulo = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

export function leadDesdeFila(f: any): LeadCrm {
  const etapa = ETAPAS_VALIDAS.has(f?.etapa) ? (f.etapa as EtapaCrm) : 'nuevo';
  const origen = f?.origen && typeof f.origen === 'object' && !Array.isArray(f.origen) ? (f.origen as OrigenCrm) : {};
  return {
    id: String(f?.id ?? ''),
    nombre: texto(f?.nombre),
    email: textoONulo(f?.email),
    telefono: textoONulo(f?.telefono),
    etapa,
    etapaDesde: texto(f?.etapa_cambiada_en),
    canal: (f?.canal in CANALES ? f.canal : 'manual') as CanalCrm,
    origen,
    fuente: (f?.fuente in FUENTES ? f.fuente : 'directo') as FuenteCrm,
    provincia: textoONulo(f?.provincia),
    etiquetas: Array.isArray(f?.etiquetas) ? f.etiquetas.filter((x: unknown) => typeof x === 'string') : [],
    valorEstimado: Number(f?.valor_estimado) || 0,
    responsable: textoONulo(f?.responsable),
    clienteId: textoONulo(f?.cliente_id),
    conversacionId: textoONulo(f?.conversacion_id),
    proximoContacto: textoONulo(f?.proximo_contacto),
    ultimaInteraccion: texto(f?.ultima_interaccion),
    mensajes: Number(f?.mensajes) || 0,
    archivado: !!f?.archivado,
    creadoPor: textoONulo(f?.creado_por),
    creado: texto(f?.created_at),
    actualizado: texto(f?.updated_at),
  };
}

export function eventoDesdeFila(f: any): EventoCrm {
  return {
    id: Number(f?.id) || 0, leadId: String(f?.lead_id ?? ''), tipo: (f?.tipo in TIPOS_EVENTO ? f.tipo : 'sistema') as TipoEventoCrm,
    resumen: texto(f?.resumen), datos: f?.datos && typeof f.datos === 'object' ? f.datos : {}, autor: textoONulo(f?.autor), creado: texto(f?.created_at),
  };
}

export function recordatorioDesdeFila(f: any): RecordatorioCrm {
  return {
    id: String(f?.id ?? ''), leadId: String(f?.lead_id ?? ''), vence: texto(f?.vence), texto: texto(f?.texto),
    hecho: !!f?.hecho, hechoEn: textoONulo(f?.hecho_en), creadoPor: textoONulo(f?.creado_por),
  };
}

export function respuestaDesdeFila(f: any): RespuestaRapida {
  return { id: String(f?.id ?? ''), atajo: texto(f?.atajo), titulo: texto(f?.titulo), texto: texto(f?.texto), orden: Number(f?.orden) || 0, activa: f?.activa !== false };
}

export function segmentoDesdeFila(f: any): SegmentoCrm {
  return { id: String(f?.id ?? ''), nombre: texto(f?.nombre), filtro: f?.filtro && typeof f.filtro === 'object' && !Array.isArray(f.filtro) ? f.filtro : {}, creadoPor: textoONulo(f?.creado_por) };
}

// ---------------------------------------------------------------------
// Texto y fechas
// ---------------------------------------------------------------------

export const normalizarEmail = (s?: string | null): string => (s || '').trim().toLowerCase();
/** Los últimos 8 dígitos (Costa Rica), con o sin +506, guiones o espacios. Vacío si no hay 8. */
export function normalizarTelefono(s?: string | null): string {
  const d = (s || '').replace(/\D/g, '');
  return d.length >= 8 ? d.slice(-8) : '';
}
const sinTildes = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const MS_DIA = 86_400_000;
export function diasDesde(iso: string | null | undefined, ahora: number): number {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? Math.floor((ahora - t) / MS_DIA) : 0;
}

/** «ahora», «hace 5 min», «hace 3 h», «hace 2 d», «hace 3 sem», «hace 4 meses». */
export function haceCuanto(iso: string | null | undefined, ahora: number): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return '';
  const min = Math.floor((ahora - t) / 60_000);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 14) return `hace ${d} d`;
  if (d < 60) return `hace ${Math.floor(d / 7)} sem`;
  const m = Math.floor(d / 30);
  return m < 12 ? `hace ${m} meses` : `hace ${Math.floor(m / 12)} a`;
}

/** Cuándo vence algo: «hoy 3:30 p. m.», «mañana», «en 3 d», «hace 2 d». */
export function cuandoVence(iso: string | null | undefined, ahora: number): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return '';
  const ini = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const dif = Math.round((ini(t) - ini(ahora)) / MS_DIA);
  const hora = new Date(t).toLocaleTimeString('es-CR', { hour: 'numeric', minute: '2-digit' });
  if (dif === 0) return t < ahora ? `hoy ${hora} (pasó)` : `hoy ${hora}`;
  if (dif === 1) return `mañana ${hora}`;
  if (dif === -1) return 'ayer';
  if (dif > 1) return `en ${dif} d`;
  return `hace ${-dif} d`;
}

export function iniciales(nombre?: string | null, email?: string | null): string {
  const base = (nombre || '').trim() || (email || '').trim();
  if (!base) return '?';
  const partes = base.split(/[\s@._-]+/).filter(Boolean);
  return ((partes[0]?.[0] || '') + (partes.length > 1 ? partes[1][0] : '')).toUpperCase() || '?';
}

/** «Ana María Mora» → «Ana»; «ANA» → «Ana». */
export function primerNombre(nombre?: string | null): string {
  const p = (nombre || '').trim().split(/\s+/)[0] || '';
  if (!p) return '';
  return p === p.toUpperCase() || p === p.toLowerCase() ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : p;
}

/** Reemplaza `{nombre}` por el primer nombre; sin nombre, quita la marca y el espacio que la precedía. */
export function plantillaConNombre(plantilla: string, nombre?: string | null): string {
  const n = primerNombre(nombre);
  return n ? plantilla.replace(/\{nombre\}/gi, n) : plantilla.replace(/\s*\{nombre\}/gi, '');
}

/** Lo que se muestra de una persona: su nombre, o su correo, o su teléfono. */
export function etiquetaDeLead(l: Pick<LeadCrm, 'nombre' | 'email' | 'telefono'>): string {
  return l.nombre.trim() || l.email || l.telefono || 'Sin nombre';
}

// ---------------------------------------------------------------------
// Compras (se arman con los pedidos que el panel ya tiene)
// ---------------------------------------------------------------------

export interface PedidoMin { id: string; customerEmail: string; total: number; status: string; timestamp: string }
export interface ResumenCompras { pedidos: number; total: number; ultima: string | null }

/** Pedidos completados agrupados por correo (los devueltos y cancelados no cuentan como compra). */
export function comprasPorCorreo(pedidos: readonly PedidoMin[]): Map<string, ResumenCompras> {
  const mapa = new Map<string, ResumenCompras>();
  for (const p of pedidos) {
    if (p.status !== 'Completado') continue;
    const correo = normalizarEmail(p.customerEmail);
    if (!correo) continue;
    const r = mapa.get(correo) || { pedidos: 0, total: 0, ultima: null };
    r.pedidos += 1;
    r.total += Number(p.total) || 0;
    if (p.timestamp && (!r.ultima || Date.parse(p.timestamp) > Date.parse(r.ultima))) r.ultima = p.timestamp;
    mapa.set(correo, r);
  }
  return mapa;
}

export const comprasDe = (l: Pick<LeadCrm, 'email'>, compras: ReadonlyMap<string, ResumenCompras>): ResumenCompras | null =>
  (l.email && compras.get(normalizarEmail(l.email))) || null;

// ---------------------------------------------------------------------
// Seguimiento
// ---------------------------------------------------------------------

export type EstadoSeguimiento = 'vencido' | 'hoy' | 'proximo' | 'sin_recordatorio';

export function estadoSeguimiento(l: Pick<LeadCrm, 'proximoContacto'>, ahora: number): EstadoSeguimiento {
  const t = l.proximoContacto ? Date.parse(l.proximoContacto) : NaN;
  if (!Number.isFinite(t)) return 'sin_recordatorio';
  if (t < ahora) return 'vencido';
  return new Date(t).toDateString() === new Date(ahora).toDateString() ? 'hoy' : 'proximo';
}

/**
 * Abierto, sin recordatorio y sin movimiento hace `dias` o más: nadie lo está atendiendo. Una conversación por
 * WhatsApp se enfría antes: a las 48 horas sin cerrar ya cuenta como sin atender (pedido del dueño, 2026-10-28).
 */
export function estaEstancado(l: LeadCrm, ahora: number, dias = 5): boolean {
  const umbral = l.canal === 'whatsapp' && l.etapa === 'conversacion' ? Math.min(dias, 2) : dias;
  return !l.archivado
    && ETAPAS_ABIERTAS.includes(l.etapa)
    && estadoSeguimiento(l, ahora) === 'sin_recordatorio'
    && diasDesde(l.ultimaInteraccion, ahora) >= umbral;
}

/** Más urgente primero: vencidos, luego lo que tuvo movimiento más reciente. */
export function ordenarPorUrgencia(leads: readonly LeadCrm[], ahora: number): LeadCrm[] {
  const peso = (l: LeadCrm) => (estadoSeguimiento(l, ahora) === 'vencido' ? 0 : 1);
  return [...leads].sort((a, b) => peso(a) - peso(b) || Date.parse(b.ultimaInteraccion || '') - Date.parse(a.ultimaInteraccion || ''));
}

export function coincideTexto(l: LeadCrm, consulta: string): boolean {
  const q = sinTildes(consulta.trim());
  if (!q) return true;
  const soloDigitos = q.replace(/\D/g, '');
  const campos = [l.nombre, l.email || '', l.provincia || '', CANALES[l.canal], FUENTES[l.fuente], ...l.etiquetas, l.origen.utm_campaign || ''].map(sinTildes);
  if (campos.some(c => c.includes(q))) return true;
  return soloDigitos.length >= 3 && normalizarTelefono(l.telefono).includes(soloDigitos.slice(-8));
}

// ---------------------------------------------------------------------
// Segmentos
// ---------------------------------------------------------------------

export interface FiltroSegmento {
  texto?: string;
  etapas?: EtapaCrm[];
  canales?: CanalCrm[];
  fuentes?: FuenteCrm[];
  /** Cualquiera de estas etiquetas. */
  etiquetas?: string[];
  provincias?: string[];
  conCorreo?: boolean;
  compra?: 'si' | 'no';
  /** Total comprado (₡) de al menos… */
  gastoMinimo?: number;
  /** Su última compra fue hace más de… días (implica que compró). */
  ultimaCompraHaceMasDe?: number;
  /** Su última interacción fue hace más de… días. */
  sinActividadMasDe?: number;
  incluirArchivados?: boolean;
}

export function aplicarFiltro(leads: readonly LeadCrm[], f: FiltroSegmento, compras: ReadonlyMap<string, ResumenCompras>, ahora: number): LeadCrm[] {
  return leads.filter(l => {
    if (l.archivado && !f.incluirArchivados) return false;
    if (f.texto && !coincideTexto(l, f.texto)) return false;
    if (f.etapas?.length && !f.etapas.includes(l.etapa)) return false;
    if (f.canales?.length && !f.canales.includes(l.canal)) return false;
    if (f.fuentes?.length && !f.fuentes.includes(l.fuente)) return false;
    if (f.etiquetas?.length && !f.etiquetas.some(e => l.etiquetas.includes(e))) return false;
    if (f.provincias?.length && !(l.provincia && f.provincias.includes(l.provincia))) return false;
    if (f.conCorreo && !l.email) return false;
    const c = comprasDe(l, compras);
    if (f.compra === 'si' && !c) return false;
    if (f.compra === 'no' && c) return false;
    if (f.gastoMinimo && (c?.total || 0) < f.gastoMinimo) return false;
    if (f.ultimaCompraHaceMasDe != null && f.ultimaCompraHaceMasDe >= 0) {
      if (!c?.ultima || diasDesde(c.ultima, ahora) <= f.ultimaCompraHaceMasDe) return false;
    }
    if (f.sinActividadMasDe != null && f.sinActividadMasDe >= 0 && diasDesde(l.ultimaInteraccion, ahora) <= f.sinActividadMasDe) return false;
    return true;
  });
}

/** El filtro en frases cortas, para mostrarlo como chips. */
export function describirFiltro(f: FiltroSegmento): string[] {
  const out: string[] = [];
  if (f.texto) out.push(`Texto: «${f.texto}»`);
  if (f.etapas?.length) out.push(`Etapa: ${f.etapas.map(e => ETAPAS.find(x => x.id === e)?.corto || e).join(', ')}`);
  if (f.canales?.length) out.push(`Canal: ${f.canales.map(c => CANALES[c]).join(', ')}`);
  if (f.fuentes?.length) out.push(`Origen: ${f.fuentes.map(c => FUENTES[c]).join(', ')}`);
  if (f.etiquetas?.length) out.push(`Etiqueta: ${f.etiquetas.join(', ')}`);
  if (f.provincias?.length) out.push(`Provincia: ${f.provincias.join(', ')}`);
  if (f.conCorreo) out.push('Con correo');
  if (f.compra === 'si') out.push('Ya compraron');
  if (f.compra === 'no') out.push('Nunca compraron');
  if (f.gastoMinimo) out.push(`Compraron ₡${Math.round(f.gastoMinimo).toLocaleString('es-CR')} o más`);
  if (f.ultimaCompraHaceMasDe != null) out.push(`Última compra hace más de ${f.ultimaCompraHaceMasDe} d`);
  if (f.sinActividadMasDe != null) out.push(`Sin actividad hace más de ${f.sinActividadMasDe} d`);
  if (f.incluirArchivados) out.push('Con archivados');
  return out;
}

export const SEGMENTOS_SUGERIDOS: readonly { id: string; nombre: string; ayuda: string; filtro: FiltroSegmento }[] = [
  { id: 'recompra', nombre: 'Para recompra', ayuda: 'Compraron hace más de 60 días y tienen correo.', filtro: { compra: 'si', ultimaCompraHaceMasDe: 60, conCorreo: true } },
  { id: 'sin_respuesta', nombre: 'Prospectos sin respuesta', ayuda: 'Nuevos que llevan más de 3 días sin movimiento.', filtro: { etapas: ['nuevo'], sinActividadMasDe: 3 } },
  { id: 'cotizaciones_paradas', nombre: 'Cotizaciones paradas', ayuda: 'En cotización o por pagar, sin movimiento hace más de 5 días.', filtro: { etapas: ['cotizacion', 'pago_pendiente'], sinActividadMasDe: 5 } },
  { id: 'postventa', nombre: 'Postventa por contactar', ayuda: 'Ya compraron y llevan más de 15 días sin que se les escriba.', filtro: { etapas: ['cerrado', 'postventa'], sinActividadMasDe: 15 } },
  { id: 'mejores', nombre: 'Mejores clientes', ayuda: 'Más de ₡100 000 en compras.', filtro: { compra: 'si', gastoMinimo: 100_000 } },
  { id: 'con_correo', nombre: 'Todos con correo', ayuda: 'Para un aviso general.', filtro: { conCorreo: true } },
];

// ---------------------------------------------------------------------
// Exportar
// ---------------------------------------------------------------------

const celdaCsv = (v: string | number | null | undefined): string => {
  let s = v == null ? '' : String(v);
  // Una celda que empieza con = + - @ se abriría como fórmula en Excel: se desactiva.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function aCsv(leads: readonly LeadCrm[], compras: ReadonlyMap<string, ResumenCompras>): string {
  const cab = ['Nombre', 'Correo', 'Teléfono', 'Etapa', 'Canal', 'Origen', 'Campaña', 'Provincia', 'Etiquetas', 'Valor estimado', 'Pedidos', 'Total comprado', 'Última interacción'];
  const filas = leads.map(l => {
    const c = comprasDe(l, compras);
    return [l.nombre, l.email, l.telefono, ETAPAS.find(e => e.id === l.etapa)?.label, CANALES[l.canal], FUENTES[l.fuente], l.origen.utm_campaign || '',
      l.provincia, l.etiquetas.join(' | '), l.valorEstimado || '', c?.pedidos ?? 0, c?.total ?? 0, l.ultimaInteraccion.slice(0, 10)].map(celdaCsv).join(',');
  });
  return [cab.map(celdaCsv).join(','), ...filas].join('\r\n');
}

/** Los correos de una lista, sin repetir y listos para pegar en «Para» o «CCO». */
export function correosDe(leads: readonly LeadCrm[]): string[] {
  const vistos = new Set<string>();
  const salida: string[] = [];
  for (const l of leads) {
    const e = normalizarEmail(l.email);
    if (e && !vistos.has(e)) { vistos.add(e); salida.push(e); }
  }
  return salida;
}

// ---------------------------------------------------------------------
// Métricas
// ---------------------------------------------------------------------

export interface MetricasCrm {
  total: number;
  abiertos: number;
  ganados: number;
  porEtapa: { etapa: EtapaCrm; n: number; valor: number }[];
  /** Los que llegaron al menos a cada etapa y qué parte pasó a la siguiente. */
  embudo: { etapa: EtapaCrm; n: number; paso: number | null }[];
  /** Ganados (venta cerrada o postventa) entre todos los contactos; null si no hay contactos. */
  conversion: number | null;
  nuevos7: number;
  nuevosPrevios7: number;
  nuevos30: number;
  /** Contactos nuevos por semana (lunes a domingo): las últimas 8, la última es la actual. */
  semanas: { desde: string; n: number }[];
  porCanal: { clave: CanalCrm; n: number; ganados: number }[];
  porFuente: { clave: FuenteCrm; n: number; ganados: number }[];
  /** Días entre que apareció y que se cerró, de los que están hoy en «Venta cerrada». */
  diasPromedioCierre: number | null;
  vencidos: number;
  paraHoy: number;
  estancados: number;
  valorAbierto: number;
  /** ₡ vendidos en los últimos 30 días a personas que están en el CRM. */
  ventas30: number;
}

const rango = (e: EtapaCrm): number => ETAPAS.findIndex(x => x.id === e);

function lunesDe(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

export function calcularMetricas(todos: readonly LeadCrm[], pedidos: readonly PedidoMin[], ahora: number): MetricasCrm {
  const leads = todos.filter(l => !l.archivado);
  const ganados = (l: LeadCrm) => l.etapa === 'cerrado' || l.etapa === 'postventa';

  const porEtapa = ETAPAS.map(e => {
    const de = leads.filter(l => l.etapa === e.id);
    return { etapa: e.id, n: de.length, valor: de.reduce((s, l) => s + l.valorEstimado, 0) };
  });
  const alcanzaron = ETAPAS.map((_, i) => leads.filter(l => rango(l.etapa) >= i).length);
  const embudo = ETAPAS.map((e, i) => ({ etapa: e.id, n: alcanzaron[i], paso: i < ETAPAS.length - 1 && alcanzaron[i] > 0 ? alcanzaron[i + 1] / alcanzaron[i] : null }));

  const hace = (d: number) => ahora - d * MS_DIA;
  const creadoMs = (l: LeadCrm) => Date.parse(l.creado) || 0;
  const nuevos7 = leads.filter(l => creadoMs(l) >= hace(7)).length;
  const nuevosPrevios7 = leads.filter(l => creadoMs(l) >= hace(14) && creadoMs(l) < hace(7)).length;
  const nuevos30 = leads.filter(l => creadoMs(l) >= hace(30)).length;

  const lunesActual = lunesDe(ahora);
  const semanas = Array.from({ length: 8 }, (_, k) => {
    const d = new Date(lunesActual);
    d.setDate(d.getDate() - 7 * (7 - k));
    const ini = d.getTime();
    const fin = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7).getTime();
    return { desde: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, n: leads.filter(l => creadoMs(l) >= ini && creadoMs(l) < fin).length };
  });

  const agrupar = <K extends string>(clave: (l: LeadCrm) => K) => {
    const m = new Map<K, { n: number; ganados: number }>();
    for (const l of leads) { const k = clave(l); const r = m.get(k) || { n: 0, ganados: 0 }; r.n++; if (ganados(l)) r.ganados++; m.set(k, r); }
    return [...m.entries()].map(([k, v]) => ({ clave: k, ...v })).sort((a, b) => b.n - a.n);
  };

  const cerrados = leads.filter(l => l.etapa === 'cerrado' && l.etapaDesde && l.creado);
  const dias = cerrados.map(l => Math.max(0, (Date.parse(l.etapaDesde) - Date.parse(l.creado)) / MS_DIA)).filter(Number.isFinite);

  const correos = new Set(leads.map(l => normalizarEmail(l.email)).filter(Boolean));
  const ventas30 = pedidos
    .filter(p => p.status === 'Completado' && correos.has(normalizarEmail(p.customerEmail)) && Date.parse(p.timestamp) >= hace(30))
    .reduce((s, p) => s + (Number(p.total) || 0), 0);

  return {
    total: leads.length,
    abiertos: leads.filter(l => ETAPAS_ABIERTAS.includes(l.etapa)).length,
    ganados: leads.filter(ganados).length,
    porEtapa,
    embudo,
    conversion: leads.length ? leads.filter(ganados).length / leads.length : null,
    nuevos7, nuevosPrevios7, nuevos30,
    semanas,
    porCanal: agrupar(l => l.canal),
    porFuente: agrupar(l => l.fuente),
    diasPromedioCierre: dias.length ? dias.reduce((a, b) => a + b, 0) / dias.length : null,
    vencidos: leads.filter(l => estadoSeguimiento(l, ahora) === 'vencido').length,
    paraHoy: leads.filter(l => estadoSeguimiento(l, ahora) === 'hoy').length,
    estancados: leads.filter(l => estaEstancado(l, ahora)).length,
    valorAbierto: leads.filter(l => ETAPAS_ABIERTAS.includes(l.etapa)).reduce((s, l) => s + l.valorEstimado, 0),
    ventas30,
  };
}

/** Las respuestas rápidas de partida (las mismas que trae la migración); sirven mientras la base no las tenga. */
export const RESPUESTAS_BASE: readonly { atajo: string; titulo: string; texto: string }[] = [
  { atajo: 'hola',        titulo: 'Saludo',                   texto: '¡Hola {nombre}! Gracias por escribirnos a Technoverse. ¿En qué te podemos ayudar?' },
  { atajo: 'cotizar',     titulo: 'Pedir datos para cotizar', texto: 'Claro {nombre}. Para cotizarte necesito la marca y el modelo del equipo y qué falla presenta. Con eso te paso el precio y el tiempo estimado.' },
  { atajo: 'pagos',       titulo: 'Formas de pago',           texto: 'Aceptamos SINPE Móvil, tarjeta y efectivo. Cuando confirmés, te paso el detalle para que todo quede registrado.' },
  { atajo: 'garantia',    titulo: 'Garantía',                 texto: 'Todas las reparaciones llevan garantía de al menos 3 meses, según la Ley 7472, sobre la pieza y la mano de obra del trabajo realizado.' },
  { atajo: 'seguimiento', titulo: 'Seguimiento',              texto: 'Hola {nombre}, te escribo para saber cómo te fue con tu compra o reparación. ¿Todo funcionando bien?' },
  { atajo: 'gracias',     titulo: 'Agradecimiento',           texto: '¡Gracias por tu compra, {nombre}! Cualquier duda con tu equipo, escribinos por acá.' },
];

/**
 * Las respuestas que corresponden a lo escrito tras «/» en el chat: primero las que EMPIEZAN con el atajo (`/co` → «cotizar»), luego las
 * que lo contienen y al final las que lo tienen en el título o en el texto. Sin tildes ni mayúsculas; dentro de cada grupo se respeta el
 * orden de la lista. Sin consulta (o solo «/») devuelve todas.
 */
export function filtrarRespuestas<T extends { atajo: string; titulo: string; texto: string }>(lista: readonly T[], consulta: string): T[] {
  const q = sinTildes(consulta.trim().replace(/^\//, '').trim());
  if (!q) return [...lista];
  const grupo = (r: T): number => {
    if (sinTildes(r.atajo).startsWith(q)) return 0;
    if (sinTildes(r.atajo).includes(q)) return 1;
    if (sinTildes(r.titulo).includes(q)) return 2;
    return sinTildes(r.texto).includes(q) ? 3 : -1;
  };
  return lista.map((r, i) => ({ r, i, g: grupo(r) })).filter(x => x.g >= 0).sort((a, b) => a.g - b.g || a.i - b.i).map(x => x.r);
}

/** Fechas de seguimiento más usadas, a las 9:00 de la mañana (hora local). */
export function fechaDeSeguimiento(diasDesdeHoy: number, ahora: number): Date {
  const d = new Date(ahora);
  d.setDate(d.getDate() + diasDesdeHoy);
  d.setHours(9, 0, 0, 0);
  return d;
}

/** Un contacto con el mismo correo o teléfono que otro (para avisar antes de crear un duplicado). */
export function buscarDuplicado(leads: readonly LeadCrm[], email?: string | null, telefono?: string | null, exceptoId?: string): LeadCrm | null {
  const e = normalizarEmail(email);
  const t = normalizarTelefono(telefono);
  return leads.find(l => l.id !== exceptoId && ((e && normalizarEmail(l.email) === e) || (t && normalizarTelefono(l.telefono) === t))) || null;
}
