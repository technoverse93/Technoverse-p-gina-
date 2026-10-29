// Control de una pestaña del Chrome de la tablet por CDP (puerto 9333), con tiempos límite y actividad real.
import fs from 'node:fs';
export async function conectar(id) {
  const ws = new WebSocket('ws://127.0.0.1:' + (process.env.PUERTO || '9333') + '/devtools/page/' + id); let n = 0; const pend = {}; const errores = []; const red = [];
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d.result ?? d.error); delete pend[d.id]; return; }
    const P = d.params || {};
    if (d.method === 'Runtime.exceptionThrown') errores.push('EXC ' + (P.exceptionDetails.exception?.description || P.exceptionDetails.text || '').slice(0, 220));
    if (d.method === 'Runtime.consoleAPICalled' && P.type === 'error') errores.push('CONSOLE ' + P.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 220));
    if (d.method === 'Network.responseReceived' && P.response.status >= 400) red.push(P.response.status + ' ' + P.response.url.slice(0, 140)); };
  await new Promise((r, x) => { ws.onopen = r; setTimeout(() => x(new Error('ws sin respuesta')), 10000); });
  const send = (method, params = {}, t = 25000) => Promise.race([new Promise(r => { const i = ++n; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); }), new Promise(r => setTimeout(() => r({ timeout: method }), t))]);
  for (const x of ['Page.enable', 'Network.enable', 'Runtime.enable']) await send(x);
  const mover = () => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5 + Math.random() * 10, y: 300 }, 3000);
  await mover(); const latido = setInterval(mover, 20000);
  const ev = async (e, gesto = false) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true, userGesture: gesto }); return r?.result?.value ?? r?.exceptionDetails?.exception?.description ?? r; };
  const foto = async (archivo) => { const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 60 }); if (r?.data) fs.writeFileSync(archivo, Buffer.from(r.data, 'base64')); return !!r?.data; };
  const pausa = ms => new Promise(r => setTimeout(r, ms));
  const ir = async (url, espera = 7000) => { await send('Page.navigate', { url }); await pausa(espera); };
  return { send, ev, foto, pausa, ir, errores, red, cerrar: () => { clearInterval(latido); ws.close(); } };
}
