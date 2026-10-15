// =====================================================================
// RENOMBRAR LOS PDF DE COMPROBANTES YA EMITIDOS (los viejos tienen nombre adivinable)
// =====================================================================
// Los PDF nuevos llevan un sufijo aleatorio (`FE-<consecutivo>-<16 hex>.pdf`). Los emitidos antes se
// llaman `FE-<consecutivo>.pdf`: como los consecutivos van seguidos, cualquiera podía recorrerlos y bajar
// las facturas de todos (nombre, cédula, correo, artículos). Este script los mueve a un nombre aleatorio y
// actualiza `invoices.pdf_url`. NO borra nada: `move` conserva el archivo y el viejo enlace deja de existir.
//
//   SUPABASE_SERVICE_ROLE_KEY=… node scripts/renombrar-facturas-publicas.mjs            # solo muestra qué haría
//   SUPABASE_SERVICE_ROLE_KEY=… node scripts/renombrar-facturas-publicas.mjs --aplicar  # lo hace
//
// La llave de servicio la tiene el dueño (Supabase → Project Settings → API). NO se pega en el chat ni se
// guarda en el repo: se pasa por variable de entorno al correr el script, en tu computadora.
// OJO: los correos ya enviados con el enlace viejo dejarán de abrir el PDF (el comprobante sigue en el sistema).
// =====================================================================

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL_BASE = (process.env.SUPABASE_URL || readFileSync(join(RAIZ, 'src/supabaseClient.ts'), 'utf8').match(/supabaseUrl\s*=\s*'([^']+)'/)?.[1] || '').replace(/\/$/, '');
const LLAVE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APLICAR = process.argv.includes('--aplicar');
if (!URL_BASE || !LLAVE) { console.error('Falta SUPABASE_SERVICE_ROLE_KEY (y/o la URL).'); process.exit(1); }

const H = { apikey: LLAVE, Authorization: `Bearer ${LLAVE}`, 'Content-Type': 'application/json' };
const api = async (ruta, opciones = {}) => {
  const r = await fetch(`${URL_BASE}${ruta}`, { headers: H, ...opciones });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* texto */ }
  if (!r.ok) throw new Error(`${ruta} → ${r.status} ${t.slice(0, 200)}`);
  return j;
};

const facturas = await api('/rest/v1/invoices?select=id,pdf_url&pdf_url=not.is.null&limit=1000');
const viejas = facturas.filter(f => /\/object\/public\/invoices\/FE-\d{20}\.pdf$/.test(f.pdf_url || ''));
console.log(`${facturas.length} facturas con PDF; ${viejas.length} con nombre adivinable.`);

for (const f of viejas) {
  const origen = `${f.id}.pdf`;
  const destino = `${f.id}-${randomBytes(8).toString('hex')}.pdf`;
  const nuevaUrl = f.pdf_url.replace(origen, destino);
  console.log(`${APLICAR ? '→' : '(prueba)'} ${origen}  ⇒  ${destino}`);
  if (!APLICAR) continue;
  await api('/storage/v1/object/move', { method: 'POST', body: JSON.stringify({ bucketId: 'invoices', sourceKey: origen, destinationKey: destino }) });
  await api(`/rest/v1/invoices?id=eq.${encodeURIComponent(f.id)}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ pdf_url: nuevaUrl }) });
}
console.log(APLICAR ? 'Listo.' : 'Era una prueba: agrega --aplicar para hacerlo de verdad.');
