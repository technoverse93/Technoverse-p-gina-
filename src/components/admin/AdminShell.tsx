// =====================================================================
// TECHNOVERSE CONSOLE — armazón del panel: "REGLETA Y CARPETAS"
// =====================================================================
// Todo lo que rodea al contenido: la regleta de arriba, la fila de
// carpetas, el selector de módulos, el dock de móvil/APK y los modales
// de seguridad.
//
// ---------------------------------------------------------------------
// EL PROBLEMA QUE ESTE MODELO RESUELVE
// ---------------------------------------------------------------------
// Medido sobre el panel real, con datos dentro, a 1440×900:
//
//   · Inventario     330 px de menús y títulos antes del primer producto
//   · Ciberseguridad 358 px y CUATRO niveles de navegación apilados
//   · Taller         450 px antes del tablero, que además salía cortado
//   · Cobros         308 px antes del primer campo del formulario
//
// Y sobre todo: el menú de arriba repetía «Productos · Repuestos ·
// Insumos · Movimientos · Reportes», que el propio módulo volvía a
// dibujar como pestañas. Dos menús idénticos, uno encima del otro.
//
// ---------------------------------------------------------------------
// CÓMO SE RESUELVE
// ---------------------------------------------------------------------
// 1. REGLETA. Hace tres cosas y nada más: sostener las PESTAÑAS
//    abiertas, sostener las acciones de la pantalla activa, y los cuatro
//    botones fijos de cuenta. No hay miga de pan, ni título de módulo
//    dentro del contenido, ni subtítulo en bloque: los tres decían lo
//    mismo.
//
// 2. PESTAÑAS. El panel se comporta como un navegador: arranca con una
//    sola pestaña —el panel general— y se van abriendo las que hagan
//    falta desde el «+». Cada una se cierra con su «×». Cambiar de
//    pestaña NO desmonta el módulo, así que un cobro a medio llenar
//    sigue ahí al volver. El estado vive en `usePestanas`.
//
// 3. CARPETAS. Las vistas DENTRO de un módulo se dibujan UNA sola vez,
//    pegadas al borde superior del contenido, con forma de carpeta de
//    archivo. La fila la pinta este armazón —a partir de `adminNav` o de
//    lo que registre la pantalla— así que es imposible que un módulo la
//    duplique por su cuenta.
//
// 4. MÓVIL Y APK. La tira de pestañas se desliza con el dedo y el «+»
//    queda fijo al borde derecho, siempre alcanzable. El selector se
//    abre anclado abajo y NO lleva campo de búsqueda: enfocar un input
//    levanta el teclado de Android y tapa la lista que se venía a leer.
//    El dock de cuatro módulos se conserva: en un teléfono el pulgar
//    necesita un ancla fija.
// =====================================================================

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Search, Store, LogOut, LayoutGrid,
  X, Plus, RefreshCw, KeyRound, Hash,
} from 'lucide-react';
import { NAV_GROUPS, NAV_ITEMS, DOCK_IDS, resolverModulo, resolverCarpeta } from './adminNav';
import type { AdminNavItem } from './adminNav';
import { PESTANA_INICIAL } from './usePestanas';
import { Carpetas } from './AdminKit';
import type { User } from '../../types';
import { useOtaStatus, verificarActualizacionManual } from '../../mobile/otaUpdater';
import { useToast } from '../ui/Overlays';
import CambiarContrasenaModal from '../security/CambiarContrasenaModal';
import CambiarPinModal from '../security/CambiarPinModal';
import BotonTema from '../ui/BotonTema';
import { esAdminSupremo } from '../../utils/securityPin';

interface AdminShellProps {
  activeTab: string;
  onNavigate: (tab: string) => void;
  currentUser: User | null;
  onLogout: () => void;
  onNavigateToStore: () => void;
  logoUrl?: string;
  children: React.ReactNode;
  /** Módulos abiertos, en orden. Los pinta la barra de pestañas. */
  pestanasAbiertas: string[];
  /** El módulo que se está viendo. */
  pestanaActiva: string;
  /** Cerrar una pestaña con su «×». */
  onCerrarPestana: (modulo: string) => void;
  /** Ref del contenedor con scroll, para recordar la posición por pestaña. */
  scrollRef?: React.RefObject<HTMLElement | null>;
}

export default function AdminShell({
  activeTab,
  onNavigate,
  currentUser,
  onLogout,
  onNavigateToStore,
  logoUrl,
  children,
  pestanasAbiertas,
  pestanaActiva,
  onCerrarPestana,
  scrollRef,
}: AdminShellProps) {
  const [menuPerfil, setMenuPerfil] = useState(false);
  const [selectorAbierto, setSelectorAbierto] = useState(false);

  const perfilRef = useRef<HTMLDivElement | null>(null);

  const moduloActivo = useMemo(() => resolverModulo(activeTab), [activeTab]);
  const carpetaActiva = useMemo(() => resolverCarpeta(activeTab), [activeTab]);

  const toast = useToast();
  const otaStatus = useOtaStatus();
  const [buscandoActualizacion, setBuscandoActualizacion] = useState(false);
  const [modalContrasenaAbierto, setModalContrasenaAbierto] = useState(false);
  const [modalPinAbierto, setModalPinAbierto] = useState(false);

  const esSupremo = esAdminSupremo(currentUser?.email);

  /** Navegar cierra todo lo que estuviera abierto encima. */
  const ir = useCallback((tab: string) => {
    onNavigate(tab);
    setMenuPerfil(false);
    setSelectorAbierto(false);
  }, [onNavigate]);

  // Ctrl/⌘+K abre el selector desde cualquier parte del panel.
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSelectorAbierto(v => !v);
      }
      if (e.key === 'Escape') {
        setSelectorAbierto(false);
        setMenuPerfil(false);
      }
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, []);

  // Cerrar el menú de cuenta al tocar fuera.
  useEffect(() => {
    if (!menuPerfil) return;
    const alTocarFuera = (e: MouseEvent) => {
      if (perfilRef.current && !perfilRef.current.contains(e.target as Node)) setMenuPerfil(false);
    };
    document.addEventListener('mousedown', alTocarFuera);
    return () => document.removeEventListener('mousedown', alTocarFuera);
  }, [menuPerfil]);

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
  // de TODAS las superficies que listan módulos. Es solo la UI: la
  // restricción de verdad vive en el servidor.
  const puedeVerModulo = (item: AdminNavItem) => !item.soloAdminSupremo || esSupremo;

  const itemsDock = DOCK_IDS
    .map(id => NAV_ITEMS.find(i => i.id === id))
    .filter((i): i is AdminNavItem => !!i)
    .filter(puedeVerModulo);

  /**
   * Las carpetas que declara el propio mapa de navegación (hoy,
   * Inventario). Se dibujan desde aquí para que el módulo no tenga que
   * saber nada de ellas — y, sobre todo, para que no pueda dibujarlas
   * otra vez por su cuenta.
   *
   * Los módulos con sub-vistas que viven en su propio estado interno
   * (Ciberseguridad, Cobros, Taller) llaman al mismo componente
   * `<Carpetas>` desde dentro: sale renderizado en este mismo hueco por
   * portal, así que la fila es siempre una y está siempre en el mismo
   * sitio.
   */
  const carpetasDeNav = moduloActivo.carpetas;

  return (
    /* El id se conserva: `#admin-panel-root` es donde admin.css declara
       las variables de la consola y donde index.css aísla el apilamiento
       del panel respecto de la tienda. */
    <div className="tv-shell" id="admin-panel-root">
      <div className="tv-main">

        {/* ---------------- REGLETA ---------------- */}
        <header className="tv-regleta">
          {/* Lanzador del selector. En móvil es el único botón a la
              izquierda, y por eso lleva el logo dentro: sustituye a la
              cabecera de marca que ocupaba una fila entera. */}
          <button
            type="button"
            className="tv-lanzador"
            onClick={() => setSelectorAbierto(true)}
            aria-label="Todos los módulos"
            title="Todos los módulos  ·  Ctrl K"
          >
            {logoUrl
              ? <img src={logoUrl} alt="" className="w-[19px] h-[19px] rounded object-contain" />
              : <LayoutGrid className="w-[17px] h-[17px]" aria-hidden="true" />}
          </button>

          {/* Las pestañas abiertas. Sustituyen al nombre único de módulo:
              ahora puede haber varios abiertos a la vez y hay que poder
              ver cuáles y saltar entre ellos de un toque. */}
          <BarraDePestanas
            abiertas={pestanasAbiertas}
            activa={pestanaActiva}
            onActivar={ir}
            onCerrar={onCerrarPestana}
            onNueva={() => setSelectorAbierto(true)}
          />

          {/* Hueco de las acciones de la pantalla activa. Lo llena cada
              módulo por portal (ver `PageHead` en AdminKit). Va antes de
              los botones fijos para que lo propio de la pantalla quede
              más cerca del contenido que lo global. */}
          <div className="tv-regleta-acciones" id="tv-regleta-acciones" />

          <div className="tv-regleta-fijos">
            <BotonTema className="tv-icon-btn" />

            <button
              type="button"
              className="tv-icon-btn hidden sm:inline-flex"
              onClick={onNavigateToStore}
              aria-label="Ver la tienda"
              title="Ver la tienda"
            >
              <Store className="w-[17px] h-[17px]" />
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
                        próximo reinicio de la app. */}
                    {otaStatus.isNative && (
                      <div className="mt-2 pt-2 border-t border-[var(--border-color)]/50 text-[11px] text-[var(--text-muted)]">
                        {otaStatus.updatePending ? (
                          <span className="text-[var(--tv-warn)] font-bold">
                            Hay una actualización descargada — cierre la app por completo y vuelva a abrirla para verla.
                          </span>
                        ) : otaStatus.currentVersion ? (
                          <span>
                            Versión: <span className="font-mono">{otaStatus.currentVersion}</span>
                            {otaStatus.latestVersion && otaStatus.latestVersion === otaStatus.currentVersion && (
                              <span className="text-[var(--tv-ok)] font-bold"> · al día</span>
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
                  {/* Cambiar PIN: control de acceso supremo. Nadie más ve este
                      botón, y aunque lo viera, el servidor rechaza el cambio
                      si el correo no calza. */}
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
          </div>
        </header>

        {/* ---------------- CARPETAS ----------------
            Hueco único para la fila de carpetas. Si el módulo activo no
            tiene vistas, queda vacío y el CSS lo colapsa a cero: no se
            reserva alto "por si acaso". */}
        <div
          className="tv-carpetas-bar"
          id="tv-carpetas-slot"
          /* Marca explícita para los navegadores sin `:has()`. No se puede
             deducir del contenido porque los módulos con vistas propias
             (Ciberseguridad, Cobros) las meten aquí por portal, después
             de que este nodo se haya renderizado. */
          data-con-carpetas={carpetasDeNav ? 'true' : undefined}
        >
          {carpetasDeNav && (
            <Carpetas
              items={carpetasDeNav.map(c => ({ id: c.tab, label: c.label, icon: c.icon }))}
              activa={carpetaActiva?.tab || carpetasDeNav[0].tab}
              onElegir={ir}
            />
          )}
        </div>

        {/* Pista de una línea: lo que antes era el subtítulo del bloque de
            título. Se conserva porque explica qué se hace en la pantalla,
            pero cuesta una línea y no un bloque de 85 px. */}
        <div className="tv-pista" id="tv-pista-slot" />

        {/* El scroll vive aquí y es UNO solo, compartido por todas las
            pestañas. Por eso la posición se guarda y se restaura por
            pestaña (ver `useScrollPorPestana`): sin eso, volver a una
            pestaña donde se había bajado veinte filas devolvía siempre al
            principio de la lista. */}
        <main className="tv-scroll" ref={scrollRef as React.RefObject<HTMLElement>}>
          <div className="tv-container">{children}</div>
        </main>
      </div>

      {/* ---------------- DOCK (móvil / APK) ----------------
          Se conserva tal cual: en un teléfono el pulgar necesita un ancla
          fija abajo, y estos cuatro son los módulos que se abren varias
          veces al día. El resto está en el selector, a un toque del
          lanzador de la regleta. */}
      <nav className="tv-dock flex lg:hidden" aria-label="Navegación rápida">
        {itemsDock.map(item => {
          const activo = resolverModulo(activeTab).id === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className="tv-dock-item"
              data-active={activo || undefined}
              onClick={() => ir(item.id)}
              aria-current={activo ? 'page' : undefined}
            >
              <item.icon className="w-[19px] h-[19px]" aria-hidden="true" />
              <span>{item.short}</span>
            </button>
          );
        })}
        <button
          type="button"
          className="tv-dock-item"
          data-active={selectorAbierto || undefined}
          onClick={() => setSelectorAbierto(true)}
          aria-label="Todos los módulos"
        >
          <LayoutGrid className="w-[19px] h-[19px]" aria-hidden="true" />
          <span>Módulos</span>
        </button>
      </nav>

      {selectorAbierto && (
        <SelectorDeModulos
          onElegir={ir}
          onCerrar={() => setSelectorAbierto(false)}
          esSupremo={esSupremo}
          tabActivo={activeTab}
          abiertas={pestanasAbiertas}
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
// BARRA DE PESTAÑAS
// ---------------------------------------------------------------------

/**
 * Las pestañas abiertas, más el botón de abrir una nueva.
 *
 * Se comporta como la barra de un navegador: cada pestaña lleva su
 * icono, su nombre y una «×» para cerrarla; el «+» de la derecha abre el
 * selector de módulos.
 *
 * En un teléfono la tira se desliza con el dedo y el «+» queda FIJO
 * pegado al borde derecho, encima de la tira. Si el «+» viajara dentro
 * del desplazamiento, con cinco pestañas abiertas habría que arrastrar
 * hasta el final para poder abrir la sexta.
 */
function BarraDePestanas({
  abiertas,
  activa,
  onActivar,
  onCerrar,
  onNueva,
}: {
  abiertas: string[];
  activa: string;
  onActivar: (modulo: string) => void;
  onCerrar: (modulo: string) => void;
  onNueva: () => void;
}) {
  const tiraRef = useRef<HTMLDivElement | null>(null);

  // Al activar una pestaña que está fuera de vista —porque se abrió desde
  // el selector con la tira desplazada— se la trae al centro. Va en
  // `useLayoutEffect` para que el ajuste ocurra antes de pintar y no se
  // vea el salto.
  useLayoutEffect(() => {
    const tira = tiraRef.current;
    if (!tira) return;
    const nodo = tira.querySelector<HTMLElement>(`[data-modulo="${CSS.escape(activa)}"]`);
    nodo?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activa, abiertas.length]);

  return (
    <div className="tv-tabs-zona">
      <div className="tv-tabs" ref={tiraRef} role="tablist" aria-label="Pestañas abiertas">
        {abiertas.map(modulo => {
          const item = resolverModulo(modulo);
          const esActiva = modulo === activa;
          // El panel general no se cierra: es el suelo del panel, la
          // pestaña a la que se cae al cerrar cualquier otra.
          const cerrable = modulo !== PESTANA_INICIAL;
          return (
            <div
              key={modulo}
              className="tv-tab"
              data-modulo={modulo}
              data-activa={esActiva || undefined}
            >
              <button
                type="button"
                className="tv-tab-btn"
                role="tab"
                aria-selected={esActiva}
                onClick={() => onActivar(modulo)}
                title={item.label}
              >
                <item.icon className="w-[14px] h-[14px] flex-shrink-0" aria-hidden="true" />
                <span className="tv-tab-label">{item.label}</span>
              </button>
              {cerrable && (
                <button
                  type="button"
                  className="tv-tab-x"
                  onClick={() => onCerrar(modulo)}
                  aria-label={`Cerrar ${item.label}`}
                  title={`Cerrar ${item.label}`}
                >
                  <X className="w-3 h-3" aria-hidden="true" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        className="tv-tab-nueva"
        onClick={onNueva}
        aria-label="Abrir otro módulo"
        title="Abrir otro módulo  ·  Ctrl K"
      >
        <Plus className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------
// SELECTOR DE MÓDULOS
// ---------------------------------------------------------------------

/**
 * La lista de todo lo que se puede abrir en una pestaña.
 *
 * ---------------------------------------------------------------------
 * SIN CAMPO DE BÚSQUEDA — Y ES A PROPÓSITO
 * ---------------------------------------------------------------------
 * Antes esta lista abría con un input enfocado. En un teléfono Android
 * —comprobado en Samsung— enfocar un input levanta el teclado al
 * instante, y el teclado se come más de media pantalla: quien solo
 * quería tocar "Inventario" se encontraba con la lista tapada y tenía
 * que cerrar el teclado antes de poder elegir.
 *
 * Los módulos son once. Once filas se leen de un vistazo; no hay nada
 * que buscar. El campo costaba más de lo que resolvía, así que no está.
 *
 * ---------------------------------------------------------------------
 * SIN CONTADORES NI AVISOS JUNTO AL NOMBRE
 * ---------------------------------------------------------------------
 * Tampoco hay «Inventario · 5 vistas» ni «Alertas (3)». Un número al
 * lado del nombre en el menú obliga a leer la fila entera para saber a
 * dónde lleva, y encima el número hay que calcularlo antes de dibujar el
 * menú. Los datos son del módulo: se ven al entrar, que es donde
 * significan algo.
 */
function SelectorDeModulos({
  onElegir,
  onCerrar,
  esSupremo,
  tabActivo,
  abiertas,
}: {
  onElegir: (tab: string) => void;
  onCerrar: () => void;
  esSupremo: boolean;
  tabActivo: string;
  abiertas: string[];
}) {
  const moduloActual = useMemo(() => resolverModulo(tabActivo), [tabActivo]);

  return (
    <div className="tv-palette-backdrop" onClick={onCerrar} role="presentation">
      <div
        className="tv-palette"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label="Abrir un módulo"
      >
        <div className="tv-palette-head">
          <span>Abrir en una pestaña</span>
          <button
            type="button"
            className="tv-icon-btn"
            onClick={onCerrar}
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="tv-palette-list">
          {NAV_GROUPS.map(grupo => {
            const items = grupo.items.filter(i => !i.soloAdminSupremo || esSupremo);
            if (items.length === 0) return null;
            return (
              <div key={grupo.titulo}>
                <div className="tv-palette-grupo">{grupo.titulo}</div>
                {items.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    className="tv-palette-row"
                    data-actual={item.id === moduloActual.id || undefined}
                    onClick={() => onElegir(item.id)}
                  >
                    <item.icon className="w-[18px] h-[18px] flex-shrink-0" aria-hidden="true" />
                    <span className="tv-palette-label">{item.label}</span>
                    {/* Lo único que se marca es si YA está abierto, para
                        que quede claro que tocarlo salta a esa pestaña en
                        vez de abrir otra igual. No es un contador ni un
                        aviso: es el estado de la propia pestaña. */}
                    {abiertas.includes(item.id) && (
                      <span className="tv-palette-abierta" aria-label="Ya abierto">abierto</span>
                    )}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
