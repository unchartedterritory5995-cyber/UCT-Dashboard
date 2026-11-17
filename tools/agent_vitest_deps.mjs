// agent_vitest_deps.mjs — every repo file the Agent BROWSER tests (agent-ci's AGENT_VITEST_PATHS) load, transitively.
//
// WHY (AUDIT 2026-11-17, follow-up to #1521's Python half): agent-ci's `paths:` filter decides whether a PR runs the
// Agent suites before merge. A PR that changes a non-Agent frontend module the Agent browser tests import (the charts
// workspace, the bar store, the Pine engine, ...) changed those tests' verdict but never ran them; the first run was the
// post-merge master deploy gate. tests/test_ci_agent_js_dep_paths.py runs this and fails on any file the filter misses.
//
// RESOLUTION is the same as tools/import_edges.mjs (itself lifted from app/src/components/screener/reachable.test.js):
// acorn + acorn-jsx, static / dynamic / side-effect / re-export / require() / import.meta.glob specifiers, relative,
// `/src/` and `@/` roots, the CODE_EXT ladder and `index.*` directories. The rail cross-checks the two: every module
// import_edges reaches from the same seeds must be reached here too. Additions, because this asks "what can change an
// Agent test's verdict" rather than "which source modules import each other":
//   * vitest's own module seams — vi.mock / vi.doMock / vi.importActual / vi.importMock string specifiers;
//   * non-code imports (`./x.json`, `?raw`) resolve to the file when it exists (a leaf); CSS and images are dropped
//     (vitest does not process CSS here; an image import is a URL string) unless imported ?raw / ?inline;
//   * the walk is not confined to app/src (a test may import ../../docs/x.json);
//   * vite.config.js `test.setupFiles` (run before every test file) and `test.alias` targets (a bare specifier the
//     tests see as a repo file).
// Seeds: every vitest test file under app/ whose app-relative path CONTAINS one of the AGENT_VITEST_PATHS filters
// (vitest's CLI filter is a substring match).
//
// Usage:  node tools/agent_vitest_deps.mjs            -> JSON {filters, seeds, setup, deps: {file: [importer,...]}, unparsed}
//         node tools/agent_vitest_deps.mjs --closure-from-edges edges.json   -> JSON [files] (same seeds, import_edges graph)

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP = path.join(REPO, 'app')
const appRequire = createRequire(pathToFileURL(path.join(APP, 'package.json')))
const { Parser } = appRequire('acorn')
const jsx = appRequire('acorn-jsx')
const P = Parser.extend(jsx())
const CODE_EXT = ['.js', '.jsx', '.ts', '.tsx', '.mjs']
const TEST_RE = /\.(test|spec)\.[cm]?[jt]sx?$/
// Assets whose CONTENT cannot change a test verdict under vitest's defaults (vite.config.js sets no test.css, so CSS is not
// processed; an image import is its URL string). Still followed when imported `?raw` / `?inline` (then the bytes ARE read).
const CONTENT_FREE = new Set(['.css', '.scss', '.less', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.woff', '.woff2'])
const VI_FUNCS = new Set(['mock', 'doMock', 'importActual', 'importMock', 'unmock', 'doUnmock'])
const rel = (p) => path.relative(REPO, p).split(path.sep).join('/')

function workflowFilters() {
  const wf = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'agent-ci.yml'), 'utf8').split('\njobs:')[0]
  const m = wf.match(/^ {2}AGENT_VITEST_PATHS: (.+)$/m)
  if (!m) throw new Error('agent-ci.yml has no top-level AGENT_VITEST_PATHS')
  return m[1].trim().split(/\s+/)
}

function viteTestConfig() {
  const src = fs.readFileSync(path.join(APP, 'vite.config.js'), 'utf8')
  const setup = [...src.matchAll(/setupFiles:\s*\[?\s*'([^']+)'/g)].map((m) => path.resolve(APP, m[1]))
  const alias = new Map([...src.matchAll(/'([^']+)':\s*fileURLToPath\(\s*new URL\(\s*'([^']+)'/g)]
    .map((m) => [m[1], path.resolve(APP, m[2])]))
  return { setup, alias }
}

function walkTests(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walkTests(p, out)
    else if (TEST_RE.test(e.name)) out.push(p)
  }
  return out
}

export function seedFiles(filters) {
  return walkTests(APP).filter((f) => {
    const appRel = path.relative(APP, f).split(path.sep).join('/')
    return filters.some((flt) => appRel.includes(flt))
  }).sort()
}

/** Every specifier a source names; null when the file does not parse (the caller fails closed). */
function specifiersOf(src) {
  let ast
  try {
    ast = P.parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true })
  } catch {
    return null
  }
  const specs = []
  const lit = (n) => (n?.type === 'Literal' && typeof n.value === 'string' ? n.value
    : n?.type === 'TemplateLiteral' && n.expressions.length === 0 ? n.quasis[0].value.cooked : null)
  const visit = (n) => {
    if (!n || typeof n.type !== 'string') return
    if ((n.type === 'ImportDeclaration' || n.type === 'ExportNamedDeclaration'
      || n.type === 'ExportAllDeclaration') && n.source?.value) specs.push(n.source.value)
    if (n.type === 'ImportExpression' && lit(n.source)) specs.push(lit(n.source))
    if (n.type === 'CallExpression') {
      const c = n.callee
      const a0 = lit(n.arguments?.[0])
      if (a0 && c?.type === 'Identifier' && c.name === 'require') specs.push(a0)
      if (a0 && c?.type === 'MemberExpression' && c.property?.name === 'glob') specs.push(a0)
      if (a0 && c?.type === 'MemberExpression' && c.object?.name === 'vi' && VI_FUNCS.has(c.property?.name)) specs.push(a0)
    }
    for (const k of Object.keys(n)) {
      const v = n[k]
      if (Array.isArray(v)) v.forEach(visit)
      else if (v && typeof v === 'object' && typeof v.type === 'string') visit(v)
    }
  }
  visit(ast)
  return specs
}

function resolve(fromFile, specRaw, alias) {
  const spec = String(specRaw).split('?')[0]
  let base
  if (alias.has(spec)) return [alias.get(spec)]
  if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec)
  else if (spec.startsWith('/src/')) base = path.join(APP, spec.slice(1))
  else if (spec.startsWith('@/')) base = path.join(APP, 'src', spec.slice(2))
  else return []                                   // bare package: not a repo file
  if (spec.includes('*')) {
    const dir = path.dirname(base)
    if (!fs.existsSync(dir)) return []
    const pattern = new RegExp(`^${path.basename(base)
      .split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`)
    return fs.readdirSync(dir).map((f) => path.join(dir, f))
      .filter((p) => pattern.test(path.basename(p)) && fs.statSync(p).isFile())
  }
  const candidates = [base, ...CODE_EXT.map((e) => base + e), ...CODE_EXT.map((e) => path.join(base, `index${e}`))]
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return [c]   // a non-code asset resolves only by its exact name
  }
  return []
}

export function closure(filters = workflowFilters()) {
  const { setup, alias } = viteTestConfig()
  const seeds = seedFiles(filters)
  const deps = {}
  const unparsed = []
  const seen = new Set()
  const queue = [...seeds, ...setup]
  while (queue.length) {
    const f = queue.pop()
    if (seen.has(f)) continue
    seen.add(f)
    if (!CODE_EXT.includes(path.extname(f))) continue           // asset leaf
    const specs = specifiersOf(fs.readFileSync(f, 'utf8'))
    if (specs === null) { unparsed.push(rel(f)); continue }
    for (const s of specs) {
      for (const t of resolve(f, s, alias)) {
        if (CONTENT_FREE.has(path.extname(t)) && !/[?&](raw|inline)/.test(s)) continue
        if (!rel(t).startsWith('..')) (deps[rel(t)] ||= new Set()).add(rel(f))
        if (!seen.has(t)) queue.push(t)
      }
    }
  }
  for (const s of setup) (deps[rel(s)] ||= new Set()).add('app/vite.config.js (test.setupFiles)')
  return {
    filters,
    seeds: seeds.map(rel),
    setup: setup.map(rel),
    deps: Object.fromEntries(Object.keys(deps).sort().map((k) => [k, [...deps[k]].sort()])),
    unparsed: unparsed.sort(),
  }
}

/** The same seeds closed over tools/import_edges.mjs's graph — the rail's agreement check. */
function closureFromEdges(edgesPath, filters = workflowFilters()) {
  const edges = JSON.parse(fs.readFileSync(edgesPath, 'utf8'))
  const seen = new Set()
  const queue = [...seedFiles(filters), ...viteTestConfig().setup].map(rel)
  while (queue.length) {
    const f = queue.pop()
    if (seen.has(f)) continue
    seen.add(f)
    queue.push(...(edges[f] || []))
  }
  return [...seen].sort()
}

const i = process.argv.indexOf('--closure-from-edges')
if (i > 0) process.stdout.write(JSON.stringify(closureFromEdges(process.argv[i + 1])))
else if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.stdout.write(JSON.stringify(closure()))
}
