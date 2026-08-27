// ⛔ THE EDITOR IS A LAZY CHUNK. A static import of CodeMirror (or of CodeEditor)
// from FormulaField would put ~the whole editor into StockChart-*.js for every
// member who never opens the builder. An AST over the file, never a grep.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const SRC = fs.readFileSync(path.resolve(__dirname, '../FormulaField.jsx'), 'utf8')
const P = Parser.extend(jsx())

function imports(source) {
  const ast = P.parse(source, { ecmaVersion: 'latest', sourceType: 'module' })
  const stat = []
  const dyn = []
  ;(function walk(node) {
    if (!node || typeof node.type !== 'string') return
    if (node.type === 'ImportDeclaration') stat.push(node.source.value)
    if (node.type === 'ImportExpression' && node.source.type === 'Literal') dyn.push(node.source.value)
    for (const key of Object.keys(node)) {
      const v = node[key]
      if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v.type === 'string') walk(v)
    }
  })(ast)
  return { stat, dyn }
}

describe('FormulaField reaches the editor through ONE dynamic import', () => {
  const { stat, dyn } = imports(SRC)
  it('no static import names CodeMirror or the editor component', () => {
    expect(stat.filter((s) => /^@codemirror\/|^@lezer\/|\/editor\/CodeEditor$/.test(s))).toEqual([])
  })
  it('the dynamic edge exists (and the walker can see static ones — the control)', () => {
    expect(dyn).toEqual(['./editor/CodeEditor'])
    expect(stat).toContain('./editor/CodeEditor.module.css')
  })
})
