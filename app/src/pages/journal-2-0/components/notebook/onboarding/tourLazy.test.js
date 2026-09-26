// @vitest-environment node
// The tour stays LAZY (wave 8, lane 8C, C2; dispatch plan R9): no file under
// app/src/pages/journal-2-0/** imports `onboarding/NotebookTour` STATICALLY, so its code
// stays out of the Notebook's first-open byte closure. NotebookTab reaches it through a
// dynamic `import()` only. Read by AST (acorn + acorn-jsx, already the tree's parser),
// never grep: a path in a comment is not an import.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const JsxParser = Parser.extend(jsx())
const HERE = path.dirname(fileURLToPath(import.meta.url))
const WAVE = path.resolve(HERE, '..', '..', '..')          // .../pages/journal-2-0
const TARGET = /(^|\/)onboarding\/NotebookTour(\.jsx)?$|^\.\/NotebookTour(\.jsx)?$/

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) walk(p, out)
    else if (/\.(js|jsx)$/.test(name) && !/\.test\.(js|jsx)$/.test(name)) out.push(p)
  }
  return out
}

/** { statics, dynamics }: every import source in `src` that names the tour. */
function tourImports(src) {
  const ast = JsxParser.parse(src, { ecmaVersion: 'latest', sourceType: 'module' })
  const statics = []
  const dynamics = []
  ;(function visit(n) {
    if (!n || typeof n.type !== 'string') return
    if ((n.type === 'ImportDeclaration' || n.type === 'ExportNamedDeclaration' || n.type === 'ExportAllDeclaration')
      && n.source && TARGET.test(n.source.value)) statics.push(n.source.value)
    if (n.type === 'ImportExpression' && n.source?.type === 'Literal' && TARGET.test(n.source.value)) dynamics.push(n.source.value)
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) v.forEach(visit)
      else if (v && typeof v.type === 'string') visit(v)
    }
  })(ast)
  return { statics, dynamics }
}

const FILES = walk(WAVE)
const FOUND = FILES.map((f) => ({
  file: path.relative(WAVE, f).split(path.sep).join('/'),
  ...tourImports(fs.readFileSync(f, 'utf8')),
}))

describe('the tour stays out of the first-open closure', () => {
  it('NON-VACUITY: the walk sees NotebookTab, and its one dynamic import of the tour', () => {
    expect(FILES.length).toBeGreaterThan(100)
    const tab = FOUND.find((f) => f.file === 'tabs/NotebookTab.jsx')
    expect(tab.dynamics).toEqual(['../components/notebook/onboarding/NotebookTour'])
  })

  it('no file under journal-2-0 imports onboarding/NotebookTour statically', () => {
    const offenders = FOUND.filter((f) => f.statics.length).map((f) => `${f.file}: ${f.statics.join(', ')}`)
    expect(offenders).toEqual([])
  })

  it('CONTROLS: a static import is seen, a comment is not, a dynamic one is told apart', () => {
    expect(tourImports("import T from '../components/notebook/onboarding/NotebookTour'\n").statics).toHaveLength(1)
    expect(tourImports("import T from './NotebookTour'\n").statics).toHaveLength(1)
    expect(tourImports("// import T from './onboarding/NotebookTour'\nexport const a = 1\n").statics).toEqual([])
    expect(tourImports("const T = () => import('./onboarding/NotebookTour')\n"))
      .toEqual({ statics: [], dynamics: ['./onboarding/NotebookTour'] })
    expect(tourImports("import { openNotebookTour } from './onboarding/tourControl'\n").statics).toEqual([])
  })
})
