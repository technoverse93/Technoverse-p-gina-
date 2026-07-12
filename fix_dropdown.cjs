const fs = require('fs');

const files = ['src/components/AdminPanel.tsx', 'src/components/PublicStore.tsx'];

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  
  // Add an effect to handle dynamic dropdowns
  if (!content.includes('handleDynamicDropdowns')) {
    content = content.replace(/useEffect\(\(\) => \{/, `useEffect(() => {\n    const handleDynamicDropdowns = () => {\n      document.querySelectorAll('.dynamic-dropdown').forEach(dropdown => {\n        const rect = dropdown.getBoundingClientRect();\n        if (rect.right > window.innerWidth - 16) {\n          (dropdown as HTMLElement).style.left = 'auto';\n          (dropdown as HTMLElement).style.right = '0';\n        }\n      });\n    };\n    window.addEventListener('mouseover', handleDynamicDropdowns);\n    return () => window.removeEventListener('mouseover', handleDynamicDropdowns);\n  }, []);\n\n  useEffect(() => {`);
    fs.writeFileSync(file, content, 'utf8');
  }
});
