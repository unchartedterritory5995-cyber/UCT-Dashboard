#!/usr/bin/env node
// MG-7 — render the code-derived coexistence parity matrix for `/calendar` -> UCT Terminal.
//
//   node tools/terminal_parity_matrix.mjs           # write the doc
//   node tools/terminal_parity_matrix.mjs --check   # exit 1 if the doc is stale
//
// The derivation lives in app/src/pages/terminal/parityMatrix.js (so the vitest rail and this
// tool run the same code); this file only reads the sources and writes the markdown.
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(REPO, 'app', 'src')
const mod = await import(pathToFileURL(path.join(SRC, 'pages', 'terminal', 'parityMatrix.js')).href)

const src = Object.fromEntries(Object.entries(mod.SOURCE_FILES)
  .map(([k, rel]) => [k, readFileSync(path.join(SRC, rel), 'utf8')]))
const derived = mod.deriveRows(src)
const md = mod.renderMarkdown(derived)
const out = path.join(REPO, mod.DOC_PATH)

if (process.argv.includes('--check')) {
  let cur = ''
  try { cur = readFileSync(out, 'utf8').replace(/\r\n/g, '\n') } catch { /* missing */ }
  if (cur !== md) {
    console.error(`STALE: ${mod.DOC_PATH} — run node tools/terminal_parity_matrix.mjs`)
    process.exit(1)
  }
  console.log('parity matrix: up to date')
} else {
  writeFileSync(out, md)
  const n = (v) => derived.rows.filter((r) => r.verdict === v).length
  console.log(`wrote ${mod.DOC_PATH}: ${derived.rows.length} rows, CARRIED ${n('CARRIED')}, `
    + `UNAFFECTED ${n('UNAFFECTED')}, GAP ${n('GAP')}`)
}
