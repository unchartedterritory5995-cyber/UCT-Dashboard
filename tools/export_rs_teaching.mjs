// tools/export_rs_teaching.mjs
//
// Writes `api/data/rs_teaching.json` from the ONE authored source,
// `app/src/content/rs/teaching.js` (Phase 4, unit 4-02).
//
//   node tools/export_rs_teaching.mjs           # write the file
//   node tools/export_rs_teaching.mjs --check   # exit 1 if the committed file is stale
//
// ⭐ IT RUNS THE SHIPPED MODULE, NOT A COPY. `teaching.js` reads the readout cards
// from the registered `rsLine` definition, so the bundle pulls in the chart engine.
// The engine uses vite-style imports (extensionless paths), so the module is bundled
// with the esbuild already in `app/node_modules` (the `tools/converse_eval.py` and
// `app/scripts/build-cot-facts.mjs` precedent) and imported from a temp directory.
//
// ⭐ THE TEXT IS `serializeTeachingExport()`'s, so this tool and the vitest rail
// (`app/src/content/rs/teaching.export.test.js`) cannot disagree about formatting:
// keys sorted at every level, two-space indent, LF, one trailing newline.
//
// ⛔ Python reads the JSON, never `app/src`.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP = path.join(REPO, 'app')
const ENTRY = path.join(APP, 'src', 'content', 'rs', 'teaching.js')
export const OUT = path.join(REPO, 'api', 'data', 'rs_teaching.json')

async function loadTeaching() {
  const appRequire = createRequire(pathToFileURL(path.join(APP, 'package.json')))
  const esbuild = appRequire('esbuild')
  const dir = mkdtempSync(path.join(os.tmpdir(), 'rs-teaching-'))
  const outfile = path.join(dir, 'teaching.bundle.mjs')
  try {
    await esbuild.build({
      entryPoints: [ENTRY], outfile, bundle: true, platform: 'node', format: 'esm', target: 'node20',
      absWorkingDir: APP, logLevel: 'error',
      loader: { '.js': 'jsx', '.jsx': 'jsx', '.css': 'empty', '.png': 'empty', '.svg': 'empty', '.woff2': 'empty' },
      jsx: 'automatic',
      define: { 'import.meta.env': JSON.stringify({ MODE: 'production', DEV: false, PROD: true, SSR: false, BASE_URL: '/' }) },
      banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    })
    return await import(pathToFileURL(outfile).href)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function main(argv) {
  const check = argv.includes('--check')
  const unknown = argv.filter((a) => a !== '--check')
  if (unknown.length) throw new Error(`unknown argument(s): ${unknown.join(' ')}`)
  const { serializeTeachingExport } = await loadTeaching()
  const text = serializeTeachingExport()
  if (check) {
    let current = ''
    try { current = readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') } catch { /* missing reads as stale */ }
    if (current !== text) {
      console.error(`${path.relative(REPO, OUT)} is stale: run node tools/export_rs_teaching.mjs`)
      process.exit(1)
    }
    console.log(`${path.relative(REPO, OUT)} is current`)
    return
  }
  writeFileSync(OUT, text, { encoding: 'utf8' })
  const obj = JSON.parse(text)
  console.log(`wrote ${path.relative(REPO, OUT)}: ${obj.glossary.length} terms, `
    + `${obj.misconceptions.length} misconceptions, ${obj.tour.length} tour cards, `
    + `${Object.keys(obj.cards).length} readout cards`)
}

await main(process.argv.slice(2))
