// @vitest-environment node
/**
 * Task 10.3: the widget formula twin stays LAZY. No eager file imports `lib/widgetFormula`, so
 * its code stays out of the Notebook's first-open byte closure (budget in
 * docs/notebook/perf-budgets.json).
 *
 * The entries are DERIVED, never typed: the module `index.html` loads (`/src/main.jsx`, read
 * from its `<script type="module">`) plus the Notebook route's lazy roots, read from the budget
 * file's `bytes.notebook_first_open.roots` (the same roots `tools/notebook_perf_budgets.py`
 * measures). From each, the STATIC import graph is walked by AST (acorn + acorn-jsx, the
 * `entryExcludesChartEngine.test.js` / `reachable.test.js` approach), never by grep: a path in a
 * comment is not an import, and only static edges are followed, because a dynamic `import()` is a
 * separate chunk Rollup loads on demand, which is exactly where the twin is allowed to live.
 *
 * Its one intended importer is the builder's lazy chunk (Task 10.16,
 * `components/notebook/widgetBuilder/`); any importer elsewhere is refused.
 *
 * CONTROLS: a planted static import in a first-open root trips the walk; a planted DYNAMIC one
 * does not; and the walk is shown to reach files it must reach, so a resolver that resolved
 * nothing cannot pass for a clean closure.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const P = Parser.extend(jsx())
const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '..', '..', '..', '..')            // app/src
const APP = path.dirname(SRC)                                     // app
const ROOT = path.dirname(APP)                                    // repo root
const TARGET_DIR = path.join(SRC, 'pages', 'journal-2-0', 'lib', 'widgetFormula') + path.sep
const ALLOWED_IMPORTER_DIR = 'pages/journal-2-0/components/notebook/widgetBuilder/'
const CODE_EXT = ['.js', '.jsx', '.mjs']
const rel = (abs) => path.relative(SRC, abs).split(path.sep).join('/')

function resolve(fromFile, specRaw) {
  const spec = String(specRaw).split('?')[0]
  let base
  if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec)
  else if (spec.startsWith('/src/')) base = path.join(APP, spec.slice(1))
  else return null // a package
  const candidates = [base, ...CODE_EXT.map((e) => base + e), base + '.json',
    ...CODE_EXT.map((e) => path.join(base, `index${e}`))]
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c
  }
  return null
}

/** Static and dynamic specifiers of one module, parsed. A file that does not parse FAILS the
 *  rail: skipping it would silently drop every edge it carries and read as clean. */
function importsOf(file, src = null) {
  if (!CODE_EXT.includes(path.extname(file))) return { statics: [], dynamics: [] }
  const text = src === null ? fs.readFileSync(file, 'utf8') : src
  const ast = P.parse(text, { ecmaVersion: 'latest', sourceType: 'module' })
  const statics = []
  const dynamics = []
  for (const n of ast.body) {
    if ((n.type === 'ImportDeclaration' || n.type === 'ExportNamedDeclaration'
      || n.type === 'ExportAllDeclaration') && n.source) statics.push(n.source.value)
  }
  ;(function visit(node) {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(visit); return }
    if (node.type === 'ImportExpression' && node.source && node.source.type === 'Literal') dynamics.push(node.source.value)
    for (const v of Object.values(node)) if (v && typeof v === 'object') visit(v)
  })(ast)
  return { statics, dynamics }
}

/** BFS over STATIC edges only; `overrides` maps a file to replacement source (the controls). */
function staticClosure(starts, overrides = new Map()) {
  const parent = new Map(starts.map((s) => [s, null]))
  const queue = [...starts]
  while (queue.length) {
    const f = queue.shift()
    const src = overrides.has(f) ? overrides.get(f) : null
    for (const spec of importsOf(f, src).statics) {
      const t = resolve(f, spec)
      if (t && !parent.has(t)) { parent.set(t, f); queue.push(t) }
    }
  }
  return parent
}

function chainTo(parent, target) {
  const chain = []
  for (let f = target; f; f = parent.get(f)) chain.unshift(rel(f))
  return chain.join(' -> ')
}

const hits = (closure) => [...closure.keys()].filter((f) => f.startsWith(TARGET_DIR))

function entries() {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8')
  const m = /<script\s+type="module"\s+src="([^"]+)"/.exec(html)
  const budgets = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'notebook', 'perf-budgets.json'), 'utf8'))
  const roots = budgets.bytes.notebook_first_open.roots.map((r) => path.join(APP, r))
  return { main: m ? path.join(APP, m[1].replace(/^\//, '')) : null, roots }
}

function walkTree(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') walkTree(p, out) }
    else if (CODE_EXT.includes(path.extname(e.name)) && !/\.test\.(js|jsx|mjs)$/.test(e.name)) out.push(p)
  }
  return out
}

const { main, roots } = entries()
const STARTS = [main, ...roots]
const CLOSURE = staticClosure(STARTS)
const NOTEBOOK_SURFACE = roots.find((r) => r.endsWith('NotebookSurface.jsx'))
const TWIN = path.join(TARGET_DIR, 'widgetFormula.js')

describe('the widget formula twin stays out of the first-open closure', () => {
  it('NON-VACUITY: the entries are real files and the walk reaches a large eager closure', () => {
    expect(main).not.toBe(null)
    expect(rel(main)).toBe('main.jsx')
    expect(roots.map(rel)).toEqual(['pages/journal-2-0/JournalLayout.jsx', 'pages/journal-2-0/surfaces/NotebookSurface.jsx'])
    for (const s of STARTS) expect(fs.existsSync(s), s).toBe(true)
    expect(CLOSURE.size).toBeGreaterThan(200)
    // a file the Notebook surface reaches statically today, named rather than counted
    expect([...CLOSURE.keys()].map(rel)).toContain('pages/journal-2-0/lib/notebookSchema.js')
    expect(fs.existsSync(TWIN)).toBe(true)
  })

  it('no first-open file reaches lib/widgetFormula statically', () => {
    expect(hits(CLOSURE).map((f) => chainTo(CLOSURE, f))).toEqual([])
  })

  it('the twin is imported only from the lazy builder, never from anywhere else (tests aside)', () => {
    const importers = walkTree(SRC).filter((f) => !f.startsWith(TARGET_DIR)).filter((f) => {
      const { statics, dynamics } = importsOf(f)
      return [...statics, ...dynamics].some((s) => {
        const t = resolve(f, s)
        return t !== null && t.startsWith(TARGET_DIR)
      })
    }).map(rel)
    // Report: at Task 10.3 nothing imports it yet; Task 10.16 wires it into the builder's chunk.
    expect(importers.filter((f) => !f.startsWith(ALLOWED_IMPORTER_DIR))).toEqual([])
  })

  it('CONTROL: a planted STATIC import in a first-open root is caught, with its chain', () => {
    const planted = `${fs.readFileSync(NOTEBOOK_SURFACE, 'utf8')}\nimport '../lib/widgetFormula/widgetFormula.js'\n`
    const closure = staticClosure(STARTS, new Map([[NOTEBOOK_SURFACE, planted]]))
    const found = hits(closure)
    expect(found.map(rel)).toEqual(['pages/journal-2-0/lib/widgetFormula/widgetFormula.js'])
    expect(chainTo(closure, found[0])).toContain('surfaces/NotebookSurface.jsx -> pages/journal-2-0/lib/widgetFormula/widgetFormula.js')
  })

  it('CONTROL: a planted DYNAMIC import is not an eager edge, and a comment is not an import', () => {
    const lazy = `${fs.readFileSync(NOTEBOOK_SURFACE, 'utf8')}\nexport const load = () => import('../lib/widgetFormula/widgetFormula.js')\n// import '../lib/widgetFormula/widgetFormula.js'\n`
    const closure = staticClosure(STARTS, new Map([[NOTEBOOK_SURFACE, lazy]]))
    expect(hits(closure)).toEqual([])
    expect(importsOf(NOTEBOOK_SURFACE, lazy).dynamics).toContain('../lib/widgetFormula/widgetFormula.js')
  })
})
