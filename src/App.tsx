import React, { useState, useEffect, Suspense, lazy } from 'react';
import PublicStore from './components/PublicStore';
import { User } from './types';
import { initKeyboard } from './mobile/keyboard';
import { OverlayProvider, useToast } from './components/ui/Overlays';

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

function AppInner() {
  const toast = useToast();

  const [currentView, setCurrentView] = useState<'store' | 'admin'>(
    window.location.pathname.startsWith('/admin') ? 'admin' : 'store'
  );
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);

  useEffect(() => {
    initKeyboard();
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

  const [autoOpenLogin, setAutoOpenLogin] = useState(false);

  const isAuthenticated = !!currentUser;

  const handleLogin = (user: User) => {
    setCurrentUser(user);
    window.dispatchEvent(new CustomEvent('technoverse_auth_sync', { detail: { currentUser: user } }));
    setAutoOpenLogin(false);
    triggerRefresh();
  };

  const handleLogout = () => {
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
    </div>
  );
}
