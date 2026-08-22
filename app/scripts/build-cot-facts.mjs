#!/usr/bin/env node
// app/scripts/build-cot-facts.mjs
//
// Bundles the COT analytics CLI entry (src/pages/cot/cotFactsEntry.js) into
// ONE self-contained Node script, dist/cot-facts.cjs, so the Python backend
// can run the same positioning analytics the browser runs (cotCompose.js) —
// one authority, no Python port. esbuild is already here as vite's bundler.
//
//   node scripts/build-cot-facts.mjs              → dist/cot-facts.cjs
//   node scripts/build-cot-facts.mjs --out <path> → <path>
//
// Wired into `npm run build` AFTER `vite build` — vite empties dist/ first,
// so the order is load-bearing. The bundle sits at dist/cot-facts.cjs, never
// under dist/assets/, so the web build's hashed-asset layout is untouched.
import * as esbuild from 'esbuild'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const ENTRY = resolve(APP_DIR, 'src', 'pages', 'cot', 'cotFactsEntry.js')
export const DEFAULT_OUTFILE = resolve(APP_DIR, 'dist', 'cot-facts.cjs')

/**
 * Build the bundle.
 * @param {{ outfile?: string, logLevel?: string }} [opts]
 * @returns {Promise<string>} the outfile written
 */
export async function buildCotFacts({ outfile = DEFAULT_OUTFILE, logLevel = 'info' } = {}) {
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
    // The entry runs its CLI only when this sentinel is stamped in; a plain
    // import of the entry (vitest, the app) leaves it undefined.
    define: { __COT_FACTS_CLI__: 'true' },
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

// Ran as `node scripts/build-cot-facts.mjs`, or merely imported? Compare file
// URLs — pathToFileURL normalises Windows drive letters and backslashes —
// case-folded on win32, where the shell may hand us either case.
function isMain() {
  if (!process.argv[1]) return false
  const here = import.meta.url
  const argv1 = pathToFileURL(resolve(process.argv[1])).href
  return process.platform === 'win32' ? here.toLowerCase() === argv1.toLowerCase() : here === argv1
}

if (isMain()) {
  try {
    const { outfile } = parseArgs(process.argv.slice(2))
    await buildCotFacts({ outfile })
    console.log(`cot-facts: wrote ${outfile}`)
  } catch (e) {
    console.error(`cot-facts: ${e.message}`)
    process.exitCode = 1
  }
}
