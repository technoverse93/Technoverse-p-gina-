#!/usr/bin/env node
// =====================================================================
// MAPA DEL CÓDIGO PARA JAVIER
// =====================================================================
// Javier no sabía cómo está hecho el sistema: ante «¿cómo funciona el
// cobro?» o «¿por qué falla la huella?» adivinaba o se iba a internet. Casi
// todos los archivos empiezan con un comentario que explica qué hacen; este
// script los junta en `supabase/functions/asistente-ia/mapa-codigo.ts`
// (ruta, título y resumen de cada archivo). La función de Javier lo trae
// consigo: busca ahí primero (sin GitHub ni internet) y después lee el
// archivo exacto con repo_leer si hace falta.
//
// Uso: node scripts/mapa-codigo.mjs   (también: npm run mapa)
// Con --verificar falla si el mapa guardado quedó viejo (para el CI).
// =====================================================================
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const SALIDA = 'supabase/functions/asistente-ia/mapa-codigo.ts';
const PATRONES = [
  'src/**/*.ts', 'src/**/*.tsx', 'src/*.ts', 'src/*.tsx',
  'supabase/functions/**/*.ts', 'supabase/*.sql', 'native-android/**/*.java',
  'public/arranque.js', 'scripts/*.sh', 'scripts/*.mjs', '.github/workflows/*.yml',
];
const FUERA = [/\.d\.ts$/, /mapa-codigo\.ts$/, /\.test\.[jt]sx?$/];
const MAX_RESUMEN = 420;

const archivos = execSync(`git ls-files ${PATRONES.map(p => `'${p}'`).join(' ')}`, { encoding: 'utf8' })
  .split('\n').filter(Boolean).filter(f => !FUERA.some(r => r.test(f))).sort();

/** El primer bloque de comentarios del archivo, sin adornos. */
function cabecera(texto, ruta) {
  const lineas = texto.split('\n').slice(0, 80);
  const out = [];
  let enBloque = false, empezo = false;
  for (const crudo of lineas) {
    const l = crudo.trim();
    if (!empezo && (l === '' || l.startsWith('#!') || l.startsWith('package ') || l.startsWith('import ') || l.startsWith('<?xml'))) continue;
    if (ruta.endsWith('.yml')) {
      if (l.startsWith('#')) { out.push(l.replace(/^#+\s?/, '')); empezo = true; continue; }
      if (empezo) break; else continue;
    }
    if (ruta.endsWith('.sql') || ruta.endsWith('.sh')) {
      if (l.startsWith('--') || l.startsWith('#')) { out.push(l.replace(/^(--|#)+\s?/, '')); empezo = true; continue; }
      if (empezo) break; else continue;
    }
    if (enBloque) {
      if (l.includes('*/')) { out.push(l.replace(/\*\/.*$/, '').replace(/^\*\s?/, '')); break; }
      out.push(l.replace(/^\*\s?/, ''));
      continue;
    }
    if (l.startsWith('/*')) { enBloque = true; empezo = true; const r = l.replace(/^\/\*+\s?/, ''); if (r.includes('*/')) { out.push(r.replace(/\*\/.*$/, '')); break; } if (r) out.push(r); continue; }
    if (l.startsWith('//')) { out.push(l.replace(/^\/\/+\s?/, '')); empezo = true; continue; }
    if (empezo) break;
    // Código antes de cualquier comentario: sin cabecera.
    break;
  }
  return out
    .map(x => x.replace(/^[=\-*~#]{4,}$/, '').trim())
    .filter(x => x && !/^[=\-*~#]+$/.test(x));
}

const mapa = [];
for (const ruta of archivos) {
  if (!existsSync(ruta)) continue;
  const lineas = cabecera(readFileSync(ruta, 'utf8'), ruta);
  if (!lineas.length) { mapa.push({ ruta, titulo: '', resumen: '' }); continue; }
  const titulo = lineas[0].slice(0, 120);
  let resumen = lineas.slice(1).join(' ').replace(/\s+/g, ' ').trim();
  if (resumen.length > MAX_RESUMEN) resumen = resumen.slice(0, resumen.lastIndexOf(' ', MAX_RESUMEN)) + '…';
  mapa.push({ ruta, titulo, resumen });
}

const contenido = `// GENERADO por scripts/mapa-codigo.mjs — no editar a mano (correr: npm run mapa).
// Qué hace cada archivo del sistema, sacado del comentario con que empieza.
// Javier lo usa para saber dónde buscar antes de leer el código (sistema_buscar).
export type EntradaMapa = { ruta: string; titulo: string; resumen: string };
export const MAPA_CODIGO: EntradaMapa[] = ${JSON.stringify(mapa, null, 0).replace(/\},\{/g, '},\n{')};
`;

if (process.argv.includes('--verificar')) {
  const actual = existsSync(SALIDA) ? readFileSync(SALIDA, 'utf8') : '';
  if (actual !== contenido) { console.error(`El mapa del código quedó viejo: corré «npm run mapa» y subí ${SALIDA}.`); process.exit(1); }
  console.log(`Mapa del código al día (${mapa.length} archivos).`);
} else {
  writeFileSync(SALIDA, contenido);
  console.log(`Mapa del código: ${mapa.length} archivos (${mapa.filter(m => m.titulo).length} con explicación) → ${SALIDA}`);
}
