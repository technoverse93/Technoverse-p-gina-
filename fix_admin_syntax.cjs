const fs = require('fs');
let code = fs.readFileSync('src/components/AdminPanel.tsx', 'utf-8');

const replacement = `
        {activeTab === 'taller' && (
          (isOwner || hasPermission('taller')) ? (
            /* MODULE C: TALLER (KANBAN COMPONENT EMBEDDED) */
            <div className="space-y-4" id="view-taller">
              <TallerKanban activeUserEmail={currentUser?.email} onRepairUpdated={loadAllAdminData} />
            </div>
          ) : (
            <div className="p-8 text-center text-rose-500 font-bold">Acceso denegado. Permisos insuficientes.</div>
          )
        )}
`;

const regex = /\{activeTab === 'taller' && \( \(isOwner \|\| hasPermission\('taller'\)\) \? \([\s\S]*?<TallerKanban activeUserEmail=\{currentUser\?\.email\} onRepairUpdated=\{loadAllAdminData\} \/>\n          <\/div>\n        \)\}/;

code = code.replace(regex, replacement);
fs.writeFileSync('src/components/AdminPanel.tsx', code);
