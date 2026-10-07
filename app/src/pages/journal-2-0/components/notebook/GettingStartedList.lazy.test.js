// @vitest-environment node
// The "get started" list stays LAZY (wave 14, lane W14-D): no file under
// app/src/pages/journal-2-0/** imports `GettingStartedList` STATICALLY, so it and its rules
// stay out of the Notebook's first-open byte closure (docs/notebook/perf-budgets.json).
// Its one dynamic import lives in the eager gate, GettingStartedChecklist.jsx. Same shape
// as onboarding/tourLazy.test.js: read by AST, never grep -- a path in a comment is not
// an import.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const JsxParser = Parser.extend(jsx())
const HERE = path.dirname(fileURLToPath(import.meta.url))
const WAVE = path.resolve(HERE, '..', '..')                // .../pages/journal-2-0
const LIST = /(^|\/)GettingStartedList(\.jsx)?$/
const RULES = /(^|\/)onboarding\/gettingStarted(\.js)?$/

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

describe('the get started list stays out of the first-open closure', () => {
  it('NON-VACUITY: the walk sees the gate and its one dynamic import of the list', () => {
    expect(FILES.length).toBeGreaterThan(100)
    const found = FILES.map((f) => ({ file: f.file, ...importsOf(f.src, LIST) }))
    expect(found.filter((f) => f.dynamics.length).map((f) => [f.file, f.dynamics]))
      .toEqual([['components/notebook/GettingStartedChecklist.jsx', ['./GettingStartedList']]])
  })

  it('no file imports the list statically', () => {
    const offenders = FILES.map((f) => ({ file: f.file, ...importsOf(f.src, LIST) }))
      .filter((f) => f.statics.length).map((f) => f.file)
    expect(offenders).toEqual([])
  })

  it('only the list (and nothing eager) imports its rules module', () => {
    const importers = FILES.map((f) => ({ file: f.file, ...importsOf(f.src, RULES) }))
      .filter((f) => f.statics.length || f.dynamics.length).map((f) => f.file)
    expect(importers).toEqual(['components/notebook/GettingStartedList.jsx'])
  })

  it('CONTROLS: a static import is seen, a comment is not, a dynamic one is told apart', () => {
    expect(importsOf("import L from './GettingStartedList'\n", LIST).statics).toHaveLength(1)
    expect(importsOf("// import L from './GettingStartedList'\nexport const a = 1\n", LIST).statics).toEqual([])
    expect(importsOf("const L = () => import('./GettingStartedList')\n", LIST))
      .toEqual({ statics: [], dynamics: ['./GettingStartedList'] })
  })
})
