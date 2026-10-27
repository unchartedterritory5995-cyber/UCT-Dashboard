// @vitest-environment node
/**
 * Task 9.16: the routine and tracker editors stay LAZY. `lib/toolsCrud.js` and everything under
 * `components/notebook/routines/` are reached only through dynamic `import()`s (the routine block's ⋯ menu, later the
 * tool picker and My tools), so none of it is in the Notebook's first-open byte closure (budget in
 * docs/notebook/perf-budgets.json). This is the bytes gate's static half, measured without a build: the entries are
 * DERIVED (index.html's module script, and the budget file's `bytes.notebook_first_open.roots`, the roots
 * `tools/notebook_perf_budgets.py` measures) and the STATIC import graph is walked by AST (the
 * widgetFormula.lazy.test.js method), never by grep.
 *
 * CONTROLS: a planted static import in a first-open root trips the walk, a planted DYNAMIC one does not, and the
 * walk reaches files it must reach, so a resolver that resolved nothing cannot pass for a clean closure.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const P = Parser.extend(jsx())
const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '..', '..', '..')                  // app/src
const APP = path.dirname(SRC)                                     // app
const ROOT = path.dirname(APP)                                    // repo root
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

const CRUD = path.join(SRC, 'pages', 'journal-2-0', 'lib', 'toolsCrud.js')
const ROUTINES_DIR = path.join(SRC, 'pages', 'journal-2-0', 'components', 'notebook', 'routines') + path.sep
const isLazyOnly = (f) => f === CRUD || f.startsWith(ROUTINES_DIR)
const hits = (closure) => [...closure.keys()].filter(isLazyOnly)
/** Who may import the lazy files: the editors themselves, My tools (Task 9.18), the tool picker (Task 9.19, in
 *  the routines directory) and the template library's sheets (wave 11, Task 11.15: the share preview reads the routine
 *  and tracker words from routines/toolEditorLib). Every one of them is itself lazy. */
const ALLOWED_IMPORTERS = ['pages/journal-2-0/components/notebook/routines/', 'pages/journal-2-0/components/notebook/myTools/',
  'pages/journal-2-0/components/notebook/library/']

const { main, roots } = entries()
const STARTS = [main, ...roots]
const CLOSURE = staticClosure(STARTS)
const NOTEBOOK_SURFACE = roots.find((r) => r.endsWith('NotebookSurface.jsx'))

describe('the routine and tracker editors stay out of the first-open closure', () => {
  it('NON-VACUITY: the entries are real files and the walk reaches a large eager closure', () => {
    expect(rel(main)).toBe('main.jsx')
    for (const s of STARTS) expect(fs.existsSync(s), s).toBe(true)
    expect(CLOSURE.size).toBeGreaterThan(200)
    expect([...CLOSURE.keys()].map(rel)).toContain('pages/journal-2-0/lib/notebookSchema.js')
    expect(fs.existsSync(CRUD)).toBe(true)
    expect(fs.existsSync(path.join(ROUTINES_DIR, 'RoutineEditorSheet.jsx'))).toBe(true)
  })

  it('no first-open file reaches toolsCrud or the editors statically', () => {
    expect(hits(CLOSURE).map((f) => chainTo(CLOSURE, f))).toEqual([])
  })

  it('every STATIC importer of a lazy file is itself one of the lazy places; everyone else imports dynamically', () => {
    const bad = walkTree(SRC).filter((f) => !isLazyOnly(f)).filter((f) => {
      const { statics } = importsOf(f)
      return statics.some((s) => { const t = resolve(f, s); return t !== null && isLazyOnly(t) })
    }).map(rel)
    expect(bad.filter((f) => !ALLOWED_IMPORTERS.some((d) => f.startsWith(d)))).toEqual([])
  })

  it('the routine block reaches the editor through a dynamic import only', () => {
    const block = path.join(SRC, 'pages', 'journal-2-0', 'components', 'notebook', 'blocks', 'RoutineBlock.jsx')
    const { statics, dynamics } = importsOf(block)
    expect(dynamics).toContain('../routines/openRoutineEditor')
    expect(statics.some((s) => s.includes('routines/'))).toBe(false)
  })

  it('CONTROL: a planted STATIC import in a first-open root is caught, with its chain', () => {
    const planted = `${fs.readFileSync(NOTEBOOK_SURFACE, 'utf8')}
import '../components/notebook/routines/openRoutineEditor.js'
`
    const closure = staticClosure(STARTS, new Map([[NOTEBOOK_SURFACE, planted]]))
    const found = hits(closure).map(rel)
    expect(found).toContain('pages/journal-2-0/lib/toolsCrud.js')
    expect(found).toContain('pages/journal-2-0/components/notebook/routines/RoutineEditorSheet.jsx')
  })

  it('CONTROL: a planted DYNAMIC import is not an eager edge', () => {
    const lazy = `${fs.readFileSync(NOTEBOOK_SURFACE, 'utf8')}
export const load = () => import('../components/notebook/routines/openRoutineEditor.js')
`
    const closure = staticClosure(STARTS, new Map([[NOTEBOOK_SURFACE, lazy]]))
    expect(hits(closure)).toEqual([])
  })
})

// Task 9.6c review m-3, armed at the be->impl merge: the per-intent key helper (`lib/idempotencyKeys.js`, the
// R-50 keyedSender) rides only with toolsCrud and the builder's lazy doors, never in the first-open closure.
const IDEM = path.join(SRC, 'pages', 'journal-2-0', 'lib', 'idempotencyKeys.js')

describe('the idempotency key helper stays out of the first-open closure', () => {
  it('no first-open file reaches lib/idempotencyKeys.js statically', () => {
    expect(fs.existsSync(IDEM)).toBe(true)
    expect(CLOSURE.has(IDEM) ? chainTo(CLOSURE, IDEM) : null).toBe(null)
  })

  it('CONTROL: a planted static import of it in a first-open root is caught', () => {
    const planted = `${fs.readFileSync(NOTEBOOK_SURFACE, 'utf8')}
import '../lib/idempotencyKeys.js'
`
    expect(staticClosure(STARTS, new Map([[NOTEBOOK_SURFACE, planted]])).has(IDEM)).toBe(true)
  })
})

// Wave 11 (Task 11.15 review M-2): the template library is lazy. `lib/templateLibrary.js` and every file under
// `components/notebook/library/` (the share preview, and the sheets Tasks 11.16, 11.17 and 11.19 add there) are reached
// only through dynamic imports, so none is in the first-open closure. The allowance above lets the library import the
// routine editor's words; this keeps the library itself off the first open.
const TEMPLATE_LIB = path.join(SRC, 'pages', 'journal-2-0', 'lib', 'templateLibrary.js')
const LIBRARY_DIR = path.join(SRC, 'pages', 'journal-2-0', 'components', 'notebook', 'library') + path.sep
const isLibrary = (f) => f === TEMPLATE_LIB || f.startsWith(LIBRARY_DIR)

describe('the template library stays out of the first-open closure', () => {
  it('NON-VACUITY: the library files exist', () => {
    expect(fs.existsSync(TEMPLATE_LIB)).toBe(true)
    expect(fs.existsSync(path.join(LIBRARY_DIR, 'SharePreviewSheet.jsx'))).toBe(true)
  })

  it('no first-open file reaches lib/templateLibrary.js or components/notebook/library/ statically', () => {
    expect([...CLOSURE.keys()].filter(isLibrary).map((f) => chainTo(CLOSURE, f))).toEqual([])
  })

  it('CONTROL: a planted static import of the share preview in a first-open root is caught', () => {
    const planted = `${fs.readFileSync(NOTEBOOK_SURFACE, 'utf8')}
import '../components/notebook/library/openSharePreview.js'
`
    const found = [...staticClosure(STARTS, new Map([[NOTEBOOK_SURFACE, planted]])).keys()].filter(isLibrary).map(rel)
    expect(found).toContain('pages/journal-2-0/components/notebook/library/SharePreviewSheet.jsx')
    expect(found).toContain('pages/journal-2-0/lib/templateLibrary.js')
  })
})
