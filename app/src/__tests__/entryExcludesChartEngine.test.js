// app/src/__tests__/entryExcludesChartEngine.test.js
//
// ─── 🔴 THE RAIL: THE ENTRY CHUNK DOES NOT CARRY THE PINE CHART ENGINE ───────
//
// Every route downloads the entry chunk before it can paint. Until this rail the
// entry statically reached the whole chart engine (`components/chart/engine/**`:
// the Pine interpreter, parser, pcf, closedTable.json, nativeRegistry, defSchema,
// the pool, …, ~1.2 MB rendered) through ONE measured chain:
//
//   main.jsx → App → Layout → MobileNav → MoversSidebar → TickerPopup
//     → TickerActions → widgetEmbedCore → ownChartSettings → chartDefaults
//     → nativeRegistry → ast/*
//
// The cut is TickerActions' send-to-note door, which now loads widgetEmbedCore /
// sendToJournal on demand through `components/journalCaptureLoader.js`. This
// rail keeps it cut: it walks the STATIC import graph from the module that
// `index.html` loads and fails, BY NAME and with the whole chain, on the next
// static edge that reaches the engine from anything on every route.
//
// ⛔ AN AST, NEVER A GREP (see screener/reachable.test.js for the history): only
// a parsed module specifier is an edge. And ONLY STATIC edges are followed —
// `import x from`, `export … from`, `export * from`. A dynamic `import()` (and so
// every `lazy(() => import(…))` route) is a separate chunk Rollup loads on demand,
// which is exactly what is allowed to hold the engine.
//
// ⭐ THE CONTROLS PROVE THE WALK CAN SEE AN EAGER EDGE: from `widgetEmbedCore`
// (still static all the way down) the same walker MUST reach the engine, and from
// the lazy loader it must NOT, although that loader's dynamic targets do. A walker
// that resolved nothing would pass the main assertion and fail the first control.

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { describe, it, expect } from 'vitest'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const APP = (() => {
  let dir = process.cwd()
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'index.html')) && fs.existsSync(path.join(dir, 'src'))) return dir
    if (fs.existsSync(path.join(dir, 'app', 'index.html'))) return path.join(dir, 'app')
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`entryExcludesChartEngine: could not find app/ from ${process.cwd()}`)
})()
const SRC = path.join(APP, 'src')

/** What must never be on the entry's static closure. */
const FORBIDDEN_PREFIX = 'components/chart/engine/'

const CODE_EXT = ['.js', '.jsx', '.mjs']
const rel = (abs) => path.relative(SRC, abs).split(path.sep).join('/')
const P = Parser.extend(jsx())

function resolve(fromFile, specRaw) {
  const spec = String(specRaw).split('?')[0]
  let base
  if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec)
  else if (spec.startsWith('/src/')) base = path.join(APP, spec.slice(1))
  else return null // a package: node_modules is not this rail's question
  const candidates = [base, ...CODE_EXT.map((e) => base + e), base + '.json',
    ...CODE_EXT.map((e) => path.join(base, `index${e}`))]
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c
  }
  return null
}

/** Static and dynamic specifiers of one module, parsed — never grepped. */
function importsOf(file) {
  if (!CODE_EXT.includes(path.extname(file))) return { statics: [], dynamics: [] }
  const src = fs.readFileSync(file, 'utf8')
  // ⛔ A file that does not parse FAILS the rail: skipping it would silently drop
  // every edge it carries and read as "clean".
  const ast = P.parse(src, { ecmaVersion: 'latest', sourceType: 'module' })
  const statics = []
  const dynamics = []
  for (const n of ast.body) {
    if ((n.type === 'ImportDeclaration' || n.type === 'ExportNamedDeclaration'
      || n.type === 'ExportAllDeclaration') && n.source) statics.push(n.source.value)
  }
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (node.type === 'ImportExpression' && node.source && node.source.type === 'Literal') {
      dynamics.push(node.source.value)
    }
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v)
  }
  walk(ast)
  return { statics, dynamics }
}

/** BFS over STATIC edges only. Returns Map<file, parentFile|null>. */
function staticClosure(startAbs) {
  const parent = new Map([[startAbs, null]])
  const queue = [startAbs]
  while (queue.length) {
    const f = queue.shift()
    for (const spec of importsOf(f).statics) {
      const t = resolve(f, spec)
      if (t && !parent.has(t)) { parent.set(t, f); queue.push(t) }
    }
  }
  return parent
}

function chainTo(parent, target) {
  const chain = []
  for (let f = target; f; f = parent.get(f)) chain.unshift(rel(f))
  return chain.join('\n    → ')
}

function engineHits(parent) {
  return [...parent.keys()].filter((f) => rel(f).startsWith(FORBIDDEN_PREFIX))
}

/** The entry is READ OFF index.html (the module script Vite bundles), not typed. */
function entryModule() {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8')
  const m = html.match(/<script\s+type="module"\s+src="([^"]+)"/)
  if (!m) throw new Error('index.html has no <script type="module" src=…>')
  const abs = resolve(path.join(APP, 'index.html'), m[1].startsWith('/') ? m[1] : `./${m[1]}`)
  if (!abs) throw new Error(`index.html module script ${m[1]} does not resolve`)
  return abs
}

const at = (p) => path.join(SRC, ...p.split('/'))

describe('⛔ the entry chunk does not statically reach the chart engine', () => {
  const entry = entryModule()
  const closure = staticClosure(entry)

  it('⭐ NON-VACUITY: the walk from index.html reaches the always-mounted shell', () => {
    expect(rel(entry)).toBe('main.jsx')
    expect(closure.size).toBeGreaterThan(100)
    // The door that USED to carry the engine is still on every route — the rail
    // is about a module that is really there, not one that fell off the graph.
    for (const m of ['App.jsx', 'components/Layout.jsx', 'components/TickerActions.jsx',
      'components/journalCaptureLoader.js']) {
      expect(closure.has(at(m)), `${m} is not on the entry's static closure`).toBe(true)
    }
  })

  it('⛔ no module under components/chart/engine/ is on the entry\'s static closure', () => {
    const hits = engineHits(closure)
    const report = hits.slice(0, 3).map((h) => `  ${rel(h)} via\n    → ${chainTo(closure, h)}`).join('\n')
    expect(hits.length, `the entry chunk statically reaches the chart engine (${hits.length} modules):\n${report}\n`
      + 'Make the edge nearest the always-mounted shell a dynamic import() — see '
      + 'components/journalCaptureLoader.js.').toBe(0)
  })

  it('🧪 CONTROL: the same walker DOES reach the engine along a chain that is still static', () => {
    // ownChartSettings merges through chartDefaults synchronously, so it still
    // reaches the engine — which is exactly why every door to it is lazy.
    const from = staticClosure(at('components/chart/pane/ownChartSettings.js'))
    expect(from.has(at('components/chart/engine/nativeRegistry.js'))).toBe(true)
    expect(from.has(at('components/chart/engine/ast/interpret.js'))).toBe(true)
    // …and would name it: the chain runs through the edges measured in the header.
    expect(chainTo(from, at('components/chart/engine/nativeRegistry.js'))).toContain('components/chart/chartDefaults.js')
  })

  it('🧪 CONTROL: a dynamic import() is not followed, although its target is eager-heavy', () => {
    const loader = at('components/journalCaptureLoader.js')
    const { statics, dynamics } = importsOf(loader)
    expect(statics).toEqual([])
    const targets = dynamics.map((s) => resolve(loader, s))
    expect(targets.map((t) => t && rel(t)).sort()).toEqual([
      'pages/journal-2-0/lib/sendToJournal.js',
      'pages/journal-2-0/lib/widgetEmbedCore.js',
    ])
    // Since widgetEmbedCore loads ownChartSettings lazily, neither target reaches
    // the engine statically any more — and the loader, walked the same way, does not.
    expect(engineHits(staticClosure(targets[0]))).toEqual([])
    expect(engineHits(staticClosure(targets[1]))).toEqual([])
    expect(engineHits(staticClosure(loader))).toEqual([])
  })

  it('🧪 CONTROL: the lazy settings door in widgetEmbedCore is dynamic, and its target is engine-heavy', () => {
    const core = at('pages/journal-2-0/lib/widgetEmbedCore.js')
    const { statics, dynamics } = importsOf(core)
    const staticTargets = statics.map((s) => resolve(core, s)).filter(Boolean).map(rel)
    const dynamicTargets = dynamics.map((s) => resolve(core, s)).filter(Boolean).map(rel)
    expect(staticTargets).not.toContain('components/chart/pane/ownChartSettings.js')
    expect(dynamicTargets).toContain('components/chart/pane/ownChartSettings.js')
    expect(engineHits(staticClosure(at('components/chart/pane/ownChartSettings.js'))).length).toBeGreaterThan(0)
  })
})

// ⛔ THE NOTEBOOK AND JOURNAL ROUTES, NOT ONLY THE ENTRY. The promotion gate's
// first-open byte budget (tools/notebook_perf_budgets.py) is measured on the
// Notebook route, and it reached the engine through its OWN edges
// (NoteEditorPage → widgetEmbedCore → ownChartSettings; AddPositionModal →
// widgetEmbedCore) after the entry stopped carrying it. Owner-approved change,
// 2026-09-29: widgetEmbedCore loads ownChartSettings lazily.
describe('⛔ the Notebook and Journal routes do not statically reach the chart engine', () => {
  for (const start of ['pages/journal-2-0/surfaces/NotebookSurface.jsx', 'pages/journal-2-0/JournalLayout.jsx']) {
    it(`${start}: no components/chart/engine/ module on its static closure`, () => {
      const closure = staticClosure(at(start))
      // non-vacuity: the walk really covers the editor and the shared embed core
      expect(closure.size).toBeGreaterThan(50)
      expect(closure.has(at('pages/journal-2-0/lib/widgetEmbedCore.js'))).toBe(true)
      const hits = engineHits(closure)
      const report = hits.slice(0, 3).map((h) => `  ${rel(h)} via\n    → ${chainTo(closure, h)}`).join('\n')
      expect(hits.length, `${start} statically reaches the chart engine (${hits.length} modules):\n${report}\n`).toBe(0)
    })
  }
})
