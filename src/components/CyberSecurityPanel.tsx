import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ShieldAlert, Globe, Ban, CheckCircle, XCircle, RefreshCw, Trash2,
  MapPin, Smartphone, Monitor, Plus, Unlock, Lock, BookOpen, Activity
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import { getDB, saveDB } from '../utils/storage';
import { obtenerMiConexion } from '../utils/adminLogin';
import { AuditLog } from '../types';
import { PaginatedTbody } from './PaginationHelper';
import { useToast, useConfirm } from './ui/Overlays';

// =====================================================================
// CENTRO DE CIBERSEGURIDAD
// =====================================================================
// Una sola pantalla con todo lo que tiene que ver con quién entra, quién
// lo intenta y qué se hace dentro del sistema:
//
//   · Resumen        — el estado de un vistazo
//   · Accesos        — cada intento, con IP, ubicación y dispositivo
//   · Bloqueos       — la lista negra de IPs, con desbloqueo manual
//   · Lista blanca   — conexiones de confianza que nunca se bloquean
//   · Bitácora       — el registro de acciones operativas
//
// La pestaña "Bitácora de Auditoría" que existía aparte quedó absorbida
// aquí como la última sección: es exactamente la misma tabla, con el
// mismo botón de limpiar. No se perdió nada, solo dejó de estar suelta.
// =====================================================================

interface CyberSecurityPanelProps {
  auditLog: AuditLog[];
  currentUserEmail?: string;
  onAuditLogChanged?: () => void;
}

type Seccion = 'resumen' | 'accesos' | 'bloqueos' | 'blanca' | 'bitacora';
type FiltroAccesos = 'todos' | 'exitosos' | 'fallidos' | 'bloqueados';

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

  const [seccion, setSeccion] = useState<Seccion>('resumen');
  const [cargando, setCargando] = useState(true);
  const [accesos, setAccesos] = useState<Acceso[]>([]);
  const [bloqueos, setBloqueos] = useState<Bloqueo[]>([]);
  const [confianza, setConfianza] = useState<Confianza[]>([]);
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
    const [a, b, c] = await Promise.all([
      supabase.from('login_audit_logs').select('*').order('ocurrido_en', { ascending: false }).limit(300),
      supabase.from('banned_ips').select('*').order('actualizado_en', { ascending: false }),
      supabase.from('ip_whitelist').select('*').order('creado_en', { ascending: false }),
    ]);
    // Se avisa del fallo en vez de mostrar una pantalla vacía que parecería
    // decir "no hay ningún intento registrado" — que es lo contrario de lo
    // que uno necesita creer en un panel de seguridad.
    if (a.error || b.error || c.error) {
      toast.error('No se pudo leer el registro de seguridad: ' + (a.error?.message || b.error?.message || c.error?.message));
    }
    setAccesos((a.data as Acceso[]) || []);
    setBloqueos((b.data as Bloqueo[]) || []);
    setConfianza((c.data as Confianza[]) || []);
    setCargando(false);
  }, [toast]);

  useEffect(() => { cargar(); }, [cargar]);

  useEffect(() => {
    obtenerMiConexion().then(r => {
      if (r) { setMiIp(r.ip); setMiGeo(r.geo); }
    });
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
      desbloqueado_en: null,
      actualizado_en: new Date().toISOString(),
    });
    if (error) { toast.error('No se pudo bloquear: ' + error.message); return; }
    toast.success(`IP ${limpia} bloqueada ${permanente ? 'de forma permanente' : 'por 30 minutos'}.`);
    setNuevaIpBloqueo('');
    cargar();
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

  const purgarHistorial = async () => {
    const ok = await confirm({
      title: 'Depurar historial de accesos',
      message: 'Se borrarán los registros de acceso con más de 90 días. Los recientes se conservan. ¿Continuar?',
      confirmText: 'Depurar',
      variant: 'danger',
    });
    if (!ok) return;
    const { data, error } = await supabase.rpc('purgar_login_audit_logs', { p_dias: 90 });
    if (error) { toast.error('No se pudo depurar: ' + error.message); return; }
    toast.success(`${data ?? 0} registro(s) antiguo(s) eliminado(s).`);
    cargar();
  };

  const limpiarBitacora = async () => {
    const ok = await confirm({
      title: 'Limpiar bitácora operativa',
      message: 'Se depurará el registro de acciones del sistema y quedará únicamente el asiento de la limpieza. Los accesos e intentos de ingreso NO se tocan. ¿Continuar?',
      confirmText: 'Limpiar',
      variant: 'danger',
    });
    if (!ok) return;
    const db = getDB();
    db.audit_log = [{
      id: 'LOG-RESET',
      userEmail: currentUserEmail || 'admin',
      module: 'Seguridad',
      action: 'Reset Bitácora',
      detail: 'Bitácora depurada por Dueño. Se conservó el registro inicial fiscal.',
      timestamp: new Date().toISOString(),
    }];
    await saveDB(db);
    if (onAuditLogChanged) onAuditLogChanged();
    toast.success('Bitácora operativa depurada.');
  };

  // -------------------------------------------------------------------
  const secciones: { id: Seccion; label: string; icono: any; contador?: number }[] = [
    { id: 'resumen',  label: 'Resumen',      icono: Activity },
    { id: 'accesos',  label: 'Accesos',      icono: Globe,      contador: accesos.length },
    { id: 'bloqueos', label: 'Bloqueos',     icono: Ban,        contador: resumen.bloqueosActivos },
    { id: 'blanca',   label: 'Lista blanca', icono: CheckCircle, contador: confianza.length },
    { id: 'bitacora', label: 'Bitácora',     icono: BookOpen,   contador: auditLog.length },
  ];

  return (
    <div className="space-y-6" id="view-ciberseguridad">

      {/* ---- Encabezado ---- */}
      <div className="flex flex-wrap justify-between items-center gap-3 border-b border-[var(--border-color)]/50 pb-3">
        <h3 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-rose-500 dark:text-[var(--brand-gold-light)]" />
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
            {/* Adve
