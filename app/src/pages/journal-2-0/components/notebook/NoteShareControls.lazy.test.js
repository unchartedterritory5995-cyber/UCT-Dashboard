// @vitest-environment node
// Audit 2026-11-05, S19: the Share sheet's content (tabs, preview, publish confirm) is a lazy chunk. A static import
// of NoteSharePanel would pull it back into the editor's first open, and every behaviour test would still pass.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const JsxParser = Parser.extend(jsx())
const read = (f) => fs.readFileSync(path.join(path.resolve(__dirname), f), 'utf8')

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

describe('the Share sheet loads its content on demand', () => {
  const { statics, dynamics } = imports(read('NoteShareControls.jsx'))
  it('NoteShareControls never imports the panel statically, and fetches it through lazyChunk', () => {
    expect(statics.length).toBeGreaterThan(3)                     // non-vacuity: the parse saw the import block
    expect(statics).not.toContain('./NoteSharePanel')
    expect(dynamics).toEqual(['./NoteSharePanel'])
    expect(read('NoteShareControls.jsx')).toMatch(/lazyChunk\(\(\) => import\('\.\/NoteSharePanel'\)\)/)
  })
  it('the preview renderer is fetched by the panel only when asked for', () => {
    const panel = imports(read('NoteSharePanel.jsx'))
    expect(panel.statics.some((s) => s.endsWith('/ReadOnlyNote'))).toBe(false)
    expect(panel.dynamics).toContain('../../public/ReadOnlyNote')
  })
  it('CONTROL: the detector sees a static import when there is one', () => {
    expect(imports("import SharePanel from './NoteSharePanel'\n").statics).toContain('./NoteSharePanel')
  })
})
