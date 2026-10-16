// @vitest-environment node
// The refused-copy offer stays LAZY (I-A bytes, 2026-10-16): no file under
// app/src/pages/journal-2-0/** imports `RefusedCopyOffer` STATICALLY, and nothing outside the
// offer's own chunk imports the copy's display half (`lib/offline/refusedCopyDisplay.js`)
// statically, so neither is in the Notebook's first-open byte closure
// (docs/notebook/perf-budgets.json, `tools/notebook_perf_budgets.py --dist app/dist`). The offer's
// one dynamic import is NoteEditorPage's `refusedCopyDoorLoaders`. The DECISION half
// (`lib/offline/refusedCopy.js`) stays static -- the drain and the durable layer run it on every
// open -- and must never reach the display half either.
// Read by AST, never grep: a path in a comment is not an import (same shape as
// GettingStartedList.lazy.test.js and onboarding/tourLazy.test.js).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const JsxParser = Parser.extend(jsx())
const HERE = path.dirname(fileURLToPath(import.meta.url))
const WAVE = path.resolve(HERE, '..', '..')                // .../pages/journal-2-0
const OFFER = /(^|\/)RefusedCopyOffer(\.jsx)?$/
const DISPLAY = /(^|\/)refusedCopyDisplay(\.js)?$/
const DECISION = /(^|\/)offline\/refusedCopy(\.js)?$|^\.\/refusedCopy(\.js)?$/

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) walk(p, out)
    else if (/\.(js|jsx)$/.test(name) && !/\.test\.(js|jsx)$/.test(name)) out.push(p)
  }
  return out
}

function importsOf(src, target) {
  const ast = JsxParser.parse(src, { ecmaVersion: 'latest', sourceType: 'module' })
  const statics = []
  const dynamics = []
  ;(function visit(n) {
    if (!n || typeof n.type !== 'string') return
    if ((n.type === 'ImportDeclaration' || n.type === 'ExportNamedDeclaration' || n.type === 'ExportAllDeclaration')
      && n.source && target.test(n.source.value)) statics.push(n.source.value)
    if (n.type === 'ImportExpression' && n.source?.type === 'Literal' && target.test(n.source.value)) dynamics.push(n.source.value)
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) v.forEach(visit)
      else if (v && typeof v.type === 'string') visit(v)
    }
  })(ast)
  return { statics, dynamics }
}

const FILES = walk(WAVE).map((f) => ({
  file: path.relative(WAVE, f).split(path.sep).join('/'),
  src: fs.readFileSync(f, 'utf8'),
}))
const scan = (target) => FILES.map((f) => ({ file: f.file, ...importsOf(f.src, target) }))

describe('the refused-copy offer stays out of the first-open closure', () => {
  it('NON-VACUITY: the walk sees the editor and its one dynamic import of the offer', () => {
    expect(FILES.length).toBeGreaterThan(100)
    expect(FILES.map((f) => f.file)).toContain('components/notebook/NoteEditorPage.jsx')
    expect(scan(OFFER).filter((f) => f.dynamics.length).map((f) => [f.file, f.dynamics]))
      .toEqual([['components/notebook/NoteEditorPage.jsx', ['./RefusedCopyOffer']]])
  })

  it('NON-VACUITY: the decision half IS imported statically, by the drain and the durable layer', () => {
    // A walk that saw no static import at all would pass the two cells below for nothing.
    const importers = scan(DECISION).filter((f) => f.statics.length).map((f) => f.file)
    expect(importers).toEqual(expect.arrayContaining([
      'lib/offline/outboxDrain.js', 'lib/offline/useDurableNote.js', 'lib/offline/refusedCopyDisplay.js',
    ]))
  })

  it('no file imports the offer statically -- NoteEditorPage above all', () => {
    const offenders = scan(OFFER).filter((f) => f.statics.length).map((f) => f.file)
    expect(offenders).toEqual([])
  })

  it('only the offer (its own chunk) imports the display half, statically or otherwise', () => {
    const importers = scan(DISPLAY).filter((f) => f.statics.length || f.dynamics.length).map((f) => f.file)
    expect(importers).toEqual(['components/notebook/RefusedCopyOffer.jsx'])
  })

  it('CONTROLS: a static import is seen, a comment is not, a dynamic one is told apart', () => {
    expect(importsOf("import RefusedCopyOffer from './RefusedCopyOffer'\n", OFFER).statics).toHaveLength(1)
    expect(importsOf("export { RefusedCopyOffers } from './RefusedCopyOffer'\n", OFFER).statics).toHaveLength(1)
    expect(importsOf("import { copyBodyText } from '../../lib/offline/refusedCopyDisplay'\n", DISPLAY).statics).toHaveLength(1)
    expect(importsOf("// import RefusedCopyOffer from './RefusedCopyOffer'\nexport const a = 1\n", OFFER).statics).toEqual([])
    expect(importsOf("const L = () => import('./RefusedCopyOffer')\n", OFFER))
      .toEqual({ statics: [], dynamics: ['./RefusedCopyOffer'] })
    // the decision half's name must not be read as the display half's, or the other way round
    expect(importsOf("import { holdRefusedCopy } from './refusedCopy'\n", DISPLAY).statics).toEqual([])
    expect(importsOf("import { copyBodyText } from './refusedCopyDisplay'\n", DECISION).statics).toEqual([])
  })
})
