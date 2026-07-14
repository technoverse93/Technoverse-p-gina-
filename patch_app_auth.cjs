const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf-8');

code = code.replace(
  "  const [currentUser, setCurrentUser] = useState<User | null>(() => {\n    const saved = localStorage.getItem('technoverse_session');\n    if (saved) {\n      try {\n        return JSON.parse(saved);\n      } catch (e) {\n        return null;\n      }\n    }\n    return null;\n  });",
  "  const [currentUser, setCurrentUser] = useState<User | null>(null);\n\n  // Check memory cache on mount to restore session smoothly without localStorage\n  useEffect(() => {\n    if (typeof window !== 'undefined') {\n       const handleSession = (e: any) => {\n         if (e.detail?.currentUser) setCurrentUser(e.detail.currentUser);\n       };\n       window.addEventListener('technoverse_auth_sync', handleSession);\n       return () => window.removeEventListener('technoverse_auth_sync', handleSession);\n    }\n  }, []);"
);

code = code.replace(
  "localStorage.setItem('technoverse_session', JSON.stringify(user));",
  "window.dispatchEvent(new CustomEvent('technoverse_auth_sync', { detail: { currentUser: user } }));"
);

code = code.replace(
  "localStorage.removeItem('technoverse_session');",
  "window.dispatchEvent(new CustomEvent('technoverse_auth_sync', { detail: { currentUser: null } }));"
);

fs.writeFileSync('src/App.tsx', code);
