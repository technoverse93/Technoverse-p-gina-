import React, { useState, useEffect, useRef, Suspense, lazy } from 'react';
import PublicStore from './components/PublicStore';
import { User } from './types';
import { initKeyboard } from './mobile/keyboard';
import { initOtaUpdater } from './mobile/otaUpdater';
import { OverlayProvider, useToast } from './components/ui/Overlays';
import { conexionBloqueada, detalleDeBloqueo } from './utils/adminLogin';
import { registrarVisita } from './utils/huella';
import { iniciarSincronizacionBiometrica, cerrarSesionConservandoBiometria, sesionBloqueada } from './utils/biometria';
import { iniciarBloqueoPorInactividad, EVENTO_FORZAR_REINGRESO } from './mobile/appLock';
import { supabase } from './supabaseClient';
import { tieneTokenSeguridad } from './utils/securityPin';
import CrearTokenModal from './components/security/CrearTokenModal';

// AdminPanel carga recharts, motion y toda la lógica de taller/inventario/CRM:
// era el bloque más pesado del bundle principal (>300 KB gzip) y se estaba
// descargando SIEMPRE, incluso para un cliente que solo entra a comprar en
// 4G. Como el catálogo público es la ruta que más tráfico recibe, separarlo
// aquí es la optimización de mayor impacto: nadie fuera de /admin lo paga.
const AdminPanel = lazy(() => import('./components/AdminPanel'));

function AdminPanelFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-base,#0F1217)]">
      <div className="w-8 h-8 rounded-full border-2 border-current border-t-transparent animate-spin opacity-60" />
    </div>
  );
}

/**
 * App envuelve toda la aplicación en <OverlayProvider> para que cualquier
 * componente (Store o Admin) pueda emitir toasts/confirmaciones a través de
 * hooks, sin diálogos nativos bloqueantes del sistema operativo. La lógica de
 * ruteo/sesión vive en <AppInner> porque los hooks del kit (useToast) deben
 * ejecutarse DENTRO del provider.
 */
export default function App() {
  return (
    <OverlayProvider>
      <AppInner />
    </OverlayProvider>
  );
}

/**
 * Pantalla que sustituye a TODA la aplicación cuando la conexión está
 * bloqueada. Sin tienda, sin catálogo, sin carrito y sin panel.
 */
function PantallaBloqueada({ porCuenta }: { porCuenta: boolean }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[#0F1217] text-[#E9ECF1]">
      <div className="max-w-lg w-full bg-[#171B22] border border-white/10 rounded-2xl p-8">
        <div className="text-[11px] uppercase tracking-[0.12em] font-bold text-[#FB923C] mb-3">
          Technoverse Costa Rica
        </div>
        {/* El motivo cambia el mensaje a propósito. Decirle "este aparato está
            bloqueado" a alguien cuya CUENTA fue suspendida provoca un reclamo
            que nadie puede resolver: cambia de teléfono, sigue bloqueado y no
            entiende por qué. */}
        <h1 className="text-xl font-bold mb-2">
          {porCuenta ? 'Cuenta suspendida' : 'Acceso bloqueado'}
        </h1>
        {porCuenta ? (
          <>
            <p className="text-sm leading-relaxed text-[#A7AFBD] mb-3">
              Esta cuenta fue suspendida por incumplir las condiciones de uso de la tienda
              y por ahora no puede realizar compras ni consultar pedidos.
            </p>
            <p className="text-sm leading-relaxed text-[#A7AFBD]">
              Si considera que se trata de un error, comuníquese con nosotros indicando el
              correo de la cuenta y lo revisamos.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm leading-relaxed text-[#A7AFBD] mb-3">
              Este aparato fue bloqueado por el sistema de seguridad y por ahora no puede usar la aplicación.
            </p>
            <p className="text-sm leading-relaxed text-[#A7AFBD]">
              El bloqueo es a este equipo, no a su conexión: cambiar de red no lo levanta.
              Si cree que se trata de un error, comuníquese con nosotros.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function AppInner() {
  const toast = useToast();

  const [currentView, setCurrentView] = useState<'store' | 'admin'>(
    window.location.pathname.startsWith('/admin') ? 'admin' : 'store'
  );
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);

  useEffect(() => {
    initKeyboard();
    // Fuera del render inicial y sin bloquearlo: revisa/aplica la
    // actualización OTA en segundo plano. No hace nada en la web.
    initOtaUpdater();
  }, []);

  // ---- Bloqueo de acceso a nivel de aplicación ----------------------------
  //
  // La página web ya la corta el Worker de Cloudflare antes de entregar el
  // HTML (src/worker/index.ts). Esto de acá existe por la APK: sus archivos
  // viven dentro del teléfono y nunca pasan por Cloudflare, así que una copia
  // filtrada del APK serviría para rodear aquel bloqueo. La comprobación sale
  // a internet desde el propio aparato, y ahí sí se ve su IP real.
  //
  // NO se espera a la respuesta para pintar la aplicación: hacerlo dejaría a
  // TODO el mundo mirando una pantalla en blanco durante un segundo por culpa
  // de un control que al 99,9 % de la gente no le aplica. Quien esté bloqueado
  // ve la tienda un instante y luego se le sustituye por el aviso; quien no,
  // no nota absolutamente nada.
  const [accesoBloqueado, setAccesoBloqueado] = useState(false);
  const [bloqueoPorCuenta, setBloqueoPorCuenta] = useState(false);
  useEffect(() => {
    let vigente = true;
    conexionBloqueada().then(bloqueada => {
      if (!vigente || !bloqueada) return;
      setAccesoBloqueado(true);
      // Segunda consulta solo para redactar bien el aviso. Se hace aparte
      // para no retrasar el bloqueo en sí: primero se corta el acceso, y
      // el motivo se afina un instante después.
      detalleDeBloqueo().then(detalle => {
        if (vigente && detalle?.cuentaPenalizada) setBloqueoPorCuenta(true);
      });
    });
    return () => { vigente = false; };
  }, []);

  // ---- Telemetría del visitante ------------------------------------------
  //
  // Registra QUÉ aparato entró: IP, sistema operativo, navegador y modelo.
  // Nunca pide ubicación: a un cliente que solo viene a comprar no se le
  // muestra ningún aviso de permisos. Es "dispara y olvida" — si falla, la
  // tienda funciona exactamente igual.
  useEffect(() => {
    void registrarVisita();
  }, []);

  // Mantiene al día el pase guardado detrás de la huella. Sin esto la
  // biometría de la APK funcionaba una sola vez: el pase es de un solo uso
  // y se consumía en el primer ingreso.
  useEffect(() => {
    iniciarSincronizacionBiometrica();
  }, []);

  // Vigila el segundo plano: CUALQUIER minimizado dispara
  // `EVENTO_FORZAR_REINGRESO` y obliga a volver a pasar por
  // biometría/PIN/contraseña al volver, sin período de gracia. Ver
  // src/mobile/appLock.ts.
  useEffect(() => {
    iniciarBloqueoPorInactividad();
  }, []);

  // Theme Management
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('technoverse_theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('technoverse_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  // Global Session Management
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  // Check memory cache on mount to restore session smoothly without localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
       const handleSession = (e: any) => {
         if (e.detail?.currentUser) setCurrentUser(e.detail.currentUser);
       };
       window.addEventListener('technoverse_auth_sync', handleSession);
       return () => window.removeEventListener('technoverse_auth_sync', handleSession);
    }
  }, []);

  // ---- Recuperación de la sesión al abrir la aplicación --------------------
  //
  // FALLO CORREGIDO: `currentUser` arrancaba SIEMPRE en null y solo se
  // llenaba al pasar por el formulario de acceso. La sesión de Supabase, en
  // cambio, sobrevive en el teléfono. Resultado: se entraba con la huella,
  // se cerraba la aplicación, se volvía a abrir… y la aplicación mostraba
  // "sin sesión" aunque el aparato siguiera perfectamente autenticado. Al
  // intentar entrar al panel, rebotaba a la tienda pidiendo la contraseña.
  // Ese es literalmente el "no completa el inicio de sesión" reportado, y
  // ninguna corrección dentro del código biométrico lo habría arreglado:
  // el fallo estaba en que nadie leía la sesión existente.
  //
  // Solo se da por buena una sesión con perfil legible. Si el perfil no se
  // puede leer, se deja la aplicación como estaba: es preferible pedir la
  // contraseña una vez a dejar entrar con datos incompletos.
  useEffect(() => {
    let vigente = true;

    const recuperar = async () => {
      try {
        // La aplicación puede estar CERRADA CON LLAVE: en la APK con
        // huella activada, "cerrar sesión" conserva la sesión en el
        // aparato y solo la huella la abre. Si no se comprobara esto,
        // cerrar sesión no tendría ningún efecto visible: la pantalla
        // volvería a entrar sola al reabrir la aplicación.
        if (sesionBloqueada()) return;

        const { data } = await supabase.auth.getSession();
        const usuario = data?.session?.user;
        if (!vigente || !usuario?.id) return;

        // Columnas explícitas, no `select('*')`: `profiles` guarda el hash
        // del token de seguridad de 4 dígitos (ver migración del PIN), y
        // ese hash tiene revocado el SELECT a nivel de columna para
        // cualquier rol del cliente. Un `select('*')` fallaría entero con
        // "permission denied for column" en vez de solo omitirla.
        const { data: perfil } = await supabase
          .from('profiles')
          .select('id, email, name, role, created_at')
          .eq('id', usuario.id)
          .maybeSingle();

        if (!vigente || !perfil) return;

        setCurrentUser({
          id: perfil.id,
          email: perfil.email,
          role: perfil.role,
          name: perfil.name || perfil.email,
        });
      } catch {
        /* sin sesión recuperable se sigue como visitante: nada se rompe */
      }
    };

    void recuperar();

    // Si la sesión se cierra desde otra pestaña, o el servidor la revoca,
    // la pantalla tiene que enterarse. Sin esto la aplicación seguiría
    // mostrando el panel de alguien cuya sesión ya no existe.
    const { data: escucha } = supabase.auth.onAuthStateChange((evento) => {
      if (evento === 'SIGNED_OUT' && vigente) setCurrentUser(null);
    });

    return () => {
      vigente = false;
      escucha?.subscription?.unsubscribe();
    };
  }, []);

  const [autoOpenLogin, setAutoOpenLogin] = useState(false);

  const isAuthenticated = !!currentUser;

  const handleLogin = (user: User) => {
    setCurrentUser(user);
    window.dispatchEvent(new CustomEvent('technoverse_auth_sync', { detail: { currentUser: user } }));
    setAutoOpenLogin(false);
    triggerRefresh();
  };

  // ---- Token de seguridad de 4 dígitos: creación forzada -------------------
  //
  // Toda cuenta Administrador (Dueño) tiene que tener este PIN configurado
  // antes de poder usar el resto del panel: es el seguro maestro que exige
  // el cambio de contraseña. Se comprueba en CADA inicio de sesión de una
  // cuenta Dueño —no solo la primera vez que existió la función— para que
  // una cuenta creada antes de este seguro quede forzada a configurarlo en
  // su próximo ingreso, tal como pide la orden.
  const [requiereTokenSeguridad, setRequiereTokenSeguridad] = useState(false);
  useEffect(() => {
    let vigente = true;
    if (!currentUser || currentUser.role !== 'Dueño') {
      setRequiereTokenSeguridad(false);
      return;
    }
    tieneTokenSeguridad().then(tiene => {
      if (vigente) setRequiereTokenSeguridad(!tiene);
    });
    return () => { vigente = false; };
  }, [currentUser]);

  const handleLogout = () => {
    // FALLO CORREGIDO: esto vaciaba el estado de la pantalla pero NO cerraba
    // la sesión de Supabase, así que el aparato seguía autenticado aunque la
    // aplicación dijera lo contrario. Ahora se cierra de verdad — y en la
    // APK con alcance local, para no invalidar el pase que guarda la huella.
    void cerrarSesionConservandoBiometria();
    setCurrentUser(null);
    window.dispatchEvent(new CustomEvent('technoverse_auth_sync', { detail: { currentUser: null } }));
    window.history.pushState(null, "", "/");
    setCurrentView("store");
    setAutoOpenLogin(false);
    triggerRefresh();
  };

  const triggerRefresh = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  // Reacciona al bloqueo por inactividad (src/mobile/appLock.ts): mismo
  // cierre que el botón "Cerrar sesión" —conserva el pase de la huella si
  // está activada, cierre real si no— pero además reabre el acceso de
  // inmediato en vez de dejar a la persona en la tienda como si nada. Sin
  // esto, el evento apagaría la sesión pero nadie pediría la
  // re-autenticación exigida por la auditoría.
  useEffect(() => {
    const alForzarReingreso = () => {
      if (!currentUser) return; // nadie con sesión abierta, no hay nada que bloquear
      handleLogout();
      setAutoOpenLogin(true);
    };
    window.addEventListener(EVENTO_FORZAR_REINGRESO, alForzarReingreso);
    return () => window.removeEventListener(EVENTO_FORZAR_REINGRESO, alForzarReingreso);
  }, [currentUser]);

  useEffect(() => {
    if (currentView === 'admin') {
      if (!currentUser) {
        window.history.replaceState(null, "", "/");
        setCurrentView("store");
        setAutoOpenLogin(true);
      } else if (currentUser.role === 'Cliente') {
        toast.error("Acceso denegado. Este panel está reservado para el personal administrativo y técnico de Technoverse.");
        window.history.replaceState(null, "", "/");
        setCurrentView("store");
      }
    }
  }, [currentView, currentUser, toast]);

  useEffect(() => {
    const handlePopState = () => {
      setCurrentView(window.location.pathname.startsWith('/admin') ? 'admin' : 'store');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // ---- Avisos de fallo al guardar contra Supabase --------------------------
  //
  // FALLO CORREGIDO: storage.ts ya emitía el evento 'technoverse_sync_error'
  // cada vez que un guardado contra la base fracasaba... pero NADIE lo estaba
  // escuchando. El aviso se disparaba al vacío, así que un fallo de guardado
  // era completamente silencioso: la pantalla mostraba el cambio aplicado, el
  // servidor no lo tenía, y nadie se enteraba hasta que faltaba un dato.
  //
  // El mensaje dice que el cambio SE DESCARTÓ, y eso es literal: cuando la
  // escritura falla, storage.ts llama a refreshTableFromSupabase() y vuelve a
  // leer del servidor, con lo cual la modificación local se pierde. Decir
  // "quedó guardado en este dispositivo" sería mentira y llevaría a alguien a
  // confiarse.
  const avisosMostrados = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    const alFallarGuardado = (e: any) => {
      const detalle = String(e?.detail?.message || 'motivo desconocido');
      // Un solo guardado puede disparar varios fallos a la vez (por ejemplo,
      // varias imágenes de golpe). Sin este freno el usuario recibiría una
      // pila de avisos idénticos encima del otro.
      const ahora = Date.now();
      const visto = avisosMostrados.current.get(detalle) || 0;
      if (ahora - visto < 8000) return;
      avisosMostrados.current.set(detalle, ahora);
      toast.error(`No se guardó en el servidor y el cambio se descartó. Revisá la conexión y volvé a intentarlo. Detalle: ${detalle}`);
    };
    window.addEventListener('technoverse_sync_error', alFallarGuardado);
    return () => window.removeEventListener('technoverse_sync_error', alFallarGuardado);
  }, [toast]);

  if (accesoBloqueado) {
    return <PantallaBloqueada porCuenta={bloqueoPorCuenta} />;
  }

  return (
    <div className="min-h-screen bg-transparent font-sans selection:bg-blue-500/20 selection:text-blue-700 dark:selection:bg-[var(--brand-gold-mid)]/20 dark:selection:text-[var(--brand-gold-light)]" id="technoverse-application-container">
      {currentView === 'store' ? (
        <PublicStore
          onNavigateToAdmin={() => { window.history.pushState(null, "", "/admin"); setCurrentView("admin"); }}
          onRefreshTrigger={refreshTrigger}
          currentUser={currentUser}
          isAuthenticated={isAuthenticated}
          onLogin={handleLogin}
          onLogout={handleLogout}
          autoOpenLogin={autoOpenLogin}
          onClearAutoOpenLogin={() => setAutoOpenLogin(false)}
          theme={theme}
          toggleTheme={toggleTheme}
        />
      ) : (
        <Suspense fallback={<AdminPanelFallback />}>
          <AdminPanel
            onNavigateToStore={() => {
              window.history.pushState(null, "", "/");
              setCurrentView("store");
              triggerRefresh();
            }}
            onRefreshTrigger={triggerRefresh}
            currentUser={currentUser}
            isAuthenticated={isAuthenticated}
            onLogin={handleLogin}
            onLogout={handleLogout}
            theme={theme}
            toggleTheme={toggleTheme}
          />
        </Suspense>
      )}

      {/* Bloqueante a propósito: sin `onClose`, cubre cualquier vista que
          esté debajo hasta que la cuenta Dueño configure su token. */}
      {requiereTokenSeguridad && (
        <CrearTokenModal open={requiereTokenSeguridad} onCreado={() => setRequiereTokenSeguridad(false)} />
      )}
    </div>
  );
}
