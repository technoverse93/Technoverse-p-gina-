import { conectar } from './cdp.mjs';
const ruta = process.argv[2] || '/admin';
const p = await conectar(process.env.PESTANA || '1011');
await p.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await p.ir('https://technoverse-cr.technoversecr.workers.dev' + ruta, 9000);
let dentro = await p.ev(`location.pathname.startsWith('/admin') && !document.querySelector('input[type=password]')`);
if (!dentro) {
  if (!(await p.ev(`!!document.querySelector('input[placeholder="usuario@ejemplo.com"]')`))) { await p.ev(`document.querySelector('[aria-label="Mi Cuenta"]')?.click()`, true); await p.pausa(1000); }
  console.log('acceso:', await p.ev(`(()=>{const set=(el,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v); el.dispatchEvent(new Event('input',{bubbles:true}));};
    const e=document.querySelector('input[placeholder="usuario@ejemplo.com"]'); const c=document.querySelector('input[type=password]'); if(!e||!c) return 'sin formulario';
    set(e, ${JSON.stringify(process.env.TV_CORREO)}); set(c, ${JSON.stringify(process.env.TV_CLAVE)}); e.form.requestSubmit(); return 'enviado';})()`, true));
  await p.pausa(8000); await p.ir('https://technoverse-cr.technoversecr.workers.dev' + ruta, 9000);
  dentro = await p.ev(`location.pathname.startsWith('/admin') && !document.querySelector('input[type=password]')`);
}
console.log('en', await p.ev('location.pathname'), 'sesión:', dentro);
p.cerrar(); process.exit(0);
