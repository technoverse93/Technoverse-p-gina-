const fs = require('fs');
let content = fs.readFileSync('src/components/AdminPanel.tsx', 'utf-8');

const correctCode = `let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel('technoverse_db_channel');
      channel.onmessage = (event) => {
        if (event.data && event.data.type === 'UPDATE_DB') {
          loadAllAdminData();
        }
      };
    } catch (e) {
      // Ignored
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('storage', handleDbUpdate);
      window.removeEventListener('technoverse_db_updated', handleDbUpdate);
      if (channel) {
        channel.close();
      }
    };
  }, []);

  const loadAllAdminData = () => {
    const db = getDB();
    setProducts(db.products || []);
    setEmployees(db.employees || []);
    setPayrolls(db.payroll || []);
    setOrders(db.orders || []);
    setRepairs(db.repair_orders || []);
    if (db.settings) {
      setCedulaJuridica(db.settings.cedulaJuridica);
      setCompanyPhone(db.settings.companyPhone || '');
      setCompanyAddress(db.settings.companyAddress || '');
      setPickupHours(db.settings.pickupHours || '');
      import('../utils/storage').then(mod => mod.getLogo().then(logo => { if (logo) setStoreLogo(logo); }));
    }
    setClients(db.clients || []);
    setMemberships(db.membership_tiers || []);
    setDeliveries(db.deliveries || []);
    setCampaigns(db.marketing_campaigns || []);
    setBanners(db.banners || []);
    setAuditLog(db.audit_log || []);
    
    if (onRefreshTrigger) {
      onRefreshTrigger();
    }
  };

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setStoreLogoPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = loginEmail.trim().toLowerCase();

    const db = getDB();
    
    // Auto-create Admin in Firebase Auth if needed
    if (cleanEmail === 'admin@technoverse.com' && loginPassword === ADMIN_PASSWORD) {
      try {
        await signInWithEmailAndPassword(auth, cleanEmail, loginPassword);
      } catch (err: any) {
        if (err.code === 'auth/operation-not-allowed') {
          alert('¡ATENCIÓN! Debes habilitar "Correo/Contraseña" en Firebase Console -> Authentication -> Sign-in method.');
          return;
        }
        if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential' || err.code === 'auth/invalid-login-credentials') {
          try {
            await createUserWithEmailAndPassword(auth, cleanEmail, loginPassword);
          } catch (createErr: any) {
            console.error(createErr);
            alert('Error creando el administrador en Firebase: ' + createErr.message);
            return;
          }
        } else {
          console.error(err);
          alert('Error de autenticación: ' + err.message);
          return;
        }
      }
      
      const adminUser: User = { id: 'admin-id', email: 'admin@technoverse.com', role: 'Dueño', name: 'Administrador Technoverse' };
      onLogin(adminUser);
      setLoginEmail(''); setLoginPassword('');
      alert('Sesión iniciada con éxito como Administrador.');
      return;
    }

    // Normal user login
    try {
      await signInWithEmailAndPassword(auth, cleanEmail, loginPassword);
    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/operation-not-allowed') {
        alert('El administrador debe habilitar la autenticación por correo/contraseña en Firebase Console.');
      } else {
        alert('Credenciales inválidas en el servidor. Por favor verifique el correo y contraseña.');
      }
      return;
    }`;

content = content.replace(
  /let channel: BroadcastChannel \| null = null;[\s\S]*?\/\/ Normal user login\s*try \{\s*await signInWithEmailAndPassword\(auth, cleanEmail, loginPassword\);\s*\} catch \(err: any\) \{\s*console\.error\(err\);\s*if \(err\.code === 'auth\/operation-not-allowed'\) \{\s*alert\('El administrador debe habilitar la autenticación por correo\/contraseña en Firebase Console\.'\);\s*\} else \{\s*alert\('Credenciales inválidas en el servidor\. Por favor verifique el correo y contraseña\.'\);\s*\}\s*return;\s*\}/,
  correctCode
);

fs.writeFileSync('src/components/AdminPanel.tsx', content);
