#!/usr/bin/env node
// Turn a client error report's stack into source files and lines (desktop speed plan 9.7).
//
// Since 2026-11-11 a frame in our own built code keeps its position in the report:
// `https://uctintelligence.com/assets/<chunk>.js:<line>:<col>` (errorBeacon.js `ownAssetPosition`, and the
// server's `_OWN_POSITION`).
//
// DEFAULT: production's own maps. The production build makes hidden source maps and keeps them out of the
// public mount (vite.config.js `sourcemap: 'hidden'`, app/scripts/stash-sourcemaps.mjs); this tool signs
// in as the synthetic admin (SMOKE_EMAIL / SMOKE_PASSWORD from the environment, never printed) and reads
// GET /api/admin/client-errors/sourcemap/<chunk>. A chunk the serving build does not have answers 404: the
// report came from an earlier build (say so; never guess).
//
// --rebuild: rebuild a commit locally with hidden maps and Railway's VITE_* values (Dockerfile.web's ARG
// semantics) and answer only if its entry chunk equals production's `/api/health` build_id. ⚠️ Measured
// 2026-11-11: a local rebuild did NOT reproduce production's chunk names byte for byte, so this path
// refuses on production reports; it stays for builds made before production kept its maps.
//
// Usage:
//   node tools/resolve_client_error.mjs <file-with-the-stack | ->              (production's maps)
//   node tools/resolve_client_error.mjs <file | -> --rebuild [--commit <sha>] [--railway-dir <dir>]
//   (the stack as stored by GET /api/admin/client-errors, or pasted)
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(REPO, 'app', 'package.json'))
const { SourceMapConsumer } = require('source-map-js')
const SITE = 'https://uctintelligence.com'
const FRAME = /https:\/\/(?:www\.)?uctintelligence\.com\/assets\/([\w.-]{1,120}\.m?js):(\d{1,7}):(\d{1,7})/g

const argv = process.argv.slice(2)
const opt = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined }
const input = argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'))
if (!input) { console.error('usage: node tools/resolve_client_error.mjs <stack-file | -> [--commit <sha>]'); process.exit(2) }
const stack = readFileSync(input === '-' ? 0 : input, 'utf8')
const frames = [...stack.matchAll(FRAME)].map((m) => ({ chunk: m[1], line: Number(m[2]), col: Number(m[3]), text: m[0] }))
if (!frames.length) { console.error('no frame with a position in our own built code (an older report masked them as #)'); process.exit(1) }

const sh = (cmd, args, o = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...o }).trim()
const git = (...a) => sh('git', a, { cwd: REPO })

async function liveBuildId() {
  const r = await fetch(`${SITE}/api/health`, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) uct-resolve-client-error' } })
  return (await r.json()).build_id || ''
}

// web builds from Dockerfile.web, where a VITE_* reaches the build ONLY if it is declared as an ARG, and a
// declared ARG that Railway does not set builds as "" (empty), not undefined. Reproduce exactly that: the
// commit's own ARG list, Railway's values, "" for the unset ones, and no other VITE_* at all.
function viteEnv(sha) {
  const dir = opt('railway-dir') || 'C:\\Users\\Patrick\\uct-dashboard'
  const raw = sh(process.platform === 'win32' ? 'railway.cmd' : 'railway', ['variables', '--service', 'web', '--json'], { cwd: dir, shell: true })
  const all = JSON.parse(raw)
  const declared = [...git('show', `${sha}:Dockerfile.web`).matchAll(/^\s*ARG\s+(VITE_[A-Z0-9_]+)/gm)].map((m) => m[1])
  return Object.fromEntries(declared.map((k) => [k, all[k] ?? '']))
}
const withoutVite = (env) => Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith('VITE_')))

async function buildFor(sha) {
  const root = join(tmpdir(), 'uct-sourcemaps', sha)
  const out = join(root, 'dist-maps')
  if (existsSync(join(out, '.vite', 'manifest.json'))) return out
  mkdirSync(root, { recursive: true })
  const src = join(root, 'src')
  const nm = join(src, 'app', 'node_modules')
  const realNm = join(REPO, 'app', 'node_modules')
  // ⛔⛔ UNLINK THE PACKAGES LINK BEFORE ANY RECURSIVE DELETE OF THE TEMP COPY. `git worktree remove --force`
  // and rmSync both FOLLOW a junction and delete what it points at: on 2026-11-11 the first version of
  // this tool emptied this checkout's real app/node_modules that way. rmdir on the link removes only it.
  const unlink = () => {
    if (!existsSync(nm)) return
    if (process.platform === 'win32') sh('cmd', ['/c', 'rmdir', nm])
    else rmSync(nm)
  }
  const removeCopy = () => {
    unlink()
    if (existsSync(nm)) throw new Error(`refusing to delete ${src}: the packages link is still there`)
    try { git('worktree', 'remove', '--force', src) } catch { /* left for git worktree prune */ }
    if (!existsSync(join(realNm, 'vite'))) throw new Error(`${realNm} lost its packages: run npm install in app/`)
  }
  if (existsSync(src)) removeCopy()
  console.error(`building ${sha.slice(0, 10)} with source maps (a few minutes, once per commit)...`)
  git('worktree', 'add', '--detach', src, sha)
  try {
    // Reuse this checkout's installed packages (a junction on Windows, a symlink elsewhere).
    if (process.platform === 'win32') sh('cmd', ['/c', 'mklink', '/J', nm, realNm])
    else sh('ln', ['-s', realNm, nm])
    execFileSync(process.execPath, [join(REPO, 'app', 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--sourcemap', 'hidden', '--outDir', out, '--emptyOutDir'], {
      cwd: join(src, 'app'), stdio: ['ignore', 'ignore', 'inherit'],
      env: { ...withoutVite(process.env), ...viteEnv(sha), NODE_OPTIONS: '--max-old-space-size=4096' },
    })
  } finally {
    removeCopy()
  }
  return out
}

const manifestEntry = (out) => {
  const m = JSON.parse(readFileSync(join(out, '.vite', 'manifest.json'), 'utf8'))
  return Object.values(m).find((e) => e.isEntry && e.src === 'index.html')?.file || ''
}

// getMap(chunk) -> the parsed map, or null when this build has no such chunk.
async function productionMaps() {
  if (!process.env.SMOKE_EMAIL || !process.env.SMOKE_PASSWORD) throw new Error('SMOKE_EMAIL / SMOKE_PASSWORD are not set')
  const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) uct-resolve-client-error' }
  const login = await fetch(`${SITE}/api/auth/login`, {
    method: 'POST', headers: { ...UA, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.SMOKE_EMAIL, password: process.env.SMOKE_PASSWORD }),
  })
  if (!login.ok) throw new Error(`admin sign-in refused (${login.status})`)
  const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  console.log(`production build ${await liveBuildId()} (its own source maps)`)
  return async (chunk) => {
    const r = await fetch(`${SITE}/api/admin/client-errors/sourcemap/${encodeURIComponent(chunk)}`, { headers: { ...UA, Cookie: cookie } })
    if (r.status === 404) return null
    if (!r.ok) throw new Error(`source map read refused (${r.status})`)
    return r.json()
  }
}

async function rebuiltMaps() {
  const live = await liveBuildId()
  let sha = opt('commit')
  if (!sha) { git('fetch', '-q', 'origin', 'production'); sha = git('rev-parse', 'origin/production') }
  const out = await buildFor(sha)
  const local = manifestEntry(out)
  if (!opt('commit') && local !== live.replace(/^\//, '')) {
    console.error(`REFUSED: the rebuild of ${sha.slice(0, 10)} is ${local}, production serves ${live}. Either web has not deployed`)
    console.error('that commit yet, or the rebuild is not byte-identical. Pass --commit <the deployed sha> once you know it.')
    process.exit(1)
  }
  console.log(`build ${local} (commit ${sha.slice(0, 10)}${opt('commit') ? ', given' : ', matches production'})`)
  return async (chunk) => {
    const f = join(out, 'assets', `${chunk}.map`)
    return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null
  }
}

const getMap = argv.includes('--rebuild') ? await rebuiltMaps() : await productionMaps()
const consumers = new Map()
for (const f of frames) {
  if (!consumers.has(f.chunk)) {
    const m = await getMap(f.chunk)
    consumers.set(f.chunk, m ? new SourceMapConsumer(m) : null)
  }
  const c = consumers.get(f.chunk)
  if (!c) { console.log(`  ${f.chunk}:${f.line}:${f.col}  ->  (not in this build: the report came from an earlier build)`); continue }
  const p = c.originalPositionFor({ line: f.line, column: f.col - 1 })
  const where = p.source ? `${p.source.replace(/^(\.\.\/)+/, '')}:${p.line}:${p.column + 1}${p.name ? ` (${p.name})` : ''}` : '(no source mapping at that position)'
  console.log(`  ${f.chunk}:${f.line}:${f.col}  ->  ${where}`)
}
