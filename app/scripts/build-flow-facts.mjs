// NO SHEBANG, DELIBERATELY — see build-cot-facts.mjs for the 13 tests a `#!`
// line cost there. vitest's loader does not strip it; Node does not need it.
//
// app/scripts/build-flow-facts.mjs
//
// Bundles the Options Flow analytics CLI entry (src/pages/optionsFlow/
// flowFactsEntry.js) into ONE self-contained Node script, dist/flow-facts.cjs,
// so the Python backend can run the same aggregation the browser runs
// (flowCompute.js) — one authority, no Python port.
//
//   node scripts/build-flow-facts.mjs              → dist/flow-facts.cjs
//   node scripts/build-flow-facts.mjs --out <path> → <path>
//
// Wired into `npm run build` AFTER `vite build` — vite empties dist/ first, so
// the order is load-bearing. The bundle sits at dist/flow-facts.cjs, never
// under dist/assets/, so the web build's hashed-asset layout is untouched.
// Exactly the arrangement build-cot-facts.mjs already uses.
import * as esbuild from 'esbuild'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const ENTRY = resolve(APP_DIR, 'src', 'pages', 'optionsFlow', 'flowFactsEntry.js')
export const DEFAULT_OUTFILE = resolve(APP_DIR, 'dist', 'flow-facts.cjs')

/**
 * Build the bundle.
 * @param {{ outfile?: string, logLevel?: string }} [opts]
 * @returns {Promise<string>} the outfile written
 */
export async function buildFlowFacts({ outfile = DEFAULT_OUTFILE, logLevel = 'info' } = {}) {
  mkdirSync(dirname(outfile), { recursive: true })
  await esbuild.build({
    entryPoints: [ENTRY],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    minify: false,
    sourcemap: false,
    logLevel,
    // The entry self-runs ONLY when this sentinel is stamped in; a plain import
    // of the entry (vitest, the app) leaves it undefined.
    define: { __FLOW_FACTS_CLI__: 'true' },
  })
  return outfile
}

function parseArgs(argv) {
  let outfile = DEFAULT_OUTFILE
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') {
      const p = argv[i + 1]
      if (!p) throw new Error('--out needs a path')
      outfile = resolve(p)
      i++
    } else {
      throw new Error(`unknown argument "${argv[i]}"`)
    }
  }
  return { outfile }
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  const { outfile } = parseArgs(process.argv.slice(2))
  buildFlowFacts({ outfile })
    .then((f) => console.log(`flow-facts: wrote ${f}`))
    .catch((e) => {
      console.error(e)
      process.exitCode = 1
    })
}
