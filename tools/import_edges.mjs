// import_edges.mjs — emit the module import graph as {repo-relative: [repo-relative, ...]}.
//
// ⛔⛔ WHY THIS EXISTS. `tools/gate_carry_over.py` documents `--edges-json` as
// "path to {file: [imported,...]} produced by the AST walker" — and NOTHING IN THE
// REPO EVER PRODUCED ONE. So C2, the check that asks whether a landing's incoming
// commits can interact with the branch at all, has been answered "could not
// evaluate" on every landing in this programme's history, and "unknown is never a
// pass" turns every one of those into a full re-gate.
//
// CLAUDE.md files that under "DOCUMENTED IS NOT BOUNDED": *"C2 is specified in
// CLAUDE.md and has been structurally unevaluable on every landing — a written
// check nobody can run is not a check."* The consumer was always ready. This is the
// producer.
//
// ⭐ IT IS NOT A SECOND AUTHORITY ON RESOLUTION. The resolve rules here are lifted
// deliberately from `app/src/components/screener/reachable.test.js`, which is the
// repo's existing acorn walker and its standing rail: relative and `/src/`
// specifiers, the CODE_EXT candidate ladder, `index.*` directory resolution, and
// `import.meta.glob`-style `*` expansion. A DIFFERENT resolver would answer a
// different question and quietly disagree with the rail.
//
// ⚠️ Bare package specifiers are deliberately dropped. C2 asks whether two sets of
// REPO files reach each other; `react` is not a repo file, and keeping node_modules
// would make everything reachable from everything within two hops — which would make
// C2 answer "they interact" always, i.e. useless in the opposite direction.
//
// Usage:  node tools/import_edges.mjs > edges.json
//         node tools/import_edges.mjs --self-check

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')

// acorn lives in app/node_modules, not at the repo root, and ESM ignores NODE_PATH —
// so resolve it the way `nav_manifest.mjs` and `hub_surface_matrix.mjs` already do,
// rather than inventing a third convention for the same problem.
const appRequire = createRequire(pathToFileURL(path.join(REPO, 'app', 'package.json')))
const { Parser } = appRequire('acorn')
const jsx = appRequire('acorn-jsx')
const APP = path.join(REPO, 'app')
const ROOTS = [path.join(APP, 'src')]
const CODE_EXT = ['.js', '.jsx', '.ts', '.tsx', '.mjs']
const P = Parser.extend(jsx())

function walkFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.git') continue
      walkFiles(p, out)
    } else if (CODE_EXT.includes(path.extname(p))) {
      out.push(p)
    }
  }
  return out
}

/** Every import specifier a source names: static, dynamic, side-effect, and require(). */
export function specifiersOf(src) {
  let ast
  try {
    ast = P.parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true })
  } catch {
    return []           // ⛔ a file we cannot parse yields NOTHING, and the caller counts it
  }
  const specs = []
  const visit = (n) => {
    if (!n || typeof n.type !== 'string') return
    if ((n.type === 'ImportDeclaration' || n.type === 'ExportNamedDeclaration'
      || n.type === 'ExportAllDeclaration') && n.source?.value) specs.push(n.source.value)
    if (n.type === 'ImportExpression' && n.source?.type === 'Literal') specs.push(n.source.value)
    if (n.type === 'CallExpression' && n.callee?.name === 'require'
      && n.arguments?.[0]?.type === 'Literal') specs.push(n.arguments[0].value)
    // import.meta.glob('./x/*.js')
    if (n.type === 'CallExpression' && n.callee?.type === 'MemberExpression'
      && n.callee.property?.name === 'glob' && n.arguments?.[0]?.type === 'Literal') {
      specs.push(n.arguments[0].value)
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

/** Lifted from reachable.test.js — same rules, deliberately. */
function resolve(fromFile, specRaw) {
  const spec = String(specRaw).split('?')[0]
  let base
  if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec)
  else if (spec.startsWith('/src/')) base = path.join(APP, spec.slice(1))
  else if (spec.startsWith('@/')) base = path.join(APP, 'src', spec.slice(2))
  else return []        // bare package -> not a repo file, see the header note

  if (spec.includes('*')) {
    const dir = path.dirname(base)
    if (!fs.existsSync(dir)) return []
    const pattern = new RegExp(`^${path.basename(base)
      .split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}`)
    return fs.readdirSync(dir).map((f) => path.join(dir, f))
      .filter((p) => CODE_EXT.includes(path.extname(p))
        && pattern.test(path.basename(p)) && fs.statSync(p).isFile())
  }

  const candidates = [base, ...CODE_EXT.map((e) => base + e),
    ...CODE_EXT.map((e) => path.join(base, `index${e}`))]
  for (const c of candidates) {
    if (!CODE_EXT.includes(path.extname(c))) continue
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return [c]
  }
  return []
}

const rel = (p) => path.relative(REPO, p).split(path.sep).join('/')

export function buildEdges() {
  const files = ROOTS.filter(fs.existsSync).flatMap((r) => walkFiles(r))
  const edges = {}
  let unparsed = 0
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8')
    const specs = specifiersOf(src)
    if (specs.length === 0 && /\bimport\s/.test(src)) unparsed += 1
    const outs = new Set()
    for (const s of specs) for (const t of resolve(f, s)) outs.add(rel(t))
    edges[rel(f)] = [...outs].sort()
  }
  return { edges, fileCount: files.length, unparsed }
}

function selfCheck() {
  const fails = []
  const s = specifiersOf("import a from './a'\nconst m = require('./b')\nimport('./c')\n")
  for (const want of ['./a', './b', './c']) {
    if (!s.includes(want)) fails.push(`specifiersOf missed ${want} (got ${JSON.stringify(s)})`)
  }
  const { edges, fileCount } = buildEdges()
  // ⛔ NON-VACUITY. An empty graph makes check_c2 pass EVERY case, so a graph that
  // came back empty must be loud. These two assertions are the control.
  if (fileCount < 100) fails.push(`only ${fileCount} source files walked — the walk is broken`)
  const withEdges = Object.values(edges).filter((v) => v.length > 0).length
  if (withEdges < 50) fails.push(`only ${withEdges} files have ANY resolved import — resolution is broken`)
  // and a known edge the repo definitely has
  const known = Object.keys(edges).find((k) => k.endsWith('app/src/hub/HubRoot.jsx'))
  if (!known) fails.push('HubRoot.jsx not in the graph')
  else if (!edges[known].some((e) => e.includes('useJoystick'))) {
    fails.push(`HubRoot.jsx does not resolve useJoystick — got ${JSON.stringify(edges[known].slice(0, 6))}`)
  }
  console.error(`  files walked: ${fileCount}, with >=1 resolved import: ${withEdges}`)
  for (const f of fails) console.error(`  FAIL ${f}`)
  console.error(fails.length ? '  SELF-CHECK: FAILED' : '  SELF-CHECK: ok')
  return fails.length ? 1 : 0
}

if (process.argv.includes('--self-check')) {
  process.exit(selfCheck())
} else {
  const { edges, fileCount, unparsed } = buildEdges()
  if (fileCount < 100) {
    console.error(`REFUSING: only ${fileCount} files walked — an empty graph makes C2 pass vacuously`)
    process.exit(2)
  }
  if (unparsed) console.error(`  note: ${unparsed} file(s) named imports but did not parse`)
  process.stdout.write(JSON.stringify(edges, null, 0))
}
