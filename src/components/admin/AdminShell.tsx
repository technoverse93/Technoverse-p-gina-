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
// 2. El riel de escritorio es de ICONOS por defecto (72px) y se abre a
//    252px cuando hace falta. La barra fija de 256px se comía una
//    cuarta parte del ancho útil de un portátil para mostrar doce
//    palabras que quien usa el panel a diario ya se sabe de memoria.
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
  Search, PanelLeftClose, PanelLeftOpen, Sun, Moon, Store, LogOut,
  MoreHorizontal, X, CornerDownLeft, RefreshCw, KeyRound, Hash,
} from 'lucide-react';
import { NAV_GROUPS, NAV_ITEMS, DOCK_IDS, resolverModulo, grupoDe, buscarModulos } from './adminNav';
import type { AdminNavItem } from './adminNav';
import type { User } from '../../types';
import { useOtaStatus, verificarActualizacionManual } from '../../mobile/otaUpdater';
import { useToast } from '../ui/Overlays';
import CambiarContrasenaModal from '../security/CambiarContrasenaModal';
import CambiarPinModal from '../security/CambiarPinModal';
import { esAdminSupremo } from '../../utils/securityPin';

const LLAVE_RIEL = 'technoverse_admin_riel_abierto';

interface AdminShellProps {
  activeTab: string;
  onNavigate: (tab: string) => void;
  currentUser: User | null;
  onLogout: () => void;
  onNavigateToStore: () => void;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  logoUrl?: string;
  children: React.ReactNode;
}

export default function AdminShell({
  activeTab,
  onNavigate,
  currentUser,
  onLogout,
  onNavigateToStore,
  theme,
  toggleTheme,
  logoUrl,
  children,
}: AdminShellProps) {
  // El estado del riel se recuerda entre sesiones: quien prefiere ver
  // los nombres no tiene que volver a abrirlo cada mañana.
  const [rielAbierto, setRielAbierto] = useState<boolean>(() => {
    try { return localStorage.getItem(LLAVE_RIEL) === '1'; } catch { return false; }
  });
  const [menuPerfil, setMenuPerfil] = useState(false);
  const [hojaAbierta, setHojaAbierta] = useState(false);
  const [buscadorAbierto, setBuscadorAbierto] = useState(false);

  const perfilRef = useRef<HTMLDivElement | null>(null);

  const moduloActivo = useMemo(() => resolverModulo(activeTab), [activeTab]);
  const grupoActivo = useMemo(() => grupoDe(activeTab), [activeTab]);

  useEffect(() => {
    try { localStorage.setItem(LLAVE_RIEL, rielAbierto ? '1' : '0'); } catch { /* sin almacenamiento, no pasa nada */ }
  }, [rielAbierto]);

  /** Navegar cierra TODO lo que estuviera abierto encima. */
  const ir = useCallback((tab: string) => {
    onNavigate(tab);
    setHojaAbierta(false);
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
        setHojaAbierta(false);
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

  const itemsDock = DOCK_IDS
    .map(id => NAV_ITEMS.find(i => i.id === id))
    .filter((i): i is AdminNavItem => !!i);

  // En la hoja de "Más" va todo lo que no cabe en el dock. Se calcula a
  // partir del dock y no con una segunda lista escrita a mano: así
  // ningún módulo puede quedar sin acceso en la APK por un descuido.
  const itemsHoja = NAV_ITEMS.filter(i => !DOCK_IDS.includes(i.id));
  const hojaTieneActivo = itemsHoja.some(i => i.id === moduloActivo.id);

  return (
    /* El id se conserva: `#admin-panel-root` es donde admin.css declara
       todas las variables de la consola y donde index.css aísla el
       apilamiento del panel respecto de la tienda. */
    <div className="tv-shell" id="admin-panel-root">
      {/* ---------------- RIEL (escritorio) ---------------- */}
      <nav
        className="tv-rail"
        data-open={rielAbierto}
        aria-label="Navegación principal"
      >
        <div className="tv-rail-head">
          <img
            src={logoUrl || '/logo.png'}
            alt=""
            className="w-8 h-8 rounded-lg object-contain flex-shrink-0"
          />
          {rielAbierto && (
            <span className="font-display font-bold text-[15px] tracking-tight text-[var(--text-primary)] whitespace-nowrap">
              Technoverse
            </span>
          )}
        </div>

        <div className="tv-rail-body">
          {NAV_GROUPS.map((grupo, idx) => (
            <div key={grupo.titulo}>
              {rielAbierto
                ? <div className="tv-group-label">{grupo.titulo}</div>
                : idx > 0 && <div className="tv-group-rule" />}
              {/* El botón va escrito aquí y no extraído a un componente
                  a propósito: el proyecto no tiene `@types/react`
                  instalado, así que TypeScript no aplica la excepción de
                  `key` a los componentes propios y una lista de
                  componentes con `key` no compila. Con elementos nativos
                  no hay problema. */}
              {grupo.items.map(item => {
                const activo = item.id === moduloActivo.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="tv-nav-item"
                    data-active={activo || undefined}
                    onClick={() => ir(item.id)}
                    aria-current={activo ? 'page' : undefined}
                  >
                    <span className="tv-nav-icon"><item.icon className="w-[18px] h-[18px]" aria-hidden="true" /></span>
                    <span className="tv-nav-label">{item.label}</span>
                    <span className="tv-tip">{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="tv-rail-foot">
          <button
            type="button"
            className="tv-nav-item"
            onClick={() => setRielAbierto(v => !v)}
            aria-label={rielAbierto ? 'Contraer el menú' : 'Expandir el menú'}
          >
            <span className="tv-nav-icon">
              {rielAbierto ? <PanelLeftClose className="w-[18px] h-[18px]" /> : <PanelLeftOpen className="w-[18px] h-[18px]" />}
            </span>
            <span className="tv-nav-label">Contraer</span>
            <span className="tv-tip">Expandir el menú</span>
          </button>
        </div>
      </nav>

      {/* ---------------- COLUMNA PRINCIPAL ---------------- */}
      <div className="tv-main">
        <header className="tv-topbar">
          {/* En móvil el logo va aquí, porque el riel no existe. */}
          <img
            src={logoUrl || '/logo.png'}
            alt=""
            className="w-8 h-8 rounded-lg object-contain flex-shrink-0 lg:hidden"
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

          <button
            type="button"
            className="tv-icon-btn"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
          >
            {theme === 'dark' ? <Sun className="w-[18px] h-[18px]" /> : <Moon className="w-[18px] h-[18px]" />}
          </button>

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
                            <span className="text-emerald-500 dark:text-[var(--brand-gold-light)] font-bold"> · al día</span>
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
        <button
          type="button"
          className="tv-dock-item"
          data-active={hojaAbierta || hojaTieneActivo || undefined}
          onClick={() => setHojaAbierta(v => !v)}
          aria-expanded={hojaAbierta}
        >
          <MoreHorizontal className="w-[19px] h-[19px]" aria-hidden="true" />
          <span>Más</span>
        </button>
      </nav>

      {hojaAbierta && (
        <>
          <div className="tv-sheet-backdrop lg:hidden" onClick={() => setHojaAbierta(false)} />
          <div className="tv-sheet lg:hidden" role="dialog" aria-label="Más módulos">
            <div className="tv-sheet-title">Todos los módulos</div>
            {itemsHoja.map(item => (
              <button
                key={item.id}
                type="button"
                className="tv-sheet-item"
                data-active={item.id === moduloActivo.id || undefined}
                onClick={() => ir(item.id)}
              >
                <item.icon className="w-[18px] h-[18px] flex-shrink-0" aria-hidden="true" />
                {item.label}
              </button>
            ))}
            <div className="tv-menu-sep" />
            <button type="button" className="tv-sheet-item" onClick={() => { setHojaAbierta(false); onNavigateToStore(); }}>
              <Store className="w-[18px] h-[18px] flex-shrink-0" /> Ver la tienda
            </button>
            <button type="button" className="tv-sheet-item" data-danger="true" onClick={() => { setHojaAbierta(false); onLogout(); }}>
              <LogOut className="w-[18px] h-[18px] flex-shrink-0" /> Cerrar sesión
            </button>
          </div>
        </>
      )}

      {buscadorAbierto && (
        <BuscadorDeModulos
          onElegir={ir}
          onCerrar={() => setBuscadorAbierto(false)}
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
}: {
  onElegir: (tab: string) => void;
  onCerrar: () => void;
}) {
  const [consulta, setConsulta] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const resultados = useMemo(() => buscarModulos(consulta), [consulta]);

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
