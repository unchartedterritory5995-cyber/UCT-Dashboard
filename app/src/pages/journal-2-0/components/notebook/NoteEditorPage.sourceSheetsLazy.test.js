// @vitest-environment node
// First-open bytes (docs/notebook/perf-budgets.md, 2026-11-10): the document preview
// (DocumentPreviewSheet, with its image and page-text viewers and the PDF boundary) and the
// captured-passage sheet (CapturedSourceSheet) are drawn only after a press, so NoteEditorPage --
// a first-open file -- loads each through `sourceSheetLoaders` (a dynamic import), never a static
// one. A static import puts ~11 KB back on the Notebook's first open
// (`tools/notebook_perf_budgets.py --dist app/dist`). ResearchHome and TickerResearchWorkspace may
// import them statically: both are lazy views, off first open.
// Read by AST, never grep: a path in a comment is not an import (RefusedCopyOffer.lazy.test.js).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const JsxParser = Parser.extend(jsx())
const HERE = path.dirname(fileURLToPath(import.meta.url))
const SHEETS = /(^|\/)(DocumentPreviewSheet|CapturedSourceSheet)(\.jsx)?$/

function importsOf(src) {
  const ast = JsxParser.parse(src, { ecmaVersion: 'latest', sourceType: 'module' })
  const statics = []
  const dynamics = []
  ;(function visit(n) {
    if (!n || typeof n.type !== 'string') return
    if ((n.type === 'ImportDeclaration' || n.type === 'ExportNamedDeclaration' || n.type === 'ExportAllDeclaration')
      && n.source && SHEETS.test(n.source.value)) statics.push(n.source.value)
    if (n.type === 'ImportExpression' && n.source?.type === 'Literal' && SHEETS.test(n.source.value)) dynamics.push(n.source.value)
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) v.forEach(visit)
      else if (v && typeof v.type === 'string') visit(v)
    }
  })(ast)
  return { statics, dynamics }
}

describe('the source sheets stay off the Notebook first open', () => {
  const { statics, dynamics } = importsOf(fs.readFileSync(path.join(HERE, 'NoteEditorPage.jsx'), 'utf8'))

  it('NoteEditorPage imports neither sheet statically', () => {
    expect(statics).toEqual([])
  })

  it('NoteEditorPage loads each sheet through one dynamic import', () => {
    expect(dynamics.sort()).toEqual(['./CapturedSourceSheet', './DocumentPreviewSheet'])
  })
})
