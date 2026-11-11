// @vitest-environment node
// Audit 2026-11-05, S16: the first run's sheet and its inline ask are ONE lazy chunk (FirstRunSheet.jsx). The gate
// (NotebookTab) and the inline slot (Research Home) are on the Notebook's first open; the sheet must never be.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const JsxParser = Parser.extend(jsx())
const HERE = path.resolve(__dirname)
const read = (rel) => fs.readFileSync(path.join(HERE, rel), 'utf8')

function imports(src) {
  const ast = JsxParser.parse(src, { ecmaVersion: 'latest', sourceType: 'module' })
  const statics = ast.body.filter((n) => n.type === 'ImportDeclaration').map((n) => n.source.value)
  const dynamics = []
  ;(function visit(n) {
    if (!n || typeof n.type !== 'string') return
    if (n.type === 'ImportExpression' && n.source.type === 'Literal') dynamics.push(n.source.value)
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) v.forEach(visit)
      else if (v && typeof v.type === 'string') visit(v)
    }
  })(ast)
  return { statics, dynamics }
}

describe('the first run loads on demand', () => {
  it('FirstRunGate fetches the sheet only through lazyLeaf, never a static import', () => {
    const { statics, dynamics } = imports(read('FirstRunGate.jsx'))
    expect(statics.length).toBeGreaterThan(3)
    expect(statics).not.toContain('./FirstRunSheet')
    expect(dynamics).toEqual(['./FirstRunSheet', './FirstRunSheet'])
    expect(read('FirstRunGate.jsx')).toMatch(/lazyLeaf\(\(\) => import\('\.\/FirstRunSheet'\)\)/)
  })
  it('NotebookTab and Research Home import the gate, never the sheet', () => {
    const tab = imports(read('../../tabs/NotebookTab.jsx'))
    expect(tab.statics).toContain('../components/notebook/FirstRunGate')
    expect(tab.statics.some((s) => s.endsWith('FirstRunSheet'))).toBe(false)
    const home = imports(read('ResearchHome.jsx'))
    expect(home.statics).toContain('./FirstRunGate')
    expect(home.statics.some((s) => s.endsWith('FirstRunSheet'))).toBe(false)
  })
  it('the tour waits for it: NotebookTourGate reads whether the first run is showing', () => {
    const src = read('onboarding/NotebookTourGate.jsx')
    expect(src).toMatch(/const firstRunShowing = useFirstRunShowing\(\)/)
    expect(src).toMatch(/const wanted = enabled && !firstRunShowing && /)
  })
  it('CONTROL: the detector sees a static import when there is one', () => {
    expect(imports("import FirstRunSheet from './FirstRunSheet'\n").statics).toContain('./FirstRunSheet')
  })
})
