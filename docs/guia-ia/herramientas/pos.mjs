// Da la posición en PANTALLA (px físicos) de un elemento: node pos.mjs '<js que devuelve el elemento>'
import { conectar } from './cdp.mjs';
const p = await conectar(process.env.PESTANA || '1011');
await p.send('Emulation.clearDeviceMetricsOverride');
const r = await p.ev(`(()=>{const e=(${process.argv[2]}); if(!e) return null; e.scrollIntoView({block:'center'}); const b=e.getBoundingClientRect(); return [b.x+b.width/2, b.y+b.height/2, devicePixelRatio]})()`);
if (!r) { console.log('NO'); } else { await p.pausa(600); const r2 = await p.ev(`(()=>{const e=(${process.argv[2]}); const b=e.getBoundingClientRect(); return [b.x+b.width/2, b.y+b.height/2, devicePixelRatio]})()`); console.log(Math.round(r2[0]*r2[2]), Math.round(216 + r2[1]*r2[2])); }
p.cerrar(); process.exit(0);
