// =====================================================================
// BUSCADOR DE SECRETOS EN EL REPOSITORIO
// =====================================================================
// `npm run secretos` — recorre los archivos que git versiona y FALLA (código de salida 1) si encuentra
// algo que no debe estar en el código: llaves privadas, tokens de GitHub / Slack / AWS / IA / Meta /
// Supabase, direcciones de base de datos con contraseña, un JWT que no sea el `anon`, o archivos que
// no se suben nunca (.env, keystores).
//
// Lo PÚBLICO por diseño no falla: la llave publicable de Supabase (`sb_publishable_…`) y el JWT con
// `role: anon`. La llave web de Firebase (`AIza…`) tampoco falla, pero avisa: es pública, aunque tiene
// que estar restringida por dominio/app en la consola de Google.
//
// Existe porque la regla del proyecto es que NINGUNA llave secreta vive en el navegador ni en el repo
// (las de IA, WhatsApp/Meta, etc. se guardan como secretos de Supabase/Edge: `Deno.env.get(…)`).
// Corre en el CI de cada PR (.github/workflows/seguridad.yml). Sin dependencias: Node puro.
// =====================================================================

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

const EXCLUIR = [
  /^package-lock\.json$/,
  /^supabase\/functions\/asistente-ia\/mapa-codigo\.ts$/, // generado: copia comentarios del código
  /^supabase\/pruebas\//,                                  // datos de prueba con «secretos» inventados a propósito
  /\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf|otf|pdf|apk|aab|zip|gz|mp3|mp4|wasm|onnx|bin)$/i,
];

// [nombre, expresión, gravedad]  — «secreto» hace fallar; «aviso» solo informa.
const PATRONES = [
  ['llave privada (PEM)', /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/, 'secreto'],
  ['token de GitHub', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/, 'secreto'],
  ['token de Slack', /\bxox[abprs]-[A-Za-z0-9-]{10,}/, 'secreto'],
  ['llave de AWS', /\bAKIA[0-9A-Z]{16}\b/, 'secreto'],
  ['llave de IA (sk-…)', /\bsk-(?:ant-|proj-|or-v1-)?[A-Za-z0-9_-]{32,}\b/, 'secreto'],
  ['llave de Groq', /\bgsk_[A-Za-z0-9]{40,}\b/, 'secreto'],
  ['llave de NVIDIA', /\bnvapi-[A-Za-z0-9_-]{40,}\b/, 'secreto'],
  ['llave secreta de Supabase', /\bsb_secret_[A-Za-z0-9_-]{20,}\b/, 'secreto'],
  ['token personal de Supabase', /\bsbp_[a-f0-9]{40}\b/, 'secreto'],
  ['token de Meta / Facebook / WhatsApp', /\bEAA[A-Za-z0-9]{40,}\b/, 'secreto'],
  ['dirección secreta de Zapier', /hooks\.zapier\.com\/hooks\/catch\/\d+\/[A-Za-z0-9]{6,}/, 'secreto'],
  ['dirección de base de datos con contraseña', /\bpostgres(?:ql)?:\/\/[^:\s/@'"]+:[^@\s'"]{3,}@/, 'secreto'],
  ['llave web de Google/Firebase (pública, pero restríngela)', /\bAIza[0-9A-Za-z_-]{35}\b/, 'aviso'],
];
const RE_JWT = /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;

// Archivos que no se versionan nunca.
const PROHIBIDOS = [
  [/(^|\/)\.env(\.(?!example$)[^/]*)?$/, 'archivo .env con variables reales'],
  [/\.(keystore|jks|p12|pfx)$/i, 'llave de firma (keystore)'],
  [/(^|\/)(id_rsa|id_ed25519)$/, 'llave SSH privada'],
];
const AVISAR_ARCHIVO = [
  [/(^|\/)google-services\.json$/, 'google-services.json (lleva una llave web de Firebase: restríngela en la consola de Google)'],
  [/(^|\/)GoogleService-Info\.plist$/, 'GoogleService-Info.plist (idem)'],
];

const archivos = execFileSync('git', ['ls-files', '-z'], { cwd: RAIZ, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .split('\0').filter(Boolean);

const secretos = [];
const avisos = [];
const tapar = s => (s.length <= 10 ? '****' : s.slice(0, 6) + '…' + s.slice(-2));

for (const ruta of archivos) {
  for (const [re, que] of PROHIBIDOS) if (re.test(ruta)) secretos.push(`${ruta}: ${que}`);
  for (const [re, que] of AVISAR_ARCHIVO) if (re.test(ruta)) avisos.push(`${ruta}: ${que}`);
  if (EXCLUIR.some(re => re.test(ruta))) continue;

  let texto;
  try {
    if (statSync(join(RAIZ, ruta)).size > 3 * 1024 * 1024) continue;
    texto = readFileSync(join(RAIZ, ruta), 'utf8');
  } catch { continue; }
  if (texto.includes('\0')) continue; // binario

  const lineas = texto.split('\n');
  lineas.forEach((linea, i) => {
    if (linea.length > 4000 && !/eyJ|AIza|sk-|ghp_/.test(linea)) return; // fuentes embebidas, etc.
    for (const [nombre, re, gravedad] of PATRONES) {
      const m = linea.match(re);
      if (!m) continue;
      (gravedad === 'secreto' ? secretos : avisos).push(`${ruta}:${i + 1}: ${nombre} (${tapar(m[0])})`);
    }
    for (const m of linea.matchAll(RE_JWT)) {
      try {
        const carga = JSON.parse(Buffer.from(m[0].split('.')[1], 'base64url').toString('utf8'));
        // Solo el JWT de rol «anon» es público por diseño; cualquier otro rol (service_role…) es un secreto.
        if (carga.role !== 'anon') secretos.push(`${ruta}:${i + 1}: JWT con role «${carga.role ?? 'sin rol'}» (${tapar(m[0])})`);
      } catch { /* no era un JWT de verdad */ }
    }
  });
}

for (const a of avisos) console.warn(`⚠ ${a}`);
if (secretos.length) {
  for (const s of secretos) console.error(`✗ ${s}`);
  console.error(`\n${secretos.length} posible(s) secreto(s) en el repositorio. Si es real: sácalo del código, guárdalo como secreto de Supabase/Edge o de GitHub, y ROTA la llave (la que estuvo en git ya se considera filtrada).`);
  process.exit(1);
}
console.log(`✓ ${archivos.length} archivos revisados: sin secretos${avisos.length ? ` (${avisos.length} aviso(s))` : ''}.`);
