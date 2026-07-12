const fs = require('fs');
const path = require('path');

const fileAdmin = path.join(__dirname, 'src', 'components', 'AdminPanel.tsx');
let adminCode = fs.readFileSync(fileAdmin, 'utf8');

// 1. Employees
if (!adminCode.includes('paginatedEmployees')) {
  adminCode = adminCode.replace(
    'const [employees, setEmployees] = useState<Employee[]>([]);',
    'const [employees, setEmployees] = useState<Employee[]>([]);\n  const { page: empPage, setPage: setEmpPage, totalPages: empTotal, startIndex: empStart, visibleItems: paginatedEmployees } = usePagination(employees, 10);'
  );
  adminCode = adminCode.replace('employees.map(emp => (', 'paginatedEmployees.map(emp => (');
  adminCode = adminCode.replace(
    '                    )}',
    '                    )}\n                  </tbody>\n                </table>\n                {empTotal > 1 && (<div className="flex items-center justify-between p-4 bg-white border-t border-slate-200"><span className="text-sm text-gray-500">Mostrando {empStart + 1} a {Math.min(empStart + 10, employees.length)} de {employees.length}</span><div className="flex gap-2"><button onClick={() => setEmpPage(p => Math.max(1, p - 1))} disabled={empPage === 1} className="px-3 py-1 bg-gray-100 rounded disabled:opacity-50 text-slate-800">Anterior</button><span className="px-3 py-1 font-bold text-slate-800">{empPage} / {empTotal}</span><button onClick={() => setEmpPage(p => Math.min(empTotal, p + 1))} disabled={empPage === empTotal} className="px-3 py-1 bg-gray-100 rounded disabled:opacity-50 text-slate-800">Siguiente</button></div></div>)}'
  );
  // Wait! Replacing `)}` globally is dangerous. 
}

fs.writeFileSync(fileAdmin, adminCode);
