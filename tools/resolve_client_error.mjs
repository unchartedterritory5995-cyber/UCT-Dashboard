#!/usr/bin/env node
// Turn a client error report's stack into source files and lines (desktop speed plan 9.7).
//
// Since 2026-11-11 a frame in our own built code keeps its position in the report:
// `https://uctintelligence.com/assets/<chunk>.js:<line>:<col>` (errorBeacon.js `ownAssetPosition`, and the
// server's `_OWN_POSITION`). Production ships no source maps, so this tool REBUILDS the deployed commit
// locally with hidden source maps and Railway's own VITE_* values, and only answers if the rebuild is the
// same build: its entry chunk must equal production's `/api/health` build_id (content-hashed names, so equal
// names mean identical code). Anything else is refused, never guessed.
//
// Usage:
//   node tools/resolve_client_error.mjs <file-with-the-stack | ->   [--commit <sha>] [--railway-dir <dir>]
//   (the stack as stored by GET /api/admin/client-errors, or pasted)
// The VITE_* values come from `railway variables --service web --json` (run in a directory linked to the
// production project), are passed to the build in memory only, and are never printed or written.
// Builds are cached per commit under <tmp>/uct-sourcemaps/<sha>/ (the second lookup is instant).
//
// ⚠️ STATUS 2026-11-11: a local rebuild did NOT yet reproduce production's chunk names byte for byte (same
// commit, Dockerfile.web's VITE_* semantics; differing installed versions or Node 20.18 vs local suspected), so
// today this tool REFUSES on production reports. The fix is for production to keep its own hidden maps
// (admin-only); until then, the kept positions still name the chunk and the offset to look at by hand.
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

const live = await liveBuildId()
let sha = opt('commit')
if (!sha) { git('fetch', '-q', 'origin', 'production'); sha = git('rev-parse', 'origin/production') }
const out = await buildFor(sha)
const local = manifestEntry(out)
if (!opt('commit') && local !== live.replace(/^\//, '')) {
  console.error(`REFUSED: the rebuild of ${sha.slice(0, 10)} is ${local}, production serves ${live}. Either web has not deployed`)
  console.error('that commit yet, or a VITE_* value differs. Pass --commit <the deployed sha> once you know it.')
  process.exit(1)
}
console.log(`build ${local} (commit ${sha.slice(0, 10)}${opt('commit') ? ', given' : ', matches production'})`)
const consumers = new Map()
for (const f of frames) {
  const mapFile = join(out, 'assets', `${f.chunk}.map`)
  if (!existsSync(mapFile)) { console.log(`  ${f.chunk}:${f.line}:${f.col}  ->  (not in this build: the report came from another build)`); continue }
  if (!consumers.has(mapFile)) consumers.set(mapFile, new SourceMapConsumer(JSON.parse(readFileSync(mapFile, 'utf8'))))
  const p = consumers.get(mapFile).originalPositionFor({ line: f.line, column: f.col - 1 })
  const where = p.source ? `${p.source.replace(/^(\.\.\/)+/, '')}:${p.line}:${p.column + 1}${p.name ? ` (${p.name})` : ''}` : '(no source mapping at that position)'
  console.log(`  ${f.chunk}:${f.line}:${f.col}  ->  ${where}`)
}
