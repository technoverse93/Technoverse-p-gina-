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

export default function CyberSecurityPanel({
  auditLog,
  currentUserEmail,
  onAuditLogChanged,
}: CyberSecurityPanelProps) {
  const toast = useToast();
  const confirm = useConfirm();

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
        });
        continue;
      }

      existente.huellas.push(v.huella);
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
  const secciones = seccionesPorVertiente[vertiente];

  /** Cambiar de vertiente lleva siempre a su primera sección: si no, se
   *  quedaría seleccionada una pestaña que ya no está en pantalla y el
   *  contenido saldría en blanco. */
  const cambiarVertiente = (v: Vertiente) => {
    setVertiente(v);
    setSeccion(seccionesPorVertiente[v][0].id);
  };

  return (
    <div className="space-y-6" id="view-ciberseguridad">

      {/* ---- Encabezado ---- */}
      <div className="flex flex-wrap justify-between items-center gap-3 border-b border-[var(--border-color)]/50 pb-3">
        <h3 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-rose-500 " />
          Centro de Ciberseguridad
        </h3>
        <button
          onClick={cargar}
          disabled={cargando}
          className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 text-[var(--text-primary)] text-sm font-bold px-3 py-1.5 rounded-xl transition hover:bg-[var(--bg-base)] flex items-center gap-1.5 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${cargando ? 'animate-spin' : ''}`} /> Actualizar
        </button>
      </div>

      {/* ---- Las dos vertientes ---- */}
      <div className="grid grid-cols-2 gap-2">
        {([
          { id: 'admin'   as Vertiente, titulo: 'Seguridad administrativa', pie: 'Accesos al panel, fuerza bruta y bloqueo de IPs', icono: Lock },
          { id: 'trafico' as Vertiente, titulo: 'Tráfico y usuarios',       pie: 'Visitantes de la tienda y cuentas penalizadas',   icono: Users },
        ]).map(v => {
          const Icono = v.icono;
          const activa = vertiente === v.id;
          return (
            <button
              key={v.id}
              onClick={() => cambiarVertiente(v.id)}
              className={`text-left p-3 rounded-2xl border transition ${
                activa
                  ? 'bg-[var(--bg-surface)] border-[var(--brand-gold-mid)]/50 shadow-sm'
                  : 'bg-transparent border-[var(--border-color)]/60 hover:bg-[var(--bg-surface)]'
              }`}
            >
              <div className={`flex items-center gap-2 font-bold text-sm ${
                activa ? 'text-[var(--brand-gold-mid)]' : 'text-[var(--text-primary)]'
              }`}>
                <Icono className="w-4 h-4 flex-shrink-0" />
                <span className="truncate">{v.titulo}</span>
              </div>
              <p className="text-[10px] text-[var(--text-secondary)] mt-1 leading-snug">{v.pie}</p>
            </button>
          );
        })}
      </div>

      {/* ---- Navegación interna ---- */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {secciones.map(s => {
          const Icono = s.icono;
          const activa = seccion === s.id;
          return (
            <button
              key={s.id}
              onClick={() => setSeccion(s.id)}
              className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-wide transition border ${
                activa
                  ? 'bg-[var(--bg-surface)] border-[var(--brand-gold-mid)]/40 text-[var(--brand-gold-mid)]'
                  : 'bg-transparent border-[var(--border-color)]/60 text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]'
              }`}
            >
              <Icono className="w-3.5 h-3.5" />
              {s.label}
              {typeof s.contador === 'number' && s.contador > 0 && (
                <span className="ml-0.5 text-[9px] bg-[var(--bg-base)] border border-[var(--border-color)]/60 px-1.5 py-0.5 rounded-full font-mono">
                  {s.contador}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* =============== RESUMEN =============== */}
      {seccion === 'resumen' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { etiqueta: 'Intentos (24 h)',   valor: resumen.intentos24h,     color: 'text-[var(--text-primary)]' },
              { etiqueta: 'Ingresos correctos', valor: resumen.exitosos24h,    color: 'text-[var(--ok)]' },
              { etiqueta: 'Intentos fallidos',  valor: resumen.fallidos24h,    color: 'text-amber-500' },
              { etiqueta: 'Bloqueos activos',   valor: resumen.bloqueosActivos, color: 'text-rose-500' },
            ].map(c => (
              <div key={c.etiqueta} className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-2xl p-4">
                <div className="text-[10px] uppercase font-bold text-[var(--text-secondary)] tracking-wide">{c.etiqueta}</div>
                <div className={`text-3xl font-bold font-mono mt-1 ${c.color}`}>{c.valor}</div>
              </div>
            ))}
          </div>

          {/* Último ingreso correcto, con ubicación */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-2xl p-5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-3 flex items-center gap-1.5 border-b border-[var(--border-color)]/50 pb-2">
              <MapPin className="w-4 h-4" /> Último ingreso correcto
            </h4>
            {resumen.ultimoExito ? (
              <div className="space-y-1.5 text-sm">
                <div className="font-bold text-[var(--text-primary)]">{resumen.ultimoExito.email || '—'}</div>
                <div className="text-[var(--text-secondary)] text-xs">{fechaCorta(resumen.ultimoExito.ocurrido_en)}</div>
                <div className="text-[var(--text-primary)] text-xs flex items-center gap-1.5">
                  <span className="text-base leading-none">{bandera(resumen.ultimoExito.codigo_pais)}</span>
                  {ubicacionTexto(resumen.ultimoExito)}
                </div>
                <div className="text-[var(--text-secondary)] text-[11px] font-mono">
                  {resumen.ultimoExito.ip || 'IP desconocida'}
                  {resumen.ultimoExito.proveedor ? ` · ${resumen.ultimoExito.proveedor}` : ''}
                </div>
                <div className="text-[var(--text-secondary)] text-[11px] flex items-center gap-1">
                  {resumen.ultimoExito.origen === 'apk'
                    ? <Smartphone className="w-3 h-3" />
                    : <Monitor className="w-3 h-3" />}
                  {resumirDispositivo(resumen.ultimoExito.user_agent)}
                  {resumen.ultimoExito.origen ? ` · ${resumen.ultimoExito.origen}` : ''}
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {resumen.ultimoExito.dispositivo_conocido === false && (
                    <span className="text-[9px] uppercase font-bold bg-amber-500/10 border border-amber-500/40 text-amber-500 px-2 py-0.5 rounded">
                      Aparato nuevo
                    </span>
                  )}
                  {resumen.ultimoExito.dispositivo_conocido === true && (
                    <span className="text-[9px] uppercase font-bold bg-[var(--ok-soft)] border border-[var(--ok)] text-[var(--ok)] px-2 py-0.5 rounded">
                      Aparato conocido
                    </span>
                  )}
                  {resumen.ultimoExito.gps_latitud != null && (
                    <a
                      href={`https://www.google.com/maps?q=${resumen.ultimoExito.gps_latitud},${resumen.ultimoExito.gps_longitud}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[9px] uppercase font-bold bg-[var(--ok-soft)] border border-[var(--ok)] text-[var(--ok)] px-2 py-0.5 rounded hover:brightness-110"
                    >
                      Lugar exacto (GPS)
                    </a>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-xs text-[var(--text-secondary)] italic">
                Todavía no hay ningún ingreso registrado. El primero quedará anotado la próxima vez que inicie sesión.
              </p>
            )}
          </div>

          {/* Esta conexión */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-2xl p-5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-3 flex items-center gap-1.5 border-b border-[var(--border-color)]/50 pb-2">
              <Globe className="w-4 h-4" /> Esta conexión (el dispositivo que está usando ahora)
            </h4>
            {miIp ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1 text-xs">
                  <div className="font-mono font-bold text-[var(--text-primary)] text-sm">{miIp}</div>
                  <div className="text-[var(--text-secondary)] flex items-center gap-1.5">
                    <span className="text-base leading-none">{bandera(miGeo?.codigo_pais)}</span>
                    {ubicacionTexto(miGeo || {})}
                  </div>
                  {miGeo?.proveedor && <div className="text-[var(--text-secondary)]">{miGeo.proveedor}</div>}
                </div>
                {confianza.some(c => c.ip === miIp) ? (
                  <span className="text-[10px] bg-[var(--ok-soft)] border border-[var(--ok)] text-[var(--ok)] font-bold px-3 py-1.5 rounded-xl uppercase">
                    Ya está en la lista blanca
                  </span>
                ) : (
                  <button
                    onClick={() => agregarConfianza(miIp, 'Conexión del administrador')}
                    className="bg-[var(--ok-soft)] border border-[var(--ok)] text-[var(--ok)] hover:brightness-110 text-xs font-bold px-3 py-2 rounded-xl transition flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" /> Marcar como conexión de confianza
                  </button>
                )}
              </div>
            ) : (
              <p className="text-xs text-[var(--text-secondary)] italic">Averiguando la dirección de esta conexión…</p>
            )}
            {/* Advertencia honesta: en datos móviles la IP cambia sola. */}
            <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed mt-3 pt-3 border-t border-[var(--border-color)]/40">
              Tenga presente que en datos móviles la dirección IP cambia con frecuencia, y varias personas del mismo
              operador comparten una misma dirección. La lista blanca sirve de verdad para una conexión fija (la casa o
              el local); en el celular puede dejar de coincidir de un día para otro.
            </p>
          </div>

          {/* Cómo funciona */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-2xl p-5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-3 border-b border-[var(--border-color)]/50 pb-2">
              Reglas activas
            </h4>
            <ul className="text-xs text-[var(--text-secondary)] space-y-1.5 leading-relaxed">
              <li>· <strong className="text-[var(--text-primary)]">3 intentos fallidos en 15 minutos</strong> bloquean la conexión.</li>
              <li>· El castigo sube solo: <strong className="text-[var(--text-primary)]">30 minutos</strong>, luego <strong className="text-[var(--text-primary)]">2 horas</strong>, luego <strong className="text-[var(--text-primary)]">24 horas</strong>.</li>
              <li>· Un ingreso correcto reinicia el contador.</li>
              <li>· Los errores de contraseña de <strong className="text-[var(--text-primary)]">clientes de la tienda</strong> se registran pero no bloquean, para no dejar sin comprar a quienes comparten IP con ellos.</li>
              <li>· Si el sistema de vigilancia se cae, el acceso sigue funcionando: nunca lo deja fuera de su propio panel.</li>
              <li>· Se reconoce el <strong className="text-[var(--text-primary)]">aparato</strong>: si entran desde uno nunca visto, sale marcado como aparato nuevo.</li>
              <li>· Al entrar una cuenta administrativa se pide permiso de ubicación, y si se acepta se guarda el <strong className="text-[var(--text-primary)]">lugar exacto por GPS</strong>. A los clientes de la tienda nunca se les pide.</li>
              <li>· La ubicación por IP <strong className="text-[var(--text-primary)]">solo dice la ciudad</strong>, no el lugar. Eso no se puede mejorar: una IP no contiene la dirección de nadie.</li>
              <li>· Una IP bloqueada no puede ni <strong className="text-[var(--text-primary)]">abrir el sitio web</strong>: se le corta en Cloudflare antes de entregarle la página. Cada bloqueo se puede bajar a "solo login" desde su ficha.</li>
              <li>· El bloqueo del sitio <strong className="text-[var(--text-primary)]">no aplica a la APK</strong>, que es de uso interno.</li>
            </ul>
          </div>
        </div>
      )}

      {/* =============== ACCESOS =============== */}
      {seccion === 'accesos' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-1.5 flex-wrap">
              {([
                { id: 'todos',      label: 'Todos' },
                { id: 'exitosos',   label: 'Correctos' },
                { id: 'fallidos',   label: 'Fallidos' },
                { id: 'bloqueados', label: 'Rechazados' },
              ] as { id: FiltroAccesos; label: string }[]).map(f => (
                <button
                  key={f.id}
                  onClick={() => setFiltro(f.id)}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase transition border ${
                    filtro === f.id
                      ? 'bg-[var(--brand-gold-mid)]/15 border-[var(--brand-gold-mid)]/50 text-[var(--brand-gold-mid)]'
                      : 'bg-transparent border-[var(--border-color)]/60 text-[var(--text-secondary)]'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => purgarHistorial(90)}
              disabled={limpiando}
              className="text-[11px] text-rose-400 hover:text-rose-300 font-bold px-3 py-1.5 rounded-lg border border-[var(--border-color)]/60 hover:bg-rose-500/10 transition flex items-center gap-1.5 disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" /> Depurar +90 días
            </button>
          </div>

          {accesosFiltrados.length === 0 ? (
            <div className="bg-[var(--bg-surface)] border border-dashed border-[var(--border-color)]/60 rounded-2xl py-12 text-center text-xs text-[var(--text-secondary)] italic">
              {cargando ? 'Cargando el registro de accesos…' : 'No hay intentos registrados con este filtro.'}
            </div>
          ) : (
            <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto overflow-y-auto max-h-[520px]">
                <table className="w-full min-w-[760px] text-left text-sm border-collapse leading-relaxed">
                  <thead>
                    <tr className="border-b border-[var(--border-color)]/80 bg-[var(--bg-base)] text-[var(--text-secondary)]">
                      <th className="p-3 text-[10px] uppercase">Resultado</th>
                      <th className="p-3 text-[10px] uppercase">Fecha</th>
                      <th className="p-3 text-[10px] uppercase">Correo</th>
                      <th className="p-3 text-[10px] uppercase">Ubicación</th>
                      <th className="p-3 text-[10px] uppercase">IP / Operador</th>
                      <th className="p-3 text-[10px] uppercase">Dispositivo</th>
                    </tr>
                  </thead>
                  <PaginatedTbody
                    items={accesosFiltrados}
                    itemsPerPage={12}
                    renderItem={(a: Acceso) => (
                      <tr
                        key={a.id}
                        onClick={() => setDetalle(a)}
                        className="hover:bg-[var(--bg-base)] cursor-pointer border-b border-[var(--border-color)]/30"
                      >
                        <td className="p-3">
                          {a.bloqueado ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase bg-rose-500/10 border border-rose-500/40 text-rose-500 px-2 py-0.5 rounded">
                              <Ban className="w-3 h-3" /> Rechazado
                            </span>
                          ) : a.exito ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase bg-[var(--ok-soft)] border border-[var(--ok)] text-[var(--ok)] px-2 py-0.5 rounded">
                              <CheckCircle className="w-3 h-3" /> Correcto
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase bg-amber-500/10 border border-amber-500/40 text-amber-500 px-2 py-0.5 rounded">
                              <XCircle className="w-3 h-3" /> Fallido
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-[11px] text-[var(--text-secondary)] whitespace-nowrap">{fechaCorta(a.ocurrido_en)}</td>
                        <td className="p-3 text-[11px] text-[var(--text-primary)] max-w-[180px] truncate">{a.email || '—'}</td>
                        <td className="p-3 text-[11px] text-[var(--text-primary)]">
                          <span className="mr-1.5 text-sm leading-none">{bandera(a.codigo_pais)}</span>
                          {ubicacionTexto(a)}
                        </td>
                        <td className="p-3 text-[10px] font-mono text-[var(--text-secondary)]">
                          <div className="text-[var(--text-primary)]">{a.ip || '—'}</div>
                          {a.proveedor && <div className="truncate max-w-[150px]">{a.proveedor}</div>}
                        </td>
                        <td className="p-3 text-[11px] text-[var(--text-secondary)]">
                          <div>{resumirDispositivo(a.user_agent)}</div>
                          {/* Esta es la señal que de verdad delata a un extraño:
                              la ubicación por IP solo llega a la ciudad, pero un
                              aparato que nunca se había usado sí es noticia. */}
                          {a.dispositivo_conocido === false && (
                            <span className="inline-block mt-1 text-[9px] font-bold uppercase bg-amber-500/10 border border-amber-500/40 text-amber-500 px-1.5 py-0.5 rounded">
                              Aparato nuevo
                            </span>
                          )}
                          {a.gps_latitud != null && (
                            <span className="inline-block mt-1 ml-1 text-[9px] font-bold uppercase bg-[var(--ok-soft)] border border-[var(--ok)] text-[var(--ok)] px-1.5 py-0.5 rounded">
                              GPS
                            </span>
                          )}
                        </td>
                      </tr>
                    )}
                  />
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* =============== DISPOSITIVOS =============== */}
      {seccion === 'dispositivos' && (
        <div className="space-y-4">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-2xl p-5">
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              Cada celular o computadora desde el que se entró correctamente queda marcado aquí. Si un día aparece un{' '}
              <strong className="text-amber-500">aparato nuevo</strong> que usted no reconoce, esa es la señal de
              alarma de verdad — mucho más confiable que la ubicación, porque la IP solo llega a decir la ciudad.
            </p>
            <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed mt-3 pt-3 border-t border-[var(--border-color)]/40">
              Dos advertencias honestas: si usted borra los datos del navegador o entra en modo incógnito, su propio
              aparato va a salir como nuevo. Y la marca la manda el navegador, así que en teoría se puede falsear:
              tómelo como una alerta que vale la pena revisar, no como una cerradura.
            </p>
          </div>

          {dispositivos.length === 0 ? (
            <div className="bg-[var(--bg-surface)] border border-dashed border-[var(--border-color)]/60 rounded-2xl py-12 text-center text-xs text-[var(--text-secondary)] italic">
              {cargando ? 'Cargando…' : 'Todavía no hay aparatos registrados. El suyo aparecerá la próxima vez que inicie sesión.'}
            </div>
          ) : (
            <div className="space-y-2">
              {dispositivos.map(d => (
                <div
                  key={d.device_id}
                  className={`bg-[var(--bg-surface)] border rounded-2xl p-4 space-y-2 ${
                    d.confiable ? 'border-[var(--border-color)]/60' : 'border-amber-500/50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-bold text-sm text-[var(--text-primary)] truncate">
                        {d.etiqueta || resumirDispositivo(d.user_agent)}
                      </div>
                      <div className="text-[11px] text-[var(--text-secondary)]">
                        {resumirDispositivo(d.user_agent)}
                        {d.origen ? ` · ${d.origen}` : ''} · {d.ingresos} ingreso(s)
                      </div>
                      <div className="text-[10px] text-[var(--text-secondary)]">
                        Primera vez: {fechaCorta(d.primer_visto)}
                      </div>
                      <div className="text-[10px] text-[var(--text-secondary)]">
                        Última vez: {fechaCorta(d.ultimo_visto)}
                        {d.ultimo_email ? ` · ${d.ultimo_email}` : ''}
                      </div>
                      <div className="text-[9px] text-[var(--text-muted)] font-mono truncate mt-1">{d.device_id}</div>
                    </div>
                    {!d.confiable && (
                      <span className="flex-shrink-0 text-[9px] uppercase font-bold bg-amber-500/10 border border-amber-500/40 text-amber-500 px-2 py-0.5 rounded">
                        No reconocido
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 pt-2 border-t border-[var(--border-color)]/40">
                    <button
                      onClick={() => renombrarDispositivo(d)}
                      className="bg-[var(--bg-base)] border border-[var(--border-color)]/80 text-[var(--text-primary)] text-[11px] font-bold px-3 py-1.5 rounded-lg transition hover:bg-[var(--bg-surface)]"
                    >
                      Ponerle nombre
                    </button>
                    <button
                      onClick={() => cambiarConfianzaDispositivo(d)}
                      className={`text-[11px] font-bold px-3 py-1.5 rounded-lg transition border ${
                        d.confiable
                          ? 'bg-amber-500/10 border-amber-500/40 text-amber-500 hover:bg-amber-500/20'
                          : 'bg-[var(--ok-soft)] border-[var(--ok)] text-[var(--ok)] hover:brightness-110'
                      }`}
                    >
                      {d.confiable ? 'No lo reconozco' : 'Sí es mío'}
                    </button>
                    <button
                      onClick={() => olvidarDispositivo(d)}
                      className="bg-rose-500/10 border border-rose-500/40 text-rose-400 text-[11px] font-bold px-3 py-1.5 rounded-lg transition hover:bg-rose-500/20"
                    >
                      Olvidar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* =============== BLOQUEOS =============== */}
      {seccion === 'bloqueos' && (
        <div className="space-y-4">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-2xl p-5 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] border-b border-[var(--border-color)]/50 pb-2">
              Bloquear una conexión a mano
            </h4>
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                value={nuevaIpBloqueo}
                onChange={e => setNuevaIpBloqueo(e.target.value)}
                placeholder="Dirección IP (ej. 190.10.20.30)"
                className="flex-1 min-w-[200px] bg-[var(--bg-base)] border border-[var(--border-color)]/80 rounded-xl px-4 py-2 text-sm text-[var(--text-primary)] font-mono focus:outline-none placeholder:text-[var(--text-muted)]"
              />
              <button
                onClick={() => bloquearManual(nuevaIpBloqueo, false)}
                className="bg-amber-500/10 border border-amber-500/40 text-amber-500 hover:bg-amber-500/20 text-xs font-bold px-3 py-2 rounded-xl transition flex items-center gap-1.5"
              >
                <Lock className="w-3.5 h-3.5" /> 30 minutos
              </button>
              <button
                onClick={() => bloquearManual(nuevaIpBloqueo, true)}
                className="bg-rose-500/10 border border-rose-500/40 text-rose-500 hover:bg-rose-500/20 text-xs font-bold px-3 py-2 rounded-xl transition flex items-center gap-1.5"
              >
                <Ban className="w-3.5 h-3.5" /> Permanente
              </button>
            </div>
          </div>

          {bloqueos.length === 0 ? (
            <div className="bg-[var(--bg-surface)] border border-dashed border-[var(--border-color)]/60 rounded-2xl py-12 text-center text-xs text-[var(--text-secondary)] italic">
              {cargando ? 'Cargando…' : 'No hay ninguna conexión bloqueada. Todo tranquilo.'}
            </div>
          ) : (
            <div className="space-y-2">
              {bloqueos.map(b => {
                const restantes = minutosRestantes(b.bloqueado_hasta);
                const activo = !b.desbloqueado_en && (b.permanente || restantes > 0);
                return (
                  <div
                    key={b.ip}
                    className={`bg-[var(--bg-surface)] border rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3 ${
                      activo ? 'border-rose-500/40' : 'border-[var(--border-color)]/60 opacity-70'
                    }`}
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-bold text-sm text-[var(--text-primary)]">{b.ip}</span>
                        {activo ? (
                          <span className="text-[9px] uppercase font-bold bg-rose-500/10 border border-rose-500/40 text-rose-500 px-2 py-0.5 rounded">
                            {b.permanente ? 'Permanente' : `${restantes} min restantes`}
                          </span>
                        ) : (
                          <span className="text-[9px] uppercase font-bold bg-[var(--bg-base)] border border-[var(--border-color)]/60 text-[var(--text-secondary)] px-2 py-0.5 rounded">
                            {b.desbloqueado_en ? 'Levantado' : 'Vencido'}
                          </span>
                        )}
                        {b.nivel > 0 && !b.permanente && (
                          <span className="text-[9px] uppercase font-bold text-[var(--text-secondary)]">Nivel {b.nivel}</span>
                        )}
                        <span className={`text-[9px] uppercase font-bold px-2 py-0.5 rounded border ${
                          b.bloqueo_total
                            ? 'bg-rose-500/10 border-rose-500/40 text-rose-500'
                            : 'bg-amber-500/10 border-amber-500/40 text-amber-500'
                        }`}>
                          {b.bloqueo_total ? 'Sitio completo' : 'Solo login'}
                        </span>
                      </div>
                      <div className="text-[11px] text-[var(--text-secondary)]">
                        {ubicacionTexto(b)} · {b.intentos_fallidos} intento(s)
                      </div>
                      {b.ultimo_email && (
                        <div className="text-[10px] text-[var(--text-secondary)] font-mono truncate max-w-[280px]">
                          Último correo probado: {b.ultimo_email}
                        </div>
                      )}
                      <div className="text-[10px] text-[var(--text-secondary)]">{b.motivo} · {fechaCorta(b.actualizado_en)}</div>
                    </div>
                    {activo && (
                      <div className="flex flex-wrap gap-2 flex-shrink-0">
                        <button
                          onClick={() => cambiarAlcanceBloqueo(b)}
                          className="bg-[var(--bg-base)] border border-[var(--border-color)]/80 text-[var(--text-primary)] text-[11px] font-bold px-3 py-2 rounded-xl transition hover:bg-[var(--bg-surface)]"
                        >
                          {b.bloqueo_total ? 'Dejar solo el login' : 'Bloquear el sitio entero'}
                        </button>
                        <button
                          onClick={() => desbloquear(b.ip)}
                          className="bg-[var(--bg-base)] border border-[var(--border-color)]/80 text-[var(--ok)] hover:bg-[var(--ok-soft)] text-xs font-bold px-3 py-2 rounded-xl transition flex items-center gap-1.5"
                        >
                          <Unlock className="w-3.5 h-3.5" /> Desbloquear
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* =============== LISTA BLANCA =============== */}
      {seccion === 'blanca' && (
        <div className="space-y-4">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-2xl p-5 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] border-b border-[var(--border-color)]/50 pb-2">
              Agregar conexión de confianza
            </h4>
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                value={nuevaIpBlanca}
                onChange={e => setNuevaIpBlanca(e.target.value)}
                placeholder={miIp ? `Su IP actual: ${miIp}` : 'Dirección IP'}
                className="flex-1 min-w-[180px] bg-[var(--bg-base)] border border-[var(--border-color)]/80 rounded-xl px-4 py-2 text-sm text-[var(--text-primary)] font-mono focus:outline-none placeholder:text-[var(--text-muted)]"
              />
              <input
                type="text"
                value={nuevaDescripcion}
                onChange={e => setNuevaDescripcion(e.target.value)}
                placeholder="Descripción (ej. casa, local)"
                className="flex-1 min-w-[180px] bg-[var(--bg-base)] border border-[var(--border-color)]/80 rounded-xl px-4 py-2 text-sm text-[var(--text-primary)] focus:outline-none placeholder:text-[var(--text-muted)]"
              />
              <button
                onClick={() => agregarConfianza(nuevaIpBlanca || miIp || '', nuevaDescripcion)}
                className="bg-[var(--ok-soft)] border border-[var(--ok)] text-[var(--ok)] hover:brightness-110 text-xs font-bold px-4 py-2 rounded-xl transition flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" /> Agregar
              </button>
            </div>
          </div>

          {confianza.length === 0 ? (
            <div className="bg-[var(--bg-surface)] border border-dashed border-[var(--border-color)]/60 rounded-2xl py-12 text-center text-xs text-[var(--text-secondary)] italic">
              {cargando ? 'Cargando…' : 'No hay conexiones de confianza registradas.'}
            </div>
          ) : (
            <div className="space-y-2">
              {confianza.map(c => (
                <div key={c.ip} className="bg-[var(--bg-surface)] border border-[var(--ok)]/40 rounded-2xl p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono font-bold text-sm text-[var(--text-primary)]">{c.ip}</div>
                    <div className="text-[11px] text-[var(--text-secondary)] truncate">{c.descripcion || 'Sin descripción'}</div>
                    <div className="text-[10px] text-[var(--text-secondary)]">Agregada el {fechaCorta(c.creado_en)}</div>
                  </div>
                  <button
                    onClick={() => quitarConfianza(c.ip)}
                    className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 p-2 rounded-xl transition flex-shrink-0"
                    title="Quitar de la lista blanca"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* =============== BITÁCORA OPERATIVA (absorbida) =============== */}
      {seccion === 'bitacora' && (
        <div className="space-y-4">
          <p className="text-[11px] text-[var(--text-secondary)] leading-snug">
            Aquí queda lo que se <strong className="text-[var(--text-primary)]">hizo</strong> (ventas, ajustes,
            inventario). En "Accesos" queda quién <strong className="text-[var(--text-primary)]">entró</strong>.
          </p>

          {/* ---- Estado y limpieza del historial ---- */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/70 rounded-xl p-3 space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { etiqueta: 'Bitácora', valor: conteos?.bitacora_total ?? 0 },
                { etiqueta: 'Accesos',  valor: conteos?.accesos_total ?? 0 },
                { etiqueta: '+90 días', valor: conteos?.accesos_90 ?? 0 },
              ].map(x => (
                <div key={x.etiqueta} className="bg-[var(--bg-base)] border border-[var(--border-color)]/50 rounded-lg py-2">
                  <div className="text-base font-bold text-[var(--text-primary)] font-mono">{x.valor}</div>
                  <div className="text-[9px] uppercase tracking-wider text-[var(--text-secondary)]">{x.etiqueta}</div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={limpiarBitacora}
                disabled={limpiando}
                className="text-[10px] font-bold uppercase px-2.5 py-1.5 rounded-lg border border-[var(--border-color)]/70 text-rose-400 hover:bg-rose-500/10 disabled:opacity-50"
              >
                Limpiar bitácora
              </button>
              <button
                onClick={() => purgarHistorial(90)}
                disabled={limpiando}
                className="text-[10px] font-bold uppercase px-2.5 py-1.5 rounded-lg border border-[var(--border-color)]/70 text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"
              >
                Accesos +90 días
              </button>
              <button
                onClick={() => purgarHistorial(30)}
                disabled={limpiando}
                className="text-[10px] font-bold uppercase px-2.5 py-1.5 rounded-lg border border-[var(--border-color)]/70 text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"
              >
                Accesos +30 días
              </button>
              <button
                onClick={() => purgarHistorial(0)}
                disabled={limpiando}
                className="text-[10px] font-bold uppercase px-2.5 py-1.5 rounded-lg border border-rose-500/40 text-rose-400 hover:bg-rose-500/10 disabled:opacity-50"
              >
                Borrar todos los accesos
              </button>
            </div>

            {conteos?.accesos_90 === 0 && conteos?.accesos_total > 0 && (
              <p className="text-[10px] text-[var(--text-secondary)] leading-snug">
                Ningún acceso supera los 90 días — el más antiguo es del{' '}
                {conteos?.accesos_mas_viejo ? new Date(conteos.accesos_mas_viejo).toLocaleDateString() : '—'}. Por eso
                "Depurar +90 días" no borra nada todavía: no hay nada tan viejo, no es una avería.
              </p>
            )}
          </div>

          <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto overflow-y-auto max-h-[500px]">
              <table className="w-full min-w-[600px] text-left text-sm border-collapse font-mono leading-relaxed">
                <thead>
                  <tr className="border-b border-[var(--border-color)]/80 bg-[var(--bg-base)] text-[var(--text-secondary)]">
                    <th className="p-3">ID / Fecha</th>
                    <th className="p-3">Usuario</th>
                    <th className="p-3 text-center">Módulo</th>
                    <th className="p-3 text-center">Acción</th>
                    <th className="p-3">Detalle Técnico</th>
                  </tr>
                </thead>
                <PaginatedTbody
                  items={auditLog}
                  itemsPerPage={10}
                  renderItem={(log: AuditLog) => (
                    <tr key={log.id} className="hover:bg-[var(--bg-base)]">
                      <td className="p-3">
                        <div className="text-[10px] text-[var(--text-secondary)]">{log.id}</div>
                        <div className="text-[9px] text-[var(--text-secondary)]">{new Date(log.timestamp).toLocaleString()}</div>
                      </td>
                      <td className="p-3 font-medium text-[var(--text-primary)]">{log.userEmail}</td>
                      <td className="p-3 text-center">
                        <span className="bg-blue-50 text-blue-600 border border-blue-100 px-2 py-0.5 rounded text-[10px] uppercase font-bold ">
                          {log.module}
                        </span>
                      </td>
                      <td className="p-3 text-center text-[var(--text-primary)] font-bold text-[10px] uppercase">{log.action}</td>
                      <td className="p-3 text-[var(--text-primary)] max-w-sm whitespace-pre-wrap">{log.detail}</td>
                    </tr>
                  )}
                />
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =============== VISITANTES DE LA TIENDA =============== */}
      {seccion === 'visitantes' && (
        <div className="space-y-4">
          {/* ---- Cabecera: tres cifras y el buscador ---- */}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex gap-5">
              {[
                { n: visitantesAgrupados.length, t: 'Aparatos' },
                { n: visitantesAgrupados.reduce((a, g) => a + g.visitas, 0), t: 'Visitas' },
                { n: visitantesAgrupados.filter(g => g.email).length, t: 'Identificados' },
              ].map(x => (
                <div key={x.t}>
                  <div className="text-xl font-semibold text-[var(--text-primary)] leading-none tabular-nums">{x.n}</div>
                  <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--text-secondary)] mt-1">{x.t}</div>
                </div>
              ))}
            </div>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
              <input
                value={buscarVisitante}
                onChange={e => setBuscarVisitante(e.target.value)}
                placeholder="Buscar"
                className="bg-transparent border-b border-[var(--border-color)] focus:border-[var(--brand-gold-mid)] pl-8 pr-2 py-1.5 text-xs text-[var(--text-primary)] w-40 focus:outline-none transition-colors"
              />
            </div>
          </div>

          {/* ---- Lista ----
              Se pasó de tabla a lista de filas porque la tabla obligaba a
              desplazarse en horizontal en un celular, que es justo donde
              se revisa esto. Cada fila cabe en el ancho de la pantalla. */}
          <div className="divide-y divide-[var(--border-color)]/40 border-y border-[var(--border-color)]/40">
            {gruposFiltrados
              .slice((paginaVisitantes - 1) * 10, paginaVisitantes * 10)
              .map((g: GrupoVisitante) => {
                const penalizado = !!g.email && emailsPenalizados.has(g.email.toLowerCase());
                const bloqueado = g.huellas.some(h =>
                  aparatos.some(a => a.device_uuid === h && !a.levantado_en));
                return (
                  <div key={g.clave} className="flex items-center gap-3 py-3 group">
                    {/* Icono */}
                    <div className="w-8 h-8 rounded-full bg-[var(--bg-base)] border border-[var(--border-color)]/60 flex items-center justify-center flex-shrink-0">
                      {g.tipo === 'Escritorio'
                        ? <Monitor className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                        : <Smartphone className="w-3.5 h-3.5 text-[var(--text-secondary)]" />}
                    </div>

                    {/* Identidad */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[13px] font-medium text-[var(--text-primary)] truncate">
                          {g.dispositivo || g.tipo || 'Sin identificar'}
                        </span>
                        {g.huellas.length > 1 && (
                          <span
                            title={`${g.huellas.length} identidades del mismo equipo`}
                            className="text-[10px] text-[var(--text-secondary)] tabular-nums"
                          >
                            ×{g.huellas.length}
                          </span>
                        )}
                        {bloqueado && (
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-500 flex-shrink-0" title="Bloqueado" />
                        )}
                      </div>
                      <div className="text-[11px] text-[var(--text-secondary)] truncate">
                        {[
                          [g.sistema, g.version_sistema].filter(Boolean).join(' '),
                          g.navegador,
                          g.email || 'Anónimo',
                        ].filter(Boolean).join(' · ')}
                        {penalizado && <span className="text-rose-400"> · cuenta baneada</span>}
                      </div>
                    </div>

                    {/* Cifras */}
                    <div className="text-right flex-shrink-0 hidden sm:block">
                      <div className="text-[13px] text-[var(--text-primary)] tabular-nums leading-none">{g.visitas}</div>
                      <div className="text-[10px] text-[var(--text-secondary)] mt-0.5">{fechaCorta(g.ultima)}</div>
                    </div>

                    {/* Acciones: discretas hasta que se necesitan */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => setVisitanteDetalle(g.reciente)}
                        title="Ver ficha"
                        className="w-7 h-7 rounded-full flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-base)] transition"
                      >
                        <Search className="w-3.5 h-3.5" />
                      </button>
                      {/* Disponible para TODOS los aparatos, tengan cuenta
                          o no: se bloquea el equipo, y para eso no hace
                          falta saber quién lo usa. */}
                      {bloqueado ? (
                        <button
                          onClick={() => liberarAparato(g.huellas[0])}
                          className="text-[10px] px-2 py-1 rounded-full border border-[var(--border-color)]/60 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition"
                        >
                          Liberar
                        </button>
                      ) : (
                        <button
                          onClick={() => banearGrupo(g)}
                          className="text-[10px] px-2 py-1 rounded-full border border-transparent text-[var(--text-secondary)] hover:text-rose-400 hover:border-rose-500/40 transition"
                        >
                          Banear
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>

          {gruposFiltrados.length > 10 && (
            <div className="flex items-center justify-between text-[11px] text-[var(--text-secondary)]">
              <span className="tabular-nums">
                {(paginaVisitantes - 1) * 10 + 1}–{Math.min(paginaVisitantes * 10, gruposFiltrados.length)} de {gruposFiltrados.length}
              </span>
              <div className="flex gap-1">
                <button
                  onClick={() => setPaginaVisitantes(p => Math.max(1, p - 1))}
                  disabled={paginaVisitantes === 1}
                  className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-[var(--bg-base)] disabled:opacity-30 transition"
                >
                  ‹
                </button>
                <button
                  onClick={() => setPaginaVisitantes(p =>
                    Math.min(Math.ceil(gruposFiltrados.length / 10), p + 1))}
                  disabled={paginaVisitantes >= Math.ceil(gruposFiltrados.length / 10)}
                  className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-[var(--bg-base)] disabled:opacity-30 transition"
                >
                  ›
                </button>
              </div>
            </div>
          )}

          {gruposFiltrados.length === 0 && (
            <p className="text-center text-xs text-[var(--text-secondary)] py-10">
              {visitantes.length === 0
                ? 'Todavía no hay visitas registradas.'
                : 'Nada coincide con la búsqueda.'}
            </p>
          )}

          <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed">
            Un renglón por aparato, no por visita. No se registra ubicación: a los clientes no se les pide GPS.
            {visitantesAgrupados.length < visitantes.length && (
              <> Se agruparon {visitantes.length} identidades en {visitantesAgrupados.length} aparatos — un mismo
              teléfono genera una identidad nueva cuando el navegador borra sus datos, y Safari lo hace a los siete
              días sin visitas. Al bloquear un renglón se bloquean todas las suyas.</>
            )}
          </p>
        </div>
      )}

      {seccion === 'penalizados' && (
        <div className="space-y-4">
          <p className="text-xs text-[var(--text-secondary)] max-w-2xl leading-relaxed">
            El baneo total hace tres cosas a la vez: marca la cuenta, bloquea todas las IPs desde las que se le vio y
            desactiva su perfil de cliente. Deja de poder entrar, ver el catálogo y comprar — la aplicación le muestra
            una pantalla de acceso denegado.{' '}
            <strong className="text-[var(--text-primary)]">Los pedidos y facturas anteriores no se tocan</strong>,
            porque son parte de la contabilidad.
          </p>

          <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-[var(--border-color)]/80 bg-[var(--bg-base)] text-[var(--text-secondary)] uppercase text-[10px] tracking-wide">
                    <th className="p-3">Cuenta</th>
                    <th className="p-3">Motivo</th>
                    <th className="p-3 text-center">IPs bloqueadas</th>
                    <th className="p-3">Aplicado</th>
                    <th className="p-3 text-center">Estado</th>
                    <th className="p-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <PaginatedTbody
                  items={penalizados}
                  itemsPerPage={10}
                  renderItem={(x: Penalizado) => {
                    const vigente = !x.levantado_en;
                    return (
                      <tr key={x.email} className="border-b border-[var(--border-color)]/40 hover:bg-[var(--bg-base)]">
                        <td className="p-3">
                          <div className="font-bold text-[var(--text-primary)] truncate max-w-[200px]">{x.email}</div>
                          {x.nombre && <div className="text-[10px] text-[var(--text-secondary)]">{x.nombre}</div>}
                        </td>
                        <td className="p-3 text-[var(--text-primary)] max-w-[220px]">
                          <div className="line-clamp-2">{x.motivo || '—'}</div>
                          {x.bloquear_user_agent && (
                            <div className="text-[9px] uppercase font-bold text-amber-500 mt-1">+ navegador bloqueado</div>
                          )}
                        </td>
                        <td className="p-3 text-center font-mono text-[var(--text-primary)]">
                          {x.ips_bloqueadas?.length || 0}
                        </td>
                        <td className="p-3 text-[11px] text-[var(--text-secondary)]">
                          <div>{fechaCorta(x.creado_en)}</div>
                          {x.creado_por && <div className="text-[10px] truncate max-w-[150px]">{x.creado_por}</div>}
                        </td>
                        <td className="p-3 text-center">
                          {vigente ? (
                            <span className="text-[9px] uppercase font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30 px-2 py-0.5 rounded">
                              Vigente
                            </span>
                          ) : (
                            <span className="text-[9px] uppercase font-bold border border-[var(--border-color)]/70 text-[var(--text-secondary)] px-2 py-0.5 rounded">
                              Levantado
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-right">
                          {vigente ? (
                            <button
                              onClick={() => levantarBaneo(x.email)}
                              className="text-[10px] font-bold uppercase px-2 py-1 rounded-lg border border-[var(--border-color)]/70 text-[var(--text-primary)] hover:bg-[var(--bg-surface)] inline-flex items-center gap-1"
                            >
                              <Unlock className="w-3 h-3" /> Levantar
                            </button>
                          ) : (
                            <span className="text-[10px] text-[var(--text-secondary)]">
                              {fechaCorta(x.levantado_en)}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  }}
                />
              </table>
            </div>
          </div>

          {penalizados.length === 0 && (
            <p className="text-center text-xs text-[var(--text-secondary)] py-8">
              No hay ninguna cuenta penalizada. El baneo total se aplica desde la lista de visitantes o desde la ficha
              del cliente.
            </p>
          )}
        </div>
      )}

      {/* =============== APARATOS BLOQUEADOS =============== */}
      {seccion === 'aparatos' && (
        <div className="space-y-4">
          <p className="text-xs text-[var(--text-secondary)] max-w-2xl leading-relaxed">
            Esto <strong className="text-[var(--text-primary)]">sustituye al viejo bloqueo por dirección IP</strong>.
            Una IP la comparte un edificio entero, un café o toda una red móvil: bloquearla castigaba a gente que no
            tenía nada que ver, y a quien se quería bloquear le bastaba apagar el WiFi para volver a entrar. El
            identificador de aparato no cambia al cambiar de red, así que el bloqueo sigue a la persona del WiFi a los
            datos móviles.
          </p>

          <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-2xl p-4 space-y-2">
            <h5 className="text-[10px] uppercase font-bold text-[var(--text-secondary)]">Bloquear un aparato a mano</h5>
            <div className="flex flex-wrap gap-2">
              <input
                value={nuevoAparato}
                onChange={e => setNuevoAparato(e.target.value)}
                placeholder="Identificador del aparato (columna Aparato en Visitantes)"
                className="flex-1 min-w-[240px] bg-[var(--bg-base)] border border-[var(--border-color)]/80 rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] font-mono focus:outline-none focus:border-[var(--brand-gold-mid)]"
              />
              <button
                onClick={() => banearAparato(nuevoAparato)}
                className="bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold px-4 py-2 rounded-xl flex items-center gap-1.5"
              >
                <Ban className="w-3.5 h-3.5" /> Bloquear
              </button>
            </div>
          </div>

          <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-[var(--border-color)]/80 bg-[var(--bg-base)] text-[var(--text-secondary)] uppercase text-[10px] tracking-wide">
                    <th className="p-3">Aparato</th>
                    <th className="p-3">Motivo</th>
                    <th className="p-3">Cuenta</th>
                    <th className="p-3">Bloqueado</th>
                    <th className="p-3 text-center">Estado</th>
                    <th className="p-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <PaginatedTbody
                  items={aparatos}
                  itemsPerPage={10}
                  renderItem={(a: AparatoBaneado) => {
                    const vigente = !a.levantado_en;
                    return (
                      <tr key={a.device_uuid} className="border-b border-[var(--border-color)]/40 hover:bg-[var(--bg-base)]">
                        <td className="p-3 font-mono text-[10px] text-[var(--text-primary)] break-all max-w-[200px]">
                          {a.device_uuid}
                        </td>
                        <td className="p-3 text-[var(--text-primary)] max-w-[200px]">
                          <div className="line-clamp-2">{a.motivo || '—'}</div>
                        </td>
                        <td className="p-3 text-[var(--text-secondary)] truncate max-w-[160px]">{a.email || 'Sin cuenta'}</td>
                        <td className="p-3 text-[11px] text-[var(--text-secondary)]">
                          <div>{fechaCorta(a.creado_en)}</div>
                          {a.creado_por && <div className="text-[10px] truncate max-w-[140px]">{a.creado_por}</div>}
                        </td>
                        <td className="p-3 text-center">
                          {vigente ? (
                            <span className="text-[9px] uppercase font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30 px-2 py-0.5 rounded">
                              Bloqueado
                            </span>
                          ) : (
                            <span className="text-[9px] uppercase font-bold border border-[var(--border-color)]/70 text-[var(--text-secondary)] px-2 py-0.5 rounded">
                              Liberado
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-right">
                          {vigente ? (
                            <button
                              onClick={() => liberarAparato(a.device_uuid)}
                              className="text-[10px] font-bold uppercase px-2 py-1 rounded-lg border border-[var(--border-color)]/70 text-[var(--text-primary)] hover:bg-[var(--bg-surface)] inline-flex items-center gap-1"
                            >
                              <Unlock className="w-3 h-3" /> Liberar
                            </button>
                          ) : (
                            <span className="text-[10px] text-[var(--text-secondary)]">{fechaCorta(a.levantado_en)}</span>
                          )}
                        </td>
                      </tr>
                    );
                  }}
                />
              </table>
            </div>
          </div>

          {aparatos.length === 0 && (
            <p className="text-center text-xs text-[var(--text-secondary)] py-8">
              No hay ningún aparato bloqueado.
            </p>
          )}

          <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed">
            Hay que ser honesto con el alcance: la marca del aparato vive en el navegador, y quien borre los datos del
            navegador aparecerá como equipo nuevo. Por eso esta capa evita que el bloqueado pueda siquiera{' '}
            <strong className="text-[var(--text-primary)]">ver</strong> la página, mientras la cerradura de verdad —la
            que impide entrar a la cuenta y leer datos— es el baneo de cuenta, que no tiene nada que borrar.
          </p>
        </div>
      )}

      {/* =============== MI ACCESO BIOMÉTRICO =============== */}
      {seccion === 'biometria' && (
        <div className="space-y-4">
          <p className="text-xs text-[var(--text-secondary)] max-w-2xl leading-relaxed">
            Face ID, Touch ID o huella para entrar sin escribir la contraseña.{' '}
            <strong className="text-[var(--text-primary)]">Aquí no se guarda ninguna cara ni ninguna huella</strong>: el
            teléfono no se las entrega al navegador. Lo que se guarda es una llave pública que solo sirve para
            comprobar firmas, y la llave privada nunca sale del chip seguro del aparato.
          </p>

          <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-2xl p-4 space-y-3">
            {/* FALLO CORREGIDO: esto se gateaba SOLO por `hayBiometria`, un
                chequeo de hardware en vivo (`isAvailable()`) que en algunos
                sensores en pantalla puede fallar de forma transitoria. Con
                eso, un teléfono que YA tenía la huella activada perdía sus
                controles —incluido "Quitar de este teléfono"— y mostraba el
                mensaje de "este aparato no ofrece acceso biométrico", que es
                justo el "me hace reconfigurar todo de cero" reportado: no
                era que se hubiera desactivado, era que la pantalla dejaba de
                mostrar que SÍ estaba activada. `huellaActivada` no depende
                de ningún chequeo de hardware —es la marca guardada—, así que
                si ya se activó una vez en este teléfono, los controles se
                quedan visibles sin importar lo que responda el chequeo en
                vivo en este instante. */}
            {(hayBiometria || (esApk && huellaActivada)) ? (
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={activarBiometria}
                  disabled={registrandoLlave}
                  className="bg-sky-500 hover:bg-sky-600 text-white text-xs font-bold px-4 py-2.5 rounded-xl flex items-center gap-2 disabled:opacity-60"
                >
                  <Fingerprint className="w-4 h-4" />
                  {registrandoLlave
                    ? 'Esperando al aparato…'
                    : huellaActivada ? 'Volver a activar' : 'Activar en este aparato'}
                </button>
                {esApk && huellaActivada && (
                  <button
                    onClick={async () => {
                      await desactivarBiometriaNativa();
                      setHuellaActivada(false);
                      toast.success('Acceso con huella retirado de este teléfono.');
                    }}
                    className="border border-[var(--border-color)]/70 text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs font-bold px-4 py-2.5 rounded-xl"
                  >
                    Quitar de este teléfono
                  </button>
                )}
              </div>
            ) : (
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                Este aparato no ofrece acceso biométrico. Ocurre cuando el equipo no tiene lector, cuando el sitio no
                se abrió por HTTPS, o dentro de la APK si el contenido no se sirve desde el dominio real.
              </p>
            )}
          </div>

          {llaves.length > 0 && (
            <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[var(--border-color)]/80 bg-[var(--bg-base)] text-[var(--text-secondary)] uppercase text-[10px] tracking-wide">
                      <th className="p-3">Aparato</th>
                      <th className="p-3">Activado</th>
                      <th className="p-3">Último uso</th>
                      <th className="p-3 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {llaves.map(l => (
                      <tr key={l.id} className="border-b border-[var(--border-color)]/40 hover:bg-[var(--bg-base)]">
                        <td className="p-3 text-[var(--text-primary)] max-w-[240px]">
                          <div className="truncate">{l.etiqueta || 'Aparato sin nombre'}</div>
                        </td>
                        <td className="p-3 text-[11px] text-[var(--text-secondary)]">{fechaCorta(l.creado_en)}</td>
                        <td className="p-3 text-[11px] text-[var(--text-secondary)]">
                          {l.ultimo_uso ? fechaCorta(l.ultimo_uso) : 'Nunca'}
                        </td>
                        <td className="p-3 text-right">
                          <button
                            onClick={() => quitarLlave(l.id)}
                            className="text-[10px] font-bold uppercase px-2 py-1 rounded-lg border border-[var(--border-color)]/70 text-[var(--text-secondary)] hover:text-rose-400 hover:border-rose-500/40 inline-flex items-center gap-1"
                          >
                            <Trash2 className="w-3 h-3" /> Quitar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {esApk && (
            <div className="bg-[var(--bg-base)] border border-[var(--border-color)]/60 rounded-2xl p-4">
              <h5 className="text-[11px] uppercase font-bold text-[var(--text-secondary)] mb-2">
                En la aplicación funciona distinto
              </h5>
              <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                El navegador interno de Android no soporta el sistema de llaves que usa la web, así que aquí se usa el
                lector del propio teléfono: la huella libera una sesión guardada en el almacén cifrado del sistema.
              </p>
              <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed mt-2">
                Es lo que hacen las aplicaciones de banco, y es seguro, pero conviene saber la diferencia: en la web se
                guarda una llave que <strong className="text-[var(--text-primary)]">solo sirve para firmar</strong> y no
                funcionaría en otro aparato; aquí se guarda un pase. Sacarlo del almacén cifrado exige un teléfono
                alterado, pero no es imposible.
              </p>
            </div>
          )}

          <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4">
            <h5 className="text-[11px] uppercase font-bold text-amber-500 mb-2">Un límite que conviene tener claro</h5>
            <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
              Si en un mismo teléfono hay <strong className="text-[var(--text-primary)]">dos caras registradas en Face
              ID</strong> (o dos huellas), las dos desbloquean ese teléfono, y por lo tanto las dos pueden usar las
              llaves que guarda. Eso lo decide iOS o Android, no esta aplicación, y no hay forma de impedirlo desde
              acá.
            </p>
            <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed mt-2">
              O sea: el aislamiento entre cuentas es total{' '}
              <strong className="text-[var(--text-primary)]">entre aparatos distintos</strong>. Si dos personas van a
              tener cuentas separadas de verdad, cada una debe activar su biometría en su propio teléfono y no enrolar
              su cara en el del otro.
            </p>
          </div>

          <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed">
            Las llaves de esta lista son solo suyas. Ni siquiera el dueño puede ver ni usar las de otra cuenta: la
            llave privada vive en el aparato de esa persona y aquí únicamente queda la parte pública, que no sirve para
            entrar.
          </p>
        </div>
      )}

      {/* =============== DETALLE DE UN VISITANTE =============== */}
      {visitanteDetalle && (
        <div
          className="fixed inset-0 z-[999] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setVisitanteDetalle(null)}
        >
          <div
            className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[85vh] overflow-y-auto p-5 space-y-3"
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
      {baneoModal && (
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
            className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[85vh] overflow-y-auto p-5 space-y-3"
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
              ['Ubicación GPS', detalle.gps_latitud != null && detalle.gps_longitud != null
                ? `${detalle.gps_latitud.toFixed(6)}, ${detalle.gps_longitud.toFixed(6)}` +
                  (detalle.gps_precision_m != null ? ` (±${Math.round(detalle.gps_precision_m)} m)` : '')
                : 'no autorizada'],
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
            {detalle.gps_latitud != null && detalle.gps_longitud != null ? (
              <a
                href={`https://www.google.com/maps?q=${detalle.gps_latitud},${detalle.gps_longitud}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-center bg-[var(--ok-soft)] border border-[var(--ok)] text-[var(--ok)] text-xs font-bold px-4 py-2.5 rounded-xl transition hover:brightness-110"
              >
                Ver el lugar EXACTO en el mapa (GPS)
              </a>
            ) : detalle.latitud != null && detalle.longitud != null ? (
              <a
                href={`https://www.google.com/maps?q=${detalle.latitud},${detalle.longitud}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-center bg-[var(--bg-base)] border border-[var(--border-color)]/80 text-[var(--text-secondary)] text-xs font-bold px-4 py-2.5 rounded-xl transition hover:bg-[var(--bg-surface)]"
              >
                Ver solo la ciudad en el mapa (no es el lugar)
              </a>
            ) : null}

            {detalle.gps_latitud != null ? (
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
    </div>
  );
}
