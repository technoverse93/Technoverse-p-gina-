const fs = require('fs');

function processFile(path) {
  let content = fs.readFileSync(path, 'utf-8');
  
  if (!content.includes('createUserWithEmailAndPassword(auth')) {
    content = content.replace(
      "import { signInWithEmailAndPassword } from 'firebase/auth';",
      "import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';"
    );
  }
  
  const loginLogic = `
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
      setIsLoginModalOpen && setIsLoginModalOpen(false);
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
    }
  `;

  // For PublicStore.tsx
  if (path.includes('PublicStore')) {
    content = content.replace(
      /try \{[\s\S]*?await signInWithEmailAndPassword\(auth, cleanEmail, loginPassword\);[\s\S]*?\} catch \(err\) \{[\s\S]*?alert\('Credenciales inválidas[\s\S]*?return;[\s\S]*?\}[\s\S]*?const db = getDB\(\);[\s\S]*?\/\/ 1\. Admin\/Dueño check[\s\S]*?if \(cleanEmail === 'admin@technoverse\.com' && loginPassword === ADMIN_PASSWORD\) \{[\s\S]*?const adminUser: User = \{ id: 'admin-id'[\s\S]*?return;[\s\S]*?\}/,
      loginLogic.replace('setIsLoginModalOpen && setIsLoginModalOpen(false);', 'setIsLoginModalOpen(false);')
    );
  }
  
  // For AdminPanel.tsx
  if (path.includes('AdminPanel')) {
    content = content.replace(
      /try \{[\s\S]*?await signInWithEmailAndPassword\(auth, cleanEmail, loginPassword\);[\s\S]*?\} catch \(err\) \{[\s\S]*?alert\('Credenciales inválidas[\s\S]*?addAuditLog[\s\S]*?return;[\s\S]*?\}/,
      loginLogic.replace('setIsLoginModalOpen && setIsLoginModalOpen(false);', '').replace("return;\n    }\n\n    // 1. Check Pre-defined admin", "return;\n    }\n")
    );
    
    // Also remove the old admin check that was left behind
    content = content.replace(
      /\/\/ 1\. Check Pre-defined admin[\s\S]*?if \(cleanEmail === 'admin@technoverse\.com' && loginPassword === ADMIN_PASSWORD\) \{[\s\S]*?const adminUser: User = \{[\s\S]*?return;[\s\S]*?\}/,
      ''
    );
  }

  fs.writeFileSync(path, content);
}

processFile('src/components/PublicStore.tsx');
processFile('src/components/AdminPanel.tsx');
