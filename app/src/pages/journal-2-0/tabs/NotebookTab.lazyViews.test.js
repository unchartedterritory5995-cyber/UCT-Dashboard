// @vitest-environment node
// Wave 7 (lane I3) — the Notebook's opt-in views and dialogs load on demand.
//
// Graph, board, calendar, timeline and tasks (view modes) and Import / Export
// (dialogs) are each their own chunk, fetched the first time they are shown. One
// static import of any of them anywhere in NotebookTab.jsx pulls it back into the
// Notebook's first open, and every NotebookTab test would still pass (they render the
// views either way). This rail reads the import graph of the file itself.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const JsxParser = Parser.extend(jsx())
const FILE = path.join(path.resolve(__dirname), 'NotebookTab.jsx')
const LAZY = [
  '../components/notebook/NoteGraphView',
  '../components/notebook/NoteBoardView',
  '../components/notebook/NoteCalendarView',
  '../components/notebook/NoteTimelineView',
  '../components/notebook/NoteTasksView',
  '../components/notebook/import/ImportWizard',
  '../components/notebook/export/ExportDialog',
  // ⚰️ Wave 8 seam S8-3 put the first-run tour here too, through `lazyChunk` in a bare
  // <Suspense>. Final-review fix I-2 moved it out: NotebookTourGate (imported statically, below)
  // owns the tour's chunk, through `lazyLeaf` inside its own boundary.
]

const ast = JsxParser.parse(fs.readFileSync(FILE, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' })
const staticImports = ast.body.filter((n) => n.type === 'ImportDeclaration').map((n) => n.source.value)
const dynamicImports = []
const calls = []
;(function visit(n) {
  if (!n || typeof n.type !== 'string') return
  if (n.type === 'ImportExpression' && n.source.type === 'Literal') dynamicImports.push(n.source.value)
  if (n.type === 'CallExpression' && n.callee.type === 'Identifier') calls.push(n.callee.name)
  for (const v of Object.values(n)) {
    if (Array.isArray(v)) v.forEach(visit)
    else if (v && typeof v.type === 'string') visit(v)
  }
})(ast)

describe('NotebookTab loads its opt-in views and dialogs on demand', () => {
  it('none of them is imported statically', () => {
    expect(staticImports.length).toBeGreaterThan(20) // non-vacuity: the parse saw the import block
    expect(staticImports.filter((s) => LAZY.includes(s))).toEqual([])
  })

  it('each of them is a dynamic import, exactly once', () => {
    expect([...dynamicImports].sort()).toEqual([...LAZY].sort())
  })

  // Fix round 1 (review M-5): a bare React.lazy turns a chunk that failed to fetch into a
  // route-boundary reload on the FIRST view click. lib/lazyChunk.test.jsx proves the helper;
  // this proves NotebookTab actually uses it (a helper test is blind to a wrapper that stops
  // calling it).
  it('every on-demand chunk loads through lazyChunk, never a bare React.lazy', () => {
    expect(staticImports).toContain('../lib/lazyChunk')
    expect(calls).toContain('useState') // non-vacuity: the walk sees ordinary calls
    expect(calls.filter((c) => c === 'lazy')).toEqual([])
    expect(calls.filter((c) => c === 'lazyChunk')).toHaveLength(2) // lazyView + lazyDialog
  })

  // Wave 8 final-review fix I-2: the tour is reached through its GATE, never its chunk. The gate
  // is small and static; the tour itself stays out of this file's import graph altogether.
  it('the tour is reached only through NotebookTourGate, never imported here', () => {
    expect(staticImports).toContain('../components/notebook/onboarding/NotebookTourGate')
    expect([...staticImports, ...dynamicImports].filter((s) => /onboarding\/NotebookTour$/.test(s))).toEqual([])
  })

  it('the editor, the first paint, stays static', () => {
    expect(staticImports).toContain('../components/notebook/NoteEditorPage')
    expect(dynamicImports).not.toContain('../components/notebook/NoteEditorPage')
  })
})

// ⛔ Wave 7 whole-branch fix (frontend review I-1): the rule above, WIDENED from NotebookTab.jsx
// to every source file under app/src/pages/journal-2-0/. Lane H's editor added two bare
// React.lazy chunks (the mic and the writing-help panel) that the NotebookTab-only rail could not
// see; a stale chunk after a deploy then blanked the whole Notebook route instead of retrying in
// place. Any lazy chunk in this tree loads through lib/lazyChunk.js, in one of exactly two forms:
//   * `lazyChunk` -- one in-place retry, then the app's one-reload-per-session stale-chunk recovery;
//     for a view with NO error boundary of its own (the mic, the writing-help panel, the ChartPane
//     pages): its failure reaches the route boundary like every App route.
//   * `lazyLeaf` -- one in-place retry, NEVER a reload; the error goes to the view's OWN boundary
//     (ruling D-I2, frontend re-review R-2). Only where this rail can SEE that boundary -- an error
//     boundary class declared in the file, rendered around the <Suspense> -- or where a named list
//     below says why not. A view inside its own boundary must use it: a reload there replaces a
//     working editor (offline, the browser's offline page) to heal one embed.
const J2_ROOT = path.resolve(__dirname, '..')
const SKIP_DIRS = new Set(['node_modules', '__tests__', '__fixtures__'])
function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) sourceFiles(full, out)
    } else if (/\.(js|jsx)$/.test(entry.name) && !/\.test\.(js|jsx)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

/** Every call of React's `lazy` in `src`, however it was imported, and every `lazyChunk(` /
 *  `lazyLeaf(` call. `boundary`: an error-boundary class (getDerivedStateFromError or
 *  componentDidCatch) declared in the file is rendered as JSX with a <Suspense> inside it. */
function lazyCalls(src) {
  const tree = JsxParser.parse(src, { ecmaVersion: 'latest', sourceType: 'module' })
  const lazyNames = new Set()      // `import { lazy }` / `import { lazy as l }` from 'react'
  const reactNames = new Set()     // `import React` / `import * as React` from 'react'
  for (const n of tree.body) {
    if (n.type !== 'ImportDeclaration' || n.source.value !== 'react') continue
    for (const s of n.specifiers) {
      if (s.type === 'ImportSpecifier' && (s.imported.name ?? s.imported.value) === 'lazy') lazyNames.add(s.local.name)
      if (s.type === 'ImportDefaultSpecifier' || s.type === 'ImportNamespaceSpecifier') reactNames.add(s.local.name)
    }
  }
  const bare = []
  const chunked = []
  const leafed = []
  const boundaryClasses = new Set()
  const jsxOf = (el) => (el.openingElement?.name?.type === 'JSXIdentifier' ? el.openingElement.name.name : null)
  const walk = (n, fn) => {
    if (!n || typeof n.type !== 'string') return
    fn(n)
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) v.forEach((c) => walk(c, fn))
      else if (v && typeof v.type === 'string') walk(v, fn)
    }
  }
  walk(tree, (n) => {
    if (n.type === 'CallExpression') {
      const c = n.callee
      if (c.type === 'Identifier' && lazyNames.has(c.name)) bare.push(n.start)
      if (c.type === 'MemberExpression' && c.object.type === 'Identifier' && reactNames.has(c.object.name)
          && !c.computed && c.property.name === 'lazy') bare.push(n.start)
      if (c.type === 'Identifier' && c.name === 'lazyChunk') chunked.push(n.start)
      if (c.type === 'Identifier' && c.name === 'lazyLeaf') leafed.push(n.start)
    }
    if ((n.type === 'ClassDeclaration' || n.type === 'ClassExpression') && n.id?.name
        && n.body.body.some((m) => m.type === 'MethodDefinition'
          && ['getDerivedStateFromError', 'componentDidCatch'].includes(m.key?.name))) {
      boundaryClasses.add(n.id.name)
    }
  })
  let boundary = false
  walk(tree, (n) => {
    if (boundary || n.type !== 'JSXElement' || !boundaryClasses.has(jsxOf(n))) return
    walk(n, (d) => { if (d !== n && d.type === 'JSXElement' && jsxOf(d) === 'Suspense') boundary = true })
  })
  return { bare, chunked, leafed, boundary }
}

// The helper module IS the wrapper: the one file under journal-2-0 allowed to call React.lazy.
const LAZY_HELPER = 'lib/lazyChunk.js'
// A `lazyLeaf` whose enclosing boundary this rail cannot see must be named here, with the reason.
// Empty on purpose: both of today's leaves render their own boundary around the <Suspense>.
const LEAF_WITHOUT_VISIBLE_BOUNDARY = {}

describe('no file under journal-2-0 loads a chunk through a bare React.lazy', () => {
  const files = sourceFiles(J2_ROOT)
  const rel = (f) => path.relative(J2_ROOT, f).split(path.sep).join('/')
  const bare = []
  const chunkedIn = []
  const leafIn = []
  const leafUnbounded = []
  const chunkInsideOwnBoundary = []
  const unparsed = []
  let helperWrapsLazy = false
  for (const f of files) {
    let found
    try { found = lazyCalls(fs.readFileSync(f, 'utf8')) } catch (e) { unparsed.push(`${rel(f)}: ${e.message}`); continue }
    if (rel(f) === LAZY_HELPER) { helperWrapsLazy = found.bare.length > 0; continue }
    if (found.bare.length) bare.push(`${rel(f)} (${found.bare.length})`)
    if (found.chunked.length) chunkedIn.push(rel(f))
    if (found.leafed.length) {
      leafIn.push(rel(f))
      if (!found.boundary && !LEAF_WITHOUT_VISIBLE_BOUNDARY[rel(f)]) leafUnbounded.push(rel(f))
    }
    if (found.chunked.length && found.boundary) chunkInsideOwnBoundary.push(rel(f))
  }

  it('CONTROL — the detector fires on every import form of React.lazy, and not on lazyChunk', () => {
    expect(lazyCalls("import { lazy } from 'react'\nconst A = lazy(() => import('./a'))").bare).toHaveLength(1)
    expect(lazyCalls("import { lazy as l } from 'react'\nconst A = l(() => import('./a'))").bare).toHaveLength(1)
    expect(lazyCalls("import React from 'react'\nconst A = React.lazy(() => import('./a'))").bare).toHaveLength(1)
    expect(lazyCalls("import * as R from 'react'\nconst A = R.lazy(() => import('./a'))").bare).toHaveLength(1)
    const ok = lazyCalls("import lazyChunk from '../lib/lazyChunk'\nconst A = lazyChunk(() => import('./a'))")
    expect(ok.bare).toHaveLength(0)
    expect(ok.chunked).toHaveLength(1)
  })

  it('CONTROL — lazyLeaf is seen, and a boundary is seen only when it renders around a <Suspense>', () => {
    const cls = 'class B extends Component { static getDerivedStateFromError() { return {} } render() { return null } }\n'
    const imp = "import { Component, Suspense } from 'react'\nimport { lazyLeaf } from '../lib/lazyChunk'\nconst A = lazyLeaf(() => import('./a'))\n"
    const wrapped = lazyCalls(`${imp}${cls}export default () => <B><Suspense fallback={null}><A /></Suspense></B>`)
    expect(wrapped).toMatchObject({ bare: [], chunked: [], boundary: true })
    expect(wrapped.leafed).toHaveLength(1)
    expect(lazyCalls(`${imp}export default () => <Suspense fallback={null}><A /></Suspense>`).boundary).toBe(false)
    expect(lazyCalls(`${imp}${cls}export default () => <div><B /><Suspense fallback={null}><A /></Suspense></div>`).boundary).toBe(false)
    const didCatch = 'class C extends Component { componentDidCatch() {} render() { return null } }\n'
    expect(lazyCalls(`${imp}${didCatch}export default () => <C><div><Suspense fallback={null}><A /></Suspense></div></C>`).boundary).toBe(true)
  })

  it('NON-VACUITY — the walk parsed the tree and sees the real lazyChunk callers', () => {
    expect(files.length).toBeGreaterThan(200)
    expect(unparsed).toEqual([])
    expect(chunkedIn).toContain('tabs/NotebookTab.jsx')
    expect(chunkedIn).toContain('components/notebook/NoteEditorPage.jsx')
    expect(leafIn).toEqual(expect.arrayContaining([
      'components/notebook/PdfViewerBoundary.jsx', 'components/notebook/WidgetEmbedView.jsx',
    ]))
    expect(helperWrapsLazy, 'the helper exemption names a file that no longer wraps React.lazy').toBe(true)
  })

  it('every lazy chunk in the tree goes through lib/lazyChunk.js', () => {
    expect(bare, 'a bare React.lazy under journal-2-0: a stale chunk takes the route down instead of retrying in place').toEqual([])
  })

  it('D-I2 — a lazyLeaf is used only where its own error boundary is visible (or named with a reason)', () => {
    expect(leafUnbounded, 'a lazyLeaf with no boundary: its failure would reach the route with no retry-reload').toEqual([])
  })

  it('D-I2 — a view inside its OWN error boundary never reloads the page (lazyLeaf, not lazyChunk)', () => {
    expect(chunkInsideOwnBoundary, 'a lazyChunk inside a file that renders its own boundary would reload the page instead').toEqual([])
  })
})
