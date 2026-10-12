#!/usr/bin/env bash
# =====================================================================
# VERIFICA LAS REGLAS DE HOOKS DE REACT (antes de publicar nada)
# =====================================================================
# Un hook llamado después de un `return` o dentro de una condición hace que React
# desmonte TODA la app cuando cambia lo que se pinta («Rendered more hooks than
# during the previous render», error #310) y en el teléfono queda la pantalla
# oscura. Pasó con el panel (AdminPanel): su pantalla de espera estaba antes de
# seis hooks, y fallaba solo cuando el perfil llegaba después del código del panel.
#
# Esto corre ESLint con UNA sola regla (react-hooks/rules-of-hooks) sobre src/. Las
# herramientas se instalan en una carpeta temporal, fuera del proyecto: no tocan
# package.json ni node_modules. Sale con error si hay una sola violación.
#
# Uso: bash scripts/verificar-hooks.sh
# =====================================================================
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cd "$TMP"
npm init -y >/dev/null 2>&1
npm install --no-audit --no-fund --silent \
  eslint@9.39.5 eslint-plugin-react-hooks@5.2.0 @typescript-eslint/parser@8.71.1 typescript@5.9.3

cat > eslint.config.mjs <<'CONFIG'
import tsParser from '@typescript-eslint/parser';
import hooks from 'eslint-plugin-react-hooks';
export default [
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module' } },
    plugins: { 'react-hooks': hooks },
    // Solo se mira esta regla; los comentarios `eslint-disable` del código son de otras reglas y se ignoran.
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'off' },
    rules: { 'react-hooks/rules-of-hooks': 'error' },
  },
];
CONFIG

cd "$RAIZ"
echo "Revisando las reglas de hooks de React en src/ …"
node "$TMP/node_modules/eslint/bin/eslint.js" -c "$TMP/eslint.config.mjs" --no-warn-ignored --quiet src
echo "Hooks en orden: ninguna violación."
