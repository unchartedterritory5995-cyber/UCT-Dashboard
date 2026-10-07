// @vitest-environment node
// The offer CARD stays lazy (wave 14, lane W14-C2): no file under
// app/src/pages/journal-2-0/** imports `TourOfferPrompt` STATICALLY, so it stays out of
// the Notebook's first-open byte closure (docs/notebook/perf-budgets.json, already over
// budget -- never raised to fit a reading). Its one dynamic import lives in the eager
// gate, TourOfferGate.jsx. Same shape as tourLazy.test.js and GettingStartedList.lazy
// .test.js: read by AST, never grep -- a path in a comment is not an import.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const JsxParser = Parser.extend(jsx())
const HERE = path.dirname(fileURLToPath(import.meta.url))
const WAVE = path.resolve(HERE, '..', '..', '..')          // .../pages/journal-2-0
const CARD = /(^|\/)TourOfferPrompt(\.jsx)?$/

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

describe('the offer card stays out of the first-open closure', () => {
  it('NON-VACUITY: the walk sees the gate and its one dynamic import of the card', () => {
    expect(FILES.length).toBeGreaterThan(100)
    const found = FILES.map((f) => ({ file: f.file, ...importsOf(f.src, CARD) }))
    expect(found.filter((f) => f.dynamics.length).map((f) => [f.file, f.dynamics]))
      .toEqual([['components/notebook/onboarding/TourOfferGate.jsx', ['./TourOfferPrompt']]])
  })

  it('no file imports the card statically', () => {
    const offenders = FILES.map((f) => ({ file: f.file, ...importsOf(f.src, CARD) }))
      .filter((f) => f.statics.length).map((f) => f.file)
    expect(offenders).toEqual([])
  })

  it('NotebookTab reaches the offer only through the door, and the door reaches the gate lazily', () => {
    const tab = FILES.find((f) => f.file === 'tabs/NotebookTab.jsx')
    expect(importsOf(tab.src, /onboarding\/TourOfferGate$/).statics).toEqual([])
    expect(importsOf(tab.src, /onboarding\/TourOfferDoor$/).statics).toEqual(['../components/notebook/onboarding/TourOfferDoor'])
    const door = FILES.find((f) => f.file === 'components/notebook/onboarding/TourOfferDoor.jsx')
    expect(importsOf(door.src, /TourOfferGate$/)).toEqual({ statics: [], dynamics: ['./TourOfferGate'] })
  })

  it('CONTROLS: a static import is seen, a comment is not, a dynamic one is told apart', () => {
    expect(importsOf("import P from './TourOfferPrompt'\n", CARD).statics).toHaveLength(1)
    expect(importsOf("// import P from './TourOfferPrompt'\nexport const a = 1\n", CARD).statics).toEqual([])
    expect(importsOf("const P = () => import('./TourOfferPrompt')\n", CARD))
      .toEqual({ statics: [], dynamics: ['./TourOfferPrompt'] })
  })
})
