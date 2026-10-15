// =====================================================================
// VALIDADOR DE CONTRASTE DE LAS PALETAS (WCAG AA)
// =====================================================================
// `npm run paletas` — lee los tokens de color de src/index.css (Esmeralda,
// la paleta de siempre: bloques `:root` y `.dark`) y de src/styles/paletas.css
// (Océano, Atardecer y Orquídea, cada una en claro y oscuro), calcula el
// contraste de cada par que la app realmente usa y FALLA (código de salida 1) si
// alguno baja del mínimo:
//   · 4,5:1 para todo texto (también el «apagado» y el de las insignias);
//   · 3:1 para el acento usado como borde o foco sobre las superficies.
//
// Existe porque el texto «verde traslúcido» que no se leía venía de tokens
// escritos a ojo (el gris «apagado» daba 3,0:1). Con esto un color nuevo que
// no se lee no llega a producción: se corre antes de fusionar (y en el CI).
//
// No instala nada: es JavaScript puro de Node.
// =====================================================================

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const leer = ruta => readFileSync(join(RAIZ, ruta), 'utf8');

// ---- lectura de bloques de tokens -------------------------------------
/** Tokens `--nombre: valor;` de UN bloque cuyo selector es exactamente `selector`. */
function bloque(css, selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|[\\n}])\\s*${esc}\\s*(?:,[^{]*)?\\{([^}]*)\\}`);
  const m = css.match(re);
  if (!m) throw new Error(`No encontré el bloque «${selector}»`);
  const tokens = {};
  for (const t of m[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) tokens[t[1]] = t[2].trim();
  return tokens;
}

const indexCss = leer('src/index.css');
const paletasCss = leer('src/styles/paletas.css');

const base = {
  claro: bloque(indexCss, ':root'),
  oscuro: bloque(indexCss, '.dark'),
};
// El bloque oscuro de index.css solo trae lo que cambia: completa con el claro.
base.oscuro = { ...base.claro, ...base.oscuro };

const PALETAS = {
  esmeralda: { claro: base.claro, oscuro: base.oscuro },
};
for (const id of ['oceano', 'atardecer', 'orquidea']) {
  PALETAS[id] = {
    claro: { ...base.claro, ...bloque(paletasCss, `:root[data-paleta="${id}"]`) },
    oscuro: { ...base.oscuro, ...bloque(paletasCss, `:root.dark[data-paleta="${id}"]`) },
  };
}

// ---- contraste ---------------------------------------------------------
const hex = h => {
  const m = /^#([0-9a-f]{6})$/i.exec(h || '');
  if (!m) return null;
  return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
};
const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const lum = c => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const ratio = (a, b) => {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

// Superficies sobre las que se escribe texto.
const SUPERFICIES = ['--bg-base', '--bg-surface', '--bg-elevated', '--bg-sunken', '--tile'];

/** [descripción, color del texto, fondos, mínimo] */
function pares(t) {
  const p = [];
  const sobre = (nombre, fg, fondos, min) => p.push([nombre, fg, fondos, min]);
  sobre('texto principal', '--text-primary', SUPERFICIES.concat('--gold-soft'), 4.5);
  sobre('texto secundario', '--text-secondary', SUPERFICIES.concat('--gold-soft'), 4.5);
  sobre('texto apagado', '--text-muted', SUPERFICIES.concat('--gold-soft'), 4.5);
  sobre('acento como texto', '--accent', SUPERFICIES.concat('--gold-soft'), 4.5);
  sobre('acento 2 como texto', '--accent-2', ['--bg-base', '--bg-surface', '--bg-sunken', '--accent-2-soft'], 4.5);
  sobre('tinta sobre acento (botón)', '--accent-ink', ['--accent', '--accent-hover'], 4.5);
  sobre('tinta sobre acento 2 (insignia)', '--accent-2-ink', ['--accent-2'], 4.5);
  sobre('burbuja entrante', '--bubble-in-ink', ['--bubble-in'], 4.5);
  sobre('hora en burbuja entrante', '--bubble-in-meta', ['--bubble-in'], 4.5);
  sobre('burbuja saliente', '--bubble-out-ink', ['--bubble-out'], 4.5);
  sobre('hora en burbuja saliente', '--bubble-out-meta', ['--bubble-out'], 4.5);
  sobre('chip activo', '--chip-on-ink', ['--chip-on-bg'], 4.5);
  sobre('éxito', '--ok', ['--ok-soft', '--bg-surface'], 4.5);
  sobre('aviso', '--warn', ['--warn-soft', '--bg-surface'], 4.5);
  sobre('insignia roja sólida', '--danger-ink', ['--danger-solid'], 4.5);
  sobre('peligro como texto', '--danger-text', ['--bg-surface', '--bg-base', '--bg-sunken'], 4.5);
  sobre('acento como borde/foco', '--accent', ['--bg-surface', '--bg-base'], 3);
  return p;
}

let fallos = 0;
let comprobados = 0;

// Un token que el bloque CLARO de una paleta define y el OSCURO no, se «filtra» al
// modo oscuro (el selector claro también aplica allí): el borde de las tarjetas se
// volvería casi invisible. Cada bloque oscuro tiene que definir todo lo que define el claro.
for (const id of ['oceano', 'atardecer', 'orquidea']) {
  const claro = bloque(paletasCss, `:root[data-paleta="${id}"]`);
  const oscuro = bloque(paletasCss, `:root.dark[data-paleta="${id}"]`);
  for (const k of Object.keys(claro)) {
    if (!(k in oscuro)) { console.error(`✗ ${id}: ${k} está en el bloque claro pero no en el oscuro (se filtraría al modo oscuro)`); fallos++; }
  }
}
// La copia de Esmeralda para las miniaturas tiene que ser idéntica a la real.
for (const [modo, sel] of [['claro', '[data-paleta-muestra="esmeralda"][data-modo="claro"]'], ['oscuro', '[data-paleta-muestra="esmeralda"][data-modo="oscuro"]']]) {
  const copia = bloque(paletasCss, sel);
  for (const [k, val] of Object.entries(copia)) {
    if ((base[modo][k] || '').toUpperCase() !== val.toUpperCase()) {
      console.error(`✗ esmeralda/${modo}: la miniatura dice ${k}: ${val} pero index.css dice ${base[modo][k]}`); fallos++;
    }
  }
}

const tabla = [];
for (const [id, modos] of Object.entries(PALETAS)) {
  for (const [modo, t] of Object.entries(modos)) {
    let peor = { r: 99, n: '' };
    for (const [nombre, fgK, fondosK, min] of pares(t)) {
      const fg = hex(t[fgK]);
      if (!fg) { console.error(`✗ ${id}/${modo}: ${fgK} no es un #RRGGBB (${t[fgK]})`); fallos++; continue; }
      for (const bgK of fondosK) {
        const bg = hex(t[bgK]);
        if (!bg) { console.error(`✗ ${id}/${modo}: ${bgK} no es un #RRGGBB (${t[bgK]})`); fallos++; continue; }
        const r = ratio(fg, bg);
        comprobados++;
        if (r < peor.r) peor = { r, n: `${nombre} (${fgK} / ${bgK})` };
        if (r < min) {
          fallos++;
          console.error(`✗ ${id}/${modo}: ${nombre} → ${fgK} ${t[fgK]} sobre ${bgK} ${t[bgK]} = ${r.toFixed(2)}:1 (mínimo ${min}:1)`);
        }
      }
    }
    tabla.push(`${id.padEnd(10)} ${modo.padEnd(7)} peor par: ${peor.r.toFixed(2)}:1  ${peor.n}`);
  }
}

console.log(tabla.join('\n'));
if (fallos) {
  console.error(`\n${fallos} par(es) por debajo del mínimo AA de ${comprobados} comprobados.`);
  process.exit(1);
}
console.log(`\n✓ ${comprobados} pares de color comprobados: todos cumplen WCAG AA.`);
