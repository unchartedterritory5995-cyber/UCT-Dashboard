// @vitest-environment node
// modern-screenshot stays LAZY (I-A bytes, 2026-10-17, ~24 KB of the Notebook's first-open closure,
// docs/notebook/perf-budgets.json, `tools/notebook_perf_budgets.py --dist app/dist`): nothing under
// app/src/pages/journal-2-0/** imports it STATICALLY. The two call sites each hold exactly one
// dynamic import, inside the function that rasterizes: lib/exportNote.js (exportNoteAsPng) and
// lib/embedArchive.js (captureElementPng). A static import in either would pull the library back
// into every first open. Read by AST, never grep: a name in a comment is not an import (same shape
// as components/notebook/RefusedCopyOffer.lazy.test.js).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const JsxParser = Parser.extend(jsx())
const HERE = path.dirname(fileURLToPath(import.meta.url))
const WAVE = path.resolve(HERE, '..')                      // .../pages/journal-2-0
const SHOT = /^modern-screenshot$/

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

describe('modern-screenshot stays out of the Notebook first-open closure', () => {
  it('NON-VACUITY: the walk sees both call sites', () => {
    const files = FILES.map((f) => f.file)
    expect(FILES.length).toBeGreaterThan(100)
    expect(files).toContain('lib/exportNote.js')
    expect(files).toContain('lib/embedArchive.js')
  })

  it('no file under journal-2-0 imports modern-screenshot statically', () => {
    const offenders = scan(SHOT).filter((f) => f.statics.length).map((f) => f.file)
    expect(offenders).toEqual([])
  })

  it('exactly one dynamic import in exportNote.js, one in embedArchive.js, and none elsewhere', () => {
    const dyn = scan(SHOT).filter((f) => f.dynamics.length).map((f) => [f.file, f.dynamics])
    expect(dyn.sort()).toEqual([
      ['lib/embedArchive.js', ['modern-screenshot']],
      ['lib/exportNote.js', ['modern-screenshot']],
    ])
  })

  it('CONTROLS: a static import is seen, a comment is not, a dynamic one is told apart', () => {
    expect(importsOf("import { domToBlob } from 'modern-screenshot'\n", SHOT).statics).toEqual(['modern-screenshot'])
    expect(importsOf("export { domToBlob } from 'modern-screenshot'\n", SHOT).statics).toEqual(['modern-screenshot'])
    expect(importsOf("// import { domToBlob } from 'modern-screenshot'\nexport const a = 1\n", SHOT).statics).toEqual([])
    expect(importsOf("const { domToBlob } = await import('modern-screenshot')\n", SHOT))
      .toEqual({ statics: [], dynamics: ['modern-screenshot'] })
    expect(importsOf("import { x } from 'modern-screenshot-other'\n", SHOT).statics).toEqual([])
  })
})
