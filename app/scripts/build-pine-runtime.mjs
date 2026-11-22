// app/scripts/build-pine-runtime.mjs
//
// Bundles the runtime's server entry (src/components/chart/engine/runtime/serverEntry.js)
// into ONE self-contained ES module, dist-server/pine-runtime.mjs, that imports under bare
// `node` with no node_modules (docs/pine/SERVER-RUNTIME-DESIGN.md H2/H3, task T1):
//   - `jsep` and every JSON import are inlined (esbuild does this, as vite does for the browser);
//   - `import.meta.env` is baked ONCE, at build time, from the process's VITE_* variables, the
//     same ARG/ENV values the client build sees: one value, never a second authority at run time;
//     W5-INT: ONLY the names on SERVER_BUNDLE_VITE_NAMES (the non-secret build constants the
//     closure reads). `define` inlines the WHOLE object at every `import.meta.env` read, so baking
//     every VITE_* would put web's VITE_CHART_RENDER_TOKEN / VITE_PICOVOICE_ACCESS_KEY values into
//     pine-runtime.mjs. A rail (serverBundle.rail.test.js) builds with such values set and greps
//     the bundle: any VITE_ name off this list, or any secret value, is red;
//   - a manifest (pine-runtime.manifest.json) records bytes, sha256, module count and the baked
//     VITE_* names, which the host-parity digest's "bundle sha256" reads.
//
//   node scripts/build-pine-runtime.mjs              -> dist-server/pine-runtime.mjs
//   node scripts/build-pine-runtime.mjs --out <path> -> <path> (+ <path minus .mjs>.manifest.json)
//
// Not wired into `npm run build` here (T1 is the build script only; the Docker stage is T10).
import * as esbuild from 'esbuild'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const ENTRY = resolve(APP_DIR, 'src', 'components', 'chart', 'engine', 'runtime', 'serverEntry.js')
export const DEFAULT_OUTFILE = resolve(APP_DIR, 'dist-server', 'pine-runtime.mjs')

/** W5-INT: the ONLY VITE_* names the server bundle may bake. Each is a non-secret build constant (a
 *  '1'/unset feature flag) that the bundle's closure READS (the rail holds this list equal to the
 *  VITE_ names in the built bundle, so it can neither miss a read nor carry a stale name). A secret
 *  (a token, a key) never goes here: the service needs none. Dockerfile ARGs and server.mjs
 *  ENV_ALLOWLIST name exactly these (tests/test_pine_runtime_dockerfile.py). */
export const SERVER_BUNDLE_VITE_NAMES = Object.freeze([
  'VITE_PINE_LOWER_TF_ENABLED', // engine/lowerTfGate.js: lower-timeframe serving (default off)
  'VITE_PINE_RUNTIME_PANE_ENABLED', // engine/runtimePaneGate.js: the runtime pane build flag (default off)
])

/** The VITE_* variables baked into `import.meta.env`: the allowlisted ones that are set, sorted. */
export function viteEnvOf(env = process.env) {
  const out = {}
  for (const k of Object.keys(env).filter((n) => SERVER_BUNDLE_VITE_NAMES.includes(n)).sort()) out[k] = String(env[k])
  return out
}

/** The whole esbuild `define` set: nothing but the allowlisted VITE_* and vite's four mode constants. */
export function defineOf(env = process.env) {
  return { 'import.meta.env': JSON.stringify({ ...viteEnvOf(env), MODE: 'production', DEV: false, PROD: true, SSR: true }) }
}

/**
 * Build the bundle.
 * @param {{ outfile?: string, logLevel?: string, env?: object }} [opts]
 * @returns {Promise<{outfile:string, manifestFile:string, manifest:object}>}
 */
export async function buildPineRuntime({ outfile = DEFAULT_OUTFILE, logLevel = 'warning', env = process.env } = {}) {
  mkdirSync(dirname(outfile), { recursive: true })
  const viteEnv = viteEnvOf(env)
  const define = defineOf(env)
  const result = await esbuild.build({
    entryPoints: [ENTRY],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    minify: false,
    sourcemap: false,
    metafile: true,
    logLevel,
    // vite's own shape for the flags the closure reads (`import.meta.env.VITE_X === '1'`).
    define,
  })
  const bytes = readFileSync(outfile)
  const manifest = {
    entry: 'src/components/chart/engine/runtime/serverEntry.js',
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    modules: Object.keys(result.metafile.inputs).length,
    viteEnvNames: Object.keys(viteEnv),
  }
  const manifestFile = outfile.replace(/\.mjs$/, '') + '.manifest.json'
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 1)}\n`)
  return { outfile, manifestFile, manifest }
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

function isMain() {
  if (!process.argv[1]) return false
  const here = import.meta.url
  const argv1 = pathToFileURL(resolve(process.argv[1])).href
  return process.platform === 'win32' ? here.toLowerCase() === argv1.toLowerCase() : here === argv1
}

if (isMain()) {
  try {
    const { outfile } = parseArgs(process.argv.slice(2))
    const { manifest } = await buildPineRuntime({ outfile })
    console.log(`pine-runtime: wrote ${outfile} (${manifest.bytes} bytes, ${manifest.modules} modules, sha256 ${manifest.sha256.slice(0, 12)})`)
  } catch (e) {
    console.error(`pine-runtime: ${e.message}`)
    process.exitCode = 1
  }
}
