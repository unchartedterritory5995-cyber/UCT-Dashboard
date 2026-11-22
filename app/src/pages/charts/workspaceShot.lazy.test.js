// @vitest-environment node
// Screenshot workspace stays LAZY: the capture module and modern-screenshot load on the click, so
// neither the /charts first open nor anything that bundles ChartsWorkspace pays for them. The only
// static importers allowed are tests; WorkspaceShotButton holds the one dynamic import of
// ./workspaceShot, and workspaceShot.js loads modern-screenshot only dynamically (capture + hover warm-up). Read by AST.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const JsxParser = Parser.extend(jsx())
const HERE = path.dirname(fileURLToPath(import.meta.url))

function importsOf(file) {
  const src = fs.readFileSync(path.join(HERE, file), 'utf8')
  const ast = JsxParser.parse(src, { ecmaVersion: 'latest', sourceType: 'module' })
  const statics = []; const dynamics = []
  ;(function visit(n) {
    if (!n || typeof n.type !== 'string') return
    if (n.type === 'ImportDeclaration') statics.push(n.source.value)
    if (n.type === 'ImportExpression' && n.source?.type === 'Literal') dynamics.push(n.source.value)
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) v.forEach(visit)
      else if (v && typeof v === 'object' && typeof v.type === 'string') visit(v)
    }
  })(ast)
  return { statics, dynamics }
}

describe('workspace screenshot is loaded on use', () => {
  it('ChartsWorkspace and the button never import the capture code statically', () => {
    for (const f of ['ChartsWorkspace.jsx', 'WorkspaceShotButton.jsx']) {
      const { statics } = importsOf(f)
      expect(statics.filter((s) => /workspaceShot$|^modern-screenshot$/.test(s)), f).toEqual([])
    }
  })
  it('the button imports ./workspaceShot dynamically; the module imports modern-screenshot dynamically', () => {
    expect(importsOf('WorkspaceShotButton.jsx').dynamics).toContain('./workspaceShot')
    const mod = importsOf('workspaceShot.js')
    expect(mod.statics).toEqual([])
    expect(mod.dynamics.length).toBeGreaterThan(0)
    expect(new Set(mod.dynamics)).toEqual(new Set(['modern-screenshot']))
  })
})
