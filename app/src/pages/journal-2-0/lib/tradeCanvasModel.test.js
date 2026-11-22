// @vitest-environment node
// Follow-up A (first-open bytes): the trade-plan canvas's board operations stay OFF the Notebook's first open.
// `tradeCanvas.js` (the board's operations, the camera, placement) is imported statically ONLY by the board's own
// files, which load on demand behind `TradeCanvasBoard`; every first-open importer (the schema node, the editor
// page, the slash menu, the create door) reads `tradeCanvasModel.js`. One static import of `tradeCanvas.js` from
// anywhere else puts the board's half back on first open. Read by AST, never grep: a path in a comment is not an
// import (same shape as GettingStartedList.lazy.test.js).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'
import * as model from './tradeCanvasModel'
import * as board from './tradeCanvas'

const JsxParser = Parser.extend(jsx())
const HERE = path.dirname(fileURLToPath(import.meta.url))
const WAVE = path.resolve(HERE, '..')                       // .../pages/journal-2-0
const SRC = path.resolve(WAVE, '..', '..')                  // .../app/src
const BOARD_MODULE = /(^|\/)tradeCanvas(\.js)?$/

// The board's own files: reached only through NoteEditorPage's on-demand `import('./TradeCanvasBoard')`.
const BOARD_FAMILY = [
  'pages/journal-2-0/components/notebook/TradeCanvasBoard.jsx',
  'pages/journal-2-0/components/notebook/TradeCanvasDialogs.jsx',
  'pages/journal-2-0/components/notebook/TradeCanvasItem.jsx',
]

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) walk(p, out)
    else if (/\.(js|jsx)$/.test(name) && !/\.test\.(js|jsx)$/.test(name)) out.push(p)
  }
  return out
}

function staticImports(src, target) {
  const ast = JsxParser.parse(src, { ecmaVersion: 'latest', sourceType: 'module' })
  const out = []
  ;(function visit(n) {
    if (!n || typeof n.type !== 'string') return
    if ((n.type === 'ImportDeclaration' || n.type === 'ExportNamedDeclaration' || n.type === 'ExportAllDeclaration')
      && n.source && target.test(n.source.value)) out.push(n.source.value)
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) v.forEach(visit)
      else if (v && typeof v.type === 'string') visit(v)
    }
  })(ast)
  return out
}

const FILES = walk(SRC).map((f) => ({
  file: path.relative(SRC, f).split(path.sep).join('/'),
  src: fs.readFileSync(f, 'utf8'),
}))

describe('the canvas board half stays off the first open', () => {
  it('only the board family imports tradeCanvas.js statically', () => {
    expect(FILES.length).toBeGreaterThan(500)   // NON-VACUITY: the walk saw the app
    const importers = FILES.filter((f) => staticImports(f.src, BOARD_MODULE).length).map((f) => f.file).sort()
    expect(importers).toEqual(BOARD_FAMILY)
  })

  it('NON-VACUITY: the board is still fetched on demand from the editor page, and first-open files read the model', () => {
    const page = FILES.find((f) => f.file === 'pages/journal-2-0/components/notebook/NoteEditorPage.jsx')
    expect(page.src).toMatch(/import\('\.\/TradeCanvasBoard'\)/)
    for (const f of [
      'pages/journal-2-0/components/notebook/NoteEditorPage.jsx',
      'pages/journal-2-0/components/notebook/SlashMenu.jsx',
      'pages/journal-2-0/lib/tradeCanvasNode.js',
      'pages/journal-2-0/lib/tradeCanvasCreate.js',
    ]) {
      const src = FILES.find((x) => x.file === f).src
      expect(staticImports(src, /(^|\/)tradeCanvasModel(\.js)?$/), f).toHaveLength(1)
    }
  })
})

describe('one model behind both files', () => {
  it('tradeCanvas.js re-exports the model itself, not a copy', () => {
    for (const name of ['readStoredBoard', 'normalizeBoard', 'boardSearchText', 'buildCanvasDoc', 'LEVEL_ROLES', 'roleOf']) {
      expect(board[name], name).toBe(model[name])
    }
  })

  it('a board an operation returns is read back as the SAME object (one identity set across the two files)', () => {
    const start = model.readStoredBoard({ items: [{ id: 'a', kind: 'text', x: 0, y: 0, text: 'hi' }] })
    const moved = board.moveItems(start, ['a'], 8, 8)
    expect(moved).not.toBe(start)
    // The board's operations mark what they return; the model's reader must recognise it without normalising again,
    // or every card re-renders on every transaction.
    expect(model.readStoredBoard(moved)).toBe(moved)
    expect(model.isNormalised(moved)).toBe(true)
  })
})
