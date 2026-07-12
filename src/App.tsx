import React, { useState, useEffect } from 'react';
import PublicStore from './components/PublicStore';
import AdminPanel from './components/AdminPanel';
import { User } from './types';

export default function App() {
  const [currentView, setCurrentView] = useState<'store' | 'admin'>(
    window.location.pathname.startsWith('/admin') ? 'admin' : 'store'
  );
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);

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
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('technoverse_session');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return null;
      }
    }
    return null;
  });

  const [autoOpenLogin, setAutoOpenLogin] = useState(false);

  const isAuthenticated = !!currentUser;

  const handleLogin = (user: User) => {
    setCurrentUser(user);
    localStorage.setItem('technoverse_session', JSON.stringify(user));
    setAutoOpenLogin(false);
    triggerRefresh();
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem('technoverse_session');
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
        alert("Acceso denegado. Este panel está reservado para el personal administrativo y técnico de Technoverse.");
        window.history.replaceState(null, "", "/");
        setCurrentView("store");
      }
    }
  }, [currentView, currentUser]);

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
      )}
    </div>
  );
}
