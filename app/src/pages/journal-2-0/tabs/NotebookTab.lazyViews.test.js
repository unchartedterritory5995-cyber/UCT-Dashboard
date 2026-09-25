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

  it('the editor, the first paint, stays static', () => {
    expect(staticImports).toContain('../components/notebook/NoteEditorPage')
    expect(dynamicImports).not.toContain('../components/notebook/NoteEditorPage')
  })
})
