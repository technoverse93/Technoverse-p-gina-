const fs = require('fs');
let code = fs.readFileSync('src/components/AdminPanel.tsx', 'utf-8');

const effectCode = `
  useEffect(() => {
    if (activeTab === 'taller' && !(isOwner || hasPermission('taller'))) {
      setActiveTab('dashboard');
    }
  }, [activeTab, currentUser]);
`;

// insert after activeDropdown effect
code = code.replace(
  "useEffect(() => {\n    if (activeDropdown !== 'profile') {\n      setShowConfigSubmenu(false);\n    }\n  }, [activeDropdown]);",
  "useEffect(() => {\n    if (activeDropdown !== 'profile') {\n      setShowConfigSubmenu(false);\n    }\n  }, [activeDropdown]);\n" + effectCode
);

fs.writeFileSync('src/components/AdminPanel.tsx', code);
