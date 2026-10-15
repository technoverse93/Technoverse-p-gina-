// =====================================================================
// PRUEBA DE LA API PÚBLICA: lo que un visitante sin sesión NO debe poder ver
// =====================================================================
// `npm run probar-api` — con la llave PÚBLICA (la misma que lleva el navegador, ver src/supabaseClient.ts)
// hace SOLO lecturas (GET) contra la API de Supabase y FALLA (código 1) si un visitante anónimo puede:
//   · leer filas de las tablas privadas (clientes, pedidos, facturas, chats, huellas, ubicaciones…);
//   · leer la dirección secreta del webhook de Instagram (`app_settings.instagram_webhook_url`);
//   · listar los archivos del bucket de comprobantes (con eso se pueden bajar las facturas de todos);
//   · ver, en el esquema público de la API, funciones de mantenimiento que solo debe llamar el servidor.
//
// NUNCA llama a una función (RPC): una función expuesta se EJECUTARÍA al probarla, y algunas borran datos.
// Por eso lo del esquema se ve en la lista de funciones (OpenAPI), no llamándolas. OJO: Supabase NO entrega
// ese esquema con la llave publicable (responde 401, comprobado en el CI del 2026-10-15), así que esa
// comprobación queda como aviso; las funciones expuestas se revisan con el asesor de seguridad de Supabase
// (`get_advisors`) y con las pruebas SQL de supabase/pruebas/.
//
// Sin dependencias (fetch de Node 22). Variables opcionales: SUPABASE_URL y SUPABASE_ANON_KEY (si no,
// se leen de src/supabaseClient.ts).
// =====================================================================

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const cliente = readFileSync(join(RAIZ, 'src/supabaseClient.ts'), 'utf8');
const URL_BASE = (process.env.SUPABASE_URL || cliente.match(/supabaseUrl\s*=\s*'([^']+)'/)?.[1] || '').replace(/\/$/, '');
const LLAVE = process.env.SUPABASE_ANON_KEY || cliente.match(/supabaseKey\s*=\s*'([^']+)'/)?.[1] || '';
if (!URL_BASE || !LLAVE) { console.error('✗ No encontré la URL o la llave pública de Supabase.'); process.exit(1); }

const CABECERAS = { apikey: LLAVE, Authorization: `Bearer ${LLAVE}`, Accept: 'application/json' };

// Tablas que un anónimo NO puede leer (todas tienen RLS de «lo mío o personal»).
const TABLAS_PRIVADAS = [
  'profiles', 'orders', 'invoices', 'payments', 'client_profiles', 'chat_messages', 'chat_conversations',
  'marketing_requests', 'legal_privacy_settings', 'known_devices', 'visitor_fingerprints',
  'supervision_visitantes', 'supervision_events', 'supervision_state', 'ubicaciones_compartidas', 'visitor_visit_log',
];

// Funciones que NO deben aparecer en la API pública (anon).
const FUNCIONES_PROHIBIDAS = [
  'purgar_huellas', 'purgar_retos_webauthn', 'conteo_historial', 'banear_cliente_total', 'banear_dispositivo',
  'levantar_baneo_cliente', 'levantar_dispositivo', 'purgar_bitacora', 'purgar_chats', 'purgar_conversacion',
  'borrar_mensaje_chat', 'admin_list_duenos', 'admin_reset_security_pin', 'dlp_fijar', 'dlp_listar', 'visitante_mirar',
  'limitar_uso', 'es_visitante',
];

const fallos = [];
const notas = [];
let comprobaciones = 0;

async function pedir(ruta, opciones = {}) {
  for (let intento = 1; ; intento++) {
    try {
      const r = await fetch(`${URL_BASE}${ruta}`, { headers: CABECERAS, signal: AbortSignal.timeout(15000), ...opciones });
      const texto = await r.text();
      let json = null; try { json = JSON.parse(texto); } catch { /* no era JSON */ }
      return { estado: r.status, json, texto };
    } catch (e) {
      if (intento >= 2) throw e;
    }
  }
}

try {
  // 1. Tablas privadas: o error (401/403/404) o lista vacía. Nunca filas.
  for (const t of TABLAS_PRIVADAS) {
    comprobaciones++;
    const { estado, json } = await pedir(`/rest/v1/${t}?select=*&limit=1`);
    if (estado === 200 && Array.isArray(json) && json.length > 0) fallos.push(`un anónimo LEE filas de «${t}»`);
  }

  // 2. El webhook de Instagram no es legible.
  comprobaciones++;
  {
    const { estado, json } = await pedir('/rest/v1/app_settings?select=instagram_webhook_url&limit=1');
    if (estado === 200 && Array.isArray(json) && json.some(f => f && f.instagram_webhook_url)) {
      fallos.push('un anónimo LEE app_settings.instagram_webhook_url (dirección secreta de Zapier): aplica supabase/migracion_ajustes_privados.sql y rota el Zap');
    }
  }

  // 3. El bucket de comprobantes no se puede listar.
  comprobaciones++;
  {
    const { estado, json } = await pedir('/storage/v1/object/list/invoices', {
      method: 'POST', headers: { ...CABECERAS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: '', limit: 5 }),
    });
    if (estado === 200 && Array.isArray(json) && json.length > 0) fallos.push('un anónimo LISTA los archivos del bucket «invoices» (se pueden recorrer todas las facturas)');
  }

  // 4. Funciones de mantenimiento expuestas (solo se mira la lista, no se llama a ninguna).
  comprobaciones++;
  {
    const { estado, json } = await pedir('/rest/v1/');
    if (estado === 200 && json && json.paths) {
      const expuestas = Object.keys(json.paths).filter(p => p.startsWith('/rpc/')).map(p => p.slice(5));
      for (const f of FUNCIONES_PROHIBIDAS) if (expuestas.includes(f)) fallos.push(`la función «${f}» está expuesta a anónimos`);
    } else {
      notas.push(`el esquema de la API no está disponible con la llave pública (estado ${estado}): bien, y no se pudo revisar la lista de funciones`);
    }
  }
} catch (e) {
  console.error(`✗ No se pudo completar la prueba (${e?.message || e}). Se considera fallo: reintenta.`);
  process.exit(1);
}

for (const n of notas) console.warn(`ℹ ${n}`);
if (fallos.length) {
  for (const f of fallos) console.error(`✗ ${f}`);
  console.error(`\n${fallos.length} problema(s) de exposición pública.`);
  process.exit(1);
}
console.log(`✓ ${comprobaciones} comprobaciones de la API pública: un visitante anónimo no ve nada privado.`);
