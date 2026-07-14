const fs = require('fs');
let code = fs.readFileSync('src/components/AdminPanel.tsx', 'utf-8');

code = code.replace(
  "{activeTab === 'taller' && (",
  "{activeTab === 'taller' && ( (isOwner || hasPermission('taller')) ? ("
);
code = code.replace(
  "<TallerKanban activeUserEmail={currentUser?.email} onRepairUpdated={loadAllAdminData} />\n          </div>\n        )}",
  "<TallerKanban activeUserEmail={currentUser?.email} onRepairUpdated={loadAllAdminData} />\n          ) : <div className=\"p-8 text-center text-rose-500 font-bold\">Acceso denegado. Permisos insuficientes.</div> )\n          </div>\n        )}"
);

fs.writeFileSync('src/components/AdminPanel.tsx', code);
