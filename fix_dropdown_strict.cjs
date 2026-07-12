const fs = require('fs');

const files = ['src/components/AdminPanel.tsx', 'src/components/PublicStore.tsx'];

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  
  // Replace the old mouseover listener logic with a more robust one handling mouseenter on wrappers
  content = content.replace(/const handleDynamicDropdowns = \(\) => \{[\s\S]*?window\.removeEventListener\('mouseover', handleDynamicDropdowns\);\n  \}, \[\]\);\n\n/g, '');

  // But we need to add the onMouseEnter to the wrapper or just a global mouseover on buttons that trigger dropdowns.
  // Actually, let's just make the dropdown wrapper right-aligned by default if it's near the edge.
  // The user says: "Añade esta lógica en el evento onClick o onMouseEnter... Si spaceRight < 320, posiciona el menú con right: 0 en lugar de left: 0."
  
  content = content.replace(/useEffect\(\(\) => \{/, `const handleDropdownEnter = (e: React.MouseEvent<HTMLDivElement | HTMLButtonElement>) => {\n    const button = e.currentTarget;\n    const rect = button.getBoundingClientRect();\n    const spaceRight = window.innerWidth - rect.right;\n    const dropdown = button.querySelector('.dynamic-dropdown') as HTMLElement;\n    if (dropdown) {\n      if (spaceRight < 320) {\n        dropdown.style.left = 'auto';\n        dropdown.style.right = '0';\n      } else {\n        dropdown.style.left = '0';\n        dropdown.style.right = 'auto';\n      }\n    }\n  };\n\n  useEffect(() => {`);

  // Add onMouseEnter={handleDropdownEnter} to elements wrapping .dynamic-dropdown
  content = content.replace(/className="relative group hidden md:block"/g, 'className="relative group hidden md:block" onMouseEnter={handleDropdownEnter}');
  content = content.replace(/className="relative group"/g, 'className="relative group" onMouseEnter={handleDropdownEnter}');
  content = content.replace(/className="relative"/g, 'className="relative" onMouseEnter={handleDropdownEnter}');
  
  fs.writeFileSync(file, content, 'utf8');
});
console.log('Dropdown logic updated');
