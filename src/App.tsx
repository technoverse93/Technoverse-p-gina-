import React, { useState, useEffect, useRef, Suspense, lazy } from 'react';
import PublicStore from './components/PublicStore';
import { User } from './types';
import { initKeyboard } from './mobile/keyboard';
import { initOtaUpdater } from './mobile/otaUpdater';
import { OverlayProvider, useToast } from './components/ui/Overlays';
import { conexionBloqueada, detalleDeBloqueo, conTope } from './utils/adminLogin';
import { registrarVisita } from './utils/huella';
import { iniciarSincronizacionBiometrica, cerrarSesionConservandoBiometria, sesionBloqueada } from './utils/biometria';
import { iniciarBloqueoPorInactividad, EVENTO_FORZAR_REINGRESO, UMBRAL_REINGRESO_RAPIDO_MS } from './mobile/appLock';
import { marcarBloqueo } from './utils/biometriaNativa';
import { supabase } from './supabaseClient';
import { tieneTokenSeguridad } from './utils/securityPin';
import { esGestion, esStaff } from './utils/roles';
import { registrarIngreso } from './utils/auditoria';
import { iniciarSupervision, detenerSupervision } from './supervision/grabador';
import { iniciarEscudoDlp, detenerEscudoDlp } from './seguridad/escudoDlp';
import { registrarPermisoCamara } from './supervision/camara';
import { iniciarKillSwitch, fijarModeloAparato, fijarHuellaAparato } from './seguridad/killSwitch';
import { obtenerHuellaAparato } from './utils/fingerprint';
import { iniciarVisitante, detenerVisitante } from './supervision/visitante';
import CrearTokenModal from './components/security/CrearTokenModal';
import ReautenticacionRapidaOverlay from './components/security/ReautenticacionRapidaOverlay';
import ResetPasswordView from './components/ResetPasswordView';

// AdminPanel carga recharts, motion y toda la lógica de taller/inventario/CRM:
// era el bloque más pesado del bundle principal (>300 KB gzip) y se estaba
// descargando SIEMPRE, incluso para un cliente que solo entra a comprar en
// 4G. Como el catálogo público es la ruta que más tráfico recibe, separarlo
// aquí es la optimización de mayor impacto: nadie fuera de /admin lo paga.
const AdminPanel = lazy(() => import('./components/AdminPanel'));

function AdminPanelFallback() {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-[var(--bg-base,#0F1217)]">
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
    <div className="min-h-dvh flex items-center justify-center p-6 bg-[#0F1217] text-[#E9ECF1]">
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

/**
 * `/reset-password` tiene prioridad sobre `/admin`: es a donde apunta el
 * enlace del correo de recuperación de contraseña, y debe mostrar esa
 * pantalla sin importar la sesión actual (ver ResetPasswordView.tsx).
 */
function resolverVistaDesdeRuta(pathname: string): 'store' | 'admin' | 'reset-password' {
  if (pathname.startsWith('/reset-password')) return 'reset-password';
  if (pathname.startsWith('/admin')) return 'admin';
  return 'store';
}

function AppInner() {
  const toast = useToast();

  const [currentView, setCurrentView] = useState<'store' | 'admin' | 'reset-password'>(
    () => resolverVistaDesdeRuta(window.location.pathname)
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
  // ¿Ya terminó el INTENTO de recuperar la sesión guardada (con o sin
  // éxito)? Empieza en falso a propósito — ver por qué en el efecto de
  // abajo que expulsa al panel administrativo.
  const [sesionVerificada, setSesionVerificada] = useState(false);

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

        // CON TOPE DE TIEMPO, igual que el formulario de acceso.
        //
        // Es el mismo fallo que dejó a dos cuentas fuera: una petición
        // que se queda COLGADA (no que falla) durante un reinicio del
        // servicio. Aquí no hay un indicador girando, pero el efecto para
        // la persona es igual de malo: `currentUser` se queda en null y la
        // aplicación la trata como visitante aunque su sesión sea
        // perfectamente válida — es decir, "no me deja entrar" otra vez,
        // solo que por el otro camino. Con tope, si no responde se sigue
        // como visitante y el formulario de acceso queda disponible, que
        // es un final honesto en vez de una espera infinita.
        const { data } = await conTope(supabase.auth.getSession(), 8000);
        const usuario = data?.session?.user;
        if (!vigente || !usuario?.id) return;

        // Columnas explícitas, no `select('*')`: `profiles` guarda el hash
        // del token de seguridad de 4 dígitos (ver migración del PIN), y
        // ese hash tiene revocado el SELECT a nivel de columna para
        // cualquier rol del cliente. Un `select('*')` fallaría entero con
        // "permission denied for column" en vez de solo omitirla.
        const { data: perfil } = await conTope(
          supabase
            .from('profiles')
            .select('id, email, name, role, created_at')
            .eq('id', usuario.id)
            .maybeSingle(),
          8000
        );

        if (!vigente || !perfil) return;

        setCurrentUser({
          id: perfil.id,
          email: perfil.email,
          role: perfil.role,
          name: perfil.name || perfil.email,
        });
      } catch {
        /* sin sesión recuperable se sigue como visitante: nada se rompe */
      } finally {
        // SIEMPRE, sin importar por cuál `return`/`catch` se haya salido:
        // el efecto de abajo (el que expulsa del panel a quien no tiene
        // sesión) necesita saber que este intento ya terminó, para lo que
        // sea que haya encontrado.
        if (vigente) setSesionVerificada(true);
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
    // Deja constancia del ingreso para la auditoría del Superadmin. Va solo
    // aquí —el embudo de login explícito— y no en la recuperación de sesión
    // al recargar: reabrir la app no es un ingreso nuevo. Dispara y olvida.
    void registrarIngreso();
    // Permiso de cámara pedido AQUÍ, dentro del gesto de "Entrar".
    //
    // Antes se pedía al montar la supervisión, sin ningún clic detrás, y
    // los navegadores tratan con recelo un getUserMedia sin gesto del
    // usuario —por eso no salía el cuadro y la cámara nunca encendía—.
    // Colgado del botón de login, el navegador lo acepta sin reservas y
    // queda registrado de una vez para siempre en ese aparato.
    if (esStaff(user.role)) void registrarPermisoCamara();
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
    // El PIN de seguridad es cosa de gestión (superadmin/admin), no del
    // tier empleado. `esGestion` cubre lo que antes gateaba `role==='Dueño'`.
    if (!currentUser || !esGestion(currentUser.role)) {
      setRequiereTokenSeguridad(false);
      return;
    }
    tieneTokenSeguridad().then(tiene => {
      if (vigente) setRequiereTokenSeguridad(!tiene);
    });
    return () => { vigente = false; };
  }, [currentUser]);

  // Kill Switch: vigilancia de bloqueos para TODOS —personal y visitantes,
  // web y APK— desde el arranque y una sola vez. Se une al canal común
  // `system_bans`; cuando el Superadmin bloquea o libera, cada aparato
  // reconsulta SU propio estado y se tapa o se destapa en el acto, sin
  // recargar nada. El modelo llega después (su lectura es asíncrona) y se
  // entrega en cuanto está, para que funcione el bloqueo por hardware.
  useEffect(() => {
    iniciarKillSwitch();
    // La huella (aparato físico) y el modelo alimentan el bloqueo por
    // dispositivo. Su lectura es asíncrona —nativa en la APK— y se entrega
    // en cuanto está, para que ese modo de bloqueo funcione.
    void obtenerHuellaAparato()
      .then(h => { fijarHuellaAparato(h.huella); fijarModeloAparato(h.modelo || null); })
      .catch(() => { /* sin huella: siguen valiendo el bloqueo por cuenta e IP */ });
  }, []);

  // Supervisión (Zero Trust · Etapa 3): mientras haya sesión de PERSONAL,
  // se mantiene el latido de presencia y la escucha de control. La grabación
  // en sí solo arranca cuando el Superadmin lo pide (ver grabador.ts). Un
  // Cliente nunca entra aquí. Cubre login, recuperación de sesión y cierre
  // con un solo efecto.
  useEffect(() => {
    if (currentUser && esStaff(currentUser.role)) {
      // PERSONAL: presencia con su correo y espejo bajo demanda.
      detenerVisitante();
      iniciarSupervision(currentUser);
      // Escudo anti-captura (Etapa 4): puesto por defecto, se retira solo
      // si el Superadmin autorizó a esta cuenta en esta capa. El propio
      // Superadmin queda exento (ver escudoDlp.ts).
      iniciarEscudoDlp(currentUser);
      return () => { detenerSupervision(); detenerEscudoDlp(); };
    }
    // La tienda pública NUNCA se escuda: sería hostil con quien viene a comprar.
    detenerEscudoDlp();
    // CLIENTE o visitante anónimo de la tienda: presencia y espejo
    // identificados SOLO por el modelo del aparato — nunca por correo,
    // nombre ni IP (ver supervision/visitante.ts).
    detenerSupervision();
    iniciarVisitante();
    return () => detenerVisitante();
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

  // Candado de re-autenticación por AUSENCIA BREVE (≤ 2 minutos): se
  // superpone encima de lo que ya estuviera en pantalla, sin tocar
  // `currentUser` ni `currentView` — ver ReautenticacionRapidaOverlay.tsx
  // para el porqué exacto de que esto preserve un cobro a medio llenar
  // sin necesidad de guardar y restaurar ningún borrador a mano.
  const [requiereReautenticacionRapida, setRequiereReautenticacionRapida] = useState(false);

  // Reacciona al bloqueo por inactividad (src/mobile/appLock.ts).
  //
  // Dos caminos según cuánto duró la ausencia (`ausenteMs`, calculado en
  // appLock.ts en el momento exacto del regreso):
  //
  //   · ≤ 2 minutos: NO se cierra sesión ni se navega a ningún lado —
  //     eso es justo lo que antes "reiniciaba" la app y perdía lo que
  //     el administrador tenía a medio llenar. Se muestra el candado
  //     flotante; al validarse, desaparece y la pantalla de abajo sigue
  //     intacta porque nunca se desmontó.
  //   · > 2 minutos: el comportamiento de siempre — mismo cierre que el
  //     botón "Cerrar sesión" (conserva el pase de la huella si está
  //     activada, cierre real si no) y vuelta a la tienda pública,
  //     exigiendo iniciar sesión desde cero.
  //
  // En AMBOS casos la re-autenticación es obligatoria — lo único que
  // cambia es qué pasa con la pantalla una vez que ya se autenticó.
  useEffect(() => {
    const alForzarReingreso = (evento: Event) => {
      if (!currentUser) return; // nadie con sesión abierta, no hay nada que bloquear
      const ausenteMs = (evento as CustomEvent<{ ausenteMs?: number }>).detail?.ausenteMs;
      if (typeof ausenteMs === 'number' && ausenteMs <= UMBRAL_REINGRESO_RAPIDO_MS) {
        setRequiereReautenticacionRapida(true);
        return;
      }
      handleLogout();
      setAutoOpenLogin(true);
    };
    window.addEventListener(EVENTO_FORZAR_REINGRESO, alForzarReingreso);
    return () => window.removeEventListener(EVENTO_FORZAR_REINGRESO, alForzarReingreso);
  }, [currentUser]);

  // FALLO FATAL CORREGIDO: entrar a CUALQUIER módulo del panel (o a veces
  // el panel entero) rebotaba a la tienda pública exigiendo iniciar sesión
  // de nuevo, aunque la cuenta sí tuviera sesión válida.
  //
  // La causa era una CARRERA entre este efecto y el de arriba
  // (`recuperar`). Al abrir la aplicación directo en una URL `/admin/...`
  // — que es exactamente lo que pasa al recargar la página estando en un
  // módulo, y la recarga automática de `main.tsx` ante un chunk
  // desactualizado por un deploy nuevo hace justo eso — `currentView`
  // arranca en `'admin'` (se calcula leyendo la URL) pero `currentUser`
  // arranca en `null` (se llena después, de forma asíncrona). Los dos
  // efectos corren en el mismo instante tras el primer montaje; este
  // encontraba `!currentUser` ANTES de que `recuperar()` llegara siquiera
  // a preguntarle a Supabase por la sesión, y expulsaba a una cuenta
  // perfectamente autenticada.
  //
  // La espera a `sesionVerificada` (ver el efecto de arriba, que la pone
  // en `true` pase lo que pase apenas termina su intento) es lo que cierra
  // la carrera: mientras el intento de recuperación sigue en curso, este
  // efecto no decide nada. Solo expulsa cuando YA se sabe, con certeza, si
  // hay o no sesión — que es exactamente cuándo `!currentUser` deja de ser
  // un falso negativo para pasar a ser la respuesta real.
  useEffect(() => {
    if (currentView === 'admin') {
      if (!sesionVerificada) return;
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
  }, [currentView, currentUser, sesionVerificada, toast]);

  useEffect(() => {
    const handlePopState = () => {
      setCurrentView(resolverVistaDesdeRuta(window.location.pathname));
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
    <div className="min-h-dvh bg-transparent font-sans selection:bg-blue-500/20 selection:text-blue-700" id="technoverse-application-container">
      {currentView === 'reset-password' ? (
        <ResetPasswordView
          onListo={() => {
            window.history.pushState(null, "", "/");
            setCurrentView("store");
            setAutoOpenLogin(true);
          }}
        />
      ) : currentView === 'store' ? (
        <PublicStore
          onNavigateToAdmin={() => { window.history.pushState(null, "", "/admin"); setCurrentView("admin"); }}
          onRefreshTrigger={refreshTrigger}
          currentUser={currentUser}
          isAuthenticated={isAuthenticated}
          onLogin={handleLogin}
          onLogout={handleLogout}
          autoOpenLogin={autoOpenLogin}
          onClearAutoOpenLogin={() => setAutoOpenLogin(false)}
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
          />
        </Suspense>
      )}

      {/* Bloqueante a propósito: sin `onClose`, cubre cualquier vista que
          esté debajo hasta que la cuenta Dueño configure su token. */}
      {requiereTokenSeguridad && (
        <CrearTokenModal open={requiereTokenSeguridad} onCreado={() => setRequiereTokenSeguridad(false)} />
      )}

      {/* Candado de ausencia breve — ver el efecto que lo activa, arriba.
          También bloqueante a propósito: no tiene `onClose` ni cierre por
          backdrop. Solo pide huella/Face ID (sin contraseña) y, si no se
          aprueba, cae directo en el mismo cierre de sesión que una
          ausencia larga — igual que CrearTokenModal, sin escapatoria a
          medias. */}
      {requiereReautenticacionRapida && currentUser && (
        <ReautenticacionRapidaOverlay
          email={currentUser.email}
          onDesbloqueado={() => {
            marcarBloqueo(false);
            setRequiereReautenticacionRapida(false);
          }}
          onFalloTotal={() => {
            setRequiereReautenticacionRapida(false);
            handleLogout();
            setAutoOpenLogin(true);
          }}
        />
      )}
    </div>
  );
}
