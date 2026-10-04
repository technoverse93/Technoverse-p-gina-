import ConfigurarDesbloqueoLocal from './security/ConfigurarDesbloqueoLocal';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ShieldAlert, Globe, Ban, CheckCircle, XCircle, RefreshCw, Trash2,
  MapPin, Smartphone, Monitor, Plus, Unlock, Lock, BookOpen, Activity,
  Users, UserX, Search, ShieldOff, Fingerprint, Smartphone as Movil
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import { getDB, saveDB } from '../utils/storage';
import { obtenerMiConexion } from '../utils/adminLogin';
import {
  soportaBiometria, registrarBiometria, misLlaves, borrarLlave, LlaveBiometrica,
  tipoDeBiometria, biometriaYaActivada, desactivarBiometriaNativa,
} from '../utils/biometria';
import { AuditLog } from '../types';
import { PaginatedTbody } from './PaginationHelper';
import { useToast, useConfirm } from './ui/Overlays';
import { Btn } from './admin/AdminKit';
import { Glifo } from './security/Glifos';
import { esAdminSupremo } from '../utils/securityPin';
import MapaModal from './ui/MapaModal';

// =====================================================================
// CENTRO DE CIBERSEGURIDAD
// =====================================================================
// Una sola pantalla, dividida en las dos cosas que en realidad son
// distintas y que antes estaban mezcladas:
//
// A) SEGURIDAD ADMINISTRATIVA — la puerta de atrás. Quién intenta entrar
//    al panel, defensa contra fuerza bruta y bloqueo de IPs.
//      · Resumen        — el estado de un vistazo
//      · Accesos        — cada intento, con IP, ubicación y dispositivo
//      · Dispositivos   — aparatos reconocidos
//      · Bloqueos       — la lista negra de IPs, con desbloqueo manual
//      · Lista blanca   — conexiones de confianza que nunca se bloquean
//      · Bitácora       — el registro de acciones operativas
//
// B) TRÁFICO Y USUARIOS — la puerta de adelante. Quién visita la tienda
//    y a quién se le ha retirado el derecho de usarla.
//      · Visitantes     — un renglón por aparato: IP, sistema, navegador
//      · Penalizados    — las cuentas con baneo total, y cómo levantarlo
//
// La separación no es cosmética: son dos trabajos distintos. Uno se mira
// cuando algo huele a intrusión; el otro, cuando hay un problema con un
// cliente concreto. Tenerlos juntos hacía que ninguno se revisara.
//
// La pestaña "Bitácora de Auditoría" que existía aparte quedó absorbida
// aquí: es exactamente la misma tabla, con el mismo botón de limpiar. No
// se perdió nada, solo dejó de estar suelta.
//
// SOBRE LA TELEMETRÍA DE VISITANTES: no incluye ubicación. A un cliente
// que solo viene a comprar no se le pide permiso de GPS — la IP ya dice
// país y provincia, que es lo que sirve para un reclamo, y pedir más
// espanta gente sin aportar nada.
// =====================================================================

interface CyberSecurityPanelProps {
  auditLog: AuditLog[];
  currentUserEmail?: string;
  onAuditLogChanged?: () => void;
}

type Vertiente = 'admin' | 'trafico';
type Seccion =
  | 'resumen' | 'accesos' | 'dispositivos' | 'bloqueos' | 'blanca' | 'bitacora'
  | 'visitantes' | 'penalizados' | 'aparatos' | 'biometria';
type FiltroAccesos = 'todos' | 'exitosos' | 'fallidos' | 'bloqueados';

/** Un aparato que entró a la tienda. Un renglón por aparato, no por visita. */
interface Visitante {
  huella: string;
  primera_visita: string;
  ultima_visita: string;
  visitas: number;
  ip: string | null;
  user_agent: string | null;
  navegador: string | null;
  version_navegador: string | null;
  sistema: string | null;
  version_sistema: string | null;
  dispositivo: string | null;
  tipo: string | null;
  plataforma: string | null;
  idioma: string | null;
  zona_horaria: string | null;
  pantalla: string | null;
  memoria_gb: number | null;
  nucleos: number | null;
  origen: string | null;
  email: string | null;
  ultima_ruta: string | null;
  /** Marcado por el superadmin: el resto del personal no lo ve (RLS). */
  oculto_personal?: boolean;
}

/** Una cuenta con baneo total vigente o ya levantado. */
interface Penalizado {
  email: string;
  nombre: string | null;
  motivo: string | null;
  ip_al_banear: string | null;
  user_agent_al_banear: string | null;
  bloquear_user_agent: boolean;
  ips_bloqueadas: string[] | null;
  creado_en: string;
  creado_por: string | null;
  levantado_en: string | null;
  levantado_por: string | null;
}

/** Un aparato con el acceso cortado. Sustituye al viejo baneo por IP. */
interface AparatoBaneado {
  device_uuid: string;
  motivo: string | null;
  email: string | null;
  user_agent: string | null;
  creado_en: string;
  creado_por: string | null;
  levantado_en: string | null;
}

interface Acceso {
  id: number;
  ocurrido_en: string;
  email: string | null;
  exito: boolean;
  bloqueado: boolean;
  motivo: string | null;
  ip: string | null;
  user_agent: string | null;
  origen: string | null;
  pais: string | null;
  codigo_pais: string | null;
  region: string | null;
  ciudad: string | null;
  latitud: number | null;
  longitud: number | null;
  zona_horaria: string | null;
  proveedor: string | null;
  device_id: string | null;
  dispositivo_conocido: boolean | null;
  // Ubicación real del GPS. Solo existe cuando quien entró es una cuenta
  // administrativa Y autorizó el permiso. Cuando está, manda sobre la de
  // la IP, que apenas alcanza para la ciudad.
  gps_latitud: number | null;
  gps_longitud: number | null;
  gps_precision_m: number | null;
  gps_capturado_en: string | null;
}

interface Dispositivo {
  device_id: string;
  primer_visto: string;
  ultimo_visto: string;
  ultimo_email: string | null;
  etiqueta: string | null;
  user_agent: string | null;
  origen: string | null;
  ingresos: number;
  confiable: boolean;
}

interface Bloqueo {
  ip: string;
  creado_en: string;
  actualizado_en: string;
  bloqueado_hasta: string | null;
  nivel: number;
  permanente: boolean;
  motivo: string | null;
  intentos_fallidos: number;
  ultimo_email: string | null;
  pais: string | null;
  ciudad: string | null;
  desbloqueado_en: string | null;
  // true = la IP no puede ni abrir el sitio (lo corta el Worker de
  // Cloudflare antes de entregar el HTML). false = solo se le cierra el
  // inicio de sesión, pero puede seguir viendo la tienda y comprando.
  bloqueo_total: boolean;
}

interface Confianza {
  ip: string;
  descripcion: string | null;
  creado_en: string;
  creado_por: string | null;
}

// Convierte "CR" en 🇨🇷 usando los caracteres indicadores regionales. Es
// solo decorativo: si el código no es válido no se muestra nada.
function bandera(codigo?: string | null): string {
  if (!codigo || codigo.length !== 2 || !/^[a-zA-Z]{2}$/.test(codigo)) return '';
  return String.fromCodePoint(
    ...codigo.toUpperCase().split('').map(c => 0x1f1e6 + c.charCodeAt(0) - 65)
  );
}

// Del User-Agent completo (que es larguísimo e ilegible) se saca solo lo
// que de verdad sirve para reconocer un dispositivo de un vistazo.
function resumirDispositivo(ua?: string | null): string {
  if (!ua) return 'Desconocido';
  const so =
    /Android/i.test(ua) ? 'Android' :
    /iPhone|iPad|iPod/i.test(ua) ? 'iOS' :
    /Windows/i.test(ua) ? 'Windows' :
    /Mac OS X|Macintosh/i.test(ua) ? 'macOS' :
    /Linux/i.test(ua) ? 'Linux' : 'Otro';
  const navegador =
    /Edg\//i.test(ua) ? 'Edge' :
    /OPR\/|Opera/i.test(ua) ? 'Opera' :
    /Chrome\//i.test(ua) ? 'Chrome' :
    /Firefox\//i.test(ua) ? 'Firefox' :
    /Safari\//i.test(ua) ? 'Safari' : '';
  return navegador ? `${so} · ${navegador}` : so;
}

function ubicacionTexto(a: { ciudad?: string | null; region?: string | null; pais?: string | null }): string {
  const partes = [a.ciudad, a.region, a.pais].filter(Boolean) as string[];
  // Evita "San José, San José, Costa Rica": en Costa Rica la ciudad y la
  // provincia se llaman igual muy seguido.
  const unicas = partes.filter((p, i) => partes.indexOf(p) === i);
  return unicas.length ? unicas.join(', ') : 'Ubicación desconocida';
}

function fechaCorta(iso?: string | null): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('es-CR'); } catch { return String(iso); }
}

function minutosRestantes(hasta?: string | null): number {
  if (!hasta) return 0;
  const ms = new Date(hasta).getTime() - Date.now();
  return ms > 0 ? Math.ceil(ms / 60000) : 0;
}

// ---- Forma propia de Ciberseguridad (riel, glifos, libro, diario) ----
const GLIFO_SECCION: Record<Seccion, string> = {
  resumen: 'pulso', accesos: 'libro', dispositivos: 'cred', bloqueos: 'cuenta', blanca: 'pase',
  biometria: 'boveda', bitacora: 'diario', visitantes: 'dir', penalizados: 'exp', aparatos: 'etq',
};
const PISTA_SECCION: Record<Seccion, string> = {
  resumen: 'Panorama de las últimas 24 horas',
  accesos: 'Quién entró y quién lo intentó',
  dispositivos: 'Los aparatos que ya conocemos',
  bloqueos: 'Conexiones frenadas y el tiempo que les queda',
  blanca: 'Conexiones de confianza que nunca se bloquean',
  biometria: 'Huella, cara y PIN de respaldo',
  bitacora: 'Lo que se hizo en el sistema',
  visitantes: 'Aparatos que pasaron por la tienda',
  penalizados: 'Cuentas con baneo total',
  aparatos: 'Bloqueo por identificador de aparato',
};
/** Minutos que dura cada nivel de castigo (30 min, 2 h, 24 h). Con eso el
 *  reloj de Bloqueos dibuja qué parte del castigo queda por cumplir. */
const DURACION_NIVEL: Record<number, number> = { 0: 30, 1: 30, 2: 120, 3: 1440 };
const POR_PAGINA_ACCESOS = 12;
const POR_PAGINA_BITACORA = 10;
const COLORES_MODULO = ['#2B7C86', '#6D5BD0', '#C07A1E', '#2B6CB0', '#B83280', '#2F7D63'];
function colorModulo(clave?: string | null): string {
  let h = 0;
  for (const ch of clave || '') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORES_MODULO[h % COLORES_MODULO.length];
}
/** "Hoy", "Ayer" o la fecha corta: encabeza cada día del libro y del diario. */
function diaDe(iso: string): string {
  const d = new Date(iso);
  const hoy = new Date();
  const ayer = new Date(); ayer.setDate(hoy.getDate() - 1);
  const mismo = (x: Date, y: Date) => x.toDateString() === y.toDateString();
  if (mismo(d, hoy)) return 'Hoy';
  if (mismo(d, ayer)) return 'Ayer';
  return d.toLocaleDateString('es-CR', { weekday: 'long', day: 'numeric', month: 'long' });
}
function horaDe(iso: string): string {
  try { return new Date(iso).toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit', hour12: false }); } catch { return ''; }
}
function esMovil(ua?: string | null, origen?: string | null): boolean {
  return origen === 'apk' || /Android|iPhone|iPad|iPod|Mobile/i.test(ua || '');
}
function Vacio({ g, texto }: { g: string; texto: string }) {
  return (
    <div className="sg-card sg-vac2">
      <span className="sg-em"><Glifo n={g} /></span>
      <p style={{ maxWidth: '44ch', margin: 0 }}>{texto}</p>
    </div>
  );
}
function Paginador({ pagina, total, porPagina, onCambiar }: { pagina: number; total: number; porPagina: number; onCambiar: (p: number) => void }) {
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  return (
    <div className="sg-pag">
      <span className="tabular-nums">{(pagina - 1) * porPagina + 1}–{Math.min(pagina * porPagina, total)} de {total}</span>
      <div>
        <button type="button" aria-label="Página anterior" disabled={pagina <= 1} onClick={() => onCambiar(pagina - 1)}>‹</button>
        <button type="button" aria-label="Página siguiente" disabled={pagina >= paginas} onClick={() => onCambiar(pagina + 1)}>›</button>
      </div>
    </div>
  );
}

function CyberSecurityPanel({
  auditLog,
  currentUserEmail,
  onAuditLogChanged,
}: CyberSecurityPanelProps) {
  const toast = useToast();
  const confirm = useConfirm();
  // Bloqueos y ubicación son exclusivos del superadmin (la misma regla que
  // los módulos Bloqueos y Ubicaciones): al resto del personal ni se le
  // muestran los apartados ni los botones.
  const esSupremo = esAdminSupremo(currentUserEmail);

  const [vertiente, setVertiente] = useState<Vertiente>('admin');
  const [seccion, setSeccion] = useState<Seccion>('resumen');
  const [visitantes, setVisitantes] = useState<Visitante[]>([]);
  const [penalizados, setPenalizados] = useState<Penalizado[]>([]);
  const [buscarVisitante, setBuscarVisitante] = useState('');
  // Paginación propia: `PaginatedTbody` renderiza <tbody>, y esta sección
  // dejó de ser una tabla para poder verse bien en un celular.
  const [paginaVisitantes, setPaginaVisitantes] = useState(1);
  const [visitanteDetalle, setVisitanteDetalle] = useState<Visitante | null>(null);
  const [baneoModal, setBaneoModal] = useState<{ email: string; nombre?: string | null } | null>(null);
  const [baneoMotivo, setBaneoMotivo] = useState('');
  const [baneoUsarUA, setBaneoUsarUA] = useState(false);
  const [baneando, setBaneando] = useState(false);
  const [aparatos, setAparatos] = useState<AparatoBaneado[]>([]);
  const [nuevoAparato, setNuevoAparato] = useState('');
  const [llaves, setLlaves] = useState<LlaveBiometrica[]>([]);
  const [hayBiometria, setHayBiometria] = useState(false);
  const [registrandoLlave, setRegistrandoLlave] = useState(false);
  // Dentro de la APK la biometría funciona distinto (plugin nativo), así
  // que la pantalla tiene que explicar lo que corresponde a cada caso.
  const [esApk] = useState(() => tipoDeBiometria() === 'nativa');
  const [huellaActivada, setHuellaActivada] = useState(false);
  const [conteos, setConteos] = useState<any>(null);
  const [limpiando, setLimpiando] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [accesos, setAccesos] = useState<Acceso[]>([]);
  const [bloqueos, setBloqueos] = useState<Bloqueo[]>([]);
  const [confianza, setConfianza] = useState<Confianza[]>([]);
  const [dispositivos, setDispositivos] = useState<Dispositivo[]>([]);
  const [filtro, setFiltro] = useState<FiltroAccesos>('todos');
  const [detalle, setDetalle] = useState<Acceso | null>(null);
  // Mapa DENTRO de la app para "ver el lugar" (ver ui/MapaModal). Reemplaza
  // los enlaces que abrían Google Maps en una pestaña nueva.
  const [mapa, setMapa] = useState<{ lat: number; lon: number; titulo: string; etiqueta: string } | null>(null);

  const [miIp, setMiIp] = useState<string | null>(null);
  const [miGeo, setMiGeo] = useState<any>(null);
  const [nuevaIpBlanca, setNuevaIpBlanca] = useState('');
  const [nuevaDescripcion, setNuevaDescripcion] = useState('');
  const [nuevaIpBloqueo, setNuevaIpBloqueo] = useState('');

  // -------------------------------------------------------------------
  const cargar = useCallback(async () => {
    setCargando(true);
    const [a, b, c, d, e, f, g] = await Promise.all([
      supabase.from('login_audit_logs').select('*').order('ocurrido_en', { ascending: false }).limit(300),
      supabase.from('banned_ips').select('*').order('actualizado_en', { ascending: false }),
      supabase.from('ip_whitelist').select('*').order('creado_en', { ascending: false }),
      supabase.from('known_devices').select('*').order('ultimo_visto', { ascending: false }),
      // Tope de 500: es un panel para mirar, no un almacén. Lo viejo lo
      // limpia `purgar_huellas()` en la base.
      supabase.from('visitor_fingerprints').select('*').order('ultima_visita', { ascending: false }).limit(500),
      supabase.from('blocked_users_list').select('*').order('creado_en', { ascending: false }),
      supabase.from('banned_devices').select('*').order('creado_en', { ascending: false }),
    ]);
    // Se avisa del fallo en vez de mostrar una pantalla vacía que parecería
    // decir "no hay ningún intento registrado" — que es lo contrario de lo
    // que uno necesita creer en un panel de seguridad.
    const fallo = a.error || b.error || c.error || d.error || e.error || f.error || g.error;
    if (fallo) {
      toast.error('No se pudo leer el registro de seguridad: ' + fallo.message);
    }
    setAccesos((a.data as Acceso[]) || []);
    setBloqueos((b.data as Bloqueo[]) || []);
    setConfianza((c.data as Confianza[]) || []);
    setDispositivos((d.data as Dispositivo[]) || []);
    setVisitantes((e.data as Visitante[]) || []);
    setPenalizados((f.data as Penalizado[]) || []);
    setAparatos((g.data as AparatoBaneado[]) || []);
    // Cuántos registros hay y cuántos son viejos. Sin esto, "0 eliminados"
    // se lee como un fallo cuando en realidad significa que no había nada
    // tan antiguo — que es exactamente lo que estaba pasando.
    const { data: resumenHistorial } = await supabase.rpc('conteo_historial');
    setConteos(resumenHistorial || null);
    setCargando(false);
  }, [toast]);

  useEffect(() => { cargar(); }, [cargar]);

  useEffect(() => {
    obtenerMiConexion().then(r => {
      if (r) { setMiIp(r.ip); setMiGeo(r.geo); }
    });
  }, []);

  useEffect(() => {
    let vigente = true;
    soportaBiometria().then(puede => { if (vigente) setHayBiometria(puede); });
    biometriaYaActivada().then(x => { if (vigente) setHuellaActivada(x); });
    // Las llaves WebAuthn solo existen en la web; en la APK la lista sale
    // vacía y no se muestra.
    if (tipoDeBiometria() === 'webauthn') {
      misLlaves().then(l => { if (vigente) setLlaves(l); });
    }
    return () => { vigente = false; };
  }, []);

  // -------------------------------------------------------------------
  const resumen = useMemo(() => {
    const hace24h = Date.now() - 24 * 60 * 60 * 1000;
    const recientes = accesos.filter(a => new Date(a.ocurrido_en).getTime() >= hace24h);
    const activos = bloqueos.filter(
      b => !b.desbloqueado_en && (b.permanente || minutosRestantes(b.bloqueado_hasta) > 0)
    );
    const ultimoExito = accesos.find(a => a.exito);
    return {
      intentos24h: recientes.length,
      fallidos24h: recientes.filter(a => !a.exito).length,
      exitosos24h: recientes.filter(a => a.exito).length,
      bloqueosActivos: activos.length,
      ultimoExito,
    };
  }, [accesos, bloqueos]);

  const accesosFiltrados = useMemo(() => {
    if (filtro === 'exitosos')   return accesos.filter(a => a.exito);
    if (filtro === 'fallidos')   return accesos.filter(a => !a.exito && !a.bloqueado);
    if (filtro === 'bloqueados') return accesos.filter(a => a.bloqueado);
    return accesos;
  }, [accesos, filtro]);

  /** Oculta (o vuelve a mostrar) un aparato de Visitantes al resto del
   *  personal. La regla la hace cumplir la base: `visitante_ocultar` solo
   *  acepta al superadmin y la política de lectura esconde la fila. */
  const ocultarAlPersonal = async (g: GrupoVisitante, ocultar: boolean) => {
    const { error } = await supabase.rpc('visitante_ocultar', { p_huellas: g.huellas, p_ocultar: ocultar });
    if (error) { toast.error('No se pudo cambiar: ' + error.message); return; }
    setVisitantes(prev => prev.map(v => g.huellas.includes(v.huella) ? { ...v, oculto_personal: ocultar } : v));
    toast.success(ocultar ? 'El resto del personal ya no ve este aparato.' : 'El aparato vuelve a estar a la vista del personal.');
  };

  // En el teléfono el riel es un mosaico deslizable: el apartado abierto
  // se trae a la vista para que no quede escondido a un costado.
  useEffect(() => {
    document.querySelector('#view-ciberseguridad .sg-ri.sg-on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [seccion]);

  const [paginaAccesos, setPaginaAccesos] = useState(1);
  const accesosPagina = useMemo(
    () => accesosFiltrados.slice((paginaAccesos - 1) * POR_PAGINA_ACCESOS, paginaAccesos * POR_PAGINA_ACCESOS),
    [accesosFiltrados, paginaAccesos]);
  const [paginaBitacora, setPaginaBitacora] = useState(1);
  const bitacoraPagina = useMemo(
    () => auditLog.slice((paginaBitacora - 1) * POR_PAGINA_BITACORA, paginaBitacora * POR_PAGINA_BITACORA),
    [auditLog, paginaBitacora]);

  /** Las últimas 24 horas en 24 casillas (la última es la hora en curso).
   *  Cada casilla toma el color de lo peor que pasó en ella. */
  const horas24 = useMemo(() => {
    const ahora = Date.now();
    const casillas = Array.from({ length: 24 }, () => ({ total: 0, clase: '' as '' | 'o' | 'f' | 'b' }));
    for (const a of accesos) {
      const hace = ahora - new Date(a.ocurrido_en).getTime();
      if (hace < 0 || hace >= 24 * 3600000) continue;
      const c = casillas[23 - Math.floor(hace / 3600000)];
      c.total++;
      const t = a.bloqueado ? 'b' : a.exito ? 'o' : 'f';
      const peso = { '': 0, o: 1, f: 2, b: 3 };
      if (peso[t] > peso[c.clase]) c.clase = t;
    }
    return casillas;
  }, [accesos]);
  const maxHora = Math.max(1, ...horas24.map(h => h.total));

  // ---- Acciones -----------------------------------------------------
  const desbloquear = async (ip: string) => {
    const ok = await confirm({
      title: 'Desbloquear conexión',
      message: `Se levantará el bloqueo de la IP ${ip} y el contador de castigo volverá a empezar desde cero. ¿Continuar?`,
      confirmText: 'Desbloquear',
    });
    if (!ok) return;
    // nivel = 0 para que el próximo bloqueo de esta IP vuelva a ser el más
    // corto (30 min). Si no se reiniciara, un desbloqueo manual seguiría
    // arrastrando el castigo escalado de antes, que ya se perdonó.
    const { error } = await supabase
      .from('banned_ips')
      .update({ desbloqueado_en: new Date().toISOString(), nivel: 0, actualizado_en: new Date().toISOString() })
      .eq('ip', ip);
    if (error) { toast.error('No se pudo desbloquear: ' + error.message); return; }
    toast.success(`Conexión ${ip} desbloqueada.`);
    cargar();
  };

  const bloquearManual = async (ip: string, permanente: boolean) => {
    const limpia = ip.trim();
    if (!limpia) { toast.warning('Escriba la dirección IP que desea bloquear.'); return; }
    if (confianza.some(c => c.ip === limpia)) {
      toast.warning('Esa IP está en la lista blanca. Quítela de ahí primero, si no el bloqueo no tendría efecto.');
      return;
    }
    const { error } = await supabase.from('banned_ips').upsert({
      ip: limpia,
      permanente,
      nivel: permanente ? 3 : 1,
      bloqueado_hasta: permanente ? null : new Date(Date.now() + 30 * 60000).toISOString(),
      motivo: `Bloqueo manual del administrador (${currentUserEmail || 'admin'})`,
      // Un bloqueo puesto a mano es una decisión deliberada: cierra el
      // sitio entero. Después se puede bajar a "solo login" desde la ficha.
      bloqueo_total: true,
      desbloqueado_en: null,
      actualizado_en: new Date().toISOString(),
    });
    if (error) { toast.error('No se pudo bloquear: ' + error.message); return; }
    toast.success(`IP ${limpia} bloqueada ${permanente ? 'de forma permanente' : 'por 30 minutos'}.`);
    setNuevaIpBloqueo('');
    cargar();
  };

  // ---- Tráfico y usuarios -------------------------------------------
  const visitantesFiltrados = useMemo(() => {
    const q = buscarVisitante.trim().toLowerCase();
    if (!q) return visitantes;
    return visitantes.filter(v =>
      [v.ip, v.email, v.dispositivo, v.sistema, v.navegador, v.huella]
        .some(campo => (campo || '').toLowerCase().includes(q))
    );
  }, [visitantes, buscarVisitante]);

  /**
   * Un renglón por APARATO FÍSICO, no por identidad guardada.
   *
   * POR QUÉ HACE FALTA AGRUPAR, si la tabla ya guarda una fila por marca:
   * la marca vive en el navegador, y Safari en iPhone borra el
   * almacenamiento de los sitios que no se visitan en siete días. El
   * mismo teléfono vuelve entonces con una marca nueva y aparece como un
   * visitante distinto. En unas semanas la lista se llena de renglones
   * que en realidad son la misma persona.
   *
   * Se agrupa por el correo cuando lo hay —es la señal más fuerte— y por
   * modelo + sistema + navegador + pantalla cuando es anónimo. Dos
   * teléfonos idénticos y sin sesión pueden caer en el mismo renglón; se
   * asume a propósito, porque es preferible a una lista ilegible, y el
   * renglón dice cuántas identidades agrupa para que no haya sorpresas.
   *
   * Al bloquear un renglón se bloquean TODAS sus marcas de una vez.
   */
  interface GrupoVisitante {
    clave: string;
    huellas: string[];
    visitas: number;
    ip: string | null;
    email: string | null;
    dispositivo: string | null;
    tipo: string | null;
    sistema: string | null;
    version_sistema: string | null;
    navegador: string | null;
    version_navegador: string | null;
    origen: string | null;
    primera: string;
    ultima: string;
    reciente: Visitante;
    oculto: boolean;
  }

  const visitantesAgrupados = useMemo<GrupoVisitante[]>(() => {
    const mapa = new Map<string, GrupoVisitante>();

    for (const v of visitantes) {
      const clave = v.email
        ? `c:${v.email.toLowerCase()}`
        : `a:${[v.dispositivo, v.sistema, v.version_sistema, v.navegador, v.pantalla]
            .map(x => (x || '').toLowerCase()).join('|')}`;

      const existente = mapa.get(clave);
      if (!existente) {
        mapa.set(clave, {
          clave,
          huellas: [v.huella],
          visitas: v.visitas || 1,
          ip: v.ip, email: v.email,
          dispositivo: v.dispositivo, tipo: v.tipo,
          sistema: v.sistema, version_sistema: v.version_sistema,
          navegador: v.navegador, version_navegador: v.version_navegador,
          origen: v.origen,
          primera: v.primera_visita,
          ultima: v.ultima_visita,
          reciente: v,
          oculto: !!v.oculto_personal,
        });
        continue;
      }

      existente.huellas.push(v.huella);
      if (v.oculto_personal) existente.oculto = true;
      existente.visitas += v.visitas || 1;
      if (v.primera_visita < existente.primera) existente.primera = v.primera_visita;
      // Los datos que se muestran son los de la visita más reciente: si el
      // aparato cambió de red o de versión, interesa lo último, no lo viejo.
      if (v.ultima_visita > existente.ultima) {
        existente.ultima = v.ultima_visita;
        existente.ip = v.ip;
        existente.reciente = v;
        existente.version_sistema = v.version_sistema;
        existente.version_navegador = v.version_navegador;
      }
      if (!existente.email && v.email) existente.email = v.email;
    }

    return [...mapa.values()].sort((a, b) => b.ultima.localeCompare(a.ultima));
  }, [visitantes]);

  const maxVisitas = useMemo(() => Math.max(1, ...visitantesAgrupados.map(g => g.visitas)), [visitantesAgrupados]);
  const gruposFiltrados = useMemo(() => {
    const q = buscarVisitante.trim().toLowerCase();
    if (!q) return visitantesAgrupados;
    return visitantesAgrupados.filter(g =>
      [g.ip, g.email, g.dispositivo, g.sistema, g.navegador, ...g.huellas]
        .some(campo => (campo || '').toLowerCase().includes(q))
    );
  }, [visitantesAgrupados, buscarVisitante]);

  /** Bloquea de una vez todas las marcas que agrupa el renglón. */
  const banearGrupo = async (g: GrupoVisitante) => {
    const ok = await confirm({
      title: 'Bloquear este aparato',
      message: g.huellas.length > 1
        ? `Se bloquearán las ${g.huellas.length} identidades de este equipo. No podrá abrir el sitio desde ninguna red. ¿Continuar?`
        : 'Este equipo no podrá abrir el sitio desde ninguna red, ni WiFi ni datos móviles. ¿Continuar?',
      confirmText: 'Bloquear',
      variant: 'danger',
    });
    if (!ok) return;

    const motivo = g.email
      ? `Bloqueo desde visitantes (${g.email})`
      : 'Bloqueo desde visitantes';
    for (const huella of g.huellas) {
      const { error } = await supabase.rpc('banear_dispositivo', { p_device: huella, p_motivo: motivo });
      if (error) { toast.error('No se pudo bloquear: ' + error.message); return; }
    }
    toast.success(g.huellas.length > 1
      ? `${g.huellas.length} identidades bloqueadas.`
      : 'Aparato bloqueado.');
    cargar();
  };

  const emailsPenalizados = useMemo(
    () => new Set(penalizados.filter(x => !x.levantado_en).map(x => x.email.toLowerCase())),
    [penalizados]
  );

  /**
   * Baneo total. Lo hace TODO la función de base de datos
   * `banear_cliente_total`, no este componente: si se hiciera desde aquí
   * con varias llamadas sueltas, una que fallara a medias dejaría al
   * cliente bloqueado por un lado y libre por el otro.
   */
  const aplicarBaneoTotal = async () => {
    if (!baneoModal) return;
    setBaneando(true);
    const { data, error } = await supabase.rpc('banear_cliente_total', {
      p_email: baneoModal.email,
      p_motivo: baneoMotivo.trim() || null,
      p_bloquear_user_agent: baneoUsarUA,
    });
    setBaneando(false);
    if (error) { toast.error('No se pudo aplicar el baneo: ' + error.message); return; }
    const total = (data as any)?.total_ips ?? 0;
    toast.success(
      `Cuenta ${baneoModal.email} penalizada.` +
      (total > 0 ? ` Se bloquearon ${total} ${total === 1 ? 'dirección IP' : 'direcciones IP'}.` : '')
    );
    setBaneoModal(null); setBaneoMotivo(''); setBaneoUsarUA(false);
    cargar();
  };

  const levantarBaneo = async (email: string) => {
    const ok = await confirm({
      title: 'Levantar la penalización',
      message: `${email} volverá a poder entrar a la tienda y comprar. Se liberarán además las IPs que se bloquearon por este baneo — las que estén bloqueadas por otro motivo se quedan como están. ¿Continuar?`,
      confirmText: 'Levantar',
    });
    if (!ok) return;
    const { error } = await supabase.rpc('levantar_baneo_cliente', { p_email: email });
    if (error) { toast.error('No se pudo levantar: ' + error.message); return; }
    toast.success(`Penalización de ${email} levantada.`);
    cargar();
  };

  const banearAparato = async (device: string, motivo?: string) => {
    const limpio = device.trim();
    if (!limpio) { toast.warning('Escriba el identificador del aparato.'); return; }
    const { error } = await supabase.rpc('banear_dispositivo', {
      p_device: limpio,
      p_motivo: motivo || `Bloqueo manual (${currentUserEmail || 'admin'})`,
    });
    if (error) { toast.error('No se pudo bloquear: ' + error.message); return; }
    toast.success('Aparato bloqueado. No podrá abrir el sitio desde ninguna red.');
    setNuevoAparato('');
    cargar();
  };

  const liberarAparato = async (device: string) => {
    const ok = await confirm({
      title: 'Liberar el aparato',
      message: 'Este equipo volverá a poder abrir el sitio y comprar. ¿Continuar?',
      confirmText: 'Liberar',
    });
    if (!ok) return;
    const { error } = await supabase.rpc('levantar_dispositivo', { p_device: device });
    if (error) { toast.error('No se pudo liberar: ' + error.message); return; }
    toast.success('Aparato liberado.');
    cargar();
  };

  const activarBiometria = async () => {
    setRegistrandoLlave(true);
    try {
      const r = await registrarBiometria(navigator.userAgent.slice(0, 60));
      if (!r.ok) {
        if (!r.cancelado) toast.error(r.mensaje || 'No se pudo activar.');
        return;
      }
      toast.success(r.mensaje || 'Acceso biométrico activado.');
      setHuellaActivada(await biometriaYaActivada());
      if (!esApk) setLlaves(await misLlaves());
    } finally {
      setRegistrandoLlave(false);
    }
  };

  const quitarLlave = async (id: number) => {
    const ok = await confirm({
      title: 'Quitar el acceso biométrico',
      message: 'Este aparato dejará de poder entrar con Face ID o huella. Podrá seguir entrando con su contraseña. ¿Continuar?',
      confirmText: 'Quitar',
      variant: 'danger',
    });
    if (!ok) return;
    const r = await borrarLlave(id);
    if (!r.ok) { toast.error(r.mensaje || 'No se pudo quitar.'); return; }
    toast.success('Acceso biométrico retirado de ese aparato.');
    setLlaves(await misLlaves());
  };

  const agregarConfianza = async (ip: string, descripcion: string) => {
    const limpia = ip.trim();
    if (!limpia) { toast.warning('Escriba la dirección IP de confianza.'); return; }
    const { error } = await supabase.from('ip_whitelist').upsert({
      ip: limpia,
      descripcion: descripcion.trim() || 'Conexión de confianza',
      creado_por: currentUserEmail || 'admin',
    });
    if (error) { toast.error('No se pudo agregar: ' + error.message); return; }
    toast.success(`IP ${limpia} agregada a la lista blanca.`);
    setNuevaIpBlanca(''); setNuevaDescripcion('');
    cargar();
  };

  const quitarConfianza = async (ip: string) => {
    const ok = await confirm({
      title: 'Quitar de la lista blanca',
      message: `La IP ${ip} dejará de ser de confianza y volverá a poder bloquearse por intentos fallidos. ¿Continuar?`,
      confirmText: 'Quitar',
      variant: 'danger',
    });
    if (!ok) return;
    const { error } = await supabase.from('ip_whitelist').delete().eq('ip', ip);
    if (error) { toast.error('No se pudo quitar: ' + error.message); return; }
    toast.success(`IP ${ip} retirada de la lista blanca.`);
    cargar();
  };

  const cambiarAlcanceBloqueo = async (b: Bloqueo) => {
    // Este interruptor existe por una razón concreta: en Costa Rica los
    // operadores móviles reparten una misma IP pública entre cientos de
    // personas. Un bloqueo total sobre una IP así deja sin poder comprar
    // a gente que no hizo nada. Poder bajarlo a "solo login" caso por caso
    // evita tener que elegir entre seguridad y ventas.
    const { error } = await supabase
      .from('banned_ips')
      .update({ bloqueo_total: !b.bloqueo_total, actualizado_en: new Date().toISOString() })
      .eq('ip', b.ip);
    if (error) { toast.error('No se pudo cambiar el alcance: ' + error.message); return; }
    toast.success(b.bloqueo_total
      ? `${b.ip}: ahora solo se le bloquea el inicio de sesión. Puede seguir viendo la tienda.`
      : `${b.ip}: ahora se le bloquea el sitio web completo.`);
    cargar();
  };

  const renombrarDispositivo = async (d: Dispositivo) => {
    const nombre = window.prompt(
      'Póngale un nombre a este aparato para reconocerlo después (ej. "Mi celular", "Compu del local"):',
      d.etiqueta || ''
    );
    if (nombre === null) return;
    const { error } = await supabase
      .from('known_devices')
      .update({ etiqueta: nombre.trim() || null })
      .eq('device_id', d.device_id);
    if (error) { toast.error('No se pudo guardar el nombre: ' + error.message); return; }
    cargar();
  };

  const cambiarConfianzaDispositivo = async (d: Dispositivo) => {
    // Marcar como NO reconocido no borra el aparato: lo deja en la lista
    // pero hace que vuelva a salir en rojo si alguien lo usa otra vez. Eso
    // es justo lo que uno quiere si sospecha de un aparato en concreto.
    const { error } = await supabase
      .from('known_devices')
      .update({ confiable: !d.confiable })
      .eq('device_id', d.device_id);
    if (error) { toast.error('No se pudo cambiar: ' + error.message); return; }
    toast.success(d.confiable
      ? 'Aparato marcado como NO reconocido. Volverá a salir en rojo la próxima vez.'
      : 'Aparato marcado como de confianza.');
    cargar();
  };

  const olvidarDispositivo = async (d: Dispositivo) => {
    const ok = await confirm({
      title: 'Olvidar este aparato',
      message: `Se borrará "${d.etiqueta || d.device_id.slice(0, 12)}" de la lista de conocidos. Si se vuelve a usar, aparecerá como aparato nuevo. El historial de accesos NO se toca.`,
      confirmText: 'Olvidar',
      variant: 'danger',
    });
    if (!ok) return;
    const { error } = await supabase.from('known_devices').delete().eq('device_id', d.device_id);
    if (error) { toast.error('No se pudo olvidar: ' + error.message); return; }
    toast.success('Aparato olvidado.');
    cargar();
  };

  /**
   * Depura el historial de ACCESOS (login_audit_logs).
   *
   * ACLARACIÓN IMPORTANTE, porque parecía un fallo y no lo era: la purga
   * de 90 días "no borraba nada" sencillamente porque no había nada de
   * más de 90 días — el registro más viejo del sistema tiene semanas. La
   * función siempre funcionó. Lo que faltaba era decir cuántos registros
   * se iban a borrar ANTES de confirmar, para que "0 eliminados" no se
   * leyera como una avería.
   *
   * Con `dias = 0` se borra todo.
   */
  const purgarHistorial = async (dias: number) => {
    const cuantos = dias === 0
      ? (conteos?.accesos_total ?? 0)
      : dias === 30 ? (conteos?.accesos_30 ?? 0) : (conteos?.accesos_90 ?? 0);

    const ok = await confirm({
      title: dias === 0 ? 'Borrar TODO el historial de accesos' : `Depurar accesos de más de ${dias} días`,
      message: cuantos === 0
        ? `No hay ningún registro que cumpla ese criterio, así que no se borrará nada. El registro más antiguo es del ${conteos?.accesos_mas_viejo ? new Date(conteos.accesos_mas_viejo).toLocaleDateString() : '—'}. ¿Continuar de todas formas?`
        : `Se borrarán ${cuantos} registro(s) de acceso. Esto no se puede deshacer. ¿Continuar?`,
      confirmText: dias === 0 ? 'Borrar todo' : 'Depurar',
      variant: 'danger',
    });
    if (!ok) return;

    setLimpiando(true);
    try {
      const { data, error } = await supabase.rpc('purgar_login_audit_logs', { p_dias: dias });
      if (error) { toast.error('No se pudo depurar: ' + error.message); return; }
      toast.success(`${data ?? 0} registro(s) de acceso eliminado(s).`);
      cargar();
    } finally {
      setLimpiando(false);
    }
  };

  /**
   * Limpia la bitácora operativa (audit_logs).
   *
   * FALLO QUE ESTO CORRIGE: antes esto solo vaciaba la COPIA LOCAL y
   * dejaba que la sincronización se encargara de borrar en la base. Pero
   * `audit_logs` tenía políticas de lectura, alta y modificación y
   * NINGUNA de borrado: con RLS activa, lo que no está permitido está
   * prohibido, así que el borrado se rechazaba en silencio devolviendo
   * "0 filas". La bitácora se veía vacía en pantalla y volvía completa en
   * cuanto la aplicación se resincronizaba.
   *
   * Se arregló por los dos lados: se agregó la política de borrado, y
   * ahora el borrado lo hace una función del servidor en una sola
   * operación, sin depender de que el navegador tenga cargada la lista.
   */
  const limpiarBitacora = async () => {
    const ok = await confirm({
      title: 'Limpiar bitácora operativa',
      message: `Se borrarán ${conteos?.bitacora_total ?? 0} registro(s) de acciones del sistema y quedará únicamente el asiento de la limpieza. Los accesos e intentos de ingreso NO se tocan. ¿Continuar?`,
      confirmText: 'Limpiar',
      variant: 'danger',
    });
    if (!ok) return;

    setLimpiando(true);
    try {
      const { data, error } = await supabase.rpc('purgar_bitacora', { p_dias: 0 });
      if (error) { toast.error('No se pudo limpiar: ' + error.message); return; }

      // La copia local se vacía DESPUÉS de que el servidor confirmó. Al
      // revés, un fallo del servidor dejaría la pantalla en blanco con los
      // datos todavía en la base.
      const db = getDB();
      db.audit_log = [{
        id: 'LOG-RESET',
        userEmail: currentUserEmail || 'admin',
        module: 'Seguridad',
        action: 'Reset Bitácora',
        detail: `Bitácora depurada por el Dueño. ${data ?? 0} registro(s) eliminado(s).`,
        timestamp: new Date().toISOString(),
      }];
      await saveDB(db);
      if (onAuditLogChanged) onAuditLogChanged();
      toast.success(`Bitácora depurada. ${data ?? 0} registro(s) eliminado(s).`);
      cargar();
    } finally {
      setLimpiando(false);
    }
  };

  // -------------------------------------------------------------------
  const seccionesPorVertiente: Record<Vertiente, { id: Seccion; label: string; icono: any; contador?: number }[]> = {
    admin: [
      { id: 'resumen',      label: 'Resumen',      icono: Activity },
      { id: 'accesos',      label: 'Accesos',      icono: Globe,      contador: accesos.length },
      { id: 'dispositivos', label: 'Dispositivos', icono: Smartphone, contador: dispositivos.length },
      { id: 'bloqueos',     label: 'Bloqueos',     icono: Ban,        contador: resumen.bloqueosActivos },
      { id: 'blanca',       label: 'Lista blanca', icono: CheckCircle, contador: confianza.length },
      { id: 'biometria',    label: 'Biometría',    icono: Fingerprint, contador: llaves.length },
      { id: 'bitacora',     label: 'Bitácora',     icono: BookOpen,   contador: auditLog.length },
    ],
    trafico: [
      { id: 'visitantes',  label: 'Visitantes',  icono: Users, contador: visitantes.length },
      { id: 'penalizados', label: 'Penalizados', icono: UserX, contador: penalizados.filter(x => !x.levantado_en).length },
      { id: 'aparatos',    label: 'Aparatos bloqueados', icono: Movil, contador: aparatos.filter(x => !x.levantado_en).length },
    ],
  };
  /**
   * Las DIEZ vistas del módulo, como carpetas de una sola fila.
   *
   * Antes esto eran cuatro capas apiladas: título del módulo, dos
   * tarjetas grandes de "vertiente", y una fila de pestañas que solo
   * mostraba las de la vertiente elegida. 358 px de navegación antes del
   * primer número, y las tres vistas de tráfico invisibles hasta que
   * alguien descubriera que la tarjeta de la derecha era un botón.
   *
   * Ahora las diez están siempre a la vista, en una sola fila, separadas
   * por una línea entre los dos bloques. La vertiente deja de ser una
   * pantalla aparte y pasa a ser lo que siempre fue: una agrupación.
   */
  const SOLO_SUPREMO: Seccion[] = ['bloqueos', 'blanca', 'penalizados', 'aparatos'];
  useEffect(() => { if (!esSupremo && SOLO_SUPREMO.includes(seccion)) setSeccion('resumen'); }, [esSupremo, seccion]); // eslint-disable-line react-hooks/exhaustive-deps
  const carpetas = useMemo(() => ([
    ...seccionesPorVertiente.admin.map(s => ({
      id: s.id as string, label: s.label, icon: s.icono, contador: s.contador, grupo: 'admin',
    })),
    ...seccionesPorVertiente.trafico.map(s => ({
      id: s.id as string, label: s.label, icon: s.icono, contador: s.contador, grupo: 'trafico',
    })),
  ].filter(c => esSupremo || !SOLO_SUPREMO.includes(c.id as Seccion))), [seccionesPorVertiente, esSupremo]);

  /** Al elegir una carpeta se ajusta también su vertiente, que sigue
   *  gobernando qué datos se cargan y se refrescan. */
  const abrirCarpeta = (id: string) => {
    const esDeTrafico = seccionesPorVertiente.trafico.some(s => s.id === id);
    setVertiente(esDeTrafico ? 'trafico' : 'admin');
    setSeccion(id as Seccion);
  };

  return (
    <div className="space-y-5" id="view-ciberseguridad">

      {/* Ciberseguridad tiene su propia forma: un riel de apartados con
          glifos de dos tonos (en teléfono, mosaico deslizable) y cada
          apartado con un formato distinto. No reutiliza las carpetas ni
          los íconos de los demás módulos, a propósito. */}
      <div className="sg-cx">
        <nav className="sg-riel" aria-label="Apartados de Ciberseguridad">
          <div className="sg-cab">Apartados</div>
          {carpetas.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => abrirCarpeta(c.id)}
              aria-current={seccion === c.id ? 'page' : undefined}
              className={`sg-ri ${seccion === c.id ? 'sg-on' : ''} ${(c.id === 'bloqueos' || c.id === 'penalizados' || c.id === 'aparatos') && c.contador ? 'sg-alerta' : ''}`}
            >
              <Glifo n={GLIFO_SECCION[c.id as Seccion]} />
              <span>{c.label}</span>
              {!!c.contador && <em>{c.contador}</em>}
            </button>
          ))}
        </nav>

        <div className="sg-zona">
          <div className="sg-tit">
            <span className="sg-em"><Glifo n={GLIFO_SECCION[seccion]} className="sg-lg" /></span>
            <div className="sg-tx">
              <h2 role="heading" aria-level={1}>{carpetas.find(c => c.id === seccion)?.label}</h2>
              <p>{PISTA_SECCION[seccion]}</p>
            </div>
            <Btn variant="default" onClick={cargar} disabled={cargando}>
              {cargando ? 'Actualizando…' : 'Actualizar'}
            </Btn>
          </div>

          <div className="sg-cuerpo">

      {/* =============== RESUMEN: el pulso del día =============== */}
      {seccion === 'resumen' && (
        <>
          <div className="sg-card sg-pulso">
            <div>
              <span className="sg-k">Hoy, {new Date().toLocaleDateString('es-CR', { day: 'numeric', month: 'long' })}</span>
              <h3 style={{ marginTop: 4 }}>
                {resumen.intentos24h === 0
                  ? 'Ningún intento de ingreso en las últimas 24 horas'
                  : `${resumen.exitosos24h} de ${resumen.intentos24h} intento${resumen.intentos24h === 1 ? '' : 's'} fueron correctos`}
              </h3>
              <p className="sg-sub">
                {resumen.fallidos24h === 0 ? 'Ningún fallo' : resumen.fallidos24h === 1 ? 'Un solo fallo' : `${resumen.fallidos24h} fallos`}
                {resumen.bloqueosActivos === 0 ? ' y ningún bloqueo activo. Todo en calma.' : ` y ${resumen.bloqueosActivos} bloqueo${resumen.bloqueosActivos === 1 ? '' : 's'} activo${resumen.bloqueosActivos === 1 ? '' : 's'}.`}
              </p>
            </div>
            {/* Una barra por hora de las últimas 24 h: el color dice lo
                peor que pasó en esa hora y el alto, cuántos intentos. */}
            <div>
              <div className="sg-reloj" role="img" aria-label="Intentos de ingreso por hora en las últimas 24 horas">
                {horas24.map((h, i) => (
                  <i
                    key={i}
                    className={`${h.clase ? 'sg-' + h.clase : ''} ${i === 23 ? 'sg-now' : ''}`}
                    style={h.total ? { height: `${30 + Math.round((h.total / maxHora) * 70)}%` } : undefined}
                    title={h.total ? `${h.total} intento(s)` : undefined}
                  />
                ))}
              </div>
              <div className="sg-eje" style={{ marginTop: 6 }}><span>hace 24 h</span><span>hace 12 h</span><span>ahora</span></div>
            </div>
            <div className="sg-leyenda">
              <span><i style={{ background: 'var(--ok)' }} />Correcto</span>
              <span><i style={{ background: 'var(--tv-warn)' }} />Fallido</span>
              <span><i style={{ background: 'var(--tv-danger)' }} />Rechazado</span>
              <span><i style={{ background: 'var(--bg-sunken)' }} />Sin actividad</span>
            </div>
          </div>

          <div className="sg-fichas">
            <div className="sg-ficha"><Glifo n="libro" /><span>Intentos (24 h)</span><b className="tabular-nums">{resumen.intentos24h}</b></div>
            <div className="sg-ficha sg-ok"><Glifo n="ok" /><span>Ingresos correctos</span><b className="tabular-nums">{resumen.exitosos24h}</b></div>
            <div className="sg-ficha sg-wa"><Glifo n="alerta" /><span>Intentos fallidos</span><b className="tabular-nums">{resumen.fallidos24h}</b></div>
            <div className="sg-ficha sg-ba"><Glifo n="prohibido" /><span>Bloqueos activos</span><b className="tabular-nums">{resumen.bloqueosActivos}</b></div>
          </div>

          <div className="sg-card sg-pasaporte">
            <div>
              <span className="sg-k">Último ingreso correcto</span>
              {resumen.ultimoExito ? (
                <>
                  <b style={{ fontSize: 16 }}>{resumen.ultimoExito.email || '—'}</b>
                  <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{fechaCorta(resumen.ultimoExito.ocurrido_en)}</span>
                  <span>{bandera(resumen.ultimoExito.codigo_pais)} {ubicacionTexto(resumen.ultimoExito)}</span>
                  <span className="sg-mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {resumen.ultimoExito.ip || 'IP desconocida'}{resumen.ultimoExito.proveedor ? ` · ${resumen.ultimoExito.proveedor}` : ''}
                  </span>
                  <span className="sg-row" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    <Glifo n={resumen.ultimoExito.origen === 'apk' ? 'cel' : 'pc'} />
                    {resumirDispositivo(resumen.ultimoExito.user_agent)}{resumen.ultimoExito.origen ? ` · ${resumen.ultimoExito.origen}` : ''}
                  </span>
                  <div className="sg-row">
                    {resumen.ultimoExito.dispositivo_conocido === false && <span className="sg-badge" data-t="wa">Aparato nuevo</span>}
                    {resumen.ultimoExito.dispositivo_conocido === true && <span className="sg-badge" data-t="ok">Aparato conocido</span>}
                    {esSupremo && resumen.ultimoExito.gps_latitud != null && (
                      <button
                        type="button"
                        className="sg-badge"
                        data-t="ok"
                        onClick={() => setMapa({ lat: Number(resumen.ultimoExito!.gps_latitud), lon: Number(resumen.ultimoExito!.gps_longitud), titulo: 'Lugar exacto (GPS)', etiqueta: `${resumen.ultimoExito!.email || ''} · ${ubicacionTexto(resumen.ultimoExito!)}` })}
                      >
                        <Glifo n="lugar" /> Lugar exacto (GPS)
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <p className="sg-txt">Todavía no hay ningún ingreso registrado. El primero quedará anotado la próxima vez que inicie sesión.</p>
              )}
            </div>
            <div>
              <span className="sg-k">Esta conexión</span>
              {miIp ? (
                <>
                  <span className="sg-mono" style={{ fontWeight: 500, fontSize: 17 }}>{miIp}</span>
                  <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                    {bandera(miGeo?.codigo_pais)} {ubicacionTexto(miGeo || {})}{miGeo?.proveedor ? ` · ${miGeo.proveedor}` : ''}
                  </span>
                  {esSupremo && <div className="sg-row" style={{ marginTop: 4 }}>
                    {confianza.some(c => c.ip === miIp) ? (
                      <span className="sg-badge" data-t="ok"><Glifo n="ok" /> Ya está en la lista blanca</span>
                    ) : (
                      <Btn className="sg-btn-ok sg-btn-sm" onClick={() => agregarConfianza(miIp, 'Conexión del administrador')}>
                        Marcar como conexión de confianza
                      </Btn>
                    )}
                  </div>}
                </>
              ) : (
                <p className="sg-txt">Averiguando la dirección de esta conexión…</p>
              )}
              <p className="sg-fino" style={{ marginTop: 6 }}>
                En datos móviles la dirección IP cambia con frecuencia, y varias personas del mismo operador comparten una
                misma dirección. La lista blanca sirve de verdad para una conexión fija (la casa o el local); en el celular
                puede dejar de coincidir de un día para otro.
              </p>
            </div>
          </div>

          <div className="sg-card">
            <h4>Reglas activas</h4>
            <div className="sg-escalera">
              <div><b>30 min</b><span>1.er castigo</span></div>
              <div><b>2 horas</b><span>2.º castigo</span></div>
              <div><b>24 horas</b><span>3.er castigo</span></div>
            </div>
            <div className="sg-reglas">
              <p><Glifo n="reloj" /><span><b>3 intentos fallidos en 15 minutos</b> bloquean la conexión. El castigo sube solo.</span></p>
              <p><Glifo n="ok" /><span>Un ingreso correcto <b>reinicia el contador</b>.</span></p>
              <p><Glifo n="dir" /><span>Los errores de contraseña de <b>clientes de la tienda</b> se registran pero no bloquean, para no dejar sin comprar a quienes comparten IP con ellos.</span></p>
              <p><Glifo n="escudo" /><span>Si el sistema de vigilancia se cae, el acceso sigue funcionando: nunca lo deja fuera de su propio panel.</span></p>
              <p><Glifo n="cred" /><span>Se reconoce el <b>aparato</b>: si entran desde uno nunca visto, sale marcado como aparato nuevo.</span></p>
              <p><Glifo n="lugar" /><span>Al entrar una cuenta administrativa se pide permiso de ubicación, y si se acepta se guarda el <b>lugar exacto por GPS</b>. A los clientes de la tienda nunca se les pide. La ubicación por IP <b>solo dice la ciudad</b>.</span></p>
              <p><Glifo n="prohibido" /><span>Una IP bloqueada no puede ni <b>abrir el sitio web</b>: se le corta en Cloudflare antes de entregarle la página. Cada bloqueo se puede bajar a "solo login". Este bloqueo <b>no aplica a la APK</b>, que es de uso interno.</span></p>
            </div>
          </div>
        </>
      )}

      {/* =============== ACCESOS: libro de registro por día =============== */}
      {seccion === 'accesos' && (
        <>
          <div className="sg-filtros2">
            <div className="sg-seg" role="group" aria-label="Filtrar accesos">
              {([
                { id: 'todos',      label: 'Todos' },
                { id: 'exitosos',   label: 'Correctos' },
                { id: 'fallidos',   label: 'Fallidos' },
                { id: 'bloqueados', label: 'Rechazados' },
              ] as { id: FiltroAccesos; label: string }[]).map(f => (
                <button key={f.id} type="button" data-on={filtro === f.id ? '' : undefined} onClick={() => { setFiltro(f.id); setPaginaAccesos(1); }}>
                  {f.label}
                </button>
              ))}
            </div>
            <Btn className="sg-btn-ba sg-btn-sm" onClick={() => purgarHistorial(90)} disabled={limpiando}>Depurar +90 días</Btn>
          </div>

          {accesosFiltrados.length === 0 ? (
            <Vacio g="libro" texto={cargando ? 'Cargando el registro de accesos…' : 'No hay intentos registrados con este filtro.'} />
          ) : (
            <div className="sg-card sg-libro">
              {accesosPagina.map((a, i) => {
                const dia = diaDe(a.ocurrido_en);
                const nuevoDia = i === 0 || diaDe(accesosPagina[i - 1].ocurrido_en) !== dia;
                const t = a.bloqueado ? 'b' : a.exito ? 'o' : 'f';
                const hora = horaDe(a.ocurrido_en);
                return (
                  <React.Fragment key={a.id}>
                    {nuevoDia && <div className="sg-dia2">{dia}</div>}
                    <div
                      className="sg-lr"
                      role="button"
                      tabIndex={0}
                      onClick={() => setDetalle(a)}
                      onKeyDown={e => { if (e.key === 'Enter') setDetalle(a); }}
                    >
                      <span className="sg-h">{hora}</span>
                      <span className={`sg-sello ${t === 'o' ? '' : 'sg-' + t}`}>
                        <Glifo n={t === 'b' ? 'prohibido' : t === 'f' ? 'alerta' : 'ok'} />
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <b>{a.email || '—'}</b>
                        <span className="sg-s">
                          {bandera(a.codigo_pais)} {ubicacionTexto(a)} · <span className="sg-mono" style={{ fontSize: 12 }}>{a.ip || '—'}{a.proveedor ? ` · ${a.proveedor}` : ''}</span>
                        </span>
                      </div>
                      <div className="sg-ls">{resumirDispositivo(a.user_agent)}</div>
                      <div className="sg-row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                        <span className="sg-hh">{hora}</span>
                        {a.dispositivo_conocido === false && <span className="sg-badge" data-t="wa">Aparato nuevo</span>}
                        {esSupremo && a.gps_latitud != null && <span className="sg-badge" data-t="ok">GPS</span>}
                        <span className="sg-badge" data-t={t === 'b' ? 'ba' : t === 'f' ? 'wa' : 'ok'}>
                          {t === 'b' ? 'Rechazado' : t === 'f' ? 'Fallido' : 'Correcto'}
                        </span>
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}
              <Paginador pagina={paginaAccesos} total={accesosFiltrados.length} porPagina={POR_PAGINA_ACCESOS} onCambiar={setPaginaAccesos} />
            </div>
          )}
        </>
      )}

      {/* =============== DISPOSITIVOS: credenciales =============== */}
      {seccion === 'dispositivos' && (
        <>
          <div className="sg-callout">
            <span className="sg-nodo"><Glifo n="info" /></span>
            <span>
              Cada celular o computadora desde el que se entró correctamente queda marcado aquí. Si un día aparece un{' '}
              <b>aparato nuevo</b> que usted no reconoce, esa es la señal de alarma de verdad, mucho más confiable que la
              ubicación, porque la IP solo llega a decir la ciudad.
              <br />
              <span style={{ fontSize: 12, opacity: 0.85 }}>
                Si borra los datos del navegador o entra en modo incógnito, su propio aparato saldrá como nuevo. Y la marca
                la manda el navegador, así que en teoría se puede falsear: tómelo como una alerta que vale la pena revisar,
                no como una cerradura.
              </span>
            </span>
          </div>

          {dispositivos.length === 0 ? (
            <Vacio g="cred" texto={cargando ? 'Cargando…' : 'Todavía no hay aparatos registrados. El suyo aparecerá la próxima vez que inicie sesión.'} />
          ) : (
            <div className="sg-cred">
              {dispositivos.map(d => (
                <div key={d.device_id} className={`sg-card sg-cr ${d.confiable ? '' : 'sg-al'}`}>
                  <div className="sg-top">
                    <span className="sg-sil"><Glifo n={esMovil(d.user_agent, d.origen) ? 'cel' : 'pc'} /></span>
                    <div style={{ minWidth: 0 }}>
                      <h5>
                        <span style={{ overflowWrap: 'anywhere' }}>{d.etiqueta || resumirDispositivo(d.user_agent)}</span>
                        {d.confiable
                          ? <span className="sg-badge" data-t="ok">Reconocido</span>
                          : <span className="sg-badge" data-t="wa">No reconocido</span>}
                      </h5>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        {resumirDispositivo(d.user_agent)}{d.origen ? ` · ${d.origen}` : ''} · {d.ingresos} ingreso(s)
                      </div>
                      <div className="sg-id" style={{ overflowWrap: 'anywhere' }}>{d.device_id}</div>
                    </div>
                  </div>
                  <div className="sg-dat">
                    <div>Primera vez<b>{fechaCorta(d.primer_visto)}</b></div>
                    <div>Última vez<b>{fechaCorta(d.ultimo_visto)}</b>{d.ultimo_email && <span style={{ fontSize: 12 }}>{d.ultimo_email}</span>}</div>
                  </div>
                  <div className="sg-pie">
                    <Btn className="sg-btn-sm" onClick={() => renombrarDispositivo(d)}>Ponerle nombre</Btn>
                    <Btn className={`sg-btn-sm ${d.confiable ? 'sg-btn-wa' : 'sg-btn-ok'}`} onClick={() => cambiarConfianzaDispositivo(d)}>
                      {d.confiable ? 'No lo reconozco' : 'Sí es mío'}
                    </Btn>
                    <Btn className="sg-btn-sm sg-btn-ba" onClick={() => olvidarDispositivo(d)}>Olvidar</Btn>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* =============== BLOQUEOS: cuenta regresiva =============== */}
      {seccion === 'bloqueos' && esSupremo && (
        <>
          <div className="sg-accion2">
            <input
              type="text"
              value={nuevaIpBloqueo}
              onChange={e => setNuevaIpBloqueo(e.target.value)}
              placeholder="IP, ej. 190.10.20.30"
              aria-label="Dirección IP a bloquear"
              className="sg-input sg-mono"
            />
            <button type="button" className="sg-opc sg-wa" onClick={() => bloquearManual(nuevaIpBloqueo, false)}>
              <Glifo n="reloj" /><span>30 minutos<small>Bloqueo temporal</small></span>
            </button>
            <button type="button" className="sg-opc sg-ba" onClick={() => bloquearManual(nuevaIpBloqueo, true)}>
              <Glifo n="prohibido" /><span>Permanente<small>Hasta que lo quite</small></span>
            </button>
          </div>

          {bloqueos.length === 0 ? (
            <Vacio g="cuenta" texto={cargando ? 'Cargando…' : 'No hay ninguna conexión bloqueada. Todo tranquilo.'} />
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {bloqueos.map(b => {
                const restantes = minutosRestantes(b.bloqueado_hasta);
                const activo = !b.desbloqueado_en && (b.permanente || restantes > 0);
                const total = DURACION_NIVEL[b.nivel] || 30;
                const pct = b.permanente ? 100 : activo ? Math.max(4, Math.min(100, Math.round((restantes / total) * 100))) : 0;
                const nivel = Math.min(3, Math.max(b.nivel || 0, b.permanente ? 3 : 0));
                return (
                  <div key={b.ip} className="sg-card sg-cuenta" style={activo ? undefined : { opacity: 0.7 }}>
                    <div className={`sg-dial ${activo ? '' : 'sg-fin'}`} style={{ ['--p' as any]: pct }}>
                      <b className="tabular-nums">
                        {b.permanente && activo ? '∞' : activo ? (restantes >= 120 ? Math.round(restantes / 60) : restantes) : '—'}
                        <small>{b.permanente && activo ? 'permanente' : activo ? (restantes >= 120 ? 'horas' : 'min') : b.desbloqueado_en ? 'levantado' : 'vencido'}</small>
                      </b>
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <h5>
                        <span style={{ overflowWrap: 'anywhere' }}>{b.ip}</span>
                        <span className="sg-niv" title={`Nivel ${b.nivel}`}>
                          {[1, 2, 3].map(i => <i key={i} className={i <= nivel ? 'sg-on' : ''} />)}
                        </span>
                      </h5>
                      <div className="sg-row" style={{ marginTop: 4 }}>
                        <span className="sg-badge" data-t={b.bloqueo_total ? 'ba' : 'wa'}>{b.bloqueo_total ? 'Sitio completo' : 'Solo login'}</span>
                        {b.nivel > 0 && !b.permanente && <span className="sg-badge">Nivel {b.nivel}</span>}
                        {b.permanente && <span className="sg-badge" data-t="ba">Permanente</span>}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 5 }}>{ubicacionTexto(b)} · {b.intentos_fallidos} intento(s)</div>
                      {b.ultimo_email && <div className="sg-mono" style={{ fontSize: 12, color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>Último correo probado: {b.ultimo_email}</div>}
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{b.motivo} · {fechaCorta(b.actualizado_en)}</div>
                    </div>
                    {activo && (
                      <div className="sg-act">
                        <Btn className="sg-btn-sm" onClick={() => cambiarAlcanceBloqueo(b)}>
                          {b.bloqueo_total ? 'Dejar solo el login' : 'Bloquear el sitio entero'}
                        </Btn>
                        <Btn className="sg-btn-sm sg-btn-ok" onClick={() => desbloquear(b.ip)}>Desbloquear</Btn>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* =============== LISTA BLANCA: pases =============== */}
      {seccion === 'blanca' && esSupremo && (
        <>
          <div className="sg-card">
            <h4>Agregar conexión de confianza</h4>
            <div className="sg-pad sg-row" style={{ gap: 8 }}>
              <input
                type="text"
                value={nuevaIpBlanca}
                onChange={e => setNuevaIpBlanca(e.target.value)}
                placeholder={miIp ? `Su IP actual: ${miIp}` : 'Dirección IP'}
                aria-label="Dirección IP de confianza"
                className="sg-input sg-mono"
              />
              <input
                type="text"
                value={nuevaDescripcion}
                onChange={e => setNuevaDescripcion(e.target.value)}
                placeholder="Descripción (ej. casa, local)"
                aria-label="Descripción"
                className="sg-input"
              />
              <Btn className="sg-btn-ok" onClick={() => agregarConfianza(nuevaIpBlanca || miIp || '', nuevaDescripcion)}>Agregar</Btn>
            </div>
          </div>

          {confianza.length === 0 ? (
            <Vacio g="pase" texto={cargando ? 'Cargando…' : 'No hay conexiones de confianza registradas.'} />
          ) : (
            <div className="sg-pases2">
              {confianza.map(c => (
                <div key={c.ip} className="sg-pase2">
                  <div className="sg-st"><Glifo n="ok" className="sg-lg" /></div>
                  <div className="sg-tx">
                    <b>{c.descripcion || 'Sin descripción'}</b>
                    <code style={{ overflowWrap: 'anywhere' }}>{c.ip}</code>
                    <span>Agregada el {fechaCorta(c.creado_en)}</span>
                    <div className="sg-row" style={{ marginTop: 4 }}>
                      <Btn className="sg-btn-sm sg-btn-ba" onClick={() => quitarConfianza(c.ip)}>Quitar de la lista blanca</Btn>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* =============== BITÁCORA: diario del sistema =============== */}
      {seccion === 'bitacora' && (
        <>
          <p className="sg-txt">
            Aquí queda lo que se <strong>hizo</strong> (ventas, ajustes, inventario). En "Accesos" queda quién <strong>entró</strong>.
          </p>
          <div className="sg-mant">
            <div className="sg-card">
              <div><b className="tabular-nums">{conteos?.bitacora_total ?? 0}</b><span className="sg-l">en la bitácora</span></div>
              <Btn className="sg-btn-sm sg-btn-ba" onClick={limpiarBitacora} disabled={limpiando}>Limpiar</Btn>
            </div>
            <div className="sg-card">
              <div><b className="tabular-nums">{conteos?.accesos_total ?? 0}</b><span className="sg-l">accesos</span></div>
              <Btn className="sg-btn-sm" onClick={() => purgarHistorial(30)} disabled={limpiando}>+30 días</Btn>
            </div>
            <div className="sg-card">
              <div><b className="tabular-nums">{conteos?.accesos_90 ?? 0}</b><span className="sg-l">de más de 90 días</span></div>
              <Btn className="sg-btn-sm" onClick={() => purgarHistorial(90)} disabled={limpiando}>+90 días</Btn>
            </div>
          </div>
          <div className="sg-row" style={{ justifyContent: 'space-between' }}>
            <p className="sg-fino" style={{ flex: 1, minWidth: 200 }}>
              {conteos?.accesos_90 === 0 && conteos?.accesos_total > 0 && (
                <>Ningún acceso supera los 90 días: el más antiguo es del{' '}
                {conteos?.accesos_mas_viejo ? new Date(conteos.accesos_mas_viejo).toLocaleDateString('es-CR') : '—'}. Por eso
                "Depurar +90 días" no borra nada todavía; no es una avería.</>
              )}
            </p>
            <Btn className="sg-btn-sm sg-btn-ba" onClick={() => purgarHistorial(0)} disabled={limpiando}>Borrar todos los accesos</Btn>
          </div>

          {auditLog.length === 0 ? (
            <Vacio g="diario" texto="La bitácora está vacía." />
          ) : (
            <div className="sg-card sg-diario">
              {bitacoraPagina.map((log, i) => {
                const dia = diaDe(log.timestamp);
                const nuevoDia = i === 0 || diaDe(bitacoraPagina[i - 1].timestamp) !== dia;
                const color = colorModulo(log.module);
                return (
                  <React.Fragment key={log.id}>
                    {nuevoDia && <div className="sg-dd">{dia}</div>}
                    <div className="sg-ev">
                      <span className="sg-pt" style={{ background: `${color}22`, color }}>{(log.module || '?').charAt(0).toUpperCase()}</span>
                      <div className="sg-tx" style={{ minWidth: 0 }}>
                        <b>{log.userEmail}</b> · {log.action}{' '}
                        <span className="sg-badge" style={{ background: `${color}1f`, color }}>{log.module}</span>
                        <span className="sg-tm">{horaDe(log.timestamp)}</span>
                        {log.detail && <div className="sg-nota2" style={{ overflowWrap: 'anywhere' }}>{log.detail}</div>}
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}
              <Paginador pagina={paginaBitacora} total={auditLog.length} porPagina={POR_PAGINA_BITACORA} onCambiar={setPaginaBitacora} />
            </div>
          )}
        </>
      )}

      {/* =============== VISITANTES: directorio =============== */}
      {seccion === 'visitantes' && (
        <>
          <div className="sg-row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 }}>
            <div className="sg-stats">
              <div><b>{visitantesAgrupados.length}</b><span>Aparatos</span></div>
              <div><b>{visitantesAgrupados.reduce((a, g) => a + g.visitas, 0)}</b><span>Visitas</span></div>
              <div><b>{visitantesAgrupados.filter(g => g.email).length}</b><span>Identificados</span></div>
            </div>
            <label className="sg-buscar">
              <Glifo n="lupa" />
              <input value={buscarVisitante} onChange={e => setBuscarVisitante(e.target.value)} placeholder="Buscar" aria-label="Buscar visitante" />
            </label>
          </div>

          {gruposFiltrados.length === 0 ? (
            <Vacio g="dir" texto={visitantes.length === 0 ? 'Todavía no hay visitas registradas.' : 'Nada coincide con la búsqueda.'} />
          ) : (
            <div className="sg-card sg-dir">
              <div className="sg-dh"><span>Aparato</span><span>Navegador</span><span>Frecuencia</span><span>Visitas</span><span /></div>
              {gruposFiltrados
                .slice((paginaVisitantes - 1) * 10, paginaVisitantes * 10)
                .map((g: GrupoVisitante) => {
                  const penalizado = !!g.email && emailsPenalizados.has(g.email.toLowerCase());
                  const bloqueado = g.huellas.some(h => aparatos.some(a => a.device_uuid === h && !a.levantado_en));
                  const nombre = g.dispositivo || g.tipo || 'Sin identificar';
                  return (
                    <div key={g.clave} className="sg-dr">
                      <div className="sg-who">
                        <span className="sg-mono2" style={{ background: colorModulo(g.clave) }}>{nombre.charAt(0).toUpperCase()}</span>
                        <div style={{ minWidth: 0 }}>
                          <div className="sg-nb">
                            <span style={{ overflowWrap: 'anywhere' }}>{nombre}</span>
                            {g.huellas.length > 1 && (
                              <span title={`${g.huellas.length} identidades del mismo equipo`} style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 400 }}>×{g.huellas.length}</span>
                            )}
                            {bloqueado && <span className="sg-badge" data-t="ba">Bloqueado</span>}
                            {esSupremo && g.oculto && <span className="sg-badge" data-t="ac" title="Solo tú ves este aparato">Oculto al personal</span>}
                          </div>
                          <div className="sg-s">
                            {[[g.sistema, g.version_sistema].filter(Boolean).join(' '), g.email || 'Anónimo'].filter(Boolean).join(' · ')}
                            {penalizado && <span style={{ color: 'var(--tv-danger)' }}> · cuenta baneada</span>}
                          </div>
                        </div>
                      </div>
                      <div className="sg-c2 sg-s">{g.navegador || '—'}</div>
                      <div className="sg-c3" title="Visitas comparadas con el aparato que más visita">
                        <div className="sg-frec"><i style={{ width: `${Math.max(6, Math.round((g.visitas / maxVisitas) * 100))}%` }} /></div>
                      </div>
                      <div className="sg-c4">
                        <div className="sg-nv tabular-nums">{g.visitas}</div>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fechaCorta(g.ultima)}</span>
                      </div>
                      <div className="sg-row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                        <button type="button" className="sg-ib" onClick={() => setVisitanteDetalle(g.reciente)} title="Ver ficha" aria-label="Ver ficha">
                          <Glifo n="lupa" />
                        </button>
                        {esSupremo && (
                          <Btn variant="ghost" className="sg-btn-sm" onClick={() => void ocultarAlPersonal(g, !g.oculto)}>
                            {g.oculto ? 'Mostrar' : 'Ocultar'}
                          </Btn>
                        )}
                        {esSupremo && (bloqueado
                          ? <Btn variant="ghost" className="sg-btn-sm" onClick={() => liberarAparato(g.huellas[0])}>Liberar</Btn>
                          : <Btn variant="ghost" className="sg-btn-sm" onClick={() => banearGrupo(g)}>Banear</Btn>)}
                      </div>
                    </div>
                  );
                })}
              {gruposFiltrados.length > 10 && (
                <Paginador pagina={paginaVisitantes} total={gruposFiltrados.length} porPagina={10} onCambiar={setPaginaVisitantes} />
              )}
            </div>
          )}

          <p className="sg-fino">
            Un renglón por aparato, no por visita. No se registra ubicación: a los clientes no se les pide GPS.
            {visitantesAgrupados.length < visitantes.length && (
              <> Se agruparon {visitantes.length} identidades en {visitantesAgrupados.length} aparatos: un mismo
              teléfono genera una identidad nueva cuando el navegador borra sus datos, y Safari lo hace a los siete
              días sin visitas. Al bloquear un renglón se bloquean todas las suyas.</>
            )}
          </p>
        </>
      )}

      {/* =============== PENALIZADOS: expedientes =============== */}
      {seccion === 'penalizados' && esSupremo && (
        <>
          <p className="sg-txt">
            El baneo total hace tres cosas a la vez: marca la cuenta, bloquea todas las IPs desde las que se le vio y
            desactiva su perfil de cliente. Deja de poder entrar, ver el catálogo y comprar; la aplicación le muestra
            una pantalla de acceso denegado. <strong>Los pedidos y facturas anteriores no se tocan</strong>, porque son
            parte de la contabilidad.
          </p>
          {penalizados.length === 0 ? (
            <Vacio g="exp" texto="No hay ninguna cuenta penalizada. El baneo total se aplica desde la lista de visitantes o desde la ficha del cliente." />
          ) : (
            <div style={{ display: 'grid', gap: 14 }}>
              {penalizados.map(x => {
                const vigente = !x.levantado_en;
                return (
                  <div key={x.email} className={`sg-exp ${vigente ? '' : 'sg-old'}`} data-t={vigente ? 'Expediente · vigente' : 'Expediente · levantado'}>
                    <span className="sg-sello2">{vigente ? 'Vigente' : 'Levantado'}</span>
                    <h5 style={{ overflowWrap: 'anywhere', paddingRight: 96 }}>{x.email}</h5>
                    {x.nombre && <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{x.nombre}</div>}
                    <p style={{ margin: '8px 0 4px', fontSize: 12.5 }}><b>Motivo:</b> {x.motivo || '—'}</p>
                    <div className="sg-row">
                      {x.bloquear_user_agent && <span className="sg-badge" data-t="wa">+ navegador bloqueado</span>}
                      <span className="sg-chip">{x.ips_bloqueadas?.length || 0} IP{(x.ips_bloqueadas?.length || 0) === 1 ? '' : 's'} bloqueada{(x.ips_bloqueadas?.length || 0) === 1 ? '' : 's'}</span>
                    </div>
                    <div className="sg-pie">
                      <span>
                        Aplicado el {fechaCorta(x.creado_en)}{x.creado_por ? ` · ${x.creado_por}` : ''}
                        {!vigente && ` · Levantado el ${fechaCorta(x.levantado_en)}`}
                      </span>
                      {vigente && <Btn className="sg-btn-sm" onClick={() => levantarBaneo(x.email)}>Levantar</Btn>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* =============== APARATOS BLOQUEADOS: etiquetas =============== */}
      {seccion === 'aparatos' && esSupremo && (
        <>
          <div className="sg-callout">
            <span className="sg-nodo"><Glifo n="info" /></span>
            <span>
              Esto <b>sustituye al viejo bloqueo por dirección IP</b>. Una IP la comparte un edificio entero, un café o
              toda una red móvil: bloquearla castigaba a gente que no tenía nada que ver, y a quien se quería bloquear le
              bastaba apagar el WiFi para volver a entrar. El identificador de aparato no cambia al cambiar de red, así
              que el bloqueo sigue a la persona del WiFi a los datos móviles.
            </span>
          </div>
          <div className="sg-card">
            <h4>Bloquear un aparato a mano</h4>
            <div className="sg-pad sg-row" style={{ gap: 8 }}>
              <input
                value={nuevoAparato}
                onChange={e => setNuevoAparato(e.target.value)}
                placeholder="ID del aparato"
                aria-label="Identificador del aparato"
                className="sg-input sg-mono"
              />
              <Btn variant="danger" onClick={() => banearAparato(nuevoAparato)}>Bloquear</Btn>
            </div>
          </div>
          {aparatos.length === 0 ? (
            <Vacio g="etq" texto="No hay ningún aparato bloqueado." />
          ) : (
            <div className="sg-etq">
              {aparatos.map(a => {
                const vigente = !a.levantado_en;
                return (
                  <div key={a.device_uuid} className={`sg-et ${vigente ? 'sg-on' : ''}`} style={vigente ? undefined : { opacity: 0.75 }}>
                    <div className="sg-code" style={{ overflowWrap: 'anywhere' }}>{a.device_uuid}</div>
                    <div className="sg-row" style={{ marginTop: 6 }}>
                      <span className="sg-badge" data-t={vigente ? 'ba' : undefined}>{vigente ? 'Bloqueado' : 'Liberado'}</span>
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 6 }}>Motivo: {a.motivo || '—'}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>
                      Cuenta: {a.email || 'Sin cuenta'} · {fechaCorta(a.creado_en)}{a.creado_por ? ` · ${a.creado_por}` : ''}
                      {!vigente && ` · liberado el ${fechaCorta(a.levantado_en)}`}
                    </div>
                    {vigente && (
                      <div className="sg-row">
                        <Btn className="sg-btn-sm sg-btn-ok" onClick={() => liberarAparato(a.device_uuid)}>Liberar</Btn>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <p className="sg-fino">
            Alcance honesto: la marca del aparato vive en el navegador, y quien borre sus datos aparecerá como equipo
            nuevo. Por eso esta capa evita que el bloqueado pueda siquiera <strong style={{ color: 'var(--text-primary)' }}>ver</strong> la
            página, mientras la cerradura de verdad (la que impide entrar a la cuenta y leer datos) es el baneo de cuenta.
          </p>
        </>
      )}

      {/* =============== BIOMETRÍA: la bóveda =============== */}
      {seccion === 'biometria' && (
        <>
          <div className="sg-card sg-boveda">
            <div className="sg-dialb"><div className="sg-disco"><Glifo n="huella" /></div></div>
            <div className="sg-bt">
              <div>
                <span className="sg-k">Acceso biométrico de este aparato</span>
                <b style={{ fontSize: 18, display: 'block' }}>Face ID, Touch ID o huella</b>
                <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                  Para entrar sin escribir la contraseña. El PIN o patrón de abajo queda como respaldo cuando el lector falla.
                </span>
              </div>
              {/* Se muestra si hay lector O si ya se activó en este teléfono:
                  un chequeo de hardware que falla un instante no debe
                  esconder los controles de algo que ya está activado. */}
              {(hayBiometria || (esApk && huellaActivada)) ? (
                <div className="sg-row">
                  {huellaActivada && <span className="sg-badge" data-t="ok"><Glifo n="ok" /> Activado en este aparato</span>}
                  <Btn variant="primary" onClick={activarBiometria} disabled={registrandoLlave}>
                    {registrandoLlave ? 'Esperando al aparato…' : huellaActivada ? 'Volver a activar' : 'Activar en este aparato'}
                  </Btn>
                  {esApk && huellaActivada && (
                    <Btn
                      onClick={async () => {
                        await desactivarBiometriaNativa();
                        setHuellaActivada(false);
                        toast.success('Acceso con huella retirado de este teléfono.');
                      }}
                    >
                      Quitar de este teléfono
                    </Btn>
                  )}
                </div>
              ) : (
                <p className="sg-txt">
                  Este aparato no ofrece acceso biométrico. Ocurre cuando el equipo no tiene lector, cuando el sitio no se
                  abrió por HTTPS, o dentro de la APK si el contenido no se sirve desde el dominio real.
                </p>
              )}
            </div>
          </div>

          {/* PIN o patrón: alternativa a la huella, y el único método en
              aparatos sin lector (tablets) o en el navegador. */}
          <ConfigurarDesbloqueoLocal email={currentUserEmail || ''} />

          <div className="sg-card">
            <h4>Cómo funciona</h4>
            <div className="sg-pad sg-pasos">
              <div data-n="1"><span><b>Aquí no se guarda ninguna cara ni ninguna huella.</b> El teléfono no se las entrega al navegador; se guarda una llave pública que solo sirve para comprobar firmas.</span></div>
              <div data-n="2"><span>La llave privada <b>nunca sale del chip seguro</b> del aparato.</span></div>
              <div data-n="3"><span>Las llaves de esta lista son solo suyas. Ni siquiera el dueño puede ver ni usar las de otra cuenta.</span></div>
            </div>
          </div>

          {llaves.length > 0 && (
            <div className="sg-card">
              <h4>Llaves registradas <small>{llaves.length}</small></h4>
              {llaves.map(l => (
                <div key={l.id} className="sg-llave">
                  <span className="sg-ll"><Glifo n="huella" /></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <b style={{ overflowWrap: 'anywhere' }}>{l.etiqueta || 'Aparato sin nombre'}</b>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      Activado {fechaCorta(l.creado_en)} · Último uso: {l.ultimo_uso ? fechaCorta(l.ultimo_uso) : 'nunca'}
                    </div>
                  </div>
                  <Btn className="sg-btn-sm sg-btn-ba" onClick={() => quitarLlave(l.id)}>Quitar</Btn>
                </div>
              ))}
            </div>
          )}

          {esApk && (
            <div className="sg-callout">
              <span className="sg-nodo"><Glifo n="info" /></span>
              <span>
                <b>En la aplicación funciona distinto.</b> El navegador interno de Android no soporta el sistema de llaves
                que usa la web, así que aquí se usa el lector del propio teléfono: la huella libera una sesión guardada en
                el almacén cifrado del sistema. Es lo que hacen las aplicaciones de banco y es seguro, pero en la web se
                guarda una llave que <b>solo sirve para firmar</b>; aquí se guarda un pase. Sacarlo del almacén cifrado
                exige un teléfono alterado, pero no es imposible.
              </span>
            </div>
          )}

          <div className="sg-callout" data-t="wa">
            <span className="sg-nodo"><Glifo n="alerta" /></span>
            <span>
              <b>Un límite que conviene tener claro.</b> Si en un mismo teléfono hay dos caras registradas en Face ID (o
              dos huellas), las dos desbloquean ese teléfono y pueden usar las llaves que guarda. Eso lo decide iOS o
              Android, no esta aplicación. El aislamiento entre cuentas es total <b>entre aparatos distintos</b>: cada
              persona debe activar su biometría en su propio teléfono.
            </span>
          </div>
        </>
      )}

          </div>
        </div>
      </div>

      {/* =============== DETALLE DE UN VISITANTE =============== */}
      {visitanteDetalle && (
        <div
          className="fixed inset-0 z-[999] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setVisitanteDetalle(null)}
        >
          <div
            className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[85dvh] overflow-y-auto p-5 space-y-3"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--border-color)]/50 pb-3">
              <h4 className="font-bold text-[var(--text-primary)]">Ficha del aparato</h4>
              <button
                onClick={() => setVisitanteDetalle(null)}
                className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xl leading-none px-2"
              >
                ×
              </button>
            </div>
            {[
              ['Modelo',            visitanteDetalle.dispositivo],
              ['Tipo',              visitanteDetalle.tipo],
              ['Sistema operativo', [visitanteDetalle.sistema, visitanteDetalle.version_sistema].filter(Boolean).join(' ')],
              ['Navegador',         [visitanteDetalle.navegador, visitanteDetalle.version_navegador].filter(Boolean).join(' ')],
              ['Dirección IP',      visitanteDetalle.ip],
              ['Origen',            visitanteDetalle.origen === 'apk' ? 'Aplicación Android' : 'Navegador web'],
              ['Cliente',           visitanteDetalle.email || 'Anónimo'],
              ['Pantalla',          visitanteDetalle.pantalla],
              ['Núcleos / memoria', [visitanteDetalle.nucleos ? `${visitanteDetalle.nucleos} núcleos` : '', visitanteDetalle.memoria_gb ? `${visitanteDetalle.memoria_gb} GB` : ''].filter(Boolean).join(' · ')],
              ['Idioma',            visitanteDetalle.idioma],
              ['Zona horaria',      visitanteDetalle.zona_horaria],
              ['Última ruta',       visitanteDetalle.ultima_ruta],
              ['Visitas',           String(visitanteDetalle.visitas)],
              ['Primera visita',    fechaCorta(visitanteDetalle.primera_visita)],
              ['Última visita',     fechaCorta(visitanteDetalle.ultima_visita)],
            ].map(([etiqueta, valor]) => (
              <div key={etiqueta as string} className="flex justify-between gap-4 text-xs">
                <span className="text-[var(--text-secondary)] flex-shrink-0">{etiqueta}</span>
                <span className="text-[var(--text-primary)] text-right break-all">{valor || '—'}</span>
              </div>
            ))}
            <div className="text-[10px] text-[var(--text-secondary)] break-all pt-2 border-t border-[var(--border-color)]/30">
              <span className="uppercase font-bold">User-Agent completo:</span> {visitanteDetalle.user_agent || '—'}
            </div>
            <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed">
              Este aparato no tiene ubicación registrada, y es a propósito: a los clientes de la tienda no se les pide
              permiso de GPS. Lo que sí se puede saber es el país y la provincia a partir de la IP.
            </p>
          </div>
        </div>
      )}

      {/* =============== APLICAR BANEO TOTAL =============== */}
      {esSupremo && baneoModal && (
        <div
          className="fixed inset-0 z-[999] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => !baneando && setBaneoModal(null)}
        >
          <div
            className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-[var(--border-color)]/50 pb-3">
              <ShieldOff className="w-5 h-5 text-rose-500 flex-shrink-0" />
              <h4 className="font-bold text-[var(--text-primary)]">Baneo total</h4>
            </div>

            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              Se le retirará el acceso a <strong className="text-[var(--text-primary)]">{baneoModal.email}</strong>: la
              cuenta queda suspendida y se bloquean todas las direcciones IP desde las que se le ha visto entrar. Sus
              pedidos y facturas anteriores no se tocan.
            </p>

            <div>
              <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1.5">
                Motivo (queda registrado)
              </label>
              <textarea
                value={baneoMotivo}
                onChange={e => setBaneoMotivo(e.target.value)}
                rows={3}
                placeholder="Ej.: intento de fraude en el pedido #1042"
                className="w-full bg-[var(--bg-base)] border border-[var(--border-color)]/80 rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--brand-gold-mid)] resize-none"
              />
            </div>

            <label className="flex gap-2.5 items-start cursor-pointer">
              <input
                type="checkbox"
                checked={baneoUsarUA}
                onChange={e => setBaneoUsarUA(e.target.checked)}
                className="mt-0.5 flex-shrink-0"
              />
              <span className="text-[11px] text-[var(--text-secondary)] leading-snug">
                Bloquear también su navegador exacto.{' '}
                <strong className="text-amber-500">Úselo con cuidado</strong>: esa firma la comparten miles de personas
                con el mismo modelo de teléfono y la misma versión del navegador, así que puede dejar fuera a clientes
                que no tienen nada que ver. Sirve cuando la persona cambia de red pero sigue con el mismo aparato.
              </span>
            </label>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setBaneoModal(null)}
                disabled={baneando}
                className="flex-1 border border-[var(--border-color)]/80 text-[var(--text-primary)] text-xs font-bold py-2.5 rounded-xl hover:bg-[var(--bg-base)] disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={aplicarBaneoTotal}
                disabled={baneando}
                className="flex-1 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold py-2.5 rounded-xl disabled:opacity-50"
              >
                {baneando ? 'Aplicando…' : 'Aplicar baneo total'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =============== DETALLE DE UN INTENTO =============== */}
      {detalle && (
        <div
          className="fixed inset-0 z-[999] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setDetalle(null)}
        >
          <div
            className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[85dvh] overflow-y-auto p-5 space-y-3"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--border-color)]/50 pb-3">
              <h4 className="font-bold text-[var(--text-primary)]">Detalle del intento</h4>
              <button onClick={() => setDetalle(null)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xl leading-none px-2">×</button>
            </div>
            {[
              ['Resultado',   detalle.bloqueado ? 'Rechazado por bloqueo' : detalle.exito ? 'Ingreso correcto' : 'Intento fallido'],
              ['Motivo',      detalle.motivo || '—'],
              ['Fecha',       fechaCorta(detalle.ocurrido_en)],
              ['Correo',      detalle.email || '—'],
              ['IP',          detalle.ip || '—'],
              ['País',        `${bandera(detalle.codigo_pais)} ${detalle.pais || '—'}`],
              ['Región',      detalle.region || '—'],
              ['Ciudad',      detalle.ciudad || '—'],
              ['Zona horaria', detalle.zona_horaria || '—'],
              ['Operador',    detalle.proveedor || '—'],
              ['Origen',      detalle.origen || '—'],
              ['Dispositivo', resumirDispositivo(detalle.user_agent)],
              ['¿Aparato conocido?', detalle.dispositivo_conocido === null
                ? 'sin dato'
                : detalle.dispositivo_conocido ? 'Sí, ya se había usado antes' : 'NO — primera vez que se usa'],
              ...(!esSupremo ? [] : [['Ubicación GPS', detalle.gps_latitud != null && detalle.gps_longitud != null
                ? `${detalle.gps_latitud.toFixed(6)}, ${detalle.gps_longitud.toFixed(6)}` +
                  (detalle.gps_precision_m != null ? ` (±${Math.round(detalle.gps_precision_m)} m)` : '')
                : 'no autorizada']]),
            ].map(([k, v]) => (
              <div key={k as string} className="flex justify-between gap-4 text-xs border-b border-[var(--border-color)]/30 pb-1.5">
                <span className="text-[var(--text-secondary)] uppercase font-bold text-[10px] flex-shrink-0">{k}</span>
                <span className="text-[var(--text-primary)] text-right break-all">{v}</span>
              </div>
            ))}
            {/* Dos mapas bien distintos, y se dice cuál es cuál.
                Antes había un solo botón que decía "ubicación aproximada" y
                siempre caía en el mismo punto: eran las coordenadas del
                centro de la ciudad que devuelve el proveedor de IP, no un
                lugar. Mezclar eso con el GPS real sería engañoso. */}
            {!esSupremo ? null : detalle.gps_latitud != null && detalle.gps_longitud != null ? (
              <button
                type="button"
                onClick={() => setMapa({ lat: Number(detalle.gps_latitud), lon: Number(detalle.gps_longitud), titulo: 'Lugar exacto (GPS)', etiqueta: `${detalle.email || ''} · ${ubicacionTexto(detalle)}` })}
                className="block w-full text-center bg-[var(--ok-soft)] border border-[var(--ok)] text-[var(--ok)] text-xs font-bold px-4 py-2.5 rounded-xl transition hover:brightness-110"
              >
                Ver el lugar EXACTO en el mapa (GPS)
              </button>
            ) : detalle.latitud != null && detalle.longitud != null ? (
              <button
                type="button"
                onClick={() => setMapa({ lat: Number(detalle.latitud), lon: Number(detalle.longitud), titulo: 'Ciudad aproximada (no es el lugar)', etiqueta: `${ubicacionTexto(detalle)} · punto del proveedor de internet, no la posición real` })}
                className="block w-full text-center bg-[var(--bg-base)] border border-[var(--border-color)]/80 text-[var(--text-secondary)] text-xs font-bold px-4 py-2.5 rounded-xl transition hover:bg-[var(--bg-surface)]"
              >
                Ver solo la ciudad en el mapa (no es el lugar)
              </button>
            ) : null}

            {!esSupremo ? null : detalle.gps_latitud != null ? (
              <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed pt-1">
                Esta ubicación viene del GPS del aparato y la autorizó la persona que entró, así que sí es el lugar
                real, con un margen de pocos metros.
              </p>
            ) : (
              <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed pt-1">
                Este ingreso no tiene ubicación real: solo se sabe la ciudad, deducida de la dirección IP. Ese dato
                marca <strong className="text-[var(--text-primary)]">el centro del cantón</strong>, no dónde estaba la
                persona — de hecho dos operadores distintos devuelven exactamente el mismo punto. Puede fallar por
                decenas de kilómetros, y más todavía con VPN o datos móviles. La ubicación exacta solo aparece cuando
                una cuenta administrativa autoriza el permiso de ubicación al entrar.
              </p>
            )}
            <div className="text-[10px] text-[var(--text-secondary)] break-all pt-2 border-t border-[var(--border-color)]/30">
              <span className="uppercase font-bold">User-Agent completo:</span> {detalle.user_agent || '—'}
            </div>
          </div>
        </div>
      )}

      {mapa && (
        <MapaModal
          abierto
          onClose={() => setMapa(null)}
          lat={mapa.lat}
          lon={mapa.lon}
          titulo={mapa.titulo}
          etiqueta={mapa.etiqueta}
        />
      )}
    </div>
  );
}

/* El render del componente cierra arriba; el mapa interno se monta como
   hermano para que cualquier "ver el lugar" lo abra sin salir de la app. */

// Mismo motivo que en los otros módulos pesados: sin `memo`, las diez
// carpetas de Ciberseguridad y sus listas (dispositivos, bloqueos,
// bitácora) se volvían a ejecutar por cada tecla ajena en otra pestaña.
export default React.memo(CyberSecurityPanel);
