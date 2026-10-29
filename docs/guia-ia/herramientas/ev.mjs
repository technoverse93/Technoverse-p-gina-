import { conectar } from './cdp.mjs';
const [expr, id] = process.argv.slice(2);
const p = await conectar(id); const v = await p.ev(expr, true);
console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 1)); p.cerrar(); process.exit(0);
