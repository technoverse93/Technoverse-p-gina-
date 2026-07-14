const fs = require('fs');
let code = fs.readFileSync('src/components/AdminPanel.tsx', 'utf-8');

// Remove the one I just added
code = code.replace(
  "useEffect(() => {\n    if (activeTab === 'taller' && !(isOwner || hasPermission('taller'))) {\n      setActiveTab('dashboard');\n    }\n  }, [activeTab, currentUser]);",
  ""
);

// Add it after hasPermission definition
const target = "const hasPermission = (module: string) => {";
const replacement = `
  useEffect(() => {
    if (activeTab === 'taller' && !(isOwner || hasPermission('taller'))) {
      setActiveTab('dashboard');
    }
  }, [activeTab, currentUser]);

  const hasPermission = (module: string) => {`;

code = code.replace(target, replacement);
fs.writeFileSync('src/components/AdminPanel.tsx', code);
