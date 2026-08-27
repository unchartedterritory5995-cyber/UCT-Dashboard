// app/src/components/chart/builder/EvidenceTab.doors.test.js
//
// ─── ONE COMPONENT, TWO DOORS — PINNED IN THE IMPORT GRAPH ──────────────
// The wire-cut idiom (`ScanToChart.wire.test.jsx`): both doors must import THIS
// module, resolved by path, so a second Evidence surface cannot appear under a
// different name in either file. Also: exactly ONE `EvidenceTab.jsx` under
// app/src — a copy is the second-authority defect wearing a filename.
//
// ⭐ AND THE DOOR LIST IS DERIVED, NOT TYPED. A hand-typed pair passes forever on
// the day a THIRD door appears, which is precisely the guarantee this task exists
// to make testable. The importer set is walked out of the real import graph and
// the hand list is asserted EQUAL to it — the same anti-rot shape W5a.5's
// `SPEAKING_STATES` needed after its typed list was found stale on its first run.
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

// ⚠️ `fileURLToPath(import.meta.url)` THROWS HERE — "The URL must be of scheme
// file". Under this environment's vite transform `import.meta.url` is an http:
// URL (measured in `engine/__tests__/singleWriterIndex.test.js`, and again in
// W5a.5's rails file). `import.meta.dirname` is the form that works, and it is
// what `editor/CodeEditor.test.jsx` uses one directory over.
const HERE = import.meta.dirname
const SRC = path.resolve(HERE, '../../..')                       // app/src
const TARGET = path.resolve(HERE, 'EvidenceTab.jsx')

/** The two doors, by name, for the message a failure prints. Asserted EQUAL to
 *  the derived set below, so this cannot quietly fall behind the graph. */
const DOORS = {
  BuilderSheet: path.resolve(HERE, 'BuilderSheet.jsx'),
  ScanResults: path.resolve(HERE, '../../screener/ScanResults.jsx'),
}

export function importsOf(file) {
  const ast = Parser.extend(jsx()).parse(fs.readFileSync(file, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' })
  const out = []
  ;(function walk(node) {
    if (!node || typeof node.type !== 'string') return
    if (node.type === 'ImportDeclaration') out.push(node.source.value)
    // a door may arrive lazily; a dynamic import is still an edge
    if (node.type === 'ImportExpression' && node.source && node.source.type === 'Literal') out.push(node.source.value)
    for (const k of Object.keys(node)) {
      const v = node[k]
      if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v.type === 'string') walk(v)
    }
  })(ast)
  return out
}

/** Resolve a relative specifier the way the bundler would. ⚠️ The extension is
 *  TRIED, never assumed: appending `.jsx` unconditionally (the shape this rail
 *  was drafted with) fails to resolve every `.js` sibling, so a control asserting
 *  "the resolver sees a known import" would go red for the wrong reason and get
 *  loosened until it measured nothing. */
export function resolveImport(file, spec) {
  if (!spec.startsWith('.')) return null
  const base = path.resolve(path.dirname(file), spec)
  const candidates = /\.(jsx?|json|css)$/.test(spec)
    ? [base]
    : [`${base}.jsx`, `${base}.js`, path.join(base, 'index.jsx'), path.join(base, 'index.js')]
  return candidates.find((p) => fs.existsSync(p)) || null
}
function resolvedImports(file) { return importsOf(file).map((s) => resolveImport(file, s)).filter(Boolean) }

function* walkDir(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') yield* walkDir(p) } else yield p
  }
}
const isTest = (p) => /\.(test|spec)\.[jt]sx?$/.test(path.basename(p))

/** Every file under app/src that imports the target, split into the surfaces a
 *  member can reach and the files that merely test it.
 *
 *  ⚠️ The cheap substring pass is a PREFILTER, not the decision: any import of
 *  this module carries the literal name in its specifier, so it cannot produce a
 *  false negative, and the AST is what actually decides. The control below proves
 *  the pair finds the importers we already know about. */
function importersOfTarget() {
  const doors = []; const tests = []
  for (const f of walkDir(SRC)) {
    if (!/\.[jt]sx?$/.test(f) || f === TARGET) continue
    let text
    try { text = fs.readFileSync(f, 'utf8') } catch { continue }
    if (!text.includes('EvidenceTab')) continue
    let hit = false
    try { hit = resolvedImports(f).includes(TARGET) } catch { continue }
    if (!hit) continue
    ;(isTest(f) ? tests : doors).push(f)
  }
  return { doors: doors.sort(), tests: tests.sort() }
}

describe('EvidenceTab has exactly two doors and both open the same module', () => {
  for (const [name, file] of Object.entries(DOORS)) {
    it(`${name} imports ./EvidenceTab.jsx by path`, () => {
      expect(resolvedImports(file)).toContain(TARGET)
    })
  }

  it('⭐ ANTI-ROT: the derived importer set IS the named pair — a THIRD door reds this', () => {
    const { doors } = importersOfTarget()
    expect(doors, 'a production module importing EvidenceTab that is not a named door is '
      + 'a third Evidence surface; a named door missing from this set has had its wire cut')
      .toEqual(Object.values(DOORS).sort())
  })

  it('CONTROL: the walk is not vacuous — it also finds the files that TEST the module', () => {
    const { tests } = importersOfTarget()
    // ⚠️ NO FLOOR ASSERTION HERE. `>= 2` is satisfied by the two NAMED checks
    // below and is mutable to `>= 0` without any test noticing (measured: it
    // survived the W5a.7 sweep). A control that cannot fail is decoration.
    expect(tests.some((p) => path.basename(p) === 'EvidenceTab.test.jsx')).toBe(true)
    expect(tests.some((p) => path.basename(p) === 'ScanResults.evidence.test.jsx')).toBe(true)
  })

  it('CONTROL: the resolver sees a known sibling import, so an empty result would be a real absence', () => {
    expect(resolvedImports(DOORS.ScanResults)).toContain(path.resolve(HERE, '../../screener/CoverageLine.jsx'))
    expect(resolvedImports(DOORS.BuilderSheet)).toContain(path.resolve(HERE, 'FormulaField.jsx'))
  })

  it('CONTROL: the resolver resolves a .js sibling too, not only .jsx', () => {
    // `builderInputs.js` — the arm an unconditional `${base}.jsx` would miss.
    expect(resolvedImports(DOORS.BuilderSheet)).toContain(path.resolve(HERE, 'builderInputs.js'))
  })

  it('there is exactly ONE EvidenceTab.jsx under app/src', () => {
    const copies = [...walkDir(SRC)].filter((p) => path.basename(p) === 'EvidenceTab.jsx')
    expect(copies).toEqual([TARGET])
  })
})
