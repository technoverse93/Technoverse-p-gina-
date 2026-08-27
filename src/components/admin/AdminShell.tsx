// =====================================================================
// TECHNOVERSE CONSOLE — armazón del panel de administración
// =====================================================================
// Todo lo que rodea al contenido: riel de navegación en escritorio,
// barra superior, dock inferior en móvil/APK, hoja de "Más" y buscador
// de módulos.
//
// ---------------------------------------------------------------------
// QUÉ CAMBIA RESPECTO AL PANEL ANTERIOR, Y POR QUÉ
// ---------------------------------------------------------------------
// 1. UNA sola barra de navegación por tamaño de pantalla. Antes había
//    enlaces arriba, en la barra lateral y en la barra inferior a la
//    vez; en tableta llegaban a verse los mismos módulos tres veces.
//
// 2. DISEÑO TARJETERO: la navegación es una barra de PÍLDORAS con
//    contador en vivo, no un riel lateral. El riel costaba 72px de ancho
//    permanentes (252px abierto) y no decía nada del estado de cada
//    módulo; la barra cuesta 54px de alto una sola vez, devuelve todo el
//    ancho a la mesa de trabajo y muestra desde cualquier pantalla que
//    hay 2 chats sin leer o 3 artículos en última unidad.
//
// 3. Buscador de módulos con Ctrl/⌘+K. Es lo que permite quitar peso
//    del menú sin esconder nada: cualquier módulo está a tres teclas,
//    y encuentra por sinónimos ("factura" lleva a Contabilidad).
//
// 4. En móvil, dock flotante de cinco ranuras con área táctil real y
//    respeto por la barra de gestos. La barra vieja iba pegada al
//    borde inferior y en teléfonos con gestos la última fila quedaba
//    debajo del indicador del sistema.
//
// NADA de esto cambia la lógica del panel: el armazón solo recibe qué
// módulo está activo y avisa cuando se pide otro.
// =====================================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, Store, LogOut,
  X, CornerDownLeft, RefreshCw, KeyRound, Hash,
} from 'lucide-react';
import { NAV_GROUPS, NAV_ITEMS, DOCK_IDS, resolverModulo, grupoDe, buscarModulos } from './adminNav';
import type { AdminNavItem } from './adminNav';
import type { User } from '../../types';
import { useOtaStatus, verificarActualizacionManual } from '../../mobile/otaUpdater';
import { useToast } from '../ui/Overlays';
import CambiarContrasenaModal from '../security/CambiarContrasenaModal';
import CambiarPinModal from '../security/CambiarPinModal';
import BotonTema from '../ui/BotonTema';
import { esAdminSupremo } from '../../utils/securityPin';
import { getDB, getDBVersion } from '../../utils/storage';

/**
 * Contadores en vivo de la barra de píldoras.
 *
 * Se calculan AQUÍ, en el armazón, y no se reciben por props desde
 * AdminPanel a propósito: son el estado del negocio, no de una pantalla,
 * y el armazón es lo único que está montado siempre. Pasarlos por props
 * obligaría a que cada módulo los recalculara y los propagara hacia
 * arriba.
 *
 * `tono: 'alert'` es lo que hace que el contador se pinte en rojo: se
 * reserva para lo que exige que alguien HAGA algo hoy (un artículo en su
 * última unidad, una reparación detenida). Un chat sin leer se cuenta,
 * pero en tono neutro — es trabajo normal, no una alarma.
 */
type Contador = { valor: number; tono?: 'alert' };

function calcularContadores(): Record<string, Contador> {
  try {
    const db = getDB();
    const productos = db.products || [];
    const reparaciones = db.repair_orders || [];
    const conversaciones = db.chat_conversations || [];

    // Misma regla que el panel general: "última unidad" y nada más.
    const ultimaUnidad = productos.filter(p => p && p.stock === 1).length;
    const enTaller = reparaciones.filter(
      r => r && r.status !== 'Entregada' && r.status !== 'Cancelada'
    ).length;
    const sinLeer = conversaciones.filter(
      c => c && c.status !== 'resuelto' && (c.unreadCount || 0) > 0
    ).length;

    return {
      inventario_productos: { valor: ultimaUnidad, tono: ultimaUnidad > 0 ? 'alert' : undefined },
      taller: { valor: enTaller },
      chat: { valor: sinLeer },
    };
  } catch {
    // Un fallo leyendo la caché no puede dejar sin navegación al panel:
    // sin contadores las píldoras siguen funcionando igual.
    return {};
  }
}

/**
 * Mantiene los contadores al día sin sondear la base entera cada segundo.
 *
 * `getDBVersion()` es un entero que sube en cada cambio real de la caché
 * (ver storage.ts): comparar enteros es gratis, y solo cuando cambia se
 * paga el recorrido de las tres tablas. El evento cubre el caso normal;
 * el intervalo es la red de seguridad por si un evento se pierde dentro
 * de un iframe anidado.
 */
function useContadores(): Record<string, Contador> {
  const [contadores, setContadores] = useState<Record<string, Contador>>(() => calcularContadores());

  useEffect(() => {
    let ultimaVersion = getDBVersion();
    const recalcular = () => setContadores(calcularContadores());

    const alCambiar = () => { ultimaVersion = getDBVersion(); recalcular(); };
    window.addEventListener('technoverse_db_updated', alCambiar);

    const intervalo = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const version = getDBVersion();
      if (version === ultimaVersion) return;
      ultimaVersion = version;
      recalcular();
    }, 2000);

    return () => {
      window.removeEventListener('technoverse_db_updated', alCambiar);
      window.clearInterval(intervalo);
    };
  }, []);

  return contadores;
}

interface AdminShellProps {
  activeTab: string;
  onNavigate: (tab: string) => void;
  currentUser: User | null;
  onLogout: () => void;
  onNavigateToStore: () => void;
  logoUrl?: string;
  children: React.ReactNode;
}

export default function AdminShell({
  activeTab,
  onNavigate,
  currentUser,
  onLogout,
  onNavigateToStore,
  logoUrl,
  children,
}: AdminShellProps) {
  const [menuPerfil, setMenuPerfil] = useState(false);
  const [buscadorAbierto, setBuscadorAbierto] = useState(false);

  const perfilRef = useRef<HTMLDivElement | null>(null);

  const moduloActivo = useMemo(() => resolverModulo(activeTab), [activeTab]);
  const grupoActivo = useMemo(() => grupoDe(activeTab), [activeTab]);
  const contadores = useContadores();

  /** Navegar cierra TODO lo que estuviera abierto encima. */
  const ir = useCallback((tab: string) => {
    onNavigate(tab);
    setMenuPerfil(false);
    setBuscadorAbierto(false);
  }, [onNavigate]);

  // Ctrl/⌘+K abre el buscador desde cualquier parte del panel.
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setBuscadorAbierto(v => !v);
      }
      if (e.key === 'Escape') {
        setBuscadorAbierto(false);
        setMenuPerfil(false);
      }
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, []);

  // Cerrar el menú de perfil al tocar fuera. Sin esto queda abierto
  // tapando contenido hasta que alguien acierta a pulsar el avatar otra
  // vez, que es un comportamiento que la gente reporta como "se trabó".
  useEffect(() => {
    if (!menuPerfil) return;
    const alTocarFuera = (e: MouseEvent) => {
      if (perfilRef.current && !perfilRef.current.contains(e.target as Node)) setMenuPerfil(false);
    };
    document.addEventListener('mousedown', alTocarFuera);
    return () => document.removeEventListener('mousedown', alTocarFuera);
  }, [menuPerfil]);

  const otaStatus = useOtaStatus();
  const toast = useToast();
  const [buscandoActualizacion, setBuscandoActualizacion] = useState(false);
  // Cambio de contraseña: ÚNICA vía en todo el sistema, y vive a propósito
  // en esta misma sección del menú plegable — junto a "Buscar
  // actualización" — y no en ningún otro lugar. Ver CambiarContrasenaModal.
  const [modalContrasenaAbierto, setModalContrasenaAbierto] = useState(false);
  // Cambiar PIN: solo el administrador supremo (correo exacto) ve este
  // botón. El filtro real vive también en el servidor (set_security_pin),
  // esto solo evita mostrarlo a quien nunca podría usarlo.
  const [modalPinAbierto, setModalPinAbierto] = useState(false);
  const esSupremo = esAdminSupremo(currentUser?.email);

  /**
   * Botón de "Buscar actualización": para cuando el chequeo silencioso
   * de arranque falló, se pospuso, o la persona simplemente quiere
   * confirmar YA que tiene lo último sin cerrar y reabrir la app. A
   * diferencia de ese chequeo de fondo, este SÍ recarga de inmediato si
   * encuentra algo nuevo — es lo que se espera de un botón que la
   * persona pulsó a propósito.
   */
  const buscarActualizacion = async () => {
    setBuscandoActualizacion(true);
    try {
      const resultado = await verificarActualizacionManual();
      switch (resultado.estado) {
        case 'al-dia':
          toast.success('Ya tiene la versión más reciente.');
          break;
        case 'actualizando':
          toast.success('Actualización encontrada. Aplicando y reiniciando…');
          break;
        case 'sin-plugin':
        case 'error':
          toast.error(resultado.mensaje);
          break;
        case 'no-nativo':
          toast.warning('Esto solo aplica a la app instalada; en el navegador siempre se ve la última versión.');
          break;
      }
    } finally {
      setBuscandoActualizacion(false);
    }
  };

  const iniciales = useMemo(() => {
    const base = (currentUser?.name || currentUser?.email || 'TV').trim();
    const partes = base.split(/[\s@._-]+/).filter(Boolean);
    return ((partes[0]?.[0] || 'T') + (partes[1]?.[0] || '')).toUpperCase();
  }, [currentUser]);

  // Los módulos marcados `soloAdminSupremo` (ver adminNav.ts) se quitan
  // aquí de TODAS las superficies que listan módulos — riel, dock, hoja
  // "Más" y buscador — para cualquier cuenta que no sea la del correo
  // supremo. Es solo la UI: la restricción de verdad vive en el
  // servidor, en las funciones que ese módulo termina llamando.
  const puedeVerModulo = (item: AdminNavItem) => !item.soloAdminSupremo || esSupremo;

  // El dock de móvil conserva SOLO los cuatro módulos del día a día, al
  // alcance del pulgar. Ya no lleva el botón "Más" ni su hoja: la barra
  // de píldoras de arriba lista los quince módulos completos, así que la
  // hoja no daba acceso a nada que no estuviera ya a un toque — y sí
  // añadía una segunda forma de navegar que había que mantener al día.
  const itemsDock = DOCK_IDS
    .map(id => NAV_ITEMS.find(i => i.id === id))
    .filter((i): i is AdminNavItem => !!i)
    .filter(puedeVerModulo);

  return (
    /* El id se conserva: `#admin-panel-root` es donde admin.css declara
       todas las variables de la consola y donde index.css aísla el
       apilamiento del panel respecto de la tienda. */
    <div className="tv-shell" id="admin-panel-root">
      {/* ---------------- COLUMNA PRINCIPAL ---------------- */}
      <div className="tv-main">
        <header className="tv-topbar">
          {/* El logo va aquí en TODOS los tamaños: al desaparecer el riel
              lateral, esta barra pasó a ser el único sitio donde vive la
              identidad de la tienda. Antes llevaba `lg:hidden` porque en
              escritorio lo mostraba la cabecera del riel. */}
          <img
            src={logoUrl || '/logo.png'}
            alt=""
            className="w-8 h-8 rounded-lg object-contain flex-shrink-0"
          />

          <div className="tv-crumb">
            <span className="hidden sm:inline">{grupoActivo}</span>
            <span className="hidden sm:inline" aria-hidden="true">/</span>
            <strong>{moduloActivo.label}</strong>
          </div>

          <div className="flex-1" />

          <button
            type="button"
            className="tv-omni"
            onClick={() => setBuscadorAbierto(true)}
            aria-label="Buscar un módulo"
          >
            <Search className="w-4 h-4" aria-hidden="true" />
            Buscar módulo
            <kbd className="tv-kbd">Ctrl K</kbd>
          </button>

          <button
            type="button"
            className="tv-icon-btn min-[900px]:hidden"
            onClick={() => setBuscadorAbierto(true)}
            aria-label="Buscar un módulo"
          >
            <Search className="w-[18px] h-[18px]" />
          </button>

          {/* Mismo interruptor de tema que la tienda: comparten el estado a
              través del módulo de tema, así que cambiarlo aquí también lo
              cambia allá. */}
          <BotonTema className="w-[34px] h-[34px]" />

          <button
            type="button"
            className="tv-icon-btn hidden sm:inline-flex"
            onClick={onNavigateToStore}
            aria-label="Ver la tienda"
            title="Ver la tienda"
          >
            <Store className="w-[18px] h-[18px]" />
          </button>

          <div className="relative" ref={perfilRef}>
            <button
              type="button"
              className="tv-avatar"
              onClick={() => setMenuPerfil(v => !v)}
              aria-haspopup="menu"
              aria-expanded={menuPerfil}
              aria-label="Cuenta"
            >
              {iniciales}
            </button>

            {menuPerfil && (
              <div className="tv-menu" role="menu">
                <div className="px-3 py-2.5">
                  <div className="text-[13px] font-bold text-[var(--text-primary)] truncate">
                    {currentUser?.name || 'Administrador'}
                  </div>
                  <div className="text-[11.5px] text-[var(--text-muted)] truncate">
                    {currentUser?.email}
                  </div>
                  <div className="mt-2">
                    <span className="tv-chip" data-tone="accent">{currentUser?.role || 'Administrador'}</span>
                  </div>
                  {/* Identifica qué versión del panel está corriendo AHORA en
                      este dispositivo. Existe porque `next()` deja la
                      actualización descargada pero solo la aplica en el
                      próximo reinicio de la app — sin esto no había forma de
                      confirmar si "ya cargó lo nuevo" o si todavía falta
                      cerrar y volver a abrir. */}
                  {otaStatus.isNative && (
                    <div className="mt-2 pt-2 border-t border-[var(--border-color)]/50 text-[11px] text-[var(--text-muted)]">
                      {otaStatus.updatePending ? (
                        <span className="text-amber-500 font-bold">
                          Hay una actualización descargada — cierre la app por completo y vuelva a abrirla para verla.
                        </span>
                      ) : otaStatus.currentVersion ? (
                        <span>
                          Versión: <span className="font-mono">{otaStatus.currentVersion}</span>
                          {otaStatus.latestVersion && otaStatus.latestVersion === otaStatus.currentVersion && (
                            <span className="text-emerald-500 font-bold"> · al día</span>
                          )}
                        </span>
                      ) : (
                        <span>Comprobando versión…</span>
                      )}
                    </div>
                  )}
                </div>
                {otaStatus.isNative && (
                  <button
                    type="button"
                    role="menuitem"
                    className="tv-menu-item"
                    disabled={buscandoActualizacion}
                    onClick={buscarActualizacion}
                  >
                    <RefreshCw className={`w-4 h-4 ${buscandoActualizacion ? 'animate-spin' : ''}`} />
                    {buscandoActualizacion ? 'Buscando…' : 'Buscar actualización'}
                  </button>
                )}
                {/* Única vía de cambio de contraseña de todo el sistema —
                    exige el token de seguridad de 4 dígitos como seguro
                    maestro. No debe existir en ningún otro lugar. */}
                <button
                  type="button"
                  role="menuitem"
                  className="tv-menu-item"
                  onClick={() => { setMenuPerfil(false); setModalContrasenaAbierto(true); }}
                >
                  <KeyRound className="w-4 h-4" /> Cambiar contraseña
                </button>
                {/* Cambiar PIN: control de acceso supremo — ver esAdminSupremo
                    arriba. Nadie más ve este botón, y aunque lo vieran, el
                    servidor rechaza igual el cambio si el correo no calza. */}
                {esSupremo && (
                  <button
                    type="button"
                    role="menuitem"
                    className="tv-menu-item"
                    onClick={() => { setMenuPerfil(false); setModalPinAbierto(true); }}
                  >
                    <Hash className="w-4 h-4" /> Cambiar PIN
                  </button>
                )}
                <div className="tv-menu-sep" />
                <button type="button" role="menuitem" className="tv-menu-item" onClick={() => { setMenuPerfil(false); onNavigateToStore(); }}>
                  <Store className="w-4 h-4" /> Ver la tienda
                </button>
                <button type="button" role="menuitem" className="tv-menu-item" onClick={() => ir('ciberseguridad')}>
                  <Search className="w-4 h-4" /> Seguridad y acceso
                </button>
                <div className="tv-menu-sep" />
                <button type="button" role="menuitem" className="tv-menu-item" data-danger="true" onClick={() => { setMenuPerfil(false); onLogout(); }}>
                  <LogOut className="w-4 h-4" /> Cerrar sesión
                </button>
              </div>
            )}
          </div>
        </header>

        {/* ---------------- BARRA DE PÍLDORAS (Tarjetero) ----------------
            La navegación completa del panel, con contador en vivo por
            módulo. Reemplaza al riel lateral y a la hoja de "Más": aquí
            están LOS QUINCE módulos, así que ninguno queda escondido
            detrás de un botón secundario.

            Los grupos de `NAV_GROUPS` se conservan como separadores
            verticales finos entre bloques de píldoras — se mantiene la
            agrupación (General / Inventario / Operación / Administración)
            sin gastar una línea de título por cada una. */}
        <nav className="tv-pills" aria-label="Navegación principal">
          {NAV_GROUPS.map((grupo, idx) => {
            const items = grupo.items.filter(puedeVerModulo);
            if (items.length === 0) return null;
            return (
              <React.Fragment key={grupo.titulo}>
                {idx > 0 && <span className="tv-pill-sep" aria-hidden="true" />}
                {items.map(item => {
                  const activo = item.id === moduloActivo.id;
                  const contador = contadores[item.id];
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className="tv-pill"
                      data-active={activo || undefined}
                      onClick={() => ir(item.id)}
                      aria-current={activo ? 'page' : undefined}
                      title={item.descripcion}
                    >
                      <item.icon className="w-[15px] h-[15px] flex-shrink-0" aria-hidden="true" />
                      <span className="tv-pill-label">{item.label}</span>
                      {/* El contador solo aparece si hay algo que contar.
                          Un "0" permanente al lado de cada módulo es ruido
                          que enseña a no mirar la barra. */}
                      {contador && contador.valor > 0 && (
                        <span className="tv-pill-count" data-tone={contador.tono}>
                          {contador.valor}
                        </span>
                      )}
                    </button>
                  );
                })}
              </React.Fragment>
            );
          })}
        </nav>

        <main className="tv-scroll">
          <div className="tv-container">{children}</div>
        </main>
      </div>

      {/* ---------------- DOCK (móvil / APK) ---------------- */}
      <nav className="tv-dock flex lg:hidden" aria-label="Navegación">
        {itemsDock.map(item => (
          <button
            key={item.id}
            type="button"
            className="tv-dock-item"
            data-active={item.id === moduloActivo.id || undefined}
            onClick={() => ir(item.id)}
            aria-current={item.id === moduloActivo.id ? 'page' : undefined}
          >
            <item.icon className="w-[19px] h-[19px]" aria-hidden="true" />
            <span>{item.short}</span>
          </button>
        ))}
      </nav>

      {buscadorAbierto && (
        <BuscadorDeModulos
          onElegir={ir}
          onCerrar={() => setBuscadorAbierto(false)}
          esSupremo={esSupremo}
        />
      )}

      <CambiarContrasenaModal open={modalContrasenaAbierto} onClose={() => setModalContrasenaAbierto(false)} />
      {esSupremo && (
        <CambiarPinModal open={modalPinAbierto} onClose={() => setModalPinAbierto(false)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// BUSCADOR DE MÓDULOS
// ---------------------------------------------------------------------

/**
 * Va con teclado completo —flechas, Enter, Escape— porque es la forma
 * en que lo usa quien pasa el día dentro del panel: se abre con Ctrl+K,
 * se escriben tres letras y se entra sin soltar el teclado. Si hubiera
 * que terminar el gesto con el ratón, no ahorraría nada.
 */
function BuscadorDeModulos({
  onElegir,
  onCerrar,
  esSupremo,
}: {
  onElegir: (tab: string) => void;
  onCerrar: () => void;
  esSupremo: boolean;
}) {
  const [consulta, setConsulta] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Mismo filtro que en el resto de superficies: un módulo
  // `soloAdminSupremo` no debe aparecer en el buscador para nadie más.
  const resultados = useMemo(
    () => buscarModulos(consulta).filter(item => !item.soloAdminSupremo || esSupremo),
    [consulta, esSupremo]
  );

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setCursor(0); }, [consulta]);

  const alTeclear = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor(c => Math.min(c + 1, resultados.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor(c => Math.max(c - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const elegido = resultados[cursor];
      if (elegido) onElegir(elegido.id);
    }
  };

  return (
    <div className="tv-palette-backdrop" onClick={onCerrar} role="presentation">
      <div
        className="tv-palette"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label="Buscar un módulo"
      >
        <div className="relative">
          <input
            ref={inputRef}
            className="tv-palette-input"
            placeholder="Buscar un módulo…  (taller, facturas, cupones…)"
            value={consulta}
            onChange={e => setConsulta(e.target.value)}
            onKeyDown={alTeclear}
          />
          <button
            type="button"
            className="tv-icon-btn absolute right-2 top-1/2 -translate-y-1/2"
            onClick={onCerrar}
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="tv-palette-list">
          {resultados.length === 0 ? (
            <div className="px-4 py-8 text-center text-[13px] text-[var(--text-muted)]">
              Ningún módulo coincide con «{consulta}».
            </div>
          ) : (
            resultados.map((item, i) => (
              <button
                key={item.id}
                type="button"
                className="tv-palette-row"
                data-cursor={i === cursor || undefined}
                onMouseEnter={() => setCursor(i)}
                onClick={() => onElegir(item.id)}
              >
                <item.icon className="w-[18px] h-[18px] flex-shrink-0" aria-hidden="true" />
                {item.label}
                {i === cursor && <CornerDownLeft className="w-3.5 h-3.5 ml-auto opacity-60" aria-hidden="true" />}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
